import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api.ts'
import type { TimelineEvent, TaxBreakdown, TaxSettings } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useDataSync } from '../hooks/useDataSync.ts'
import { useIsMobile } from '../hooks/useIsMobile.ts'
import { TaxCard } from './Sales.tsx'
import React from 'react'

const EVENT_TYPES = ['Exercise', 'Down payment exchange', 'Vesting', 'Share Price', 'Loan Payoff', 'Refinanced', 'Early Loan Payment', 'Sale', 'Liquidation (projected)']

const TYPE_COLORS: Record<string, string> = {
  'Exercise': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Down payment exchange': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Vesting': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Share Price': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Loan Payoff': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Refinanced': 'bg-gray-100 text-stone-600 dark:bg-slate-800/60 dark:text-slate-400',
  'Early Loan Payment': 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  'Sale': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'Liquidation (projected)': 'bg-gray-100 text-gray-500 dark:bg-slate-800/60 dark:text-slate-400',
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(r: number) {
  return (r * 100).toFixed(2) + '%'
}

function fmtNum(n: number | null) {
  return n != null ? n.toLocaleString('en-US') : '—'
}

const TODAY = new Date().toISOString().slice(0, 10)

const WI_TAX_DEFAULTS: TaxSettings = {
  federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
  niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765, lt_holding_days: 365, lot_selection_method: 'lifo',
  loan_payoff_method: 'epic_lifo', flexible_payoff_enabled: false,
  prefer_stock_dp: false, dp_min_percent: 0.10, dp_min_cap: 20000,
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

function estTaxForVesting(e: TimelineEvent, ts: TaxSettings): number {
  const incomeRate = ts.federal_income_rate + ts.state_income_rate
  return e.income * incomeRate
}

function est83bTax(e: TimelineEvent, ts: TaxSettings): number {
  const ltCgRate = ts.federal_lt_cg_rate + ts.niit_rate + ts.state_lt_cg_rate
  return e.income * ltCgRate
}

function TaxRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-400'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function VestingTaxCard({ e, ts }: { e: TimelineEvent; ts: TaxSettings }) {
  const incomeRate = ts.federal_income_rate + ts.state_income_rate
  const totalTax = e.income * incomeRate
  const sharesToCover = e.share_price > 0 ? Math.ceil(totalTax / e.share_price) : 0
  const isFuture = e.date > TODAY

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-xs dark:border-orange-800 dark:bg-orange-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">Estimated Tax</h3>
      <div className="space-y-1">
        <TaxRow
          label={`Ordinary income × ${fmtPct(incomeRate)}`}
          value={`${fmt$(e.income)} → ${fmt$(totalTax)}`}
        />
        <div className="my-2 border-t border-orange-200 dark:border-orange-700" />
        <TaxRow label="Estimated total tax" value={fmt$(totalTax)} bold />
        {isFuture && sharesToCover > 0 && (
          <TaxRow label="Sell to cover" value={`≈ ${sharesToCover.toLocaleString()} shares`} />
        )}
      </div>
    </div>
  )
}

function LiqDetailCard({ e }: { e: TimelineEvent }) {
  const s = e.exit_summary
  if (!s) {
    // Fallback for events without exit_summary (shouldn't happen)
    const shares = Math.abs(e.vested_shares ?? 0)
    const gross = e.gross_proceeds ?? 0
    const tax = e.estimated_tax ?? 0
    const net = Math.max(0, gross - tax)
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">Projected Liquidation</h3>
        <div className="space-y-1">
          <TaxRow label={`${fmtNum(shares)} shares × ${fmtPrice(e.share_price)}`} value={fmt$(gross)} />
          <TaxRow label="Est. tax on sale" value={`−${fmt$(tax)}`} />
          <div className="my-2 border-t border-stone-200 dark:border-slate-600" />
          <TaxRow label="Net cash" value={fmt$(net)} bold />
        </div>
      </div>
    )
  }

  const hasSales = s.prior_sales.length > 0
  const hasDeduction = s.deduction_savings > 0
  const liqNet = Math.max(0, s.gross_vested + s.unvested_cost_proceeds - s.liquidation_tax - s.outstanding_principal)
  const yearsLabel = s.deduction_years.length > 0
    ? s.deduction_years.length === 1
      ? String(s.deduction_years[0])
      : `${s.deduction_years[0]}–${s.deduction_years[s.deduction_years.length - 1]}`
    : ''

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">Exit Breakdown</h3>

      {/* Liquidation section */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Liquidation Sale</p>
        <TaxRow label={`${fmtNum(s.vested_shares)} vested × ${fmtPrice(s.share_price)}`} value={fmt$(s.gross_vested)} />
        {s.unvested_cost_proceeds > 0 && (
          <TaxRow label="Unvested at cost basis" value={fmt$(s.unvested_cost_proceeds)} />
        )}
        <TaxRow label="Est. tax on liquidation" value={`−${fmt$(s.liquidation_tax)}`} />
        {s.outstanding_principal > 0 && (
          <TaxRow label="Loan principal payoff" value={`−${fmt$(s.outstanding_principal)}`} />
        )}
        <div className="my-1.5 border-t border-stone-200 dark:border-slate-600" />
        <TaxRow label="Net from liquidation" value={fmt$(liqNet)} bold />
      </div>

      {/* Prior sales section */}
      {hasSales && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">
            Prior Sales ({s.prior_sales.length})
          </p>
          {s.prior_sales.map((sale, i) => (
            <div key={i} className="space-y-0.5">
              <TaxRow
                label={`${sale.date}  ${fmtNum(sale.shares)} sh × ${fmtPrice(sale.price_per_share)}`}
                value={fmt$(sale.net)}
              />
              <p className="pl-2 text-[10px] text-stone-400 dark:text-slate-500">
                {fmt$(sale.proceeds)} proceeds
                {sale.estimated_tax > 0 ? ` − ${fmt$(sale.estimated_tax)} tax` : ''}
                {sale.loan_payoff > 0 ? ` − ${fmt$(sale.loan_payoff)} loan` : ''}
              </p>
            </div>
          ))}
          <div className="my-1.5 border-t border-stone-200 dark:border-slate-600" />
          <TaxRow label="Net from prior sales" value={fmt$(s.prior_sales_net)} bold />
        </div>
      )}

      {/* Deduction section */}
      {(hasDeduction || s.deduction_excluded_years.length > 0) && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Interest Deduction</p>
          {hasDeduction && (
            <TaxRow label={`Tax savings${yearsLabel ? ` (${yearsLabel})` : ''}`} value={`+${fmt$(s.deduction_savings)}`} />
          )}
          {s.deduction_excluded_years.length > 0 && (
            <p className="text-[10px] text-stone-400 dark:text-slate-500">
              {s.deduction_excluded_years.length <= 5
                ? `Not applied to ${s.deduction_excluded_years.join(', ')}.`
                : `Not applied to ${s.deduction_excluded_years.length} years (${s.deduction_excluded_years[0]}–${s.deduction_excluded_years[s.deduction_excluded_years.length - 1]}).`
              }
              {' '}<a href="/settings" className="underline hover:text-stone-600 dark:hover:text-slate-300">Customize</a>
            </p>
          )}
        </div>
      )}

      {/* Total */}
      <div className="mt-3 border-t-2 border-stone-300 pt-2 dark:border-slate-500">
        <TaxRow label="Total cash at exit" value={fmt$(s.net_cash)} bold />
      </div>
    </div>
  )
}

function Unrealized83bCard({ e, ts }: { e: TimelineEvent; ts: TaxSettings }) {
  const ltCgRate = ts.federal_lt_cg_rate + ts.niit_rate + ts.state_lt_cg_rate
  const potentialTax = e.income * ltCgRate
  const isFuture = e.date > TODAY

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-xs dark:border-violet-800 dark:bg-violet-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">83(b) Election — Unrealized Gain</h3>
      <div className="space-y-1">
        <TaxRow label="Unrealized gain at vesting" value={fmt$(e.income)} />
        <TaxRow label="Cost basis (83b at $0)" value="$0" />
        <div className="my-2 border-t border-violet-200 dark:border-violet-700" />
        <TaxRow label="No income tax due at vesting" value="$0" />
        <TaxRow
          label={`Potential LT cap gains × ${fmtPct(ltCgRate)}`}
          value={`→ ~${fmt$(potentialTax)}`}
        />
        {isFuture && (
          <p className="pt-1 text-stone-600">Gain realized only upon sale — holding period starts at vesting.</p>
        )}
      </div>
    </div>
  )
}

function InterestDeductionCard({ e }: { e: TimelineEvent }) {
  const stcgDed = e.interest_deduction_on_stcg ?? 0
  const ltcgDed = e.interest_deduction_on_ltcg ?? 0
  const total = e.interest_deduction_applied ?? 0
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs dark:border-purple-800 dark:bg-purple-900/20">
      <h3 className="mb-2 text-xs font-semibold text-purple-900 dark:text-purple-200">Investment Interest Deduction Applied</h3>
      <div className="space-y-1">
        {stcgDed > 0 && (
          <TaxRow label="Offset against short-term gains" value={`−${fmt$(stcgDed)}`} />
        )}
        {ltcgDed > 0 && (
          <TaxRow label="Offset against long-term gains" value={`−${fmt$(ltcgDed)}`} />
        )}
        <div className="my-1.5 border-t border-purple-200 dark:border-purple-700" />
        <TaxRow label="Total deduction used this event" value={fmt$(total)} bold />
        {e.adjusted_total_cap_gains != null && (
          <TaxRow
            label={`Reported cap gains (${fmt$(e.total_cap_gains)} − ${fmt$(total)})`}
            value={fmt$(e.adjusted_total_cap_gains)}
          />
        )}
      </div>
      <p className="mt-2 text-[10px] text-purple-600 dark:text-purple-700">
        Form 4952 estimate — interest paid on investment loans is deducted here.
        Unused deduction carries forward to future years.
      </p>
    </div>
  )
}

export default function Events() {
  const [searchParams] = useSearchParams()
  const fetchEvents = useCallback(() => api.getEvents(), [])
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: events, loading, reload } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  useDataSync('sales', reload)
  const initialTypes = searchParams.get('types')?.split(',').filter(Boolean) ?? []
  const [typeFilter, setTypeFilter] = useState<Set<string>>(
    initialTypes.length ? new Set(initialTypes) : new Set()
  )
  const highlightDate = searchParams.get('date') ?? null
  const [highlightedRows, setHighlightedRows] = useState<Set<number>>(new Set())
  const isMobile = useIsMobile()
  const highlightRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const typeDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!typeDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [typeDropdownOpen])

  useEffect(() => {
    if (!highlightDate || !events) return
    // Find indices in the filtered list that match the target date
    // We re-derive filtered here just to find indices; the actual filtered is computed below in render
    const matchingIndices = new Set<number>()
    const tempFiltered = typeFilter.size > 0 ? events.filter(e => typeFilter.has(e.event_type)) : events
    tempFiltered.forEach((e, i) => {
      if (typeof e.date === 'string' && e.date.startsWith(highlightDate)) {
        matchingIndices.add(i)
      }
    })
    if (matchingIndices.size === 0) return
    setHighlightedRows(matchingIndices)
    // Scroll to first matching row after render
    const firstIdx = Math.min(...matchingIndices)
    requestAnimationFrame(() => {
      const el = highlightRefs.current.get(firstIdx)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    // Remove highlight after 2 seconds
    const timer = setTimeout(() => setHighlightedRows(new Set()), 2000)
    return () => clearTimeout(timer)
  }, [highlightDate, events]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleType(t: string) {
    setTypeFilter(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // Per-sale-row inline TaxCard state
  const [breakdowns, setBreakdowns] = useState<Map<number, TaxBreakdown>>(new Map())
  const [expandedSales, setExpandedSales] = useState<Set<number>>(new Set())
  const [loadingTaxIds, setLoadingTaxIds] = useState<Set<number>>(new Set())

  // Per-vesting-row expansion state (keyed by row index in filtered list)
  const [expandedVesting, setExpandedVesting] = useState<Set<number>>(new Set())
  const [expandedLiq, setExpandedLiq] = useState(false)
  const [expandedMobileRows, setExpandedMobileRows] = useState<Set<number>>(new Set())

  const ts = taxSettings ?? WI_TAX_DEFAULTS

  function toggleVestingTax(idx: number) {
    setExpandedVesting(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  async function toggleSaleTax(saleId: number) {
    if (breakdowns.has(saleId)) {
      setExpandedSales(prev => {
        const next = new Set(prev)
        if (next.has(saleId)) next.delete(saleId)
        else next.add(saleId)
        return next
      })
      return
    }
    setLoadingTaxIds(prev => new Set(prev).add(saleId))
    try {
      const tax = await api.getSaleTax(saleId)
      setBreakdowns(prev => new Map(prev).set(saleId, tax))
      setExpandedSales(prev => new Set(prev).add(saleId))
    } catch {
      // silently ignore
    } finally {
      setLoadingTaxIds(prev => { const next = new Set(prev); next.delete(saleId); return next })
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-stone-600">Loading...</p>
  if (!events) return <p className="p-6 text-center text-sm text-red-500">Failed to load events</p>

  const filtered = typeFilter.size > 0 ? events.filter(e => typeFilter.has(e.event_type)) : events
  // Index of the projected liquidation event in the filtered list (for separator placement)
  const liqIdx = filtered.findIndex(e => e.is_projected)
  const hasInterestDeduction = events.some(e => (e.interest_deduction_applied ?? 0) > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Events Timeline</h2>
        <div className="relative" ref={typeDropdownRef}>
          <button
            onClick={() => setTypeDropdownOpen(p => !p)}
            aria-expanded={typeDropdownOpen}
            aria-haspopup="listbox"
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {typeFilter.size === 0
              ? `All types (${events.length})`
              : typeFilter.size === 1
              ? `${[...typeFilter][0]} (${filtered.length})`
              : `${typeFilter.size} types (${filtered.length})`}
            <span className="text-stone-600">{typeDropdownOpen ? '▲' : '▼'}</span>
          </button>
          {typeDropdownOpen && (
            <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <button
                onClick={() => { setTypeFilter(new Set()); setTypeDropdownOpen(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-stone-50 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Clear selection
              </button>
              <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
              {EVENT_TYPES.map(t => (
                <label key={t} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-stone-50 dark:hover:bg-slate-700">
                  <input
                    type="checkbox"
                    checked={typeFilter.has(t)}
                    onChange={() => toggleType(t)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  <span className="flex-1 text-xs text-gray-700 dark:text-slate-200">{t}</span>
                  <span className="text-[10px] text-stone-600">{events.filter(e => e.event_type === t).length}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile card layout */}
      {isMobile ? <div className="space-y-2">
        {filtered.map((e, i) => {
          const saleId = e.sale_id ?? null
          const bd = saleId != null ? breakdowns.get(saleId) : undefined
          const isSaleExpanded = saleId != null && expandedSales.has(saleId)
          const isVestingExpanded = expandedVesting.has(i)
          const isLoadingSale = saleId != null && loadingTaxIds.has(saleId)
          const hasST = (e.st_shares ?? 0) > 0
          const is83b = e.event_type === 'Vesting' && e.income > 0 && !!e.election_83b
          const hasVestingTax = e.event_type === 'Vesting' && e.income > 0 && !e.election_83b
          const isPastHorizon = liqIdx >= 0 && !e.is_projected && i > liqIdx
          const isMobileExpanded = expandedMobileRows.has(i)

          const sharesDisplay = e.event_type === 'Early Loan Payment'
            ? (e.amount != null ? fmt$(e.amount) : null)
            : (e.vested_shares ?? e.granted_shares) != null ? fmtNum(e.vested_shares ?? e.granted_shares) : null

          // Cap gains / gross proceeds
          let capGainsLabel: string | null = null
          let capGainsValue: React.ReactNode = null
          if (e.event_type === 'Loan Payoff' && e.cash_due != null) {
            capGainsLabel = 'Cash Due'
            capGainsValue = <span>{fmt$(e.cash_due)} <span className={e.status === 'covered' ? 'text-emerald-700' : 'text-orange-700'}>{e.status === 'covered' ? '\u2713' : '!'}</span></span>
          } else if ((e.event_type === 'Sale' || e.is_projected) && e.gross_proceeds != null) {
            capGainsLabel = 'Gross Proceeds'
            capGainsValue = <span className={e.is_projected ? 'text-green-700 opacity-70 dark:text-green-300' : 'text-green-700 dark:text-green-300'}>{fmt$(e.gross_proceeds)}</span>
          } else if (e.adjusted_total_cap_gains != null && e.adjusted_total_cap_gains !== e.total_cap_gains) {
            capGainsLabel = 'Cap Gains'
            capGainsValue = <span className="text-purple-600 dark:text-purple-700">{fmt$(e.adjusted_total_cap_gains)} <span className="text-[9px] text-purple-700 dark:text-purple-500">adj.</span></span>
          } else if (e.total_cap_gains) {
            capGainsLabel = 'Cap Gains'
            capGainsValue = <span className="text-purple-600 dark:text-purple-700">{fmt$(e.total_cap_gains)}</span>
          }

          // Tax display
          let taxNode: React.ReactNode = null
          if (e.is_projected && e.estimated_tax != null) {
            taxNode = <span className="text-orange-700 opacity-70 dark:text-orange-700">~{fmt$(e.estimated_tax)}</span>
          } else if (e.event_type === 'Sale' && saleId != null) {
            taxNode = (
              <button onClick={(ev) => { ev.stopPropagation(); toggleSaleTax(saleId) }} className="inline-flex items-center gap-1">
                {isLoadingSale ? <span className="text-stone-600">...</span> : (
                  <>
                    {hasST && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">ST</span>}
                    <span className={`underline decoration-dotted ${hasST ? 'text-amber-700 dark:text-amber-300' : 'text-orange-700 dark:text-orange-300'}`}>{e.estimated_tax != null ? fmt$(e.estimated_tax) : '\u2014'}</span>
                  </>
                )}
              </button>
            )
          } else if (is83b) {
            taxNode = <button onClick={(ev) => { ev.stopPropagation(); toggleVestingTax(i) }}><span className="text-violet-700 underline decoration-dotted dark:text-violet-300">~{fmt$(est83bTax(e, ts))}</span></button>
          } else if (hasVestingTax) {
            taxNode = <button onClick={(ev) => { ev.stopPropagation(); toggleVestingTax(i) }}><span className="text-orange-700 underline decoration-dotted dark:text-orange-300">{fmt$(estTaxForVesting(e, ts))}</span></button>
          }

          const autoShowInterestDed = e.event_type === 'Share Price' && (e.interest_deduction_applied ?? 0) > 0

          return (
            <React.Fragment key={i}>
              <div
                ref={(el) => { if (el) highlightRefs.current.set(i, el); else highlightRefs.current.delete(i) }}
                className={[
                  'rounded-lg border border-stone-200 p-3 text-xs dark:border-slate-700',
                  e.is_projected ? 'bg-stone-50 opacity-75 dark:bg-slate-900/50' : isPastHorizon ? 'bg-white opacity-40 dark:bg-slate-900' : e.event_type === 'Refinanced' ? 'bg-white opacity-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-900',
                  highlightedRows.has(i) ? 'ring-2 ring-inset ring-blue-400 animate-pulse' : '',
                ].join(' ')}
                onClick={() => setExpandedMobileRows(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })}
              >
                {/* Line 1: Date + Type badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700 dark:text-slate-300">{e.date}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[e.event_type] ?? ''} ${e.is_projected ? 'ring-1 ring-dashed ring-gray-400 dark:ring-gray-600' : ''}`}>
                      {e.is_projected ? 'Liquidation' : e.event_type}
                    </span>
                    {e.is_projected && <span className="text-[9px] uppercase tracking-wide text-stone-600 dark:text-slate-400">projected</span>}
                  </div>
                  <span className="text-stone-400 dark:text-slate-500">{isMobileExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
                {/* Line 2: Grant + Shares */}
                <div className="mt-1 flex items-center justify-between text-gray-500 dark:text-slate-400">
                  <span>{e.grant_year ? `${e.grant_year} ${e.grant_type}` : ''}</span>
                  {sharesDisplay && (
                    <span className={`tabular-nums font-medium ${(e.event_type === 'Sale' || e.is_projected) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
                      {sharesDisplay}{e.event_type !== 'Early Loan Payment' ? ' shares' : ''}
                    </span>
                  )}
                </div>
                {/* Collapsed: tax indicator for quick reference */}
                {!isMobileExpanded && hasVestingTax && (
                  <div className="mt-0.5 text-right">
                    <span className="text-[10px] text-orange-700 dark:text-orange-300">Tax {fmt$(estTaxForVesting(e, ts))}</span>
                  </div>
                )}
                {!isMobileExpanded && is83b && (
                  <div className="mt-0.5 text-right">
                    <span className="text-[10px] text-violet-700 dark:text-violet-300">Tax ~{fmt$(est83bTax(e, ts))}</span>
                  </div>
                )}
                {/* Expanded secondary fields */}
                {isMobileExpanded && (
                  <div className="mt-2 space-y-1 border-t border-stone-100 pt-2 dark:border-slate-700">
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-slate-400">Price</span>
                      <span className="tabular-nums text-gray-700 dark:text-slate-300">{fmtPrice(e.share_price)}</span>
                    </div>
                    {(is83b || e.income > 0) && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-slate-400">Income</span>
                        {is83b
                          ? <span className="tabular-nums text-violet-700 dark:text-violet-300">~{fmt$(e.income)}</span>
                          : <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{fmt$(e.income)}</span>}
                      </div>
                    )}
                    {capGainsLabel && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-slate-400">{capGainsLabel}</span>
                        <span className="tabular-nums">{capGainsValue}</span>
                      </div>
                    )}
                    {taxNode && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-slate-400">Tax</span>
                        <span className="tabular-nums">{taxNode}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-slate-400">Cum Shares</span>
                      <span className="tabular-nums font-medium text-gray-900 dark:text-slate-100">{fmtNum(e.cum_shares)}</span>
                    </div>
                    {isSaleExpanded && bd && <div className="mt-2"><TaxCard breakdown={bd} /></div>}
                    {isVestingExpanded && hasVestingTax && <div className="mt-2"><VestingTaxCard e={e} ts={ts} /></div>}
                    {isVestingExpanded && is83b && <div className="mt-2"><Unrealized83bCard e={e} ts={ts} /></div>}
                    {e.is_projected && <div className="mt-2"><LiqDetailCard e={e} /></div>}
                    {(isVestingExpanded || autoShowInterestDed) && (e.interest_deduction_applied ?? 0) > 0 && (
                      <div className="mt-2"><InterestDeductionCard e={e} /></div>
                    )}
                  </div>
                )}
              </div>
              {i === liqIdx && liqIdx >= 0 && liqIdx < filtered.length - 1 && typeFilter.size === 0 && (
                <div className="border-t-2 border-dashed border-gray-300 py-1 text-center text-[10px] italic text-stone-600 dark:border-slate-600 dark:text-slate-400">
                  beyond exit horizon — events below won't occur if you liquidate above
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div> : /* Desktop table layout */
      <div tabIndex={0} className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr className="text-gray-500 dark:text-slate-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Grant</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Income</th>
              <th className="px-3 py-2 text-right">{hasInterestDeduction ? 'Cap Gains (adj.)' : 'Cap Gains'}</th>
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2 text-right">Cum Shares</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((e, i) => {
              const saleId = e.sale_id ?? null
              const bd = saleId != null ? breakdowns.get(saleId) : undefined
              const isSaleExpanded = saleId != null && expandedSales.has(saleId)
              const isVestingExpanded = expandedVesting.has(i)
              const isLoadingSale = saleId != null && loadingTaxIds.has(saleId)
              const hasST = (e.st_shares ?? 0) > 0
              const is83b = e.event_type === 'Vesting' && e.income > 0 && !!e.election_83b
              const hasVestingTax = e.event_type === 'Vesting' && e.income > 0 && !e.election_83b
              // Events after the projected liquidation are beyond the exit horizon
              const isPastHorizon = liqIdx >= 0 && !e.is_projected && i > liqIdx

              return (
                <React.Fragment key={i}>
                  <tr
                    ref={(el) => {
                      if (el) highlightRefs.current.set(i, el)
                      else highlightRefs.current.delete(i)
                    }}
                    className={[
                      e.is_projected
                        ? 'cursor-pointer bg-stone-50 opacity-75 dark:bg-slate-900/50'
                        : isPastHorizon
                        ? 'bg-white opacity-40 dark:bg-slate-900'
                        : e.event_type === 'Refinanced'
                        ? 'bg-white opacity-50 dark:bg-slate-900'
                        : 'bg-white dark:bg-slate-900',
                      highlightedRows.has(i) ? 'ring-2 ring-inset ring-blue-400 animate-pulse' : '',
                    ].join(' ')}
                    onClick={e.is_projected ? () => setExpandedLiq(p => !p) : undefined}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-slate-300">{e.date}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[e.event_type] ?? ''} ${e.is_projected ? 'ring-1 ring-dashed ring-gray-400 dark:ring-gray-600' : ''}`}>
                        {e.is_projected ? 'Liquidation' : e.event_type}
                      </span>
                      {e.is_projected && (
                        <span className="ml-1 text-[9px] uppercase tracking-wide text-stone-600 dark:text-slate-400">
                          projected {expandedLiq ? '▲' : '▼'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">
                      {e.grant_year ? `${e.grant_year} ${e.grant_type}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${(e.event_type === 'Sale' || e.is_projected) ? 'text-red-600 opacity-70 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
                      {e.event_type === 'Early Loan Payment'
                        ? (e.amount != null ? fmt$(e.amount) : '—')
                        : fmtNum(e.vested_shares ?? e.granted_shares)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmtPrice(e.share_price)}</td>
                    <td className="px-3 py-2 text-right">
                      {is83b
                        ? <span className="text-violet-700 dark:text-violet-300">~{fmt$(e.income)}</span>
                        : e.income
                        ? <span className="text-emerald-700 dark:text-emerald-300">{fmt$(e.income)}</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-700">
                      {e.event_type === 'Loan Payoff' && e.cash_due != null
                        ? <span>
                            {fmt$(e.cash_due)}
                            {' '}
                            <span className={e.status === 'covered' ? 'text-emerald-700' : 'text-orange-700'}>
                              {e.status === 'covered' ? '✓' : '!'}
                            </span>
                          </span>
                        : (e.event_type === 'Sale' || e.is_projected) && e.gross_proceeds != null
                        ? <span className={e.is_projected ? 'text-green-700 opacity-70 dark:text-green-300' : 'text-green-700 dark:text-green-300'}>{fmt$(e.gross_proceeds)}</span>
                        : e.adjusted_total_cap_gains != null && e.adjusted_total_cap_gains !== e.total_cap_gains
                        ? <span title={`Gross: ${fmt$(e.total_cap_gains)} − ${fmt$(e.interest_deduction_applied ?? 0)} interest ded.`}>
                            {fmt$(e.adjusted_total_cap_gains)}
                            <span className="ml-1 text-[9px] text-purple-700 dark:text-purple-500">adj.</span>
                          </span>
                        : e.total_cap_gains ? fmt$(e.total_cap_gains) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.is_projected && e.estimated_tax != null ? (
                        <span className="text-orange-700 opacity-70 dark:text-orange-700">
                          ~{fmt$(e.estimated_tax)}
                        </span>
                      ) : e.event_type === 'Sale' && saleId != null ? (
                        <button
                          onClick={() => toggleSaleTax(saleId)}
                          aria-expanded={isSaleExpanded}
                          aria-label={`${isSaleExpanded ? 'Hide' : 'Show'} tax breakdown`}
                          className="inline-flex items-center gap-1"
                        >
                          {isLoadingSale ? (
                            <span className="text-stone-600">...</span>
                          ) : (
                            <>
                              {hasST && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  ST
                                </span>
                              )}
                              <span className={`underline decoration-dotted ${hasST ? 'text-amber-700 dark:text-amber-300' : 'text-orange-700 dark:text-orange-300'}`}>
                                {e.estimated_tax != null ? fmt$(e.estimated_tax) : '—'}
                              </span>
                            </>
                          )}
                        </button>
                      ) : is83b ? (
                        <button onClick={() => toggleVestingTax(i)}>
                          <span className="text-violet-700 underline decoration-dotted dark:text-violet-300">
                            ~{fmt$(est83bTax(e, ts))}
                          </span>
                        </button>
                      ) : hasVestingTax ? (
                        <button onClick={() => toggleVestingTax(i)}>
                          <span className="text-orange-700 underline decoration-dotted dark:text-orange-300">
                            {fmt$(estTaxForVesting(e, ts))}
                          </span>
                        </button>
                      ) : e.event_type === 'Share Price' ? (
                        <span className="text-xs text-stone-600 dark:text-slate-400">—*</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">{fmtNum(e.cum_shares)}</td>
                  </tr>
                  {isSaleExpanded && bd && (
                    <tr className="bg-white dark:bg-slate-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <TaxCard breakdown={bd} />
                      </td>
                    </tr>
                  )}
                  {isVestingExpanded && hasVestingTax && (
                    <tr className="bg-white dark:bg-slate-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <VestingTaxCard e={e} ts={ts} />
                      </td>
                    </tr>
                  )}
                  {isVestingExpanded && is83b && (
                    <tr className="bg-white dark:bg-slate-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <Unrealized83bCard e={e} ts={ts} />
                      </td>
                    </tr>
                  )}
                  {e.is_projected && expandedLiq && (
                    <tr className="bg-stone-50 dark:bg-slate-900/50">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <LiqDetailCard e={e} />
                      </td>
                    </tr>
                  )}
                  {(isVestingExpanded || (e.event_type === 'Share Price' && (e.interest_deduction_applied ?? 0) > 0))
                    && (e.interest_deduction_applied ?? 0) > 0 && (
                    <tr className="bg-white dark:bg-slate-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <InterestDeductionCard e={e} />
                      </td>
                    </tr>
                  )}
                  {i === liqIdx && liqIdx >= 0 && liqIdx < filtered.length - 1 && typeFilter.size === 0 && (
                    <tr>
                      <td colSpan={9} className="py-0">
                        <div className="border-t-2 border-dashed border-gray-300 py-1 text-center text-[10px] italic text-stone-600 dark:border-slate-600 dark:text-slate-400">
                          beyond exit horizon — events below won't occur if you liquidate above
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>}
      <p className="text-xs text-stone-600">{filtered.length} events &nbsp;·&nbsp; * price appreciation is unrealized — not a taxable event</p>
    </div>
  )
}
