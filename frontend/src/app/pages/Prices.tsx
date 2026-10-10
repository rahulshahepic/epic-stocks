import { useCallback, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import type { PriceEntry } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { useViewing } from '../../scaffold/contexts/viewing.ts'
import { fmtPrice } from '../format.ts'
import { Field } from '../../scaffold/components/ui/Field.tsx'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import { addCalendarYears, useToday } from '../dateUtils.ts'

type PriceForm = { effective_date: string; price: number; is_estimate: boolean; expected_announcement_date: string; announced_date: string; version?: number }
type Mode = 'list' | 'add' | 'edit' | 'growth'

type GrowthForm = {
  annual_growth_pct: number
  first_date: string
  through_date: string
  expected_announcement_date: string
}

function nextJan1(): string {
  return `${new Date().getFullYear() + 1}-01-01`
}

function addYears(iso: string, n: number): string {
  return addCalendarYears(iso, n)
}

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000
}

function computeGrowthPreview(
  basePrice: number,
  annual_growth_pct: number,
  first_date: string,
  through_date: string,
  confirmed: PriceEntry[],
): { date: string; price: number }[] {
  if (!basePrice || !first_date || !through_date || first_date > through_date) return []
  const multiplier = 1 + annual_growth_pct / 100
  const results: { date: string; price: number }[] = []
  let current = first_date
  let price = Math.round(basePrice * multiplier * 100) / 100
  while (current <= through_date) {
    const actual = confirmed.find(p => p.effective_date === current)
    if (actual) price = actual.price
    else results.push({ date: current, price })
    current = addCalendarYears(current, 1)
    price = Math.round(price * multiplier * 100) / 100
  }
  return results
}

export default function Prices() {
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const readOnly = !!viewing
  const today = useToday()

  const fetchPrices = useCallback(() => vid ? api.getSharedPrices(vid) : api.getPrices(), [vid])
  const { data: prices, loading, reload } = useApiData<PriceEntry[]>(fetchPrices)

  const config = useConfig()
  const epicMode = (config?.epic_mode ?? false) || readOnly

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<PriceForm>({ effective_date: '', price: 0, is_estimate: false, expected_announcement_date: '', announced_date: today })
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [removeNearby, setRemoveNearby] = useState(true)

  const defaultFirst = nextJan1()
  const [growthForm, setGrowthForm] = useState<GrowthForm>({
    annual_growth_pct: 5,
    first_date: defaultFirst,
    through_date: addYears(defaultFirst, 4),
    expected_announcement_date: `${defaultFirst.slice(0, 4)}-03-01`,
  })
  const [growthSaving, setGrowthSaving] = useState(false)
  const [growthError, setGrowthError] = useState('')

  function resetForm() {
    setForm({ effective_date: '', price: 0, is_estimate: false, expected_announcement_date: '', announced_date: today })
    setEditId(null)
    setError('')
    setRemoveNearby(true)
  }

  function openAdd() {
    resetForm()
    if (epicMode) setForm(f => ({ ...f, is_estimate: true, announced_date: '' }))
    setMode('add')
  }

  function openEdit(p: PriceEntry) {
    setForm({ effective_date: p.effective_date, price: p.price, is_estimate: !!p.is_estimate,
      expected_announcement_date: p.expected_announcement_date ?? `${p.effective_date.slice(0, 4)}-03-01`,
      announced_date: p.announced_date ?? (p.is_estimate ? '' : today), version: p.version })
    setEditId(p.id)
    setError('')
    setMode('edit')
  }

  // Estimates within 31 days of the add-form date (exact-date match handled by backend)
  const nearbyEstimates = useMemo(() => {
    if (!prices || !form.effective_date || mode !== 'add') return []
    return prices.filter(
      p => p.is_estimate && p.effective_date !== form.effective_date && daysApart(p.effective_date, form.effective_date) <= 31,
    )
  }, [prices, form.effective_date, mode])

  async function handleSave(addAnother: boolean) {
    if (epicMode && !form.is_estimate) {
      setError('Only tentative prices can be added in Epic mode')
      return
    }
    if (!form.is_estimate && !form.announced_date) {
      setError('Enter the actual announcement date to confirm this price')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        await api.annualPrice({ effective_date: form.effective_date, price: form.price,
          is_estimate: form.is_estimate, expected_announcement_date: form.expected_announcement_date || null,
          announced_date: form.is_estimate ? null : form.announced_date })
        if (!form.is_estimate && removeNearby && nearbyEstimates.length > 0) {
          await Promise.all(nearbyEstimates.map(p => api.deletePrice(p.id)))
        }
      } else if (editId != null) {
        await api.updatePrice(editId, { ...form, expected_announcement_date: form.expected_announcement_date || null,
          announced_date: form.is_estimate ? null : form.announced_date })
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

  // Growth starts from the latest applicable price, including tentative prices.
  const basePrice = useMemo(() => {
    if (!prices) return 0
    const prior = prices.filter(p => p.effective_date < growthForm.first_date)
    return prior.length ? prior[prior.length - 1].price : 0
  }, [prices, growthForm.first_date])

  const growthPreview = useMemo(
    () => computeGrowthPreview(basePrice, growthForm.annual_growth_pct, growthForm.first_date, growthForm.through_date, (prices ?? []).filter(p => !p.is_estimate)),
    [basePrice, growthForm, prices],
  )

  // Existing estimates that fall inside the growth range — will be replaced
  const estimatesToReplace = useMemo(() => {
    if (!prices || !growthForm.first_date || !growthForm.through_date) return []
    return prices.filter(
      p => p.is_estimate && p.effective_date >= growthForm.first_date && p.effective_date <= growthForm.through_date,
    )
  }, [prices, growthForm.first_date, growthForm.through_date])

  async function handleGrowthApply() {
    if (!growthForm.first_date) {
      setGrowthError('Enter the first applicable date')
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
        announcement_month: Number(growthForm.expected_announcement_date.slice(5, 7)),
        announcement_day: Number(growthForm.expected_announcement_date.slice(8, 10)),
      })
      reload()
      setMode('list')
    } catch (e: unknown) {
      setGrowthError(e instanceof Error ? e.message : 'Failed to apply estimates')
    } finally {
      setGrowthSaving(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-cs-text-2">Loading...</p>
  if (!prices) return <p className="p-6 text-center text-sm text-red-500">Failed to load prices</p>

  // ── Add / Edit form ───────────────────────────────────────────────────────
  if (mode === 'add' || mode === 'edit') {
    const title = mode === 'add' ? 'Add Price' : 'Edit Price'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cs-text">{title}</h2>
          <button
            onClick={() => { setMode('list'); resetForm() }}
            className="text-xs text-cs-muted hover:text-cs-text-2 "
          >
            Cancel
          </button>
        </div>
        {epicMode && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            In Epic mode, you can add tentative estimates for any applicable date.
          </p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Applicable Date" type="date"
            value={form.effective_date}
            onChange={v => setForm(f => ({ ...f, effective_date: v }))} />
          <Field label="Price per Share" type="number" step="0.01"
            value={form.price}
            onChange={v => setForm(f => ({ ...f, price: +v }))} />
        </div>

        <label className="flex items-center gap-2 text-sm text-cs-text">
          <input type="checkbox" checked={form.is_estimate}
            onChange={e => setForm(f => ({ ...f, is_estimate: e.target.checked,
              expected_announcement_date: f.expected_announcement_date || `${f.effective_date.slice(0, 4) || today.slice(0, 4)}-03-01`,
              announced_date: e.target.checked ? '' : today }))} />
          Tentative estimate
        </label>
        <Field label={form.is_estimate ? 'Expected Announcement Date' : 'Actual Announcement Date'} type="date"
          value={form.is_estimate ? form.expected_announcement_date : form.announced_date}
          max={form.is_estimate ? undefined : today}
          onChange={v => setForm(f => ({ ...f, [f.is_estimate ? 'expected_announcement_date' : 'announced_date']: v }))} />
        <p className="text-xs text-cs-muted">The price applies from its applicable date. A tentative estimate stays tentative until an actual announcement is recorded.</p>

        {mode === 'add' && !form.is_estimate && nearbyEstimates.length > 0 && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/20">
            <input
              type="checkbox"
              checked={removeNearby}
              onChange={e => setRemoveNearby(e.target.checked)}
              className="mt-0.5 shrink-0 accent-amber-600"
            />
            <span className="text-xs text-amber-800 dark:text-amber-300">
              Also delete {nearbyEstimates.length} estimated price{nearbyEstimates.length > 1 ? 's' : ''} within 31 days (this real price replaces them):{' '}
              {nearbyEstimates.map(p => `${p.effective_date} (${fmtPrice(p.price)})`).join(', ')}
            </span>
          </label>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-md bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-50"
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
          <h2 className="text-lg font-semibold text-cs-text">Growth Estimator</h2>
          <button
            onClick={() => { setMode('list'); setGrowthError('') }}
            className="text-xs text-cs-muted hover:text-cs-text-2 "
          >
            Cancel
          </button>
        </div>
        <p className="text-xs text-cs-muted">
          Project future share prices as annual % growth from the current price
          {basePrice > 0 ? ` (${fmtPrice(basePrice)})` : ''}.
        </p>
        {growthError && <p className="text-xs text-red-500">{growthError}</p>}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Annual Growth %" type="number" step="0.1" min="0.1" max="100"
            value={growthForm.annual_growth_pct}
            onChange={v => setGrowthForm(f => ({ ...f, annual_growth_pct: +v }))} />
          <Field label="First Price Date" type="date"
            value={growthForm.first_date}
            onChange={v => setGrowthForm(f => ({ ...f, first_date: v }))} />
          <Field label="Through Date" type="date"
            value={growthForm.through_date}
            min={growthForm.first_date}
            onChange={v => setGrowthForm(f => ({ ...f, through_date: v }))} />
        </div>

        <Field label="Expected Announcement Date (repeats annually)" type="date"
          value={growthForm.expected_announcement_date}
          onChange={v => setGrowthForm(f => ({ ...f, expected_announcement_date: v }))} />
        <p className="text-xs text-cs-muted">Estimates apply on each price date, including dates already passed. March 1 is the default expected announcement; passing that date never confirms an estimate.</p>

        {estimatesToReplace.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/20">
            <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              Replacing {estimatesToReplace.length} existing estimate{estimatesToReplace.length > 1 ? 's' : ''}:
            </p>
            <ul className="space-y-0.5">
              {estimatesToReplace.map(p => (
                <li key={p.id} className="text-xs text-amber-700 dark:text-amber-300">
                  {p.effective_date} — {fmtPrice(p.price)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {growthPreview.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-cs-muted">
              New estimates ({growthPreview.length})
            </p>
            <Card pad="none" className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-left text-xs">
                <thead className="bg-cs-raised">
                  <tr className="text-cs-text-2">
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
                      <tr key={row.date} className="bg-cs-surface">
                        <td className="px-3 py-2 text-cs-text-2">{row.date}</td>
                        <td className="px-3 py-2 text-right font-medium text-amber-700 dark:text-amber-300">{fmtPrice(row.price)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300">+{fmtPrice(change)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
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
            className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
          >
            {growthSaving
              ? 'Applying...'
              : estimatesToReplace.length > 0
                ? `Replace ${estimatesToReplace.length} + Add ${growthPreview.length}`
                : `Apply ${growthPreview.length} Estimate${growthPreview.length !== 1 ? 's' : ''}`}
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
        <h2 className="text-lg font-semibold text-cs-text">Share Prices</h2>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={openAdd}
              className="rounded-md bg-amber-800 px-2 py-1 text-xs font-medium text-white hover:bg-amber-900"
            >
              + Price
            </button>
            <button
              onClick={() => { setGrowthError(''); setMode('growth') }}
              className="rounded-full bg-cs-brand px-3 py-1 text-xs font-semibold text-white hover:bg-cs-brand-hover"
            >
              + Estimate
            </button>
          </div>
        )}
      </div>
      {epicMode && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-cs-brand dark:bg-indigo-900/20 dark:text-rose-300">
          {readOnly
            ? `Viewing shared data — read only.`
            : 'Historical data provided by Epic — view only. You can add tentative price estimates, including ones already applicable.'}
        </p>
      )}

      <Card pad="none" className="overflow-x-auto" tabIndex={0}>
        <table className="w-full text-left text-xs">
          <thead className="bg-cs-raised">
            <tr className="text-cs-text-2">
              <th className="px-3 py-2">Applicable Date</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {prices.map(p => {
              const isEst = p.is_estimate ?? false
              const canEdit = !readOnly && (!epicMode || isEst)
              return (
                <tr key={p.id} className={`bg-cs-surface ${isEst ? 'opacity-70' : ''}`}>
                  <td className="px-3 py-2 text-cs-text-2">
                    <span>{p.effective_date}</span>
                    <div className="mt-1 text-[10px] text-cs-muted">{isEst
                      ? `Announcement expected ${p.expected_announcement_date ?? `${p.effective_date.slice(0, 4)}-03-01`}`
                      : p.announced_date ? `Announced ${p.announced_date}` : 'Confirmed · announcement date unknown'}</div>
                    {isEst && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] italic text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        tentative
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${isEst ? 'italic text-amber-700 dark:text-amber-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    {fmtPrice(p.price)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(p)} className="mr-2 text-cs-brand hover:text-cs-brand-hover dark:hover:text-rose-300">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Del</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {prices.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-cs-text-2">No share prices yet. Tap + Price above to record one.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-cs-text-2">
        {prices.length} price entr{prices.length === 1 ? 'y' : 'ies'}
        {estimateCount > 0 && ` (${estimateCount} estimated)`}
      </p>
    </div>
  )
}
