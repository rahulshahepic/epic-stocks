import { useCallback, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import type { PriceEntry } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'

type PriceForm = { effective_date: string; price: number }
type Mode = 'list' | 'add' | 'edit' | 'growth'

type GrowthForm = {
  annual_growth_pct: number
  first_date: string
  through_date: string
}

const TODAY = new Date().toISOString().slice(0, 10)

function nextMarch1(): string {
  const today = new Date()
  const march1 = new Date(today.getFullYear(), 2, 1) // month is 0-indexed
  return today > march1
    ? `${today.getFullYear() + 1}-03-01`
    : `${today.getFullYear()}-03-01`
}

function addYears(iso: string, n: number): string {
  return `${+iso.slice(0, 4) + n}${iso.slice(4)}`
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function computeGrowthPreview(
  basePrice: number,
  annual_growth_pct: number,
  first_date: string,
  through_date: string,
): { date: string; price: number }[] {
  if (!basePrice || !first_date || !through_date || first_date > through_date) return []
  const multiplier = 1 + annual_growth_pct / 100
  const results: { date: string; price: number }[] = []
  let current = first_date
  let price = Math.round(basePrice * multiplier * 100) / 100
  while (current <= through_date) {
    results.push({ date: current, price })
    const year = +current.slice(0, 4) + 1
    current = `${year}${current.slice(4)}`
    price = Math.round(price * multiplier * 100) / 100
  }
  return results
}

export default function Prices() {
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const { data: prices, loading, reload } = useApiData<PriceEntry[]>(fetchPrices)

  const config = useConfig()
  const epicMode = config?.epic_mode ?? false

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<PriceForm>({ effective_date: '', price: 0 })
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const defaultFirst = nextMarch1()
  const [growthForm, setGrowthForm] = useState<GrowthForm>({
    annual_growth_pct: 5,
    first_date: defaultFirst,
    through_date: addYears(defaultFirst, 4),
  })
  const [growthSaving, setGrowthSaving] = useState(false)
  const [growthError, setGrowthError] = useState('')

  function resetForm() {
    setForm({ effective_date: '', price: 0 })
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
    if (epicMode && form.effective_date <= TODAY) {
      setError('Only future-dated prices can be added in Epic mode')
      return
    }
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

  // Most recent non-estimate price for growth preview base
  const basePrice = useMemo(() => {
    if (!prices) return 0
    const real = prices.filter(p => !p.is_estimate && p.effective_date <= TODAY)
    return real.length ? real[real.length - 1].price : 0
  }, [prices])

  const growthPreview = useMemo(
    () => computeGrowthPreview(basePrice, growthForm.annual_growth_pct, growthForm.first_date, growthForm.through_date),
    [basePrice, growthForm],
  )

  async function handleGrowthApply() {
    if (!growthForm.first_date || growthForm.first_date <= TODAY) {
      setGrowthError('First date must be in the future')
      return
    }
    if (growthForm.through_date < growthForm.first_date) {
      setGrowthError('Through date must be after first date')
      return
    }
    setGrowthSaving(true)
    setGrowthError('')
    try {
      await api.growthPrice({
        annual_growth_pct: growthForm.annual_growth_pct,
        first_date: growthForm.first_date,
        through_date: growthForm.through_date,
      })
      reload()
      setMode('list')
    } catch (e: unknown) {
      setGrowthError(e instanceof Error ? e.message : 'Failed to apply estimates')
    } finally {
      setGrowthSaving(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!prices) return <p className="p-6 text-center text-sm text-red-500">Failed to load prices</p>

  // ── Add / Edit form ───────────────────────────────────────────────────────
  if (mode === 'add' || mode === 'edit') {
    const title = mode === 'add' ? 'Add Price' : 'Edit Price'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            onClick={() => { setMode('list'); resetForm() }}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
        {epicMode && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            In Epic mode, only future-dated prices can be added.
          </p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Effective Date</span>
            <input
              type="date"
              value={form.effective_date}
              min={epicMode ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : undefined}
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
              Save &amp; Add Another
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Growth estimator form ─────────────────────────────────────────────────
  if (mode === 'growth') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Growth Estimator</h2>
          <button
            onClick={() => { setMode('list'); setGrowthError('') }}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Project future share prices as annual % growth from the current price
          {basePrice > 0 ? ` (${fmt$(basePrice)})` : ''}.
          Existing estimates in the selected range will be replaced.
        </p>
        {growthError && <p className="text-xs text-red-500">{growthError}</p>}
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Annual Growth %</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              value={growthForm.annual_growth_pct}
              onChange={e => setGrowthForm(f => ({ ...f, annual_growth_pct: +e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">First Price Date</span>
            <input
              type="date"
              value={growthForm.first_date}
              min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
              onChange={e => setGrowthForm(f => ({ ...f, first_date: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">Through Date</span>
            <input
              type="date"
              value={growthForm.through_date}
              min={growthForm.first_date}
              onChange={e => setGrowthForm(f => ({ ...f, through_date: e.target.value }))}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
          </label>
        </div>

        {growthPreview.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Preview</p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr className="text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Projected Price</th>
                    <th className="px-3 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {growthPreview.map((row, i) => {
                    const prev = i === 0 ? basePrice : growthPreview[i - 1].price
                    const change = row.price - prev
                    return (
                      <tr key={row.date} className="bg-white dark:bg-gray-900">
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.date}</td>
                        <td className="px-3 py-2 text-right font-medium text-amber-600 dark:text-amber-400">{fmt$(row.price)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">+{fmt$(change)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {basePrice === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            No historical price found. Add at least one past price before using the growth estimator.
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleGrowthApply}
            disabled={growthSaving || basePrice === 0 || growthPreview.length === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {growthSaving ? 'Applying...' : `Apply ${growthPreview.length} Estimate${growthPreview.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────
  const estimateCount = prices.filter(p => p.is_estimate).length
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Share Prices</h2>
        <div className="flex gap-2">
          <button
            onClick={openAdd}
            className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            + Price
          </button>
          <button
            onClick={() => { setGrowthError(''); setMode('growth') }}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            + Estimate
          </button>
        </div>
      </div>
      {epicMode && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
          Historical data provided by Epic — view only. You can add future price estimates.
        </p>
      )}

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
            {prices.map(p => {
              const isEst = p.is_estimate ?? false
              const canEdit = !epicMode || isEst
              return (
                <tr key={p.id} className={`bg-white dark:bg-gray-900 ${isEst ? 'opacity-70' : ''}`}>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                    {p.effective_date}
                    {isEst && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] italic text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                        est.
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${isEst ? 'italic text-amber-500 dark:text-amber-500' : 'text-amber-700 dark:text-amber-400'}`}>
                    {fmt$(p.price)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(p)} className="mr-2 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {prices.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-gray-400">No prices yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        {prices.length} price entr{prices.length === 1 ? 'y' : 'ies'}
        {estimateCount > 0 && ` (${estimateCount} estimated)`}
      </p>
    </div>
  )
}
