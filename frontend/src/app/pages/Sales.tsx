import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '../../api.ts'
import type { PriceEntry, SaleEntry, SaleEstimate, TaxBreakdown, TaxSettings, TrancheLine, TrancheAllocation } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'

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

type SaleMethod = 'fifo' | 'lifo' | 'epic_lifo' | 'manual_tranche'

type SaleForm = {
  date: string
  shares: number
  price_per_share: number
  notes: string
  loan_id: number | null
}
type Mode = 'list' | 'add' | 'edit'

function buildLotOverrides(
  lines: TrancheLine[],
  manualAlloc: Record<string, number>,
): Array<{ vest_date: string; grant_year: number | null; grant_type: string | null; basis_price: number; shares: number }> {
  return lines
    .map(line => {
      const key = `${line.vest_date}|${line.grant_year}|${line.grant_type}`
      const shares = manualAlloc[key] ?? line.allocated_shares
      if (shares <= 0) return null
      return { vest_date: line.vest_date, grant_year: line.grant_year, grant_type: line.grant_type, basis_price: line.basis_price, shares }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export function TrancheTable({
  lines, loading, manual, manualAlloc, onManualChange, date: saleDate,
}: {
  lines: TrancheLine[]; loading: boolean; manual: boolean
  manualAlloc: Record<string, number>; onManualChange: (key: string, shares: number) => void; date: string
}) {
  if (loading) return <p className="px-1 text-xs text-stone-500">Loading lots…</p>
  if (!lines.length) return <p className="px-1 text-xs text-stone-500">No vested shares at this date</p>
  const displayLines = manual ? lines : lines.filter(l => l.allocated_shares > 0)
  if (!manual && displayLines.length === 0) return null
  const totalAlloc = lines.reduce((s, l) => {
    const key = `${l.vest_date}|${l.grant_year}|${l.grant_type}`
    return s + (manual ? (manualAlloc[key] ?? l.allocated_shares) : l.allocated_shares)
  }, 0)
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="border-b border-gray-200 px-3 py-1.5 dark:border-slate-700">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          Lot Allocation{saleDate ? ` at ${saleDate}` : ''}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-stone-500">
            <th className="px-3 py-1 text-left font-medium">Grant</th>
            <th className="px-3 py-1 text-right font-medium">Basis</th>
            <th className="px-3 py-1 text-right font-medium">Avail</th>
            <th className="px-3 py-1 text-right font-medium">{manual ? 'Sell ✎' : 'Allocated'}</th>
            <th className="px-3 py-1 text-right font-medium">Type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {displayLines.map(line => {
            const key = `${line.vest_date}|${line.grant_year}|${line.grant_type}`
            const allocated = manual ? (manualAlloc[key] ?? line.allocated_shares) : line.allocated_shares
            return (
              <tr key={key} className="text-gray-700 dark:text-slate-300">
                <td className="px-3 py-1">
                  <span>{line.grant_year ?? '—'} {line.grant_type ?? ''}</span>
                  <span className="ml-1 text-[10px] text-stone-500 dark:text-slate-400">{line.vest_date}</span>
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtUSD(line.basis_price)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtNum(line.available_shares)}</td>
                <td className="px-3 py-1 text-right">
                  {manual ? (
                    <input
                      type="number" min="0" max={line.available_shares}
                      value={manualAlloc[key] ?? line.allocated_shares}
                      onChange={e => onManualChange(key, Math.min(line.available_shares, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="w-20 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-right text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    />
                  ) : (
                    <span className={allocated > 0 ? 'tabular-nums font-medium' : 'text-gray-300 dark:text-slate-600'}>{fmtNum(allocated)}</span>
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  {allocated > 0 ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${line.is_lt ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                      {line.is_lt ? 'LT' : 'ST'}
                    </span>
                  ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
        {displayLines.length > 1 && (
          <tfoot>
            <tr className="border-t border-gray-200 font-medium dark:border-slate-600">
              <td className="px-3 py-1 text-gray-700 dark:text-slate-200">Total</td>
              <td />
              <td className="px-3 py-1 text-right tabular-nums text-gray-700 dark:text-slate-200">{fmtNum(lines.reduce((s, l) => s + l.available_shares, 0))}</td>
              <td className="px-3 py-1 text-right tabular-nums text-gray-700 dark:text-slate-200">{fmtNum(totalAlloc)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const TODAY = new Date().toISOString().slice(0, 10)

const emptyForm: SaleForm = {
  date: TODAY,
  shares: 0,
  price_per_share: 0,
  notes: '',
  loan_id: null,
}

function priceAt(date: string, prices: PriceEntry[]): number {
  let last = 0
  for (const p of prices) {
    if (p.effective_date <= date) last = p.price
    else break
  }
  return last
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
  const lots = breakdown.lots ?? []
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-xs dark:border-green-800 dark:bg-green-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">Estimated Tax Breakdown</h3>
      {hasUnvested && (
        <div className="mb-3 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
          Warning: {fmtNum(breakdown.unvested_shares)} shares may not yet be vested and could be taxed as ordinary income.
        </div>
      )}
      {lots.length > 0 && (
        <div className="mb-3">
          <table className="w-full">
            <thead>
              <tr className="text-stone-500 dark:text-slate-400">
                <th className="pb-1 text-left font-normal">Grant</th>
                <th className="pb-1 text-right font-normal">Shares</th>
                <th className="pb-1 text-right font-normal">LT</th>
                <th className="pb-1 text-right font-normal">ST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-100 dark:divide-green-900/40">
              {lots.map((lot, i) => (
                <tr key={i} className="text-gray-700 dark:text-slate-300">
                  <td className="py-0.5">{lot.grant_year ?? '—'} {lot.grant_type ?? ''}</td>
                  <td className="py-0.5 text-right tabular-nums">{fmtNum(lot.shares)}</td>
                  <td className="py-0.5 text-right tabular-nums">{lot.lt_shares > 0 ? fmtNum(lot.lt_shares) : '—'}</td>
                  <td className="py-0.5 text-right tabular-nums">{lot.st_shares > 0 ? <span className="text-amber-700 dark:text-amber-400">{fmtNum(lot.st_shares)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 border-t border-green-200 dark:border-green-700" />
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
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-400'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Field({ label, type, value, onChange, step, min }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; step?: string; min?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        step={step}
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
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
        <span className="text-xs font-medium text-gray-600 dark:text-slate-400">Tax rates for this sale</span>
        {onReset && (
          <button type="button" onClick={onReset} className="text-[10px] text-rose-600 hover:text-rose-700 dark:text-rose-400">
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
          <span className="text-[10px] text-gray-500 dark:text-slate-400">LT Hold Days</span>
          <input
            type="number"
            value={rates.lt_holding_days}
            onChange={e => set('lt_holding_days', e.target.value)}
            className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          />
        </label>
      </div>
    </div>
  )
}

function RateField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 dark:text-slate-400">{label}</span>
      <div className="relative mt-0.5">
        <input
          type="number"
          step="0.001"
          value={(value * 100).toFixed(2)}
          onChange={e => onChange(String(parseFloat(e.target.value) / 100))}
          className="block w-full rounded-md border border-gray-300 bg-white py-1 pl-1.5 pr-4 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        />
        <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[10px] text-stone-500">%</span>
      </div>
    </label>
  )
}

export default function Sales() {
  const config = useConfig()
  const epicMode = !!config?.epic_mode
  const fetchSales = useCallback(() => api.getSales(), [])
  const { data: sales, loading, reload } = useApiData<SaleEntry[]>(fetchSales)
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)

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
  // Fetch all tax breakdowns in one request when sales load
  useEffect(() => {
    if (!sales) return
    api.getAllSaleTaxes()
      .then(all => setBreakdowns(new Map(Object.entries(all).map(([k, v]) => [Number(k), v]))))
      .catch(() => {})
  }, [sales])

  useDataSync('sales', reload)

  type InputMode = 'dollars' | 'shares'
  const [inputMode, setInputMode] = useState<InputMode>('dollars')
  const [dollarTarget, setDollarTarget] = useState('')
  const [estimate, setEstimate] = useState<SaleEstimate | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lot selection method + tranche allocation
  const [method, setMethod] = useState<SaleMethod>('epic_lifo')
  const [trancheAlloc, setTrancheAlloc] = useState<TrancheAllocation | null>(null)
  const [trancheLoading, setTrancheLoading] = useState(false)
  const [manualAlloc, setManualAlloc] = useState<Record<string, number>>({})
  const trancheTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Actual tax paid (recording mode only)
  const [actualTaxPaid, setActualTaxPaid] = useState('')

  // In Epic mode, price per share is always derived from the prices table
  useEffect(() => {
    if (!epicMode || !prices || mode === 'list') return
    setForm(f => ({ ...f, price_per_share: priceAt(f.date, prices) }))
  }, [form.date, epicMode, prices, mode])

  // Tranche allocation — debounced 300ms, triggered by date/shares/method
  useEffect(() => {
    if (mode === 'list' || !form.date || form.shares <= 0) {
      setTrancheAlloc(null)
      return
    }
    if (trancheTimer.current) clearTimeout(trancheTimer.current)
    trancheTimer.current = setTimeout(async () => {
      setTrancheLoading(true)
      try {
        const result = await api.getTrancheAllocation({ sale_date: form.date, shares: form.shares, method })
        setTrancheAlloc(result)
      } catch {
        setTrancheAlloc(null)
      } finally {
        setTrancheLoading(false)
      }
    }, 300)
  }, [form.date, form.shares, method, mode])

  // Live estimate — debounced 400ms, triggered by dollar target or share count + price change
  useEffect(() => {
    if (mode === 'list') return
    const price = form.price_per_share
    if (price <= 0) { setEstimate(null); return }

    let targetCash: number | null = null
    let exactShares: number | null = null
    if (inputMode === 'dollars') {
      const v = parseFloat(dollarTarget)
      if (!dollarTarget || isNaN(v) || v <= 0) { setEstimate(null); return }
      targetCash = v
    } else {
      const s = form.shares
      if (!s || s <= 0) { setEstimate(null); return }
      exactShares = s
    }

    if (estimateTimer.current) clearTimeout(estimateTimer.current)
    estimateTimer.current = setTimeout(async () => {
      setEstimateLoading(true)
      try {
        const result = await api.estimateSale({
          price_per_share: price,
          ...(exactShares != null ? { shares: exactShares } : { target_net_cash: targetCash! }),
          sale_date: form.date,
        })
        setEstimate(result)
        if (inputMode === 'dollars') {
          setForm(f => ({ ...f, shares: result.shares_needed }))
        }
      } catch {
        setEstimate(null)
      } finally {
        setEstimateLoading(false)
      }
    }, 400)
  }, [dollarTarget, form.shares, form.price_per_share, form.date, inputMode, mode])

  function resetForm() {
    setForm(emptyForm)
    setTaxRates(ratesFromDefaults(taxSettings))
    setEditId(null)
    setEditVersion(1)
    setError('')
    setConflict(false)
    setDollarTarget('')
    setEstimate(null)
    setTrancheAlloc(null)
    setManualAlloc({})
    setActualTaxPaid('')
    setInputMode('dollars')
  }

  function openAdd() {
    resetForm()
    setTaxRates(ratesFromDefaults(taxSettings))
    const m = taxSettings?.lot_selection_method
    setMethod(m && ['fifo', 'lifo', 'epic_lifo', 'manual_tranche'].includes(m) ? m as SaleMethod : 'epic_lifo')
    setMode('add')
  }

  function openEdit(s: SaleEntry) {
    const {
      id, version,
      federal_income_rate, federal_lt_cg_rate, federal_st_cg_rate,
      niit_rate, state_income_rate, state_lt_cg_rate, state_st_cg_rate, lt_holding_days,
      lot_overrides, actual_tax_paid, sale_plan_id: _sp,
      ...rest
    } = s
    setForm(rest as SaleForm)
    setTaxRates(ratesFromSale(s, taxSettings))
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)
    // Determine method from lot_overrides
    if (lot_overrides && lot_overrides.length > 0) {
      setMethod('manual_tranche')
      const alloc: Record<string, number> = {}
      for (const ov of lot_overrides) {
        alloc[`${ov.vest_date}|${ov.grant_year}|${ov.grant_type}`] = ov.shares
      }
      setManualAlloc(alloc)
    } else {
      const m = taxSettings?.lot_selection_method
      setMethod(m && ['fifo', 'lifo', 'epic_lifo', 'manual_tranche'].includes(m) ? m as SaleMethod : 'epic_lifo')
      setManualAlloc({})
    }
    setActualTaxPaid(actual_tax_paid != null ? String(actual_tax_paid) : '')
    setInputMode('shares')
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
      const lotOverrides = method === 'manual_tranche' && trancheAlloc
        ? buildLotOverrides(trancheAlloc.lines, manualAlloc)
        : null
      const payload = {
        ...form,
        ...taxRates,
        lot_overrides: lotOverrides,
        actual_tax_paid: actualTaxPaid !== '' ? parseFloat(actualTaxPaid) || null : null,
      }
      if (mode === 'add') {
        saved = await api.createSale(payload)
      } else if (mode === 'edit' && editId != null) {
        saved = await api.updateSale(editId, { ...payload, version: editVersion })
      } else {
        return
      }
      broadcastChange('sales')
      setBreakdowns(prev => { const next = new Map(prev); next.delete(saved.id); return next })
      try {
        const tax = await api.getSaleTax(saved.id)
        setBreakdowns(prev => new Map(prev).set(saved.id, tax))
        setExpanded(prev => new Set(prev).add(saved.id))
      } catch {
        // silently ignore — breakdown won't auto-expand
      }
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
    setBreakdowns(prev => { const next = new Map(prev); next.delete(id); return next })
    setExpanded(prev => { const next = new Set(prev); next.delete(id); return next })
    reload()
    setMode('list')
    resetForm()
  }

  if (loading) return <p className="p-6 text-center text-sm text-stone-500">Loading...</p>
  if (!sales) return <p className="p-6 text-center text-sm text-red-500">Failed to load sales</p>

  if (mode !== 'list') {
    const isPayoff = form.loan_id != null
    const isRecording = !epicMode && form.date < TODAY
    const isPlanAdd = mode === 'add' && !isRecording
    const title = mode === 'add' ? (isRecording ? 'Record Sale' : 'Plan Sale') : 'Edit Sale'
    const showMethodSelector = !isPayoff
    const showTranche = (trancheAlloc !== null || trancheLoading) && form.shares > 0

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-slate-300">Cancel</button>
        </div>
        {conflict && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
            <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
              This record was changed on another device.
            </p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { reload(); setMode('list'); resetForm() }} className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-700">Reload latest</button>
              <button onClick={() => { setMode('list'); resetForm() }} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-300">Discard</button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Date + price */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sale Date" type="date" value={form.date} min={epicMode ? TODAY : undefined}
            onChange={v => setForm(f => ({ ...f, date: v }))} />
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Price per Share</span>
            {epicMode ? (
              <div className="mt-0.5 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {form.price_per_share > 0 ? fmtUSD(form.price_per_share) : <span className="text-stone-500">No price for this date</span>}
              </div>
            ) : (
              <input type="number" step="0.01" value={form.price_per_share}
                onChange={e => setForm(f => ({ ...f, price_per_share: +e.target.value }))}
                className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
            )}
          </label>
        </div>

        {/* Lot selection method */}
        {showMethodSelector && (
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Lot selection</span>
            <select
              value={method}
              onChange={e => { setMethod(e.target.value as SaleMethod); setManualAlloc({}) }}
              className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="epic_lifo">Epic LIFO — prefer long-term gains (default)</option>
              <option value="fifo">FIFO — oldest lots first</option>
              <option value="lifo">LIFO — newest lots first</option>
              <option value="manual_tranche">Manual — pick lots yourself</option>
            </select>
          </label>
        )}

        {/* Input mode toggle (add mode only) */}
        {mode === 'add' && (
          <div className="flex gap-1 rounded-md border border-stone-200 bg-stone-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            {(['dollars', 'shares'] as const).map(m => (
              <button key={m} onClick={() => { setInputMode(m); setEstimate(null) }}
                className={`flex-1 rounded py-1 text-xs font-medium transition-colors ${inputMode === m ? 'bg-white shadow-sm text-gray-900 dark:bg-slate-700 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
                {m === 'dollars' ? '$ Target' : '# Shares'}
              </button>
            ))}
          </div>
        )}

        {/* Amount input */}
        {mode === 'add' && inputMode === 'dollars' ? (
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Target net cash (post-tax)</span>
            <div className="relative mt-0.5">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-stone-500">$</span>
              <input type="number" step="100" min="0" value={dollarTarget}
                onChange={e => setDollarTarget(e.target.value)}
                placeholder="0"
                className="block w-full rounded-md border border-gray-300 bg-white pl-5 pr-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
            </div>
          </label>
        ) : (
          <Field label="Shares to sell" type="number" value={form.shares}
            onChange={v => setForm(f => ({ ...f, shares: +v }))} />
        )}

        {/* Tranche table */}
        {showTranche && (
          <TrancheTable
            lines={trancheAlloc?.lines ?? []}
            loading={trancheLoading && !trancheAlloc}
            manual={method === 'manual_tranche'}
            manualAlloc={manualAlloc}
            onManualChange={(key, shares) => setManualAlloc(prev => ({ ...prev, [key]: shares }))}
            date={form.date}
          />
        )}

        {/* Live estimate */}
        {(estimate || estimateLoading) && (
          <div className="rounded-md border border-indigo-100 bg-rose-50 px-3 py-2.5 dark:border-indigo-900 dark:bg-rose-950/30">
            {estimateLoading ? (
              <p className="text-xs text-rose-400">Calculating…</p>
            ) : estimate && (
              <div className="space-y-1 text-xs">
                {isPlanAdd && inputMode === 'dollars' && (
                  <Row label="Shares needed" value={fmtNum(estimate.shares_needed)} />
                )}
                <Row label="Gross proceeds" value={fmtUSD(estimate.gross_proceeds)} />
                <Row label="Est. tax" value={fmtUSD(estimate.estimated_tax)} />
                <Row label="Net cash" value={fmtUSD(estimate.net_proceeds)} bold />
              </div>
            )}
          </div>
        )}

        {/* Tax rates (non-epic mode) */}
        {!epicMode && (
          <TaxRateFields
            rates={taxRates}
            onChange={setTaxRates}
            onReset={() => setTaxRates(ratesFromDefaults(taxSettings))}
          />
        )}

        {/* Actual tax paid — recording only */}
        {isRecording && (
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Actual tax paid (optional — overrides estimate)</span>
            <div className="relative mt-0.5">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-stone-500">$</span>
              <input type="number" step="0.01" min="0" value={actualTaxPaid}
                onChange={e => setActualTaxPaid(e.target.value)}
                placeholder="Leave blank to use estimate"
                className="block w-full rounded-md border border-gray-300 bg-white pl-5 pr-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
            </div>
          </label>
        )}

        <Field label="Notes (optional)" type="text" value={form.notes}
          onChange={v => setForm(f => ({ ...f, notes: v }))} />

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSave}
            disabled={saving || form.shares <= 0}
            className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'add' ? (isRecording ? 'Record sale' : 'Plan sale') : 'Save'}
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Sales</h2>
        <button onClick={openAdd} className="rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-800">
          + Sale
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr className="text-gray-500 dark:text-slate-400">
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
                  <tr key={s.id} className="bg-white dark:bg-slate-900">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{s.date}</td>
                    <td className="px-3 py-2">
                      {s.loan_id != null ? (
                        <span className="inline-block rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                          Payoff
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                          Cash Out
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmtNum(s.shares)}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmtUSD(s.price_per_share)}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">
                      {fmtUSD(s.shares * s.price_per_share)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleTax(s.id)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} tax breakdown`}
                        className="inline-flex items-center gap-1 text-right"
                      >
                        {isLoading ? (
                          <span className="text-stone-500">...</span>
                        ) : bd ? (
                          <>
                            {hasST && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                ST
                              </span>
                            )}
                            <span className={`font-medium underline decoration-dotted ${hasST ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-slate-100'}`}>
                              {fmtUSD(bd.estimated_tax)}
                            </span>
                          </>
                        ) : (
                          <span className="text-stone-500 underline decoration-dotted">—</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(s)}
                        className="text-rose-400 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                        aria-label="Edit sale"
                      >
                        <PencilIcon />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && bd && (
                    <tr key={`${s.id}-tax`} className="bg-white dark:bg-slate-900">
                      <td colSpan={7} className="px-3 pb-3 pt-0">
                        {s.notes && (
                          <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">Note: {s.notes}</p>
                        )}
                        <TaxCard breakdown={bd} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {sales.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">No sales recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">{sales.length} sales</p>
    </div>
  )
}
