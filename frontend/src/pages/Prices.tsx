import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import type { PriceEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

type PriceForm = Omit<PriceEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit'

const empty: PriceForm = { effective_date: '', price: 0 }

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

export default function Prices() {
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const { data: prices, loading, reload } = useApiData<PriceEntry[]>(fetchPrices)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<PriceForm>(empty)
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

  function openEdit(p: PriceEntry) {
    setForm({ effective_date: p.effective_date, price: p.price })
    setEditId(p.id)
    setError('')
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        await api.annualPrice({ effective_date: form.effective_date, price: form.price })
      } else if (editId != null) {
        await api.updatePrice(editId, form)
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
    if (!confirm('Delete this price entry?')) return
    await api.deletePrice(id)
    reload()
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!prices) return <p className="p-6 text-center text-sm text-red-500">Failed to load prices</p>

  if (mode !== 'list') {
    const title = mode === 'add' ? 'Add Price' : 'Edit Price'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Effective Date</span>
            <input
              type="date"
              value={form.effective_date}
              onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Price per Share</span>
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {mode === 'add' && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60 disabled:opacity-50"
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Share Prices</h2>
        <button onClick={openAdd} className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">
          + Price
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Effective Date</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {prices.map(p => (
              <tr key={p.id} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.effective_date}</td>
                <td className="px-3 py-2 text-right font-medium text-amber-700 dark:text-amber-400">{fmt$(p.price)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(p)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 mr-2">Edit</button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                </td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-400">No prices yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{prices.length} price entries</p>
    </div>
  )
}
