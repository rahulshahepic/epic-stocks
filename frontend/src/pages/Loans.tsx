import { useCallback, useState } from 'react'
import { api, ConflictError } from '../api.ts'
import type { LoanEntry, SaleEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'

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
        <button onClick={onDiscard} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
          Discard my changes
        </button>
      </div>
    </div>
  )
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const LOAN_TYPES = ['Interest', 'Tax', 'Principal', 'Purchase']

export default function Loans() {
  const fetchLoans = useCallback(() => api.getLoans(), [])
  const { data: loans, loading, reload } = useApiData<LoanEntry[]>(fetchLoans)
  const fetchSales = useCallback(() => api.getSales(), [])
  const { data: sales, reload: reloadSales } = useApiData<SaleEntry[]>(fetchSales)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<LoanForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [generatePayoffSale, setGeneratePayoffSale] = useState(true)
  const [generatingSale, setGeneratingSale] = useState(false)

  useDataSync('loans', reload)
  useDataSync('sales', reloadSales)

  function resetForm() {
    setForm(empty)
    setEditId(null)
    setEditVersion(1)
    setError('')
    setConflict(false)
    setGeneratePayoffSale(true)
  }

  function openAdd() {
    resetForm()
    setMode('add')
  }

  function openEdit(l: LoanEntry) {
    const { id, version, ...rest } = l
    setForm(rest)
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        await api.createLoan(form, generatePayoffSale)
      } else if (editId != null) {
        await api.updateLoan(editId, { ...form, version: editVersion })
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

  async function handleGeneratePayoffSale() {
    if (!editId) return
    setGeneratingSale(true)
    setError('')
    try {
      const suggestion = await api.getLoanPayoffSuggestion(editId)
      await api.createSale({
        date: suggestion.date,
        shares: suggestion.shares,
        price_per_share: suggestion.price_per_share,
        loan_id: suggestion.loan_id,
        notes: suggestion.notes,
      })
      broadcastChange('sales')
      reloadSales()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate payoff sale')
    } finally {
      setGeneratingSale(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this loan?')) return
    await api.deleteLoan(id)
    broadcastChange('loans')
    reload()
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!loans) return <p className="p-6 text-center text-sm text-red-500">Failed to load loans</p>

  if (mode !== 'list') {
    const title = mode === 'add' ? 'Add Loan' : 'Edit Loan'
    const linkedSale: SaleEntry | undefined = mode === 'edit' && editId != null
      ? sales?.find(s => s.loan_id === editId)
      : undefined

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
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
            <span className="text-xs text-gray-500 dark:text-gray-400">Grant Type</span>
            <select
              value={form.grant_type}
              onChange={e => setForm(f => ({ ...f, grant_type: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              <option value="Purchase">Purchase</option>
              <option value="Bonus">Bonus</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Loan Type</span>
            <select
              value={form.loan_type}
              onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="Loan Year" type="number" value={form.loan_year} onChange={v => setForm(f => ({ ...f, loan_year: +v }))} />
          <Field label="Amount" type="number" step="0.01" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: +v }))} />
          <Field label="Interest Rate (%)" type="number" step="0.01" value={form.interest_rate} onChange={v => setForm(f => ({ ...f, interest_rate: +v }))} />
          <Field label="Due Date" type="date" value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} />
          <Field label="Loan Number" type="text" value={form.loan_number ?? ''} onChange={v => setForm(f => ({ ...f, loan_number: v || null }))} />
        </div>

        {mode === 'add' && (
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={generatePayoffSale}
              onChange={e => setGeneratePayoffSale(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span>
              Generate payoff sale (recommended)
              <span className="ml-1 text-gray-400" title="Creates a stock sale at the loan's due date sized to cover the payoff after capital gains tax">ⓘ</span>
            </span>
          </label>
        )}

        {mode === 'edit' && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Payoff Sale</h3>
            {linkedSale ? (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                <p className="text-xs font-medium text-green-800 dark:text-green-300">Sale linked</p>
                <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                  {linkedSale.date} · {linkedSale.shares.toLocaleString()} shares @ ${linkedSale.price_per_share.toFixed(2)}/share
                  {linkedSale.notes && <span className="ml-1 text-gray-400">— {linkedSale.notes}</span>}
                </p>
                <p className="mt-1 text-[10px] text-gray-400">To edit this sale, go to the Sales page.</p>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">No payoff sale linked to this loan.</p>
                <button
                  type="button"
                  onClick={handleGeneratePayoffSale}
                  disabled={generatingSale}
                  className="mt-2 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {generatingSale ? 'Generating...' : 'Generate payoff sale suggestion'}
                </button>
                <p className="mt-1 text-[10px] text-gray-400">Calculates gross-up shares to cover the cash due after tax.</p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
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
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Loans</h2>
        <button onClick={openAdd} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">
          + Loan
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Grant</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Loan #</th>
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loans.map(l => {
              const hasSale = sales?.some(s => s.loan_id === l.id)
              return (
                <tr key={l.id} className="bg-white dark:bg-gray-900">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300">{l.grant_year} {l.grant_type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      l.loan_type === 'Interest' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                      l.loan_type === 'Tax' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' :
                      'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                    }`}>
                      {l.loan_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{l.loan_year}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmt$(l.amount)}</td>
                  <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{l.interest_rate}%</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{l.due_date}</td>
                  <td className="px-3 py-2 text-gray-400">{l.loan_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    {hasSale
                      ? <span className="text-[10px] text-green-600 dark:text-green-400">✓ linked</span>
                      : <span className="text-[10px] text-gray-400">none</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(l)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 mr-2">Edit</button>
                    <button onClick={() => handleDelete(l.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                  </td>
                </tr>
              )
            })}
            {loans.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No loans yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{loans.length} loans</p>
    </div>
  )
}

function Field({ label, type, value, onChange, step }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; step?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      />
    </label>
  )
}
