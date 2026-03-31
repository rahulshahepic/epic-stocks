import { useCallback, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import type { PriceEntry } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'

type PriceForm = Omit<PriceEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit' | 'estimate'

type EstimateForm = {
  base_price: number
  start_date: string
  end_date: string
  annual_rate_pct: number
  frequency: 'annual' | 'quarterly' | 'monthly'
}

const empty: PriceForm = { effective_date: '', price: 0 }

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function computePreview(form: EstimateForm): { date: string; price: number }[] {
  const { base_price, start_date, end_date, annual_rate_pct, frequency } = form
  if (!base_price || base_price <= 0 || !start_date || !end_date || start_date >= end_date) return []
  const rate = annual_rate_pct / 100
  const start = new Date(start_date + 'T00:00:00')
  const end = new Date(end_date + 'T00:00:00')
  const results: { date: string; price: number }[] = []
  let current = new Date(start)
  let safety = 0
  while (current <= end && safety < 600) {
    safety++
    const yearsElapsed = (current.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000)
    const price = Math.round(base_price * Math.pow(1 + rate, yearsElapsed) * 100) / 100
    results.push({ date: current.toISOString().slice(0, 10), price })
    const next = new Date(current)
    if (frequency === 'annual') next.setFullYear(next.getFullYear() + 1)
    else if (frequency === 'quarterly') next.setMonth(next.getMonth() + 3)
    else next.setMonth(next.getMonth() + 1)
    current = next
  }
  return results
}

export default function Prices() {
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const { data: prices, loading, reload } = useApiData<PriceEntry[]>(fetchPrices)

  const config = useConfig()
  const epicMode = config?.epic_mode ?? false

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<PriceForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const nextYear = new Date().getFullYear() + 1
  const [estimateForm, setEstimateForm] = useState<EstimateForm>({
    base_price: 0,
    start_date: `${nextYear}-01-01`,
    end_date: `${nextYear + 4}-01-01`,
    annual_rate_pct: 10,
    frequency: 'annual',
  })

  const preview = useMemo(() => {
    if (mode !== 'estimate') return []
    return computePreview(estimateForm)
  }, [mode, estimateForm])

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

  function openEstimate() {
    const latest = prices?.[prices.length - 1]
    setEstimateForm(f => ({
      ...f,
      base_price: latest?.price ?? 0,
    }))
    setError('')
    setMode('estimate')
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

  async function handleGenerate() {
    if (preview.length === 0) return
    setSaving(true)
    setError('')
    try {
      await api.growthEstimate({
        base_price: estimateForm.base_price,
        start_date: estimateForm.start_date,
        end_date: estimateForm.end_date,
        annual_rate_pct: estimateForm.annual_rate_pct,
        frequency: estimateForm.frequency,
      })
      reload()
      setMode('list')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed')
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

  if (mode === 'estimate') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Growth Estimator</h2>
          <button onClick={() => setMode('list')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Base Price</span>
            <input
              type="number"
              step="0.01"
              value={estimateForm.base_price}
              onChange={e => setEstimateForm(f => ({ ...f, base_price: +e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Annual Growth %</span>
            <input
              type="number"
              step="0.1"
              value={estimateForm.annual_rate_pct}
              onChange={e => setEstimateForm(f => ({ ...f, annual_rate_pct: +e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Start Date</span>
            <input
              type="date"
              value={estimateForm.start_date}
              onChange={e => setEstimateForm(f => ({ ...f, start_date: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">End Date</span>
            <input
              type="date"
              value={estimateForm.end_date}
              onChange={e => setEstimateForm(f => ({ ...f, end_date: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block col-span-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Frequency</span>
            <select
              value={estimateForm.frequency}
              onChange={e => setEstimateForm(f => ({ ...f, frequency: e.target.value as EstimateForm['frequency'] }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>

        {preview.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{preview.length} price{preview.length !== 1 ? 's' : ''} to generate</p>
            <div className="overflow-x-auto overflow-y-auto max-h-56 rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                  <tr className="text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {preview.map(row => (
                    <tr key={row.date} className="bg-white dark:bg-gray-900">
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{row.date}</td>
                      <td className="px-3 py-1.5 text-right font-medium text-amber-700 dark:text-amber-400">{fmt$(row.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={saving || preview.length === 0}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? 'Generating...' : preview.length > 0 ? `Generate ${preview.length} Price${preview.length !== 1 ? 's' : ''}` : 'Generate'}
        </button>
      </div>
    )
  }

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
        {!epicMode && (
          <div className="flex gap-2">
            <button onClick={openEstimate} className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60">
              % Growth
            </button>
            <button onClick={openAdd} className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">
              + Price
            </button>
          </div>
        )}
      </div>
      {epicMode && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
          Data provided by Epic — view only
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Effective Date</th>
              <th className="px-3 py-2 text-right">Price</th>
              {!epicMode && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {prices.map(p => (
              <tr key={p.id} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.effective_date}</td>
                <td className="px-3 py-2 text-right font-medium text-amber-700 dark:text-amber-400">{fmt$(p.price)}</td>
                {!epicMode && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(p)} className="mr-2 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">Edit</button>
                    <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                  </td>
                )}
              </tr>
            ))}
            {prices.length === 0 && (
              <tr><td colSpan={epicMode ? 2 : 3} className="px-3 py-6 text-center text-gray-400">No prices yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{prices.length} price entries</p>
    </div>
  )
}
