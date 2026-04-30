import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { api } from '../../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry, GrantEntry, TaxSettings, SaleEntry, ExitPreview, DeductionPreview } from '../../api.ts'
import ExitBreakdownCard from '../components/ExitBreakdownCard.tsx'
import { useApiData } from '../hooks/useApiData.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import ImportWizard from '../components/ImportWizard.tsx'
import TipCarousel from '../components/TipCarousel.tsx'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function fmtDate(d: string) {
  const m = d.slice(5, 7)
  const y = d.slice(2, 4)
  return `${m}/${y}` // "2021-03-01" → "03/21"
}

function fmtFullDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Compute ~maxTicks evenly-spaced numeric indices for a dataset of length len. */
function numericTicks(len: number, maxTicks = 6): number[] {
  if (len === 0) return []
  if (len <= maxTicks) return Array.from({ length: len }, (_, i) => i)
  return Array.from({ length: maxTicks }, (_, k) => Math.round(k * (len - 1) / (maxTicks - 1)))
}

/** @deprecated use numericTicks instead */
function smartInterval(len: number, maxTicks = 6): number {
  if (len <= maxTicks) return 0
  return Math.ceil(len / maxTicks) - 1
}

const TODAY = new Date().toISOString().slice(0, 10)

type RangeMode = 'all' | 'custom'

interface DateRange {
  mode: RangeMode
  start: string
  end: string
}

function filterByDateRange<T>(items: T[], range: DateRange, dateKey: keyof T): T[] {
  if (range.mode === 'all') return items
  return items.filter(item => {
    const d = item[dateKey] as string
    return d >= range.start && d <= range.end
  })
}

function RangeControls({ range, setRange, maxDate }: { range: DateRange; setRange: (r: DateRange) => void; maxDate: string }) {
  const isAll = range.mode === 'all'
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setRange({ mode: 'all', start: '', end: '' })}
        aria-pressed={isAll}
        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
          isAll
            ? 'bg-rose-700 text-white'
            : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
        }`}
      >
        All
      </button>
      <input
        type="date"
        aria-label="Range start date"
        value={range.mode === 'custom' ? range.start : ''}
        onChange={e => setRange({ mode: 'custom', start: e.target.value, end: range.end || maxDate })}
        className="h-6 rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
      />
      <span className="text-xs text-stone-600">–</span>
      <input
        type="date"
        aria-label="Range end date"
        value={range.mode === 'custom' ? range.end : ''}
        onChange={e => setRange({ mode: 'custom', start: range.start || '0000-01-01', end: e.target.value })}
        className="h-6 rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
      />
    </div>
  )
}

/** Find the index of the data point closest to today for the ReferenceLine. */
function todayIndex(data: { _date: string }[]): number | null {
  for (let i = 0; i < data.length; i++) {
    if (data[i]._date >= TODAY) return i
  }
  return null
}

interface ChartColors {
  grid: string
  axis: string
  tooltipBg: string
  tooltipText: string
}

function useChartColors(): ChartColors {
  const dark = useDark()
  return dark
    ? { grid: '#1e293b', axis: '#94a3b8', tooltipBg: '#0f172a', tooltipText: '#f1f5f9' }
    : { grid: '#e7e5e4', axis: '#78716c', tooltipBg: '#ffffff', tooltipText: '#1c1917' }
}

const CARD_STYLES: Record<string, { bg: string; border: string; label: string }> = {
  price:  { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', label: 'text-amber-700 dark:text-amber-300' },
  shares: { bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-200 dark:border-rose-800', label: 'text-rose-700 dark:text-rose-400' },
  income: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', label: 'text-emerald-700 dark:text-emerald-300' },
  gains:  { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800', label: 'text-purple-700 dark:text-purple-700' },
  loans:  { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-red-200 dark:border-red-800', label: 'text-red-700 dark:text-red-400' },
  interest: { bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800', label: 'text-rose-700 dark:text-rose-400' },
  event:  { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-200 dark:border-sky-800', label: 'text-sky-700 dark:text-sky-400' },
  tax:    { bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800', label: 'text-orange-700 dark:text-orange-300' },
  cash:   { bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-800', label: 'text-green-700 dark:text-green-300' },
  unvested: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-200 dark:border-indigo-800', label: 'text-indigo-700 dark:text-indigo-300' },
}

function Card({ label, value, subvalue, variant, subtitle, onClick, expanded }: { label: string; value: string; subvalue?: string; variant: string; subtitle?: string; onClick?: () => void; expanded?: boolean }) {
  const s = CARD_STYLES[variant] ?? CARD_STYLES.event
  const clickable = !!onClick
  const content = (
    <>
      <p className={`text-xs font-medium uppercase ${s.label}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{value}</p>
      {subvalue && <p className="mt-0.5 text-sm font-medium text-gray-600 dark:text-slate-300">{subvalue}</p>}
      {subtitle && <p className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-slate-400">{subtitle}</p>}
      {clickable && (
        <p className="mt-1 text-[10px] leading-tight text-gray-400 dark:text-slate-500">
          {expanded ? '▲ hide breakdown' : '▼ see breakdown'}
        </p>
      )}
    </>
  )
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={!!expanded}
        className={`rounded-lg border p-4 text-left transition hover:shadow-sm ${s.bg} ${s.border}`}
      >
        {content}
      </button>
    )
  }
  return <div className={`rounded-lg border p-4 ${s.bg} ${s.border}`}>{content}</div>
}

function BreakdownRow({ label, value, sub, bold, tone }: { label: ReactNode; value: string; sub?: string; bold?: boolean; tone?: 'positive' | 'negative' }) {
  const toneClass = tone === 'negative'
    ? 'text-red-700 dark:text-red-400'
    : tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : ''
  return (
    <div className="space-y-0.5">
      <div className={`flex justify-between gap-4 text-xs ${bold ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-400'}`}>
        <span>{label}</span>
        <span className={`tabular-nums ${toneClass}`}>{value}</span>
      </div>
      {sub && <p className="pl-2 text-[10px] text-stone-400 dark:text-slate-500">{sub}</p>}
    </div>
  )
}

function BreakdownShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

/** Detail card shown below a chart when user clicks a data point */
function DetailCard({ items, onClose }: { items: { label: string; value: string }[]; onClose: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {items.map(({ label, value }) => (
            <span key={label} className="text-xs text-gray-600 dark:text-slate-400">
              <span className="font-medium text-gray-900 dark:text-slate-200">{value}</span>{' '}{label}
            </span>
          ))}
        </div>
        <button onClick={onClose} aria-label="Close detail panel" className="ml-2 shrink-0 text-xs text-stone-600 hover:text-gray-600 dark:hover:text-slate-300">&times;</button>
      </div>
    </div>
  )
}

function SharesChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
      .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    return filtered.map((e, i) => {
      const isPast = !hasFuturePrices || e.date <= TODAY
      return {
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        shares: isPast ? e.cum_shares : null as number | null,
        projected: !isPast ? e.cum_shares : null as number | null,
      }
    }).map((d, i, arr) => {
      if (hasFuturePrices && d.shares !== null && (i === arr.length - 1 || arr[i + 1].projected !== null)) {
        return { ...d, projected: d.shares }
      }
      return d
    })
  }, [events, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#e11d48" strokeWidth={1.5} zIndex={600} />
          )}
          <Line type="monotone" dataKey="shares" stroke="#e11d48" strokeWidth={2} dot={false} name="Shares" connectNulls={false} />
          {hasFuturePrices && (
            <Line type="monotone" dataKey="projected" stroke="#e11d48" strokeWidth={2} dot={false} name="Projected" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'shares', value: fmtNum(sel._event.cum_shares) },
            ...(sel._event.event_type ? [{ label: '', value: sel._event.event_type }] : []),
            ...(sel._event.vested_shares ? [{ label: 'vested', value: fmtNum(sel._event.vested_shares) }] : []),
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Cumulative shares chart: {data.length} data points from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
        </p>
      )}
    </>
  )
}

function IncomeCapGainsChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const hasDeduction = events.some(e => (e.interest_deduction_applied ?? 0) > 0)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
    // Track the portion of income and cap gains attributable solely to future price changes.
    // RSU vests (grant_price=0) produce income; option vests (grant_price>0) produce cap gains.
    // For the future price event: price_cap_gains is entirely price-driven surplus.
    // For future vests after a price change: extra = cumFuturePriceIncrease × shares_vested.
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0
    return filtered.map((e, i) => {
      if (hasFuturePrices && e.date > TODAY) {
        const vs = (e.vested_shares ?? 0)
        if (e.event_type === 'Share Price') {
          cumFuturePriceIncrease += e.price_increase
          cumSurplusCg += e.price_cap_gains
        } else if (cumFuturePriceIncrease > 0 && vs > 0) {
          if ((e.grant_price ?? 0) === 0) {
            cumSurplusIncome += cumFuturePriceIncrease * vs  // RSU: extra shows as income
          } else {
            cumSurplusCg += cumFuturePriceIncrease * vs      // option: extra shows as cap gains
          }
        }
      }
      const cumCg = e.cum_cap_gains
      return {
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        income: e.cum_income - cumSurplusIncome,
        gains: cumCg - cumSurplusCg,
        projExtraIncome: hasFuturePrices && cumSurplusIncome > 0 ? cumSurplusIncome : null as number | null,
        projExtra: hasFuturePrices && cumSurplusCg > 0 ? cumSurplusCg : null as number | null,
      }
    })
  }, [events, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{'  '}
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Capital gains'}{'  '}
              <tspan fill="#6ee7b7">&#9632;</tspan>/<tspan fill="#c4b5fd">&#9632;</tspan> Projected
            </text>
          )}
          {!hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{'  '}
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Capital gains'}
            </text>
          )}
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#8b5cf6" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Single stack: income + certain gains + projected extras (price-driven surplus) */}
          <Area type="monotone" dataKey="income" stackId="main" fill="#34d399" fillOpacity={0.7} stroke="#10b981" name="Income" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtraIncome" stackId="main" fill="#6ee7b7" fillOpacity={0.5} stroke="#6ee7b7" strokeDasharray="6 3" name="Proj Income" dot={false} />
          )}
          <Area type="monotone" dataKey="gains" stackId="main" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" name="Capital gains" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtra" stackId="main" fill="#c4b5fd" fillOpacity={0.5} stroke="#c4b5fd" strokeDasharray="6 3" name="Projected capital gains" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'income', value: fmt$(sel._event.cum_income) },
            { label: 'capital gains', value: fmt$(sel._event.cum_cap_gains) },
            ...(hasDeduction && (sel._event.interest_deduction_applied ?? 0) > 0
              ? [{ label: 'interest deducted this event', value: fmt$(sel._event.interest_deduction_applied!) }]
              : []),
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Income and capital gains chart: {data.length} data points from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
        </p>
      )}
    </>
  )
}

function PriceChart({ prices, c, range, hasFuturePrices }: { prices: PriceEntry[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(prices, range, 'effective_date')
    if (filtered.length === 0) return []

    const result = filtered.map((p, i) => {
      const isPast = !hasFuturePrices || p.effective_date <= TODAY
      return {
        _idx: i,
        _date: p.effective_date,
        _label: fmtDate(p.effective_date),
        _price: p.price,
        price: isPast ? p.price : null as number | null,
        projected: !isPast ? p.price : null as number | null,
      }
    })

    if (hasFuturePrices) {
      // Overlap: last past point also gets projected for line continuity
      const lastKnownIdx = result.findIndex(d => d._date > TODAY) - 1
      const overlapIdx = lastKnownIdx >= 0 ? lastKnownIdx : result.length - 1
      if (result[overlapIdx] && result.some(d => d.projected !== null)) {
        result[overlapIdx] = { ...result[overlapIdx], projected: result[overlapIdx].price ?? result[overlapIdx]._price }
      }
    }

    return result
  }, [prices, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#e11d48" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#e11d48', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#fbbf24" strokeWidth={1.5} zIndex={600} />
          )}
          <Line type="monotone" dataKey="price" stroke="#fbbf24" strokeWidth={2} dot={false} name="Price" connectNulls={false} />
          {hasFuturePrices && (
            <Line type="monotone" dataKey="projected" stroke="#fbbf24" strokeWidth={2} dot={false} name="Projected" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: '', value: fmtPrice(sel._price) },
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Share price history: {data.length} entries from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
          Most recent price: {fmtPrice(data[data.length - 1]._price)}.
        </p>
      )}
    </>
  )
}

const WI_TAX_DEFAULTS: TaxSettings = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
  lot_selection_method: 'lifo',
  loan_payoff_method: 'epic_lifo',
  flexible_payoff_enabled: false,
  prefer_stock_dp: false,
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

function TaxChart({ events, loans, taxSettings, c, range, hasFuturePrices }: {
  events: TimelineEvent[]
  loans: LoanEntry[]
  taxSettings: TaxSettings
  c: ChartColors
  range: DateRange
  hasFuturePrices: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const incomeRate = taxSettings.federal_income_rate + taxSettings.state_income_rate
    const ltCgRate = taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate

    // Build sorted list of Tax loans for running total computation
    const sortedTaxLoans = [...loans]
      .filter(l => l.loan_type === 'Tax')
      .sort((a, b) => a.loan_year - b.loan_year)
    let taxLoanIdx = 0
    let cumTaxPaid = 0

    // Track price-driven surplus (same approach as IncomeCapGainsChart)
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0

    const filtered = filterByDateRange(events, range, 'date')
    return filtered.map((e, i) => {
      // Accumulate tax loan payments up to this event's year (tax paid when loan was taken, not when due)
      const eYear = parseInt(e.date.slice(0, 4), 10)
      while (taxLoanIdx < sortedTaxLoans.length && sortedTaxLoans[taxLoanIdx].loan_year <= eYear) {
        cumTaxPaid += sortedTaxLoans[taxLoanIdx].amount
        taxLoanIdx++
      }
      // Accumulate Sale estimated taxes at the sale date
      if (e.event_type === 'Sale' && e.estimated_tax) {
        cumTaxPaid += e.estimated_tax
      }
      // Accumulate income tax on vesting events (RSU vesting without 83b) and grant events with income
      if (e.income > 0 && ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')) {
        cumTaxPaid += e.income * incomeRate
      }

      // Track future price surplus (same logic as IncomeCapGainsChart)
      if (hasFuturePrices && e.date > TODAY) {
        const vs = e.vested_shares ?? 0
        if (e.event_type === 'Share Price') {
          cumFuturePriceIncrease += e.price_increase
          cumSurplusCg += e.price_cap_gains
        } else if (cumFuturePriceIncrease > 0 && vs > 0) {
          if ((e.grant_price ?? 0) === 0) {
            cumSurplusIncome += cumFuturePriceIncrease * vs
          } else {
            cumSurplusCg += cumFuturePriceIncrease * vs
          }
        }
      }

      const effectiveCumCg = e.cum_cap_gains

      // "Sure" tax = tax on base income + base vesting cap gains (no price surplus)
      const taxSure = Math.round(
        (e.cum_income - cumSurplusIncome) * incomeRate +
        (effectiveCumCg - cumSurplusCg) * ltCgRate
      )

      // "Half" tax = tax on price-driven surplus (uncertain - depends on future price)
      const hasSurplus = hasFuturePrices && (cumSurplusIncome + cumSurplusCg) > 0
      const taxHalf = hasSurplus
        ? Math.round(cumSurplusIncome * incomeRate + cumSurplusCg * ltCgRate)
        : null as number | null

      return {
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        taxSure,
        taxHalf,
        taxPaid: cumTaxPaid > 0 ? cumTaxPaid : null as number | null,
      }
    })
  }, [events, loans, taxSettings, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
            <tspan fill="#fb923c">&#9632;</tspan> Est. Tax (Sure){'  '}
            {hasFuturePrices && <><tspan fill="#fed7aa">&#9632;</tspan> +Projected{'  '}</>}
            <tspan fill="#ef4444">&#9632;</tspan> Paid
          </text>
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#60a5fa" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#60a5fa', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#fb923c" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Stacked: sure tax + projected half tax */}
          <Area type="monotone" dataKey="taxSure" stackId="tax" fill="#fb923c" fillOpacity={0.7} stroke="#ea580c" name="Est. Tax (Sure)" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="taxHalf" stackId="tax" fill="#fed7aa" fillOpacity={0.5} stroke="#fed7aa" strokeDasharray="6 3" name="Est. Tax (Projected)" dot={false} />
          )}
          {/* Paid area overlaid (not stacked) — fills the tax-loan-covered region */}
          <Area type="monotone" dataKey="taxPaid" fill="#fca5a5" fillOpacity={0.45} stroke="#ef4444" strokeWidth={2} dot={false} name="Tax Paid" connectNulls />
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'est. tax (sure)', value: fmt$(sel.taxSure) },
            ...(sel.taxHalf ? [{ label: 'est. tax (projected)', value: fmt$(sel.taxHalf) }] : []),
            ...(sel.taxPaid ? [{ label: 'tax paid', value: fmt$(sel.taxPaid) }] : []),
          ]}
        />
      )}
    </>
  )
}

function InterestChart({ loans, c, range }: { loans: LoanEntry[]; c: ChartColors; range: DateRange }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
    const interestLoans = loans.filter(l => l.loan_type === 'Interest')

    if (purchaseLoans.length === 0 && interestLoans.length === 0) return []

    // Latest known interest rate (highest loan_year interest loan, fallback to purchase rate)
    const latestInterestLoan = [...interestLoans].sort((a, b) => b.loan_year - a.loan_year)[0]
    const latestRate = latestInterestLoan?.interest_rate
      ?? (purchaseLoans.length ? Math.max(...purchaseLoans.map(l => l.interest_rate)) : 0)

    // Year range
    const allYears = new Set<number>()
    for (const l of loans) {
      allYears.add(l.loan_year)
      allYears.add(new Date(l.due_date + 'T00:00:00').getFullYear())
    }
    if (allYears.size === 0) return []
    const minYear = Math.min(...allYears)
    const maxYear = Math.max(...allYears)

    const yearData: { year: number; guaranteedNew: number; projectedNew: number }[] = []

    for (let year = minYear; year <= maxYear; year++) {
      let guaranteedNew = 0
      let projectedNew = 0

      // Existing Interest loans for this year → guaranteed
      for (const l of interestLoans) {
        if (l.loan_year === year) guaranteedNew += l.amount
      }

      // Projected interest from Purchase loans for years not yet in DB → guaranteed
      for (const p of purchaseLoans) {
        const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
        if (year > p.loan_year && year <= dueYear) {
          const alreadyExists = interestLoans.some(
            l => l.grant_year === p.grant_year && l.grant_type === p.grant_type && l.loan_year === year
          )
          if (!alreadyExists) guaranteedNew += p.amount * p.interest_rate
        }
      }

      // Projected interest generated by existing Interest loans (second-order, at latest rate)
      if (latestRate > 0) {
        for (const il of interestLoans) {
          const parentPurchase = purchaseLoans.find(
            p => p.grant_year === il.grant_year && p.grant_type === il.grant_type
          )
          const dueYear = parentPurchase
            ? new Date(parentPurchase.due_date + 'T00:00:00').getFullYear()
            : new Date(il.due_date + 'T00:00:00').getFullYear()
          if (year > il.loan_year && year <= dueYear) {
            projectedNew += il.amount * latestRate
          }
        }

        // Projected interest from future (not-yet-in-DB) interest loans (at latest rate)
        for (const p of purchaseLoans) {
          const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
          for (let intYear = p.loan_year + 1; intYear < year && intYear <= dueYear; intYear++) {
            const existsInDB = interestLoans.some(
              l => l.grant_year === p.grant_year && l.grant_type === p.grant_type && l.loan_year === intYear
            )
            if (!existsInDB && year <= dueYear) {
              projectedNew += p.amount * p.interest_rate * latestRate
            }
          }
        }
      }

      yearData.push({ year, guaranteedNew, projectedNew })
    }

    // Cumulative
    let cumGuaranteed = 0
    let cumProjected = 0
    return yearData.map(d => {
      cumGuaranteed += d.guaranteedNew
      cumProjected += d.projectedNew
      return {
        _date: `${d.year}-01-01`,
        _label: String(d.year),
        guaranteed: cumGuaranteed,
        projected: cumProjected > 0 ? cumProjected : null as number | null,
      }
    })
  }, [loans])

  if (data.length === 0) return null

  const displayed = filterByDateRange(data, range, '_date')
  const tIdx = todayIndex(displayed)
  const sel = selected !== null && selected < displayed.length ? displayed[selected] : null
  const hasProjected = displayed.some(d => d.projected !== null && d.projected > 0)

  return (
    <>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span style={{ color: '#fb7185' }}>&#9632;</span> Recorded + Guaranteed{'  '}
        {hasProjected && <><span style={{ color: '#fda4af' }}>&#9632;</span> + Est. interest-on-interest</>}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={displayed} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(displayed.length)} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={displayed[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < displayed.length && (
            <ReferenceLine x={displayed[selected]._label} stroke="#fb7185" strokeWidth={1.5} zIndex={600} />
          )}
          <Area type="monotone" dataKey="guaranteed" stackId="i" fill="#fb7185" fillOpacity={0.7} stroke="#e11d48" name="Guaranteed" dot={false} />
          {hasProjected && (
            <Area type="monotone" dataKey="projected" stackId="i" fill="#fda4af" fillOpacity={0.4} stroke="#fda4af" strokeDasharray="6 3" name="Est. interest-on-interest" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: String(sel._label) },
            { label: 'cumulative interest', value: fmt$(sel.guaranteed + (sel.projected ?? 0)) },
            ...(sel.projected ? [{ label: 'of which est.', value: fmt$(sel.projected) }] : []),
          ]}
        />
      )}
    </>
  )
}

function LoanChart({ loanPaymentByYear, c, range, setRange, maxDate }: {
  loanPaymentByYear: { year: string; payoff_sale: number; cash_in: number }[]
  c: ChartColors
  range: DateRange; setRange: (r: DateRange) => void; maxDate: string
}) {
  if (!loanPaymentByYear || loanPaymentByYear.length === 0) return null
  const displayed = range.mode === 'all' ? loanPaymentByYear
    : loanPaymentByYear.filter(d => {
        const y = d.year + '-01-01'
        return y >= range.start && y <= range.end
      })
  return (
    <ChartBox title="Loan Payments by Due Year" range={range} setRange={setRange} maxDate={maxDate}>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span style={{ color: '#4ade80' }}>&#9632;</span> Payoff sale{'  '}
        <span style={{ color: '#fb923c' }}>&#9632;</span> Cash in
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={displayed}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Bar dataKey="payoff_sale" stackId="a" fill="#4ade80" name="Payoff sale" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cash_in" stackId="a" fill="#fb923c" name="Cash in" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function ChartBox({ title, children, range, setRange, maxDate }: {
  title: string; children: React.ReactNode
  range?: DateRange; setRange?: (r: DateRange) => void; maxDate?: string
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300">{title}</h3>
        {range && setRange && <RangeControls range={range} setRange={setRange} maxDate={maxDate ?? '2099-12-31'} />}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const readOnly = !!viewing

  const fetchDashboard = useCallback(() => vid ? api.getSharedDashboard(vid) : api.getDashboard(), [vid])
  const fetchEvents = useCallback(() => vid ? api.getSharedEvents(vid) : api.getEvents(), [vid])
  const fetchPrices = useCallback(() => vid ? api.getSharedPrices(vid) : api.getPrices(), [vid])
  const fetchLoans = useCallback(() => vid ? api.getSharedLoans(vid) : api.getLoans(), [vid])
  const fetchGrants = useCallback(() => vid ? api.getSharedGrants(vid) : api.getGrants(), [vid])
  const fetchTaxSettings = useCallback(() => vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(), [vid])
  const fetchSales = useCallback(() => vid ? api.getSharedSales(vid) : api.getSales(), [vid])

  const { data: dash, loading: dashLoading, reload: reloadDash } = useApiData<DashboardData>(fetchDashboard)
  const { data: events, reload: reloadEvents } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const { data: grantsData } = useApiData<GrantEntry[]>(fetchGrants)
  const { data: taxSettings, reload: reloadTaxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const { data: sales } = useApiData<SaleEntry[]>(fetchSales)
  const c = useChartColors()
  const [rangeInterest, setRangeInterest] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [rangeLoan, setRangeLoan] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [range, setRange] = useState<DateRange>(() => {
    try {
      const saved = localStorage.getItem('dashboard_range')
      if (saved) return JSON.parse(saved) as DateRange
    } catch {}
    return { mode: 'all', start: '', end: '' }
  })
  const [cardDate, setCardDate] = useState<string>(() => {
    return localStorage.getItem('dashboard_cardDate') ?? TODAY
  })
  const [exitBreakdownOpen, setExitBreakdownOpen] = useState(false)
  const [openBreakdowns, setOpenBreakdowns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('dashboard_openBreakdowns')
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch {}
    const initial = new Set<string>()
    if (localStorage.getItem('dashboard_holdingsOpen') === 'true') initial.add('grants')
    if (localStorage.getItem('dashboard_loansOpen') === 'true') initial.add('activeLoans')
    return initial
  })
  const toggleBreakdown = useCallback((key: string) => {
    setOpenBreakdowns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])
  useEffect(() => {
    localStorage.setItem('dashboard_openBreakdowns', JSON.stringify([...openBreakdowns]))
  }, [openBreakdowns])

  // Load an exit preview for the current cardDate (only meaningful for today or later).
  const showExitPreview = cardDate >= TODAY
  const [exitPreview, setExitPreview] = useState<ExitPreview | null | 'loading'>(null)

  useEffect(() => {
    if (!showExitPreview) {
      setExitPreview(null)
      return
    }
    setExitPreview('loading')
    const timer = setTimeout(() => {
      api.previewExit(cardDate)
        .then(result => setExitPreview(result))
        .catch(() => setExitPreview(null))
    }, 200)
    return () => clearTimeout(timer)
  }, [cardDate, showExitPreview])

  // Investment interest deduction preview
  const [pendingDeduction, setPendingDeduction] = useState<boolean | null>(null)
  const [deductionPreview, setDeductionPreview] = useState<DeductionPreview | null | 'loading'>(null)
  const [savingDeduction, setSavingDeduction] = useState(false)

  // Reset pending when saved setting reloads
  useEffect(() => { setPendingDeduction(null) }, [taxSettings])

  const savedDeduction = taxSettings?.deduct_investment_interest ?? false
  const pendingDeductionChanged = pendingDeduction !== null && pendingDeduction !== savedDeduction

  // When toggling on for the first time (no existing exclusions), tell the
  // preview to auto-exclude past years so the number matches what Apply will do.
  const shouldExcludePast = pendingDeduction === true && !savedDeduction && !taxSettings?.deduction_excluded_years?.length

  useEffect(() => {
    if (!pendingDeductionChanged || pendingDeduction === null) {
      setDeductionPreview(null)
      return
    }
    setDeductionPreview('loading')
    const timer = setTimeout(() => {
      api.previewDeduction(pendingDeduction, shouldExcludePast)
        .then(result => setDeductionPreview(result))
        .catch(() => setDeductionPreview(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [pendingDeductionChanged, pendingDeduction, shouldExcludePast])

  async function applyDeduction(enabled: boolean) {
    setSavingDeduction(true)
    try {
      const update: Partial<TaxSettings> = { deduct_investment_interest: enabled }
      // When first enabling and no year customization exists yet,
      // auto-exclude past years (you can't retroactively itemize)
      if (enabled && taxSettings && !taxSettings.deduction_excluded_years?.length) {
        const thisYear = new Date().getFullYear()
        const pastYears = (taxSettings.taxable_years ?? []).filter(y => y < thisYear)
        if (pastYears.length > 0) {
          update.deduction_excluded_years = pastYears
        }
      }
      await api.updateTaxSettings(update)
      reloadDash()
      reloadEvents()
      reloadTaxSettings()
    } finally {
      setSavingDeduction(false)
    }
  }

  useEffect(() => {
    localStorage.setItem('dashboard_range', JSON.stringify(range))
  }, [range])

  useEffect(() => {
    localStorage.setItem('dashboard_cardDate', cardDate)
  }, [cardDate])

  // Only show projected/dashed styling when a future price actually differs from the current price
  const hasFuturePrices = useMemo(() => {
    if (!prices) return false
    const futurePrices = prices.filter(p => p.effective_date > TODAY)
    if (!futurePrices.length) return false
    const pastPrices = prices.filter(p => p.effective_date <= TODAY)
    const currentPrice = pastPrices.length ? pastPrices[pastPrices.length - 1].price : 0
    return futurePrices.some(p => Math.abs(p.price - currentPrice) > 0.005)
  }, [prices])

  // Last event/price date for default end in range picker
  const maxDate = useMemo(() => {
    let last = TODAY
    if (events?.length) last = events[events.length - 1].date > last ? events[events.length - 1].date : last
    if (prices?.length) {
      const lp = prices[prices.length - 1].effective_date
      if (lp > last) last = lp
    }
    return last
  }, [events, prices])

  // Date of the last real (non-projected) event
  const lastRealEventDate = useMemo(() => {
    if (!events?.length) return TODAY
    return events[events.length - 1].date
  }, [events])

  // Card values computed from local data as of cardDate
  const cardValues = useMemo(() => {
    if (!events || !loans) return null

    const effectiveDate = cardDate

    // Last event at or before effectiveDate
    let lastEvent: TimelineEvent | null = null
    for (const e of events) {
      if (e.date <= effectiveDate) lastEvent = e
      else break
    }
    // Next event after cardDate
    let nextEvent: { date: string; event_type: string } | null = null
    for (const e of events) {
      if (e.date > cardDate) { nextEvent = { date: e.date, event_type: e.event_type }; break }
    }

    const incomeRate = taxSettings
      ? taxSettings.federal_income_rate + taxSettings.state_income_rate
      : 0
    const taxPaid =
      loans.filter(l => l.loan_type === 'Tax' && l.loan_year <= parseInt(effectiveDate.slice(0, 4), 10))
        .reduce((sum, l) => sum + l.amount, 0)
      + events.filter(e => e.event_type === 'Sale' && e.date <= effectiveDate)
          .reduce((sum, e) => sum + (e.estimated_tax ?? 0), 0)
      + events
          .filter(e =>
            e.income > 0 &&
            e.date <= effectiveDate &&
            ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')
          )
          .reduce((sum, e) => sum + e.income * incomeRate, 0)

    // Outstanding loan principal just before (or at) the liq date, ignoring the virtual liq sale
    const outstandingPrincipal = (() => {
      const refDate = effectiveDate
      const refYear = parseInt(refDate.slice(0, 4), 10)
      const settledIds = new Set(
        (sales ?? []).filter(s => s.loan_id !== null && s.date <= refDate).map(s => s.loan_id)
      )
      const refinancedIds = new Set(loans.map(l => l.refinances_loan_id).filter((id): id is number => id !== null))
      const earlyPaidByLoan = new Map<number, number>()
      events.filter(e => e.event_type === 'Early Loan Payment' && e.date <= refDate && e.loan_id != null)
        .forEach(e => { earlyPaidByLoan.set(e.loan_id!, (earlyPaidByLoan.get(e.loan_id!) ?? 0) + (e.amount ?? 0)) })
      return loans
        .filter(l => l.loan_year <= refYear && !settledIds.has(l.id) && !refinancedIds.has(l.id))
        .reduce((sum, l) => sum + Math.max(0, l.amount - (earlyPaidByLoan.get(l.id) ?? 0)), 0)
    })()

    // Map sale_id -> estimated_tax from timeline events so we can subtract it below
    const saleTaxBySaleId = new Map<number, number>()
    for (const e of events) {
      if (e.event_type === 'Sale' && e.sale_id != null && e.estimated_tax != null) {
        saleTaxBySaleId.set(e.sale_id, e.estimated_tax)
      }
    }

    // Build loan amount map for payoff sale deductions
    const loanAmountById = new Map<number, number>()
    for (const l of loans) loanAmountById.set(l.id, l.amount)
    const earlyPaidByLoan = new Map<number, number>()
    for (const e of events) {
      if (e.event_type === 'Early Loan Payment' && e.loan_id != null && e.date <= effectiveDate) {
        earlyPaidByLoan.set(e.loan_id, (earlyPaidByLoan.get(e.loan_id) ?? 0) + (e.amount ?? 0))
      }
    }
    const cashReceived = sales
      ? sales.filter(s => s.date <= effectiveDate)
          .reduce((sum, s) => {
            const proceeds = s.shares * s.price_per_share
            const tax = saleTaxBySaleId.get(s.id) ?? 0
            const loanCovered = s.loan_id != null
              ? Math.max(0, (loanAmountById.get(s.loan_id) ?? 0) - (earlyPaidByLoan.get(s.loan_id) ?? 0))
              : 0
            return sum + proceeds - loanCovered - tax
          }, 0)
      : 0

    const adjCumCg = lastEvent?.cum_cap_gains ?? 0
    const stcgRate = taxSettings
      ? taxSettings.federal_st_cg_rate + taxSettings.niit_rate + taxSettings.state_st_cg_rate
      : 0
    const ltcgRate = taxSettings
      ? taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate
      : 0
    let interestDeductionTotal = 0
    let taxSavings = 0
    for (const e of events) {
      if (e.date > effectiveDate) break
      interestDeductionTotal += e.interest_deduction_applied ?? 0
      taxSavings += (e.interest_deduction_on_stcg ?? 0) * stcgRate
        + (e.interest_deduction_on_ltcg ?? 0) * ltcgRate
    }
    return {
      current_price: lastEvent?.share_price ?? 0,
      total_shares: lastEvent?.cum_shares ?? 0,
      total_income: lastEvent?.cum_income ?? 0,
      total_cap_gains: adjCumCg,
      total_interest: (() => {
        const effYear = parseInt(effectiveDate.slice(0, 4), 10)
        const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
        const interestLoans = loans.filter(l => l.loan_type === 'Interest')
        let total = interestLoans
          .filter(l => l.loan_year <= effYear)
          .reduce((sum, l) => sum + l.amount, 0)
        for (const p of purchaseLoans) {
          const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
          const relatedInterestLoans = interestLoans.filter(
            l => l.grant_year === p.grant_year && l.grant_type === p.grant_type
          )
          for (let yr = p.loan_year + 1; yr <= Math.min(effYear, dueYear); yr++) {
            const exists = relatedInterestLoans.some(l => l.loan_year === yr)
            if (!exists) {
              total += p.amount * p.interest_rate
              // Also project interest accruing on outstanding interest loans for this year
              for (const il of relatedInterestLoans) {
                if (il.loan_year < yr) total += il.amount * il.interest_rate
              }
            }
          }
        }
        return total
      })(),
      total_loan_principal: outstandingPrincipal,
      total_tax_paid: taxPaid - taxSavings,
      cash_received: cashReceived,
      interest_deduction_total: interestDeductionTotal,
      tax_savings_from_deduction: taxSavings,
      next_event: nextEvent,
      price_is_estimate: (() => {
        if (!prices) return false
        let isEst = false
        for (const p of prices) {
          if (p.effective_date <= effectiveDate) isEst = !!p.is_estimate
          else break
        }
        return isEst
      })(),
    }
  }, [events, loans, sales, taxSettings, dash, cardDate, prices])

  // Per-grant holdings breakdown as of cardDate
  const grantHoldings = useMemo(() => {
    if (!grantsData || !events || !loans) return null

    const effectiveDate = cardDate
    const effYear = parseInt(effectiveDate.slice(0, 4), 10)

    // Current share price as of effectiveDate
    let currentPrice = 0
    for (const e of events) {
      if (e.date <= effectiveDate) currentPrice = e.share_price
      else break
    }

    const incomeRate = taxSettings
      ? taxSettings.federal_income_rate + taxSettings.state_income_rate
      : 0

    // Build settled/refinanced loan sets (mirrors outstandingPrincipal logic)
    const settledIds = new Set(
      (sales ?? []).filter(s => s.loan_id !== null && s.date <= effectiveDate).map(s => s.loan_id)
    )
    const refinancedIds = new Set(
      loans.map(l => l.refinances_loan_id).filter((id): id is number => id !== null)
    )
    const earlyPaidByLoan = new Map<number, number>()
    events.filter(e => e.event_type === 'Early Loan Payment' && e.date <= effectiveDate && e.loan_id != null)
      .forEach(e => earlyPaidByLoan.set(e.loan_id!, (earlyPaidByLoan.get(e.loan_id!) ?? 0) + (e.amount ?? 0)))

    return grantsData.map(g => {
      // Vested shares from schedule
      let vested = 0
      if (g.periods > 0) {
        const vs = new Date(g.vest_start + 'T00:00:00')
        const base = Math.floor(g.shares / g.periods)
        const rem = g.shares % g.periods
        for (let p = 0; p < g.periods; p++) {
          const vd = new Date(vs)
          vd.setFullYear(vd.getFullYear() + p)
          if (vd.toISOString().slice(0, 10) <= effectiveDate) {
            vested += base + (p < rem ? 1 : 0)
          }
        }
      }
      const unvested = g.shares - vested

      // Outstanding loans for this grant
      const grantLoans = loans.filter(l =>
        l.grant_year === g.year && l.grant_type === g.type &&
        l.loan_year <= effYear &&
        !settledIds.has(l.id) && !refinancedIds.has(l.id)
      )
      const totalLoan = grantLoans.reduce(
        (sum, l) => sum + Math.max(0, l.amount - (earlyPaidByLoan.get(l.id) ?? 0)), 0
      )

      // Taxes: tax loans + income tax from vesting
      const taxLoanTotal = loans.filter(l =>
        l.loan_type === 'Tax' && l.grant_year === g.year && l.grant_type === g.type &&
        l.loan_year <= effYear
      ).reduce((sum, l) => sum + l.amount, 0)

      const vestingIncomeTax = events
        .filter(e =>
          e.grant_year === g.year && e.grant_type === g.type &&
          e.income > 0 && e.date <= effectiveDate &&
          ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')
        )
        .reduce((sum, e) => sum + e.income * incomeRate, 0)

      const vestedValue = vested * currentPrice
      const unvestedValue = unvested * g.price
      return {
        year: g.year,
        type: g.type,
        exerciseDate: g.exercise_date,
        costBasis: g.price,
        vestedShares: vested,
        unvestedShares: unvested,
        vestedValue,
        unvestedValue,
        totalValue: vestedValue + unvestedValue,
        totalTax: taxLoanTotal + vestingIncomeTax,
        totalLoan,
      }
    })
  }, [grantsData, events, loans, sales, taxSettings, cardDate])

  // Active (non-settled, non-refinanced) loans as of cardDate
  const activeLoans = useMemo(() => {
    if (!loans || !events) return null

    const effectiveDate = cardDate
    const effYear = parseInt(effectiveDate.slice(0, 4), 10)

    const settledIds = new Set(
      (sales ?? []).filter(s => s.loan_id !== null && s.date <= effectiveDate).map(s => s.loan_id)
    )
    const refinancedIds = new Set(
      loans.map(l => l.refinances_loan_id).filter((id): id is number => id !== null)
    )
    const earlyPaidByLoan = new Map<number, number>()
    events.filter(e => e.event_type === 'Early Loan Payment' && e.date <= effectiveDate && e.loan_id != null)
      .forEach(e => earlyPaidByLoan.set(e.loan_id!, (earlyPaidByLoan.get(e.loan_id!) ?? 0) + (e.amount ?? 0)))

    return loans
      .filter(l =>
        l.loan_year <= effYear &&
        !settledIds.has(l.id) &&
        !refinancedIds.has(l.id)
      )
      .map(l => ({
        id: l.id,
        grantYear: l.grant_year,
        grantType: l.grant_type,
        loanType: l.loan_type,
        loanYear: l.loan_year,
        dueDate: l.due_date,
        balance: Math.max(0, l.amount - (earlyPaidByLoan.get(l.id) ?? 0)),
        interestRate: l.interest_rate,
      }))
      .filter(l => l.balance > 0)
  }, [loans, events, sales, cardDate])

  // Breakdown data (Cash/Income/Cap Gains/Interest/Tax) computed as of cardDate.
  const breakdowns = useMemo(() => {
    if (!events || !loans) return null
    const effectiveDate = cardDate
    const effYear = parseInt(effectiveDate.slice(0, 4), 10)

    // --- Cash Received: per-sale contribution ---
    const saleTaxBySaleId = new Map<number, number>()
    for (const e of events) {
      if (e.event_type === 'Sale' && e.sale_id != null && e.estimated_tax != null) {
        saleTaxBySaleId.set(e.sale_id, e.estimated_tax)
      }
    }
    const loanAmountById = new Map<number, number>()
    for (const l of loans) loanAmountById.set(l.id, l.amount)
    const earlyPaidByLoan = new Map<number, number>()
    for (const e of events) {
      if (e.event_type === 'Early Loan Payment' && e.loan_id != null && e.date <= effectiveDate) {
        earlyPaidByLoan.set(e.loan_id, (earlyPaidByLoan.get(e.loan_id) ?? 0) + (e.amount ?? 0))
      }
    }
    const loanById = new Map<number, LoanEntry>()
    for (const l of loans) loanById.set(l.id, l)
    const cashSales = (sales ?? [])
      .filter(s => s.date <= effectiveDate)
      .map(s => {
        const proceeds = s.shares * s.price_per_share
        const tax = saleTaxBySaleId.get(s.id) ?? 0
        const loanPayoff = s.loan_id != null
          ? Math.max(0, (loanAmountById.get(s.loan_id) ?? 0) - (earlyPaidByLoan.get(s.loan_id) ?? 0))
          : 0
        const loan = s.loan_id != null ? loanById.get(s.loan_id) : null
        return {
          id: s.id,
          date: s.date,
          shares: s.shares,
          price: s.price_per_share,
          proceeds,
          tax,
          loanPayoff,
          loanLabel: loan ? `${loan.grant_year} ${loan.grant_type} ${loan.loan_type}` : null,
          net: proceeds - tax - loanPayoff,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
    const cashTotals = cashSales.reduce(
      (acc, s) => ({
        proceeds: acc.proceeds + s.proceeds,
        tax: acc.tax + s.tax,
        loanPayoff: acc.loanPayoff + s.loanPayoff,
        net: acc.net + s.net,
      }),
      { proceeds: 0, tax: 0, loanPayoff: 0, net: 0 },
    )

    // --- Total Income: vesting events grouped by grant ---
    type IncomeGroup = { key: string; year: number; type: string; income: number; events: number }
    const incomeByGrant = new Map<string, IncomeGroup>()
    let incomeTotal = 0
    for (const e of events) {
      if (e.date > effectiveDate) break
      if (e.income > 0 && ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')) {
        const key = `${e.grant_year}|${e.grant_type}`
        const grp = incomeByGrant.get(key) ?? {
          key,
          year: e.grant_year ?? 0,
          type: e.grant_type ?? '',
          income: 0,
          events: 0,
        }
        grp.income += e.income
        grp.events += 1
        incomeByGrant.set(key, grp)
        incomeTotal += e.income
      }
    }
    const incomeGroups = [...incomeByGrant.values()].sort(
      (a, b) => a.year - b.year || a.type.localeCompare(b.type),
    )

    // --- Total Cap Gains: split vesting (RSU cost-basis delta) vs price appreciation ---
    type CgGroup = { key: string; year: number; type: string; amount: number }
    const vestingCgByGrant = new Map<string, CgGroup>()
    let vestingCgTotal = 0
    let priceCgTotal = 0
    for (const e of events) {
      if (e.date > effectiveDate) break
      if (e.vesting_cap_gains && e.vesting_cap_gains !== 0) {
        const key = `${e.grant_year}|${e.grant_type}`
        const grp = vestingCgByGrant.get(key) ?? {
          key,
          year: e.grant_year ?? 0,
          type: e.grant_type ?? '',
          amount: 0,
        }
        grp.amount += e.vesting_cap_gains
        vestingCgByGrant.set(key, grp)
        vestingCgTotal += e.vesting_cap_gains
      }
      if (e.price_cap_gains) priceCgTotal += e.price_cap_gains
    }
    const vestingCgGroups = [...vestingCgByGrant.values()].sort(
      (a, b) => a.year - b.year || a.type.localeCompare(b.type),
    )

    // --- Total Interest: per-loan accrual ---
    type InterestRow = { id: number; label: string; amount: number; note?: string }
    const interestRows: InterestRow[] = []
    let interestTotal = 0
    const interestLoans = loans.filter(l => l.loan_type === 'Interest')
    const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
    // Interest loans booked on or before effYear: they ARE the accrued interest.
    for (const l of interestLoans) {
      if (l.loan_year > effYear) continue
      interestRows.push({
        id: l.id,
        label: `${l.grant_year} ${l.grant_type} interest booked ${l.loan_year}`,
        amount: l.amount,
      })
      interestTotal += l.amount
    }
    // Purchase loans accrue interest each year after loan_year up to min(effYear, dueYear)
    // in years where no explicit Interest loan replaces it.
    for (const p of purchaseLoans) {
      const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
      const related = interestLoans.filter(
        l => l.grant_year === p.grant_year && l.grant_type === p.grant_type,
      )
      let accrued = 0
      let years = 0
      for (let yr = p.loan_year + 1; yr <= Math.min(effYear, dueYear); yr++) {
        const exists = related.some(l => l.loan_year === yr)
        if (!exists) {
          accrued += p.amount * p.interest_rate
          // Interest-on-interest for already-booked Interest loans this year
          for (const il of related) {
            if (il.loan_year < yr) accrued += il.amount * il.interest_rate
          }
          years += 1
        }
      }
      if (accrued > 0) {
        interestRows.push({
          id: p.id,
          label: `${p.grant_year} ${p.grant_type} estimated`,
          amount: accrued,
          note: `${(p.interest_rate * 100).toFixed(2)}% × ${years} yr`,
        })
        interestTotal += accrued
      }
    }
    interestRows.sort((a, b) => a.label.localeCompare(b.label))

    // --- Tax Paid: income tax + CG tax + deduction savings ---
    const incomeRate = taxSettings
      ? taxSettings.federal_income_rate + taxSettings.state_income_rate
      : 0
    const taxLoansSum = loans
      .filter(l => l.loan_type === 'Tax' && l.loan_year <= effYear)
      .reduce((sum, l) => sum + l.amount, 0)
    const vestingIncomeTax = events
      .filter(e =>
        e.income > 0 &&
        e.date <= effectiveDate &&
        ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant'),
      )
      .reduce((sum, e) => sum + e.income * incomeRate, 0)
    const cgTaxFromSales = events
      .filter(e => e.event_type === 'Sale' && e.date <= effectiveDate)
      .reduce((sum, e) => sum + (e.estimated_tax ?? 0), 0)
    const stcgRate = taxSettings
      ? taxSettings.federal_st_cg_rate + taxSettings.niit_rate + taxSettings.state_st_cg_rate
      : 0
    const ltcgRate = taxSettings
      ? taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate
      : 0
    let deductionSavings = 0
    for (const e of events) {
      if (e.date > effectiveDate) break
      deductionSavings += (e.interest_deduction_on_stcg ?? 0) * stcgRate
        + (e.interest_deduction_on_ltcg ?? 0) * ltcgRate
    }

    return {
      cash: { sales: cashSales, totals: cashTotals },
      income: { groups: incomeGroups, total: incomeTotal },
      capGains: {
        vestingGroups: vestingCgGroups,
        vestingTotal: vestingCgTotal,
        priceTotal: priceCgTotal,
        total: vestingCgTotal + priceCgTotal,
      },
      interest: { rows: interestRows, total: interestTotal },
      tax: {
        taxLoans: taxLoansSum,
        vestingIncomeTax,
        cgTaxFromSales,
        deductionSavings,
        total: taxLoansSum + vestingIncomeTax + cgTaxFromSales - deductionSavings,
      },
    }
  }, [events, loans, sales, taxSettings, cardDate])

  const [downloading, setDownloading] = useState(false)
  async function downloadReport() {
    setDownloading(true)
    try {
      const exportUrl = vid
        ? `/api/sharing/view/${vid}/export/excel`
        : `/api/export/holdings-report?as_of=${encodeURIComponent(cardDate)}`
      const resp = await fetch(exportUrl, { credentials: 'include' })
      if (!resp.ok) throw new Error(`Export failed (${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Holdings_Report_${cardDate}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
    setDownloading(false)
  }

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-stone-600">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  const isEmpty = !events || events.length === 0

  if (isEmpty && !readOnly) {
    return <ImportWizard onComplete={reloadEvents} />
  }

  if (isEmpty && readOnly) {
    return <p className="py-12 text-center text-sm text-stone-500 dark:text-slate-400">This user has no data yet.</p>
  }

  const cv = cardValues ?? {
    current_price: dash.current_price,
    total_shares: dash.total_shares,
    total_income: dash.total_income,
    total_cap_gains: dash.total_cap_gains,
    total_loan_principal: dash.total_loan_principal,
    total_tax_paid: dash.total_tax_paid ?? 0,
    cash_received: dash.cash_received ?? 0,
    interest_deduction_total: dash.interest_deduction_total ?? 0,
    tax_savings_from_deduction: dash.tax_savings_from_deduction ?? 0,
    next_event: dash.next_event,
    total_interest: 0,
    price_is_estimate: false,
  }
  const hasInterestDeduction = (cv.interest_deduction_total ?? 0) > 0
  const hasInterestLoans = loans?.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') ?? false
  const showDeductionCard = hasInterestDeduction || hasInterestLoans

  return (
    <div className="space-y-6">
      {/* Date selector for card values */}
      <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-slate-400">As of</span>
          <input
            type="date"
            value={cardDate}
            max={maxDate}
            onChange={e => setCardDate(e.target.value)}
            className="h-7 flex-1 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="shrink-0 text-xs text-gray-400 dark:text-slate-500">Jump to:</span>
          {([
            { label: 'Today', date: TODAY },
            { label: 'Last event', date: lastRealEventDate, title: 'Jump to your last scheduled event' },
          ] as { label: string; date: string; title?: string }[]).map(({ label, date, title }) => (
            <button
              key={label}
              onClick={() => setCardDate(date)}
              title={title}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                cardDate === date
                  ? 'bg-rose-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={downloadReport}
            disabled={downloading}
            title="Download holdings report as Excel"
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300"
          >
            {downloading ? '…' : 'Export'}
          </button>
        </div>
      </div>

      {!readOnly && <TipCarousel onApply={() => { reloadDash(); reloadEvents(); reloadTaxSettings() }} />}

      {/* (F) aria-live so screen readers announce summary updates when cardDate changes */}
      <div aria-live="polite" aria-atomic="true" className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Up to this date</p>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Your Shares</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card label={cv.price_is_estimate ? 'Share Price (est.)' : 'Share Price'} value={fmtPrice(cv.current_price)} variant="price" subtitle="Price per share on this date" />
            <Card
              label="Vested Shares"
              value={fmtNum(cv.total_shares)}
              subvalue={grantHoldings ? fmt$(grantHoldings.reduce((s, h) => s + h.vestedValue, 0)) + (cv.price_is_estimate ? ' (est.)' : '') : undefined}
              variant="shares"
              subtitle={`Value at ${fmtPrice(cv.current_price)}/share`}
              onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
              expanded={openBreakdowns.has('grants')}
            />
            <Card
              label="Unvested Shares"
              value={fmtNum(grantHoldings?.reduce((s, h) => s + h.unvestedShares, 0) ?? 0)}
              subvalue={grantHoldings ? fmt$(grantHoldings.reduce((s, h) => s + h.unvestedShares * h.costBasis, 0)) : undefined}
              variant="unvested"
              subtitle="Value at purchase price"
              onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
              expanded={openBreakdowns.has('grants')}
            />
            <Card
              label="Next Event"
              value={cv.next_event ? `${cv.next_event.date} — ${cv.next_event.event_type}` : 'None'}
              variant="event"
              subtitle="Your next vesting or price date"
            />
          </div>
          {openBreakdowns.has('grants') && grantHoldings && grantHoldings.length > 0 && (
            <BreakdownShell title="Grants">
              {grantHoldings.map(h => (
                <div key={`${h.year}-${h.type}`} className="rounded border border-stone-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">{h.year} {h.type}</p>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-3">
                    <span className="text-gray-500 dark:text-slate-400">Purchased <span className="font-medium text-gray-800 dark:text-slate-200">{fmtFullDate(h.exerciseDate)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Cost basis <span className="font-medium text-gray-800 dark:text-slate-200">{fmtPrice(h.costBasis)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Vested <span className="font-medium text-gray-800 dark:text-slate-200">{fmtNum(h.vestedShares)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Vested value <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.vestedValue)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Unvested <span className="font-medium text-gray-800 dark:text-slate-200">{fmtNum(h.unvestedShares)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Unvested value <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.unvestedValue)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Total value <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.totalValue)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Taxes <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.totalTax)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Loans <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.totalLoan)}</span></span>
                  </div>
                </div>
              ))}
            </BreakdownShell>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Earnings</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card
              label="Total Income"
              value={fmt$(cv.total_income)}
              variant="income"
              subtitle="Taxed as ordinary income at vest"
              onClick={breakdowns && breakdowns.income.groups.length > 0 ? () => toggleBreakdown('income') : undefined}
              expanded={openBreakdowns.has('income')}
            />
            <Card
              label="Total capital gains"
              value={fmt$(cv.total_cap_gains)}
              variant="gains"
              subtitle="Growth since your grants"
              onClick={breakdowns && (breakdowns.capGains.vestingGroups.length > 0 || breakdowns.capGains.priceTotal !== 0) ? () => toggleBreakdown('capGains') : undefined}
              expanded={openBreakdowns.has('capGains')}
            />
            <Card
              label="Cash Received"
              value={fmt$(cv.cash_received)}
              variant="cash"
              subtitle="Net proceeds from sales through this date"
              onClick={breakdowns && breakdowns.cash.sales.length > 0 ? () => toggleBreakdown('cash') : undefined}
              expanded={openBreakdowns.has('cash')}
            />
          </div>
          {openBreakdowns.has('income') && breakdowns && breakdowns.income.groups.length > 0 && (
            <BreakdownShell title="Total Income breakdown">
              {breakdowns.income.groups.map(g => (
                <BreakdownRow
                  key={g.key}
                  label={`${g.year} ${g.type}`}
                  value={fmt$(g.income)}
                  sub={`${g.events} vesting event${g.events === 1 ? '' : 's'}`}
                />
              ))}
              <div className="my-1 border-t border-stone-200 dark:border-slate-600" />
              <BreakdownRow label="Total" value={fmt$(breakdowns.income.total)} bold />
              <p className="mt-2 text-[10px] text-stone-400 dark:text-slate-500">
                Ordinary income recognized at each vest (grant-price × shares for RSUs, share-price × shares for bonus/free grants without 83(b)).
              </p>
            </BreakdownShell>
          )}
          {openBreakdowns.has('capGains') && breakdowns && (breakdowns.capGains.vestingGroups.length > 0 || breakdowns.capGains.priceTotal !== 0) && (
            <BreakdownShell title="Total capital gains breakdown">
              {breakdowns.capGains.vestingGroups.length > 0 && (
                <>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Gains at vest (share price − what you paid)</p>
                  {breakdowns.capGains.vestingGroups.map(g => (
                    <BreakdownRow key={g.key} label={`${g.year} ${g.type}`} value={fmt$(g.amount)} />
                  ))}
                  <BreakdownRow label="Vesting gains subtotal" value={fmt$(breakdowns.capGains.vestingTotal)} bold />
                </>
              )}
              {breakdowns.capGains.priceTotal !== 0 && (
                <>
                  {breakdowns.capGains.vestingGroups.length > 0 && <div className="my-1 border-t border-stone-200 dark:border-slate-600" />}
                  <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Price appreciation on holdings</p>
                  <BreakdownRow
                    label="Share-price changes × shares held"
                    value={fmt$(breakdowns.capGains.priceTotal)}
                    sub="Unrealized gain from share-price increases on shares you already held"
                  />
                </>
              )}
              <div className="my-1 border-t border-stone-200 dark:border-slate-600" />
              <BreakdownRow label="Total" value={fmt$(breakdowns.capGains.total)} bold />
            </BreakdownShell>
          )}
          {openBreakdowns.has('cash') && breakdowns && breakdowns.cash.sales.length > 0 && (
            <BreakdownShell title="Cash Received breakdown">
              {breakdowns.cash.sales.map(s => (
                <BreakdownRow
                  key={s.id}
                  label={`${s.date}  ${fmtNum(s.shares)} sh × ${fmtPrice(s.price)}`}
                  value={fmt$(s.net)}
                  sub={[
                    `${fmt$(s.proceeds)} proceeds`,
                    s.tax > 0 ? `− ${fmt$(s.tax)} est. CG tax` : null,
                    s.loanPayoff > 0 ? `− ${fmt$(s.loanPayoff)} loan payoff${s.loanLabel ? ` (${s.loanLabel})` : ''}` : null,
                  ].filter(Boolean).join(' ')}
                  tone={s.net < 0 ? 'negative' : undefined}
                />
              ))}
              <div className="my-1 border-t border-stone-200 dark:border-slate-600" />
              <BreakdownRow label="Gross proceeds" value={fmt$(breakdowns.cash.totals.proceeds)} />
              {breakdowns.cash.totals.tax > 0 && (
                <BreakdownRow label="Est. CG tax on sales" value={`−${fmt$(breakdowns.cash.totals.tax)}`} />
              )}
              {breakdowns.cash.totals.loanPayoff > 0 && (
                <BreakdownRow label="Loan principal paid off from sales" value={`−${fmt$(breakdowns.cash.totals.loanPayoff)}`} />
              )}
              <BreakdownRow label="Cash received" value={fmt$(breakdowns.cash.totals.net)} bold tone={breakdowns.cash.totals.net < 0 ? 'negative' : undefined} />
              {breakdowns.cash.totals.net < 0 && (
                <p className="mt-2 text-[10px] text-stone-400 dark:text-slate-500">
                  Negative means payoff sales didn't cover their loan plus estimated CG tax — usually because tax rates or lot methods changed after the sale was sized.
                </p>
              )}
            </BreakdownShell>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Costs</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card
              label="Loan Principal"
              value={fmt$(cv.total_loan_principal)}
              variant="loans"
              subtitle="Total amount borrowed"
              onClick={activeLoans && activeLoans.length > 0 ? () => toggleBreakdown('activeLoans') : undefined}
              expanded={openBreakdowns.has('activeLoans')}
            />
            <Card
              label="Total Interest"
              value={fmt$(cv.total_interest)}
              variant="interest"
              subtitle="Interest accrued on loans"
              onClick={breakdowns && breakdowns.interest.rows.length > 0 ? () => toggleBreakdown('interest') : undefined}
              expanded={openBreakdowns.has('interest')}
            />
            <Card
              label={hasInterestDeduction ? 'Tax Paid (after int. ded.)' : 'Tax Paid'}
              value={fmt$(cv.total_tax_paid)}
              variant="tax"
              subtitle="Taxes withheld through this date"
              onClick={breakdowns && (breakdowns.tax.taxLoans > 0 || breakdowns.tax.vestingIncomeTax > 0 || breakdowns.tax.cgTaxFromSales > 0) ? () => toggleBreakdown('tax') : undefined}
              expanded={openBreakdowns.has('tax')}
            />
          </div>
          {openBreakdowns.has('activeLoans') && activeLoans && activeLoans.length > 0 && (
            <BreakdownShell title={`Active Loans (${activeLoans.length})`}>
              <div className="hidden px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 sm:grid sm:grid-cols-5 sm:gap-x-2 dark:text-slate-500">
                <span>Grant</span><span>Type</span><span>Balance</span><span>Rate</span><span>Due</span>
              </div>
              {activeLoans.map(l => (
                <div key={l.id} className="rounded border border-stone-200 bg-white px-3 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:hidden">
                    <span className="text-gray-500 dark:text-slate-400">{l.grantYear} {l.grantType} <span className="text-gray-400 dark:text-slate-500">· {l.loanType}</span></span>
                    <span className="text-right font-medium text-gray-800 dark:text-slate-200">{fmt$(l.balance)}</span>
                    <span className="text-gray-500 dark:text-slate-400">Rate <span className="font-medium text-gray-800 dark:text-slate-200">{(l.interestRate * 100).toFixed(2)}%</span></span>
                    <span className="text-right text-gray-500 dark:text-slate-400">Due <span className="font-medium text-gray-800 dark:text-slate-200">{fmtFullDate(l.dueDate)}</span></span>
                  </div>
                  <div className="hidden sm:grid sm:grid-cols-5 sm:gap-x-2">
                    <span className="font-medium text-gray-800 dark:text-slate-200">{l.grantYear} {l.grantType}</span>
                    <span className="text-gray-600 dark:text-slate-400">{l.loanType}</span>
                    <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(l.balance)}</span>
                    <span className="text-gray-600 dark:text-slate-400">{(l.interestRate * 100).toFixed(2)}%</span>
                    <span className="text-gray-600 dark:text-slate-400">{fmtFullDate(l.dueDate)}</span>
                  </div>
                </div>
              ))}
            </BreakdownShell>
          )}
          {openBreakdowns.has('interest') && breakdowns && breakdowns.interest.rows.length > 0 && (
            <BreakdownShell title="Total Interest breakdown">
              {breakdowns.interest.rows.map(r => (
                <BreakdownRow key={r.id} label={r.label} value={fmt$(r.amount)} sub={r.note} />
              ))}
              <div className="my-1 border-t border-stone-200 dark:border-slate-600" />
              <BreakdownRow label="Total" value={fmt$(breakdowns.interest.total)} bold />
              <p className="mt-2 text-[10px] text-stone-400 dark:text-slate-500">
                "Booked" rows are Interest-type loans you've already recorded; "estimated" rows project future interest on Purchase loans each year until due.
              </p>
            </BreakdownShell>
          )}
          {openBreakdowns.has('tax') && breakdowns && (breakdowns.tax.taxLoans > 0 || breakdowns.tax.vestingIncomeTax > 0 || breakdowns.tax.cgTaxFromSales > 0) && (
            <BreakdownShell title="Tax Paid breakdown">
              {breakdowns.tax.taxLoans > 0 && (
                <BreakdownRow
                  label="Income tax withheld at vest (Tax loans)"
                  value={fmt$(breakdowns.tax.taxLoans)}
                  sub="Sum of Tax-type loan rows (actual amounts withheld)"
                />
              )}
              {breakdowns.tax.vestingIncomeTax > 0 && (
                <BreakdownRow
                  label="Income tax estimated on vesting"
                  value={fmt$(breakdowns.tax.vestingIncomeTax)}
                  sub="Σ(income × federal+state income rate) across vesting events"
                />
              )}
              {breakdowns.tax.cgTaxFromSales > 0 && (
                <BreakdownRow
                  label="Est. capital gains tax on sales"
                  value={fmt$(breakdowns.tax.cgTaxFromSales)}
                  sub="Sum of estimated_tax across recorded sales"
                />
              )}
              {breakdowns.tax.deductionSavings > 0 && (
                <BreakdownRow
                  label="Interest deduction savings"
                  value={`−${fmt$(breakdowns.tax.deductionSavings)}`}
                  sub="Loan interest subtracted from capital gains before tax (IRS Form 4952)"
                  tone="positive"
                />
              )}
              <div className="my-1 border-t border-stone-200 dark:border-slate-600" />
              <BreakdownRow label="Total" value={fmt$(breakdowns.tax.total)} bold />
            </BreakdownShell>
          )}
        </section>
      </div>

      {showExitPreview && (
        <div aria-live="polite" aria-atomic="true" className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
            If you exited on this date
          </p>
          {exitPreview === 'loading' ? (
            <p className="text-xs text-gray-400 dark:text-slate-500">Calculating…</p>
          ) : exitPreview ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  onClick={() => setExitBreakdownOpen(o => !o)}
                  className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left dark:border-emerald-800 dark:bg-emerald-950/40"
                >
                  <p className="text-xs font-medium uppercase text-emerald-700 dark:text-emerald-300">Net Cash at Exit</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{fmt$(exitPreview.net_cash)}</p>
                  <p className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-slate-400">
                    {exitBreakdownOpen ? '▲ hide breakdown' : '▼ see breakdown'}
                  </p>
                </button>
                <Card label="Gross Proceeds" value={fmt$(exitPreview.gross_vested + exitPreview.unvested_cost_proceeds)} variant="gains" subtitle="Liquidated shares × price" />
                <Card label="Loans Paid Off" value={fmt$(exitPreview.outstanding_principal)} variant="loans" subtitle="From sale proceeds" />
                <Card label="Est. Divest Tax" value={fmt$(exitPreview.liquidation_tax)} variant="tax" subtitle="Capital gains on liquidation" />
              </div>
              {exitBreakdownOpen && <ExitBreakdownCard s={exitPreview} />}
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-slate-500">No price data for this date</p>
          )}
        </div>
      )}

      {showDeductionCard && !readOnly && (() => {
        const displayEnabled = pendingDeduction ?? savedDeduction
        const currentSavings = cardValues?.tax_savings_from_deduction ?? dash.tax_savings_from_deduction ?? 0
        const previewSavings = pendingDeductionChanged
          ? (deductionPreview === 'loading' ? null : deductionPreview?.tax_savings_from_deduction ?? null)
          : null
        const delta = pendingDeductionChanged
          ? (deductionPreview === 'loading' ? '…' : previewSavings !== null
              ? (displayEnabled ? `+${fmt$(previewSavings)}` : `−${fmt$(currentSavings)}`)
              : null)
          : (displayEnabled ? fmt$(currentSavings) : null)
        const excludedYears = new Set(taxSettings?.deduction_excluded_years ?? [])
        const allYears = [...(taxSettings?.taxable_years ?? [])].sort((a, b) => a - b)
        const appliedYears = allYears.filter(y => !excludedYears.has(y))
        const appliedLabel = appliedYears.length === 0
          ? 'No years applied.'
          : appliedYears.length === allYears.length
            ? `Applied to all years (${appliedYears[0]}–${appliedYears[appliedYears.length - 1]}).`
            : appliedYears.length <= 4
              ? `Applied to ${appliedYears.join(', ')}.`
              : `Applied to ${appliedYears[0]}–${appliedYears[appliedYears.length - 1]} (${excludedYears.size} yr${excludedYears.size !== 1 ? 's' : ''} excluded).`
        return (
          <div className="rounded-md bg-stone-100 px-3 py-2 text-xs dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <span className="text-stone-500 dark:text-slate-400">Interest deduction</span>
              <span className={`flex-1 font-semibold tabular-nums ${pendingDeductionChanged ? (displayEnabled ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400') : 'text-stone-700 dark:text-slate-300'}`}>
                {delta ?? '—'}
              </span>
              {pendingDeductionChanged && (
                <>
                  <button
                    onClick={() => applyDeduction(pendingDeduction!)}
                    disabled={savingDeduction || deductionPreview === 'loading'}
                    className="rounded bg-rose-700 px-2.5 py-1 font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                  >
                    {savingDeduction ? '…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => setPendingDeduction(null)}
                    disabled={savingDeduction}
                    className="text-stone-400 hover:text-stone-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300"
                  >
                    ✕
                  </button>
                </>
              )}
              <button
                role="switch"
                aria-checked={displayEnabled}
                onClick={() => setPendingDeduction(!displayEnabled)}
                disabled={savingDeduction}
                className={`relative shrink-0 h-6 w-11 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${displayEnabled ? 'bg-purple-600 dark:bg-purple-500' : 'bg-stone-300 dark:bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${displayEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {savedDeduction && !pendingDeductionChanged && (
              <p className="mt-1 text-[10px] text-stone-400 dark:text-slate-500">
                {appliedLabel}{' '}
                <a href="/settings" className="underline hover:text-stone-600 dark:hover:text-slate-300">
                  Customize years
                </a>
              </p>
            )}
          </div>
        )
      })()}

      <div className="grid gap-4 md:grid-cols-2">
        {events && events.length > 0 && (
          <ChartBox title="Shares Over Time" range={range} setRange={setRange} maxDate={maxDate}>
            <SharesChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
          </ChartBox>
        )}
        {events && events.length > 0 && (
          <ChartBox title="Income vs capital gains" range={range} setRange={setRange} maxDate={maxDate}>
            <IncomeCapGainsChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
          </ChartBox>
        )}
        {prices && prices.length > 0 && (
          <ChartBox title="Share Price History" range={range} setRange={setRange} maxDate={maxDate}>
            <PriceChart prices={prices} c={c} range={range} hasFuturePrices={hasFuturePrices} />
          </ChartBox>
        )}
        {events && events.length > 0 && loans !== undefined && (
          <ChartBox title="Estimated Tax Liability" range={range} setRange={setRange} maxDate={maxDate}>
            <TaxChart
              events={events}
              loans={loans ?? []}
              taxSettings={taxSettings ?? WI_TAX_DEFAULTS}
              c={c}
              range={range}
              hasFuturePrices={hasFuturePrices}
            />
          </ChartBox>
        )}
        {loans && loans.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') && (
          <ChartBox title="Interest Over Time" range={rangeInterest} setRange={setRangeInterest} maxDate={maxDate}>
            <InterestChart loans={loans} c={c} range={rangeInterest} />
          </ChartBox>
        )}
        {dash.loan_payment_by_year && dash.loan_payment_by_year.length > 0 && (
          <LoanChart loanPaymentByYear={dash.loan_payment_by_year} c={c} range={rangeLoan} setRange={setRangeLoan} maxDate={maxDate} />
        )}
      </div>
    </div>
  )
}
