import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import type { LoanEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

type LoanForm = Omit<LoanEntry, 'id'>
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

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const LOAN_TYPES = ['Interest', 'Tax', 'Principal']

export default function Loans() {
  const fetchLoans = useCallback(() => api.getLoans(), [])
  const { data: loans, loading, reload } = useApiData<LoanEntry[]>(fetchLoans)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<LoanForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function resetForm() {
    setForm(empty)
    setEditId(null)
    setError('')
  }

  function openAdd() {
    resetForm()
    setMode('add')
  }

  function openEdit(l: LoanEntry) {
    const { id, ...rest } = l
    setForm(rest)
    setEditId(id)
    setError('')
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        await api.createLoan(form)
      } else if (editId != null) {
        await api.updateLoan(editId, form)
      }
      reload()
      if (addAnother) {
        resetForm()
      } else {
        setMode('list')
        resetForm()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this loan?')) return
    await api.deleteLoan(id)
    reload()
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!loans) return <p className="p-6 text-center text-sm text-red-500">Failed to load loans</p>

  if (mode !== 'list') {
    const title = mode === 'add' ? 'Add Loan' : 'Edit Loan'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
        </div>
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
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loans.map(l => (
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
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(l)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 mr-2">Edit</button>
                  <button onClick={() => handleDelete(l.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                </td>
              </tr>
            ))}
            {loans.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No loans yet</td></tr>
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
