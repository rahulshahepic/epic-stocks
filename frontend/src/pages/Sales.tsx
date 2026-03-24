import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '../api.ts'
import type { SaleEntry, TaxBreakdown, TaxSettings } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'

export type TaxRates = {
  federal_income_rate: number
  federal_lt_cg_rate: number
  federal_st_cg_rate: number
  niit_rate: number
  state_income_rate: number
  state_lt_cg_rate: number
  state_st_cg_rate: number
  lt_holding_days: number
}

export const DEFAULT_RATES: TaxRates = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
}

export function ratesFromDefaults(ts: TaxSettings | null | undefined): TaxRates {
  if (!ts) return DEFAULT_RATES
  return {
    federal_income_rate: ts.federal_income_rate,
    federal_lt_cg_rate: ts.federal_lt_cg_rate,
    federal_st_cg_rate: ts.federal_st_cg_rate,
    niit_rate: ts.niit_rate,
    state_income_rate: ts.state_income_rate,
    state_lt_cg_rate: ts.state_lt_cg_rate,
    state_st_cg_rate: ts.state_st_cg_rate,
    lt_holding_days: ts.lt_holding_days,
  }
}

export function ratesFromSale(sale: SaleEntry, defaults: TaxSettings | null | undefined): TaxRates {
  const d = ratesFromDefaults(defaults)
  return {
    federal_income_rate: sale.federal_income_rate ?? d.federal_income_rate,
    federal_lt_cg_rate: sale.federal_lt_cg_rate ?? d.federal_lt_cg_rate,
    federal_st_cg_rate: sale.federal_st_cg_rate ?? d.federal_st_cg_rate,
    niit_rate: sale.niit_rate ?? d.niit_rate,
    state_income_rate: sale.state_income_rate ?? d.state_income_rate,
    state_lt_cg_rate: sale.state_lt_cg_rate ?? d.state_lt_cg_rate,
    state_st_cg_rate: sale.state_st_cg_rate ?? d.state_st_cg_rate,
    lt_holding_days: sale.lt_holding_days ?? d.lt_holding_days,
  }
}

type SaleForm = {
  date: string
  shares: number
  price_per_share: number
  notes: string
  loan_id: number | null
}
type Mode = 'list' | 'add' | 'edit'

const emptyForm: SaleForm = {
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

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
    </svg>
  )
}

export function TaxCard({ breakdown }: { breakdown: TaxBreakdown }) {
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
        {(hasLT || hasST) && <Row label="Cost basis" value={fmtUSD(breakdown.cost_basis)} />}
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

export function TaxRateFields({ rates, onChange, onReset }: {
  rates: TaxRates
  onChange: (r: TaxRates) => void
  onReset?: () => void
}) {
  function set(key: keyof TaxRates, val: string) {
    onChange({ ...rates, [key]: key === 'lt_holding_days' ? parseInt(val) || 0 : parseFloat(val) || 0 })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Tax rates for this sale</span>
        {onReset && (
          <button type="button" onClick={onReset} className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400">
            Reset to defaults
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <RateField label="Fed Income" value={rates.federal_income_rate} onChange={v => set('federal_income_rate', v)} />
        <RateField label="Fed LT CG" value={rates.federal_lt_cg_rate} onChange={v => set('federal_lt_cg_rate', v)} />
        <RateField label="Fed ST CG" value={rates.federal_st_cg_rate} onChange={v => set('federal_st_cg_rate', v)} />
        <RateField label="NIIT" value={rates.niit_rate} onChange={v => set('niit_rate', v)} />
        <RateField label="State Inc" value={rates.state_income_rate} onChange={v => set('state_income_rate', v)} />
        <RateField label="State LT" value={rates.state_lt_cg_rate} onChange={v => set('state_lt_cg_rate', v)} />
        <RateField label="State ST" value={rates.state_st_cg_rate} onChange={v => set('state_st_cg_rate', v)} />
        <label className="block">
          <span className="text-[10px] text-gray-500 dark:text-gray-400">LT Hold Days</span>
          <input
            type="number"
            value={rates.lt_holding_days}
            onChange={e => set('lt_holding_days', e.target.value)}
            className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-[11px] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
        </label>
      </div>
    </div>
  )
}

function RateField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
      <div className="relative mt-0.5">
        <input
          type="number"
          step="0.001"
          value={(value * 100).toFixed(2)}
          onChange={e => onChange(String(parseFloat(e.target.value) / 100))}
          className="block w-full rounded-md border border-gray-300 bg-white py-1 pl-1.5 pr-4 text-[11px] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        />
        <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[10px] text-gray-400">%</span>
      </div>
    </label>
  )
}

export default function Sales() {
  const fetchSales = useCallback(() => api.getSales(), [])
  const { data: sales, loading, reload } = useApiData<SaleEntry[]>(fetchSales)
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)

  const [mode, setMode] = useState<Mode>('list')
  const [form, setForm] = useState<SaleForm>(emptyForm)
  const [taxRates, setTaxRates] = useState<TaxRates>(DEFAULT_RATES)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  // Per-row tax state: cached breakdowns and expanded/loading sets
  const [breakdowns, setBreakdowns] = useState<Map<number, TaxBreakdown>>(new Map())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadingTaxIds, setLoadingTaxIds] = useState<Set<number>>(new Set())
  const fetchStarted = useRef(new Set<number>())

  // Eagerly fetch all tax breakdowns when sales load
  useEffect(() => {
    if (!sales) return
    sales.forEach(s => {
      if (fetchStarted.current.has(s.id)) return
      fetchStarted.current.add(s.id)
      setLoadingTaxIds(prev => new Set(prev).add(s.id))
      api.getSaleTax(s.id)
        .then(tax => setBreakdowns(prev => new Map(prev).set(s.id, tax)))
        .catch(() => {})
        .finally(() => setLoadingTaxIds(prev => { const next = new Set(prev); next.delete(s.id); return next }))
    })
  }, [sales])

  useDataSync('sales', reload)

  function resetForm() {
    setForm(emptyForm)
    setTaxRates(ratesFromDefaults(taxSettings))
    setEditId(null)
    setEditVersion(1)
    setError('')
    setConflict(false)
  }

  function openAdd() {
    resetForm()
    setTaxRates(ratesFromDefaults(taxSettings))
    setMode('add')
  }

  function openEdit(s: SaleEntry) {
    const { id, version, federal_income_rate, federal_lt_cg_rate, federal_st_cg_rate,
            niit_rate, state_income_rate, state_lt_cg_rate, state_st_cg_rate, lt_holding_days, ...rest } = s
    setForm(rest)
    setTaxRates(ratesFromSale(s, taxSettings))
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)
    setMode('edit')
  }

  async function toggleTax(id: number) {
    // If already loaded, just toggle visibility
    if (breakdowns.has(id)) {
      setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }
    // Load then expand
    setLoadingTaxIds(prev => new Set(prev).add(id))
    try {
      const tax = await api.getSaleTax(id)
      setBreakdowns(prev => new Map(prev).set(id, tax))
      setExpanded(prev => new Set(prev).add(id))
    } catch {
      // silently ignore — cell stays as "—"
    } finally {
      setLoadingTaxIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      let saved: SaleEntry
      const payload = { ...form, ...taxRates }
      if (mode === 'add') {
        saved = await api.createSale(payload)
      } else if (mode === 'edit' && editId != null) {
        saved = await api.updateSale(editId, { ...payload, version: editVersion })
      } else {
        return
      }
      broadcastChange('sales')
      // Clear cached breakdown so it re-fetches with updated rates
      fetchStarted.current.delete(saved.id)
      setBreakdowns(prev => { const next = new Map(prev); next.delete(saved.id); return next })
      reload()
      setMode('list')
      resetForm()
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
    fetchStarted.current.delete(id)
    setBreakdowns(prev => { const next = new Map(prev); next.delete(id); return next })
    setExpanded(prev => { const next = new Set(prev); next.delete(id); return next })
    reload()
    setMode('list')
    resetForm()
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
        <TaxRateFields
          rates={taxRates}
          onChange={setTaxRates}
          onReset={() => setTaxRates(ratesFromDefaults(taxSettings))}
        />
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {mode === 'edit' && editId != null && (
            <button
              onClick={() => handleDelete(editId)}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete sale
            </button>
          )}
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

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Price/Share</th>
              <th className="px-3 py-2 text-right">Gross Proceeds</th>
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sales.map(s => {
              const bd = breakdowns.get(s.id)
              const isExpanded = expanded.has(s.id)
              const isLoading = loadingTaxIds.has(s.id)
              const hasST = bd && bd.st_shares > 0
              return (
                <>
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
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleTax(s.id)}
                        className="inline-flex items-center gap-1 text-right"
                      >
                        {isLoading ? (
                          <span className="text-gray-400">...</span>
                        ) : bd ? (
                          <>
                            {hasST && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                ST
                              </span>
                            )}
                            <span className={`font-medium underline decoration-dotted ${hasST ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {fmtUSD(bd.estimated_tax)}
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400 underline decoration-dotted">—</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(s)}
                        className="text-indigo-400 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300"
                        aria-label="Edit sale"
                      >
                        <PencilIcon />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && bd && (
                    <tr key={`${s.id}-tax`} className="bg-white dark:bg-gray-900">
                      <td colSpan={7} className="px-3 pb-3 pt-0">
                        {s.notes && (
                          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Note: {s.notes}</p>
                        )}
                        <TaxCard breakdown={bd} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
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
