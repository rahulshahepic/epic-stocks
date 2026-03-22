import { useCallback, useState } from 'react'
import { api, ConflictError } from '../api.ts'
import type { SaleEntry, TaxBreakdown } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'

type SaleForm = Omit<SaleEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit'

const empty: SaleForm = {
  date: new Date().toISOString().slice(0, 10),
  shares: 0,
  price_per_share: 0,
  notes: '',
  loan_id: null,
}

function fmtUSD(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(r: number) {
  return (r * 100).toFixed(2) + '%'
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function TaxCard({ breakdown }: { breakdown: TaxBreakdown }) {
  const hasLT = breakdown.lt_shares > 0
  const hasST = breakdown.st_shares > 0
  const hasUnvested = breakdown.unvested_shares > 0
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-xs dark:border-green-800 dark:bg-green-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Estimated Tax Breakdown</h3>
      {hasUnvested && (
        <div className="mb-3 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
          Warning: {fmtNum(breakdown.unvested_shares)} shares may not yet be vested and could be taxed as ordinary income.
        </div>
      )}
      <div className="space-y-1">
        <Row label="Gross proceeds" value={fmtUSD(breakdown.gross_proceeds)} />
        {(hasLT || hasST) && <Row label="Cost basis (FIFO)" value={fmtUSD(breakdown.cost_basis)} />}
        {(hasLT || hasST) && <Row label="Net gain" value={fmtUSD(breakdown.net_gain)} bold />}
        {hasLT && (
          <Row
            label={`  Long-term (${fmtNum(breakdown.lt_shares)} shares) × ${fmtPct(breakdown.lt_rate)}`}
            value={fmtUSD(breakdown.lt_gain) + ' → ' + fmtUSD(breakdown.lt_tax)}
          />
        )}
        {hasST && (
          <Row
            label={`  Short-term (${fmtNum(breakdown.st_shares)} shares) × ${fmtPct(breakdown.st_rate)}`}
            value={fmtUSD(breakdown.st_gain) + ' → ' + fmtUSD(breakdown.st_tax)}
          />
        )}
        {hasUnvested && (
          <Row
            label={`  Unvested (${fmtNum(breakdown.unvested_shares)} shares) × ${fmtPct(breakdown.unvested_rate)}`}
            value={fmtUSD(breakdown.unvested_proceeds) + ' → ' + fmtUSD(breakdown.unvested_tax)}
          />
        )}
        <div className="my-2 border-t border-green-200 dark:border-green-700" />
        <Row label="Estimated total tax" value={fmtUSD(breakdown.estimated_tax)} bold />
        <Row label="Net after tax" value={fmtUSD(breakdown.net_proceeds)} bold />
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
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

export default function Sales() {
  const fetchSales = useCallback(() => api.getSales(), [])
  const { data: sales, loading, reload } = useApiData<SaleEntry[]>(fetchSales)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<SaleForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [breakdown, setBreakdown] = useState<TaxBreakdown | null>(null)
  const [loadingTax, setLoadingTax] = useState(false)

  useDataSync('sales', reload)

  function resetForm() {
    setForm(empty)
    setEditId(null)
    setEditVersion(1)
    setError('')
    setConflict(false)
    setBreakdown(null)
  }

  function openAdd() {
    resetForm()
    setMode('add')
  }

  function openEdit(s: SaleEntry) {
    const { id, version, ...rest } = s
    setForm(rest)
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)
    setBreakdown(null)
    setMode('edit')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setBreakdown(null)
    try {
      let saved: SaleEntry
      if (mode === 'add') {
        saved = await api.createSale(form)
      } else if (mode === 'edit' && editId != null) {
        saved = await api.updateSale(editId, { ...form, version: editVersion })
      } else {
        return
      }
      broadcastChange('sales')
      reload()
      setMode('list')
      resetForm()

      // Fetch tax breakdown for the saved sale
      setLoadingTax(true)
      try {
        const tax = await api.getSaleTax(saved.id)
        setBreakdown(tax)
      } finally {
        setLoadingTax(false)
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
    if (!confirm('Delete this sale?')) return
    await api.deleteSale(id)
    broadcastChange('sales')
    reload()
  }

  async function handleViewTax(id: number) {
    setLoadingTax(true)
    try {
      const tax = await api.getSaleTax(id)
      setBreakdown(tax)
    } catch {
      setError('Failed to load tax breakdown')
    } finally {
      setLoadingTax(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!sales) return <p className="p-6 text-center text-sm text-red-500">Failed to load sales</p>

  if (mode !== 'list') {
    const title = mode === 'add' ? 'Record Sale' : 'Edit Sale'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
        </div>
        {conflict && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
            <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
              This record was changed on another device.
            </p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { reload(); setMode('list'); resetForm() }} className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-700">Reload latest</button>
              <button onClick={() => { setMode('list'); resetForm() }} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300">Discard</button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sale Date" type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
          <Field label="Shares" type="number" value={form.shares} onChange={v => setForm(f => ({ ...f, shares: +v }))} />
          <Field label="Price per Share" type="number" step="0.01" value={form.price_per_share} onChange={v => setForm(f => ({ ...f, price_per_share: +v }))} />
          <div className="col-span-2">
            <Field label="Notes (optional)" type="text" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Show Tax'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sales</h2>
        <button onClick={openAdd} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700">
          + Sale
        </button>
      </div>

      {loadingTax && <p className="text-xs text-gray-400">Computing tax breakdown...</p>}
      {breakdown && !loadingTax && <TaxCard breakdown={breakdown} />}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Price/Share</th>
              <th className="px-3 py-2 text-right">Gross Proceeds</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sales.map(s => (
              <tr key={s.id} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{s.date}</td>
                <td className="px-3 py-2">
                  {s.loan_id != null ? (
                    <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                      Payoff
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                      Cash Out
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtNum(s.shares)}</td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtUSD(s.price_per_share)}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                  {fmtUSD(s.shares * s.price_per_share)}
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{s.notes || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => handleViewTax(s.id)} className="mr-2 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300">Tax</button>
                  <button onClick={() => openEdit(s)} className="mr-2 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">Edit</button>
                  <button onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No sales recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{sales.length} sales</p>
    </div>
  )
}
