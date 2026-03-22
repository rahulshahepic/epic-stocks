import { useCallback, useState } from 'react'
import { api, ConflictError } from '../api.ts'
import type { GrantEntry, LoanEntry, PriceEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'

type GrantForm = Omit<GrantEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit'

const empty: GrantForm = {
  year: new Date().getFullYear(),
  type: 'Purchase',
  shares: 0,
  price: 0,
  vest_start: '',
  periods: 4,
  exercise_date: '',
  dp_shares: 0,
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

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function latestPrice(prices: PriceEntry[] | null | undefined): number {
  if (!prices || prices.length === 0) return 0
  return prices.reduce((a, b) => a.effective_date > b.effective_date ? a : b).price
}

export default function Grants() {
  const fetchGrants = useCallback(() => api.getGrants(), [])
  const { data: grants, loading, reload } = useApiData<GrantEntry[]>(fetchGrants)
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const fetchLoans = useCallback(() => api.getLoans(), [])
  const { data: loans, reload: reloadLoans } = useApiData<LoanEntry[]>(fetchLoans)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<GrantForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  useDataSync('grants', reload)

  // Optional loan fields (for purchase-type grants in both add and edit)
  const [loanAmount, setLoanAmount] = useState(0)
  const [loanRate, setLoanRate] = useState(0)
  const [loanDueDate, setLoanDueDate] = useState('')
  const [loanNumber, setLoanNumber] = useState('')
  const [generatePayoffSale, setGeneratePayoffSale] = useState(true)
  const [editLoanId, setEditLoanId] = useState<number | null>(null)
  const [editLoanVersion, setEditLoanVersion] = useState(1)

  function resetForm() {
    setForm(empty)
    setLoanAmount(0)
    setLoanRate(0)
    setLoanDueDate('')
    setLoanNumber('')
    setGeneratePayoffSale(true)
    setEditId(null)
    setEditVersion(1)
    setEditLoanId(null)
    setEditLoanVersion(1)
    setError('')
    setConflict(false)
  }

  function openPurchase() {
    resetForm()
    setForm({ ...empty, type: 'Purchase', price: latestPrice(prices) })
    setMode('add')
  }

  function openBonus() {
    resetForm()
    setForm({ ...empty, type: 'Bonus', price: latestPrice(prices), dp_shares: 0 })
    setMode('add')
  }

  function openEdit(g: GrantEntry) {
    const { id, version, ...rest } = g
    setForm(rest)
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)

    const existingLoan = loans?.find(
      l => l.grant_year === g.year && l.grant_type === g.type && l.loan_type === 'Purchase'
    ) ?? null
    if (existingLoan) {
      setLoanAmount(existingLoan.amount)
      setLoanRate(existingLoan.interest_rate)
      setLoanDueDate(existingLoan.due_date)
      setLoanNumber(existingLoan.loan_number ?? '')
      setEditLoanId(existingLoan.id)
      setEditLoanVersion(existingLoan.version)
    } else {
      setLoanAmount(0)
      setLoanRate(0)
      setLoanDueDate('')
      setLoanNumber('')
      setEditLoanId(null)
      setEditLoanVersion(1)
    }
    setGeneratePayoffSale(true)
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        if (form.type === 'Purchase') {
          await api.newPurchase({
            year: form.year,
            shares: form.shares,
            price: form.price,
            vest_start: form.vest_start,
            periods: form.periods,
            exercise_date: form.exercise_date,
            dp_shares: form.dp_shares || undefined,
            loan_amount: loanAmount || undefined,
            loan_rate: loanRate || undefined,
            loan_due_date: loanDueDate || undefined,
            loan_number: loanNumber || undefined,
            generate_payoff_sale: loanAmount > 0 ? generatePayoffSale : undefined,
          })
        } else {
          await api.addBonus({
            year: form.year,
            shares: form.shares,
            price: form.price || undefined,
            vest_start: form.vest_start,
            periods: form.periods,
            exercise_date: form.exercise_date,
          })
        }
      } else if (mode === 'edit' && editId != null) {
        await api.updateGrant(editId, { ...form, version: editVersion })
        if (form.type === 'Purchase') {
          if (editLoanId != null) {
            await api.updateLoan(editLoanId, {
              amount: loanAmount,
              interest_rate: loanRate,
              due_date: loanDueDate,
              loan_number: loanNumber || null,
              version: editLoanVersion,
            })
            broadcastChange('loans')
            reloadLoans()
          } else if (loanAmount > 0) {
            await api.createLoan({
              grant_year: form.year,
              grant_type: 'Purchase',
              loan_type: 'Purchase',
              loan_year: form.year,
              amount: loanAmount,
              interest_rate: loanRate,
              due_date: loanDueDate,
              loan_number: loanNumber || null,
            }, generatePayoffSale)
            broadcastChange('loans')
            reloadLoans()
          }
        }
      }
      broadcastChange('grants')
      reload()
      if (addAnother) {
        const prevType = form.type
        resetForm()
        setForm(() => ({ ...empty, type: prevType, price: latestPrice(prices) }))
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
    if (!confirm('Delete this grant?')) return
    await api.deleteGrant(id)
    broadcastChange('grants')
    reload()
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!grants) return <p className="p-6 text-center text-sm text-red-500">Failed to load grants</p>

  const showLoanSection = form.type === 'Purchase'

  if (mode !== 'list') {
    const title = mode === 'add'
      ? (form.type === 'Purchase' ? 'New Purchase Grant' : 'New Bonus Grant')
      : 'Edit Grant'

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

        {/* Grant type selector — only for add mode so user can switch between Purchase/Bonus */}
        {mode === 'add' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: 'Purchase', dp_shares: f.dp_shares }))}
              className={`rounded-md px-3 py-1 text-xs font-medium ${form.type === 'Purchase' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}`}
            >
              Purchase
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: 'Bonus', dp_shares: 0 }))}
              className={`rounded-md px-3 py-1 text-xs font-medium ${form.type === 'Bonus' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}`}
            >
              Bonus
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" type="number" value={form.year} onChange={v => setForm(f => ({ ...f, year: +v }))} />
          <Field label="Shares" type="number" value={form.shares} onChange={v => setForm(f => ({ ...f, shares: +v }))} />
          <Field
            label={form.type === 'Bonus' ? 'Cost Basis (optional)' : 'Cost Basis'}
            type="number" step="0.01"
            value={form.price}
            onChange={v => setForm(f => ({ ...f, price: +v }))}
          />
          <Field label="Vest Start" type="date" value={form.vest_start} onChange={v => setForm(f => ({ ...f, vest_start: v }))} />
          <Field label="Vest Periods" type="number" value={form.periods} onChange={v => setForm(f => ({ ...f, periods: +v }))} />
          <Field label="Exercise Date" type="date" value={form.exercise_date} onChange={v => setForm(f => ({ ...f, exercise_date: v }))} />
          {form.type === 'Purchase' && (
            <FieldWithInfo label="Down Payment Shares" info="Shares used as down payment in a stock exchange" type="number" value={form.dp_shares} onChange={v => setForm(f => ({ ...f, dp_shares: +v }))} />
          )}
        </div>

        {showLoanSection && (
          <>
            <h3 className="pt-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              {mode === 'edit' && editLoanId != null ? 'Purchase Loan' : mode === 'edit' ? 'Add Loan' : 'Optional Loan'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loan Amount" type="number" step="0.01" value={loanAmount} onChange={v => setLoanAmount(+v)} />
              <Field label="Interest Rate (%)" type="number" step="0.01" value={loanRate} onChange={v => setLoanRate(+v)} />
              <Field label="Due Date" type="date" value={loanDueDate} onChange={v => setLoanDueDate(v)} />
              <Field label="Loan Number" type="text" value={loanNumber} onChange={v => setLoanNumber(v)} />
            </div>
            {loanAmount > 0 && editLoanId == null && (
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
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {mode !== 'edit' && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="rounded-md bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 disabled:opacity-50"
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Grants</h2>
        <div className="flex gap-2">
          <button onClick={openPurchase} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700">
            + Purchase
          </button>
          <button onClick={openBonus} className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">
            + Bonus
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Cost Basis</th>
              <th className="px-3 py-2">Vest Start</th>
              <th className="px-3 py-2 text-right">Periods</th>
              <th className="px-3 py-2">Exercise</th>
              <th className="px-3 py-2 text-right" title="Down Payment Shares">Down Pmt</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {grants.map(g => (
              <tr key={g.id} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{g.year}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${g.type === 'Purchase' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                    {g.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtNum(g.shares)}</td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtPrice(g.price)}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{g.vest_start}</td>
                <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{g.periods}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{g.exercise_date}</td>
                <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{g.dp_shares ? fmtNum(g.dp_shares) : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(g)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 mr-2">Edit</button>
                  <button onClick={() => handleDelete(g.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                </td>
              </tr>
            ))}
            {grants.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No grants yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{grants.length} grants</p>
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

function FieldWithInfo({ label, info, type, value, onChange, step }: {
  label: string; info: string; type: string; value: string | number; onChange: (v: string) => void; step?: string
}) {
  const [showInfo, setShowInfo] = useState(false)
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {label}
        <button
          type="button"
          onClick={e => { e.preventDefault(); setShowInfo(v => !v) }}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 leading-none"
          aria-label="More info"
        >ⓘ</button>
      </span>
      {showInfo && <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{info}</p>}
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
