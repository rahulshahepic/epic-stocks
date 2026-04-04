import { useCallback, useState } from 'react'
import { api, ConflictError } from '../../api.ts'
import type { LoanEntry, LoanPayoffSuggestion, SaleEntry, TaxSettings } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'
import { TaxRateFields, TrancheTable, ratesFromDefaults, ratesFromSale, DEFAULT_RATES } from './Sales.tsx'
import type { TaxRates } from './Sales.tsx'
import type { TrancheAllocation } from '../../api.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'

type LoanForm = Omit<LoanEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit'

const empty: LoanForm = {
  grant_year: new Date().getFullYear(),
  grant_type: 'Purchase',
  loan_type: 'Interest',
  loan_year: new Date().getFullYear(),
  amount: 0,
  interest_rate: 0,
  due_date: '',
  loan_number: null,
  refinances_loan_id: null,
}

function loanLabel(l: LoanEntry, refinancedIds?: Set<number>) {
  const num = l.loan_number ? ` #${l.loan_number}` : ''
  const rate = `${(l.interest_rate * 100).toFixed(2)}%`
  const refinanced = refinancedIds?.has(l.id) ? ' [refinanced]' : ''
  return `${l.grant_year} ${l.grant_type} ${l.loan_type}${num} – ${rate} – ${l.due_date}${refinanced}`
}

function ConflictBanner({ onReload, onDiscard }: { onReload: () => void; onDiscard: () => void }) {
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
      <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
        This record was changed on another device. Reload to see the latest version, or discard your changes.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={onReload} className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-700">
          Reload latest
        </button>
        <button onClick={onDiscard} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-gray-600">
          Discard my changes
        </button>
      </div>
    </div>
  )
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const LOAN_TYPES = ['Interest', 'Tax', 'Purchase']

export default function Loans() {
  const fetchLoans = useCallback(() => api.getLoans(), [])
  const { data: loans, loading, reload } = useApiData<LoanEntry[]>(fetchLoans)
  const fetchSales = useCallback(() => api.getSales(), [])
  const { data: sales, reload: reloadSales } = useApiData<SaleEntry[]>(fetchSales)
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)

  const [mode, setMode] = useState<Mode>('list')
  const [expandedLoanId, setExpandedLoanId] = useState<number | null>(null)
  const [form, setForm] = useState<LoanForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [payoffSaleChecked, setPayoffSaleChecked] = useState(true)
  const [saleRates, setSaleRates] = useState<TaxRates>(DEFAULT_RATES)
  const [regenerating, setRegenerating] = useState(false)
  const [payoffModal, setPayoffModal] = useState<{ loan: LoanEntry; suggestion: LoanPayoffSuggestion | null; existingSale: SaleEntry | null } | null>(null)
  const [payoffExecuting, setPayoffExecuting] = useState(false)
  const [payoffError, setPayoffError] = useState('')
  const [payoffTranche, setPayoffTranche] = useState<TrancheAllocation | null>(null)
  const [payoffTrancheLoading, setPayoffTrancheLoading] = useState(false)

  const config = useConfig()
  const epicMode = !!config?.epic_mode

  useDataSync('loans', reload)
  useDataSync('sales', reloadSales)

  function resetForm() {
    setForm(empty)
    setEditId(null)
    setEditVersion(1)
    setError('')
    setConflict(false)
    setPayoffSaleChecked(true)
    setSaleRates(ratesFromDefaults(taxSettings))
  }

  function openAdd() {
    resetForm()
    setPayoffSaleChecked(true)
    setSaleRates(ratesFromDefaults(taxSettings))
    setMode('add')
  }

  function openEdit(l: LoanEntry) {
    const { id, version, ...rest } = l  // eslint-disable-line @typescript-eslint/no-unused-vars
    setForm(rest)
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)
    const linkedSale = sales?.find(s => s.loan_id === id) ?? null
    setPayoffSaleChecked(!!linkedSale)
    setSaleRates(linkedSale ? ratesFromSale(linkedSale, taxSettings) : ratesFromDefaults(taxSettings))
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      let savedLoanId: number

      if (mode === 'add') {
        const newLoan = await api.createLoan(form, false)  // handle payoff sale manually
        savedLoanId = newLoan.id
      } else if (editId != null) {
        await api.updateLoan(editId, { ...form, version: editVersion })
        savedLoanId = editId
      } else {
        return
      }

      // Handle payoff sale
      const linkedSale = sales?.find(s => s.loan_id === savedLoanId)
      if (payoffSaleChecked) {
        const suggestion = await api.getLoanPayoffSuggestion(savedLoanId)
        const salePayload = {
          date: suggestion.date,
          shares: suggestion.shares,
          price_per_share: suggestion.price_per_share,
          notes: suggestion.notes,
          loan_id: savedLoanId,
          ...saleRates,
        }
        if (linkedSale) {
          await api.updateSale(linkedSale.id, { ...salePayload, version: linkedSale.version })
        } else {
          await api.createSale(salePayload)
        }
        broadcastChange('sales')
        reloadSales()
      } else if (linkedSale) {
        await api.deleteSale(linkedSale.id)
        broadcastChange('sales')
        reloadSales()
      }

      broadcastChange('loans')
      reload()
      if (addAnother) {
        resetForm()
      } else {
        setMode('list')
        resetForm()
      }
    } catch (e: unknown) {
      if (e instanceof ConflictError) {
        setConflict(true)
      } else {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this loan?')) return
    await api.deleteLoan(id)
    broadcastChange('loans')
    reload()
  }

  async function handleRegenerateAll() {
    if (!confirm('Recompute payoff sale share counts for all future loans using current lot selection method?')) return
    setRegenerating(true)
    try {
      const result = await api.regenerateAllPayoffSales()
      broadcastChange('sales')
      reloadSales()
      alert(`Updated ${result.updated} payoff sale${result.updated !== 1 ? 's' : ''}.`)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to regenerate payoff sales')
    } finally {
      setRegenerating(false)
    }
  }

  function closePayoffModal() {
    setPayoffModal(null)
    setPayoffTranche(null)
  }

  async function openPayoffModal(loan: LoanEntry) {
    const existingSale = sales?.find(s => s.loan_id === loan.id) ?? null
    setPayoffModal({ loan, suggestion: null, existingSale })
    setPayoffError('')
    setPayoffTranche(null)
    setPayoffTrancheLoading(true)
    try {
      const suggestion = await api.getLoanPayoffSuggestion(loan.id)
      setPayoffModal({ loan, suggestion, existingSale })
      // Fetch same-tranche allocation using the suggestion's date and shares
      try {
        const alloc = await api.getTrancheAllocation({
          sale_date: suggestion.date,
          shares: suggestion.shares,
          method: 'epic_lifo',
          grant_year: loan.grant_year,
          grant_type: loan.grant_type,
        })
        setPayoffTranche(alloc)
      } catch {
        // tranche load is non-fatal
      }
    } catch {
      setPayoffError('Failed to load payoff estimate')
    } finally {
      setPayoffTrancheLoading(false)
    }
  }

  async function handleExecutePayoff() {
    if (!payoffModal?.suggestion) return
    setPayoffExecuting(true)
    setPayoffError('')
    try {
      const { suggestion, existingSale, loan } = payoffModal
      if (existingSale) {
        await api.updateSale(existingSale.id, {
          date: suggestion.date,
          shares: suggestion.shares,
          price_per_share: suggestion.price_per_share,
          notes: suggestion.notes,
          loan_id: loan.id,
          version: existingSale.version,
        })
      } else {
        await api.executePayoff(loan.id)
      }
      broadcastChange('sales')
      reloadSales()
      closePayoffModal()
    } catch (e: unknown) {
      setPayoffError(e instanceof Error ? e.message : 'Failed to execute payoff')
    } finally {
      setPayoffExecuting(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-stone-500">Loading...</p>
  if (!loans) return <p className="p-6 text-center text-sm text-red-500">Failed to load loans</p>

  if (mode !== 'list') {
    const title = mode === 'add' ? 'Add Loan' : 'Edit Loan'

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-slate-300">Cancel</button>
        </div>
        {conflict && (
          <ConflictBanner
            onReload={() => { reload(); setMode('list'); resetForm() }}
            onDiscard={() => { setMode('list'); resetForm() }}
          />
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Grant Year" type="number" value={form.grant_year} onChange={v => setForm(f => ({ ...f, grant_year: +v }))} />
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Grant Type</span>
            <select
              value={form.grant_type}
              onChange={e => setForm(f => ({ ...f, grant_type: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="Purchase">Purchase</option>
              <option value="Bonus">Bonus</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Loan Type</span>
            <select
              value={form.loan_type}
              onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="Loan Year" type="number" value={form.loan_year} onChange={v => setForm(f => ({ ...f, loan_year: +v }))} />
          <Field label="Amount" type="number" step="0.01" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: +v }))} />
          <Field label="Interest Rate (%)" type="number" step="0.01" value={+(form.interest_rate * 100).toFixed(4)} onChange={v => setForm(f => ({ ...f, interest_rate: +v / 100 }))} />
          <Field label="Due Date" type="date" value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} />
          <Field label="Loan Number" type="text" value={form.loan_number ?? ''} onChange={v => setForm(f => ({ ...f, loan_number: v || null }))} />
          <label className="col-span-2 block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Refinances loan (optional)</span>
            <select
              value={form.refinances_loan_id ?? ''}
              onChange={e => setForm(f => ({ ...f, refinances_loan_id: e.target.value ? +e.target.value : null }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">— None —</option>
              {(() => {
                const refinancedIds = new Set((loans ?? []).map(o => o.refinances_loan_id).filter((id): id is number => id !== null))
                return (loans ?? [])
                  .filter(l => l.id !== editId)
                  .map(l => (
                    <option key={l.id} value={l.id}>{loanLabel(l, refinancedIds)}</option>
                  ))
              })()}
            </select>
            {form.refinances_loan_id && (
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                The old loan's payoff event will show as "Refinanced" with $0 cash due. Its auto-generated sale will be removed.
              </p>
            )}
          </label>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={payoffSaleChecked}
              onChange={e => setPayoffSaleChecked(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600"
            />
            <span>Payoff loan via sale</span>
          </label>
          {payoffSaleChecked && (
            <TaxRateFields
              rates={saleRates}
              onChange={setSaleRates}
              onReset={() => setSaleRates(ratesFromDefaults(taxSettings))}
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {mode === 'add' && (
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 disabled:opacity-50"
              >
                Save & Add Another
              </button>
            )}
          </div>
          {mode === 'edit' && editId != null && (
            <button
              onClick={() => handleDelete(editId)}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete loan
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Loans</h2>
        {epicMode
          ? <p className="text-xs text-rose-700 dark:text-rose-400">Data provided by Epic</p>
          : <div className="flex gap-2">
              <button
                onClick={handleRegenerateAll}
                disabled={regenerating}
                className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-gray-600"
                title="Recompute payoff sale share counts for all future loans using current lot selection method"
              >
                {regenerating ? 'Regenerating…' : 'Regen payoff sales'}
              </button>
              <button onClick={openAdd} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">
                + Loan
              </button>
            </div>
        }
      </div>

      <div tabIndex={0} className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr className="text-gray-500 dark:text-slate-400">
              <th className="px-3 py-2">Grant</th>
              <th className="px-3 py-2 text-right">Loan Yr</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loans.map(l => {
              const linkedSale = sales?.find(s => s.loan_id === l.id)
              const hasSale = !!linkedSale
              const isExpanded = expandedLoanId === l.id
              const refinancedByLoan = loans.find(other => other.refinances_loan_id === l.id)
              return (
                <>
                  <tr key={l.id} className="bg-white dark:bg-slate-900">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-slate-300">
                      {l.grant_year} {l.grant_type}
                      {refinancedByLoan && (
                        <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 dark:bg-slate-700 dark:text-slate-400" title={`Refinanced by ${loanLabel(refinancedByLoan)}`}>
                          Refinanced
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 dark:text-slate-400">{l.loan_year}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        l.loan_type === 'Interest' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                        l.loan_type === 'Tax' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' :
                        'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                      }`}>
                        {l.loan_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmt$(l.amount)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 dark:text-slate-400">{(l.interest_rate * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{l.due_date}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setExpandedLoanId(isExpanded ? null : l.id)}
                        className={`text-[10px] underline decoration-dotted ${hasSale ? 'text-green-700 dark:text-green-300' : 'text-stone-500 dark:text-slate-400'}`}
                      >
                        {hasSale ? '✓ linked' : 'none'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {epicMode
                        ? <button onClick={() => openPayoffModal(l)} className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 text-xs font-medium">Request Payoff</button>
                        : <button onClick={() => openEdit(l)} className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300">Edit</button>
                      }
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${l.id}-detail`} className="bg-white dark:bg-slate-900">
                      <td colSpan={7} className="px-3 pb-3 pt-0">
                        <div className="rounded-md bg-stone-50 p-3 dark:bg-slate-800">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            {l.loan_number && <div className="col-span-2"><span className="text-stone-500 dark:text-slate-400">Loan #</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{l.loan_number}</span></div>}
                            {linkedSale && (
                              <>
                                <div><span className="text-stone-500 dark:text-slate-400">Sale date</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{linkedSale.date}</span></div>
                                <div><span className="text-stone-500 dark:text-slate-400">Shares</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{linkedSale.shares.toLocaleString('en-US')}</span></div>
                                <div><span className="text-stone-500 dark:text-slate-400">Price</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{linkedSale.price_per_share.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}</span></div>
                                <div><span className="text-stone-500 dark:text-slate-400">Gross</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{fmt$(linkedSale.shares * linkedSale.price_per_share)}</span></div>
                              </>
                            )}
                            {!l.loan_number && !linkedSale && (
                              <div className="col-span-2 text-stone-500">No additional details</div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {loans.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">No loans yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">{loans.length} loans</p>

      {payoffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePayoffModal}>
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Request Early Payoff</h3>
              <button onClick={closePayoffModal} aria-label="Close dialog" className="text-stone-500 hover:text-gray-600 dark:hover:text-slate-300">✕</button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              {payoffModal.loan.grant_year} {payoffModal.loan.grant_type} — {payoffModal.loan.loan_type} loan
            </p>
            {payoffModal.existingSale && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Existing payoff sale on {payoffModal.existingSale.date} will be updated.
              </p>
            )}

            {!payoffModal.suggestion && !payoffError && (
              <p className="mt-4 text-center text-xs text-stone-500">Loading estimate…</p>
            )}

            {payoffModal.suggestion && (
              <>
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-slate-400">Outstanding balance</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{payoffModal.suggestion.cash_due.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-slate-400">Shares to sell</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{payoffModal.suggestion.shares.toLocaleString('en-US')}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-slate-400">Price per share</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{payoffModal.suggestion.price_per_share.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2 dark:border-slate-700">
                    <dt className="text-gray-500 dark:text-slate-400">Est. gross proceeds</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{(payoffModal.suggestion.shares * payoffModal.suggestion.price_per_share).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-slate-400">Sale date</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{payoffModal.suggestion.date}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <TrancheTable
                    lines={payoffTranche?.lines ?? []}
                    loading={payoffTrancheLoading && !payoffTranche}
                    manual={false}
                    manualAlloc={{}}
                    onManualChange={() => {}}
                    date={payoffModal.suggestion.date}
                  />
                </div>
              </>
            )}

            {payoffError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{payoffError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closePayoffModal} className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-slate-300">Cancel</button>
              <button
                onClick={handleExecutePayoff}
                disabled={payoffExecuting || !payoffModal.suggestion}
                className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {payoffExecuting ? 'Processing…' : payoffModal.existingSale ? 'Update Payoff Sale' : 'Confirm Payoff'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, type, value, onChange, step }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; step?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      />
    </label>
  )
}
