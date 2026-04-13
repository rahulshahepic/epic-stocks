import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { api } from '../../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry, GrantEntry, TaxSettings, SaleEntry, HorizonSettings, ExitPreview, DeductionPreview } from '../../api.ts'
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

/** Find the index of the first data point at or after exitDate. */
function exitIndex(data: { _date: string }[], exitDate: string): number | null {
  for (let i = 0; i < data.length; i++) {
    if (data[i]._date >= exitDate) return i
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

function Card({ label, value, variant }: { label: string; value: string; variant: string }) {
  const s = CARD_STYLES[variant] ?? CARD_STYLES.event
  return (
    <div className={`rounded-lg border p-4 ${s.bg} ${s.border}`}>
      <p className={`text-xs font-medium uppercase ${s.label}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{value}</p>
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

function SharesChart({ events, c, range, hasFuturePrices, exitDate }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean; exitDate: string | null }) {
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
  const eIdx = exitDate ? exitIndex(data, exitDate) : null
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
          {eIdx !== null && <ReferenceLine x={eIdx} stroke="#4ade80" strokeDasharray="4 4" zIndex={600} label={{ value: 'Exit', fontSize: 10, fill: '#4ade80', position: 'top' }} />}
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

function IncomeCapGainsChart({ events, c, range, hasFuturePrices, exitDate }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean; exitDate: string | null }) {
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
  const eIdx = exitDate ? exitIndex(data, exitDate) : null
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
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Cap Gains'}{'  '}
              <tspan fill="#6ee7b7">&#9632;</tspan>/<tspan fill="#c4b5fd">&#9632;</tspan> Projected
            </text>
          )}
          {!hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{'  '}
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Cap Gains'}
            </text>
          )}
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {eIdx !== null && <ReferenceLine x={eIdx} stroke="#4ade80" strokeDasharray="4 4" zIndex={600} label={{ value: 'Exit', fontSize: 10, fill: '#4ade80', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#8b5cf6" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Single stack: income + certain gains + projected extras (price-driven surplus) */}
          <Area type="monotone" dataKey="income" stackId="main" fill="#34d399" fillOpacity={0.7} stroke="#10b981" name="Income" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtraIncome" stackId="main" fill="#6ee7b7" fillOpacity={0.5} stroke="#6ee7b7" strokeDasharray="6 3" name="Proj Income" dot={false} />
          )}
          <Area type="monotone" dataKey="gains" stackId="main" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" name="Cap Gains" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtra" stackId="main" fill="#c4b5fd" fillOpacity={0.5} stroke="#c4b5fd" strokeDasharray="6 3" name="Proj Cap Gains" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'income', value: fmt$(sel._event.cum_income) },
            { label: 'cap gains', value: fmt$(sel._event.cum_cap_gains) },
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

function PriceChart({ prices, c, range, hasFuturePrices, exitDate }: { prices: PriceEntry[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean; exitDate: string | null }) {
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
  const eIdx = exitDate ? exitIndex(data, exitDate) : null
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
          {eIdx !== null && <ReferenceLine x={eIdx} stroke="#4ade80" strokeDasharray="4 4" zIndex={600} label={{ value: 'Exit', fontSize: 10, fill: '#4ade80', position: 'top' }} />}
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
  dp_min_percent: 0.10,
  dp_min_cap: 20000,
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

function TaxChart({ events, loans, taxSettings, c, range, hasFuturePrices, exitDate }: {
  events: TimelineEvent[]
  loans: LoanEntry[]
  taxSettings: TaxSettings
  c: ChartColors
  range: DateRange
  hasFuturePrices: boolean
  exitDate: string | null
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
  const eIdx = exitDate ? exitIndex(data, exitDate) : null
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
          {eIdx !== null && <ReferenceLine x={eIdx} stroke="#4ade80" strokeDasharray="4 4" zIndex={600} label={{ value: 'Exit', fontSize: 10, fill: '#4ade80', position: 'top' }} />}
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

function InterestChart({ loans, c, range, exitDate }: { loans: LoanEntry[]; c: ChartColors; range: DateRange; exitDate: string | null }) {
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
  const eIdx = exitDate ? exitIndex(displayed, exitDate) : null
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
          {eIdx !== null && <ReferenceLine x={displayed[eIdx]._label} stroke="#4ade80" strokeDasharray="4 4" zIndex={600} label={{ value: 'Exit', fontSize: 10, fill: '#4ade80', position: 'top' }} />}
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
  const fetchHorizon = useCallback(() => vid ? api.getSharedHorizonSettings(vid) : api.getHorizonSettings(), [vid])

  const { data: dash, loading: dashLoading, reload: reloadDash } = useApiData<DashboardData>(fetchDashboard)
  const { data: events, reload: reloadEvents } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const { data: grantsData } = useApiData<GrantEntry[]>(fetchGrants)
  const { data: taxSettings, reload: reloadTaxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const { data: sales } = useApiData<SaleEntry[]>(fetchSales)
  const { data: horizonSettings, reload: reloadHorizon } = useApiData<HorizonSettings>(fetchHorizon)
  const exitDate = horizonSettings?.horizon_date ?? null
  const c = useChartColors()
  const [rangeInterest, setRangeInterest] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [rangeLoan, setRangeLoan] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [holdingsOpen, setHoldingsOpen] = useState<boolean>(() =>
    localStorage.getItem('dashboard_holdingsOpen') === 'true'
  )
  const [loansOpen, setLoansOpen] = useState<boolean>(() =>
    localStorage.getItem('dashboard_loansOpen') === 'true'
  )
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
  const [savingExit, setSavingExit] = useState(false)
  const [exitEditOpen, setExitEditOpen] = useState(false)
  const [pendingExitDate, setPendingExitDate] = useState<string>('')

  // Keep pending input in sync when server data reloads (e.g. after applying a tip)
  useEffect(() => {
    setPendingExitDate(exitDate ?? '')
  }, [exitDate])

  const pendingExitChanged = pendingExitDate !== (exitDate ?? '')

  const [exitPreview, setExitPreview] = useState<ExitPreview | null | 'loading'>(null)

  useEffect(() => {
    if (!pendingExitChanged || !pendingExitDate) {
      setExitPreview(null)
      return
    }
    setExitPreview('loading')
    const timer = setTimeout(() => {
      api.previewExit(pendingExitDate)
        .then(result => setExitPreview(result))
        .catch(() => setExitPreview(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [pendingExitChanged, pendingExitDate])

  async function applyExitDate(date: string | null) {
    setSavingExit(true)
    try {
      await api.updateHorizonSettings({ horizon_date: date })
      reloadEvents()
      reloadHorizon()
      setExitEditOpen(false)
    } finally {
      setSavingExit(false)
    }
  }

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
    localStorage.setItem('dashboard_holdingsOpen', String(holdingsOpen))
  }, [holdingsOpen])

  useEffect(() => {
    localStorage.setItem('dashboard_loansOpen', String(loansOpen))
  }, [loansOpen])

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
    const real = events.filter(e => !e.is_projected)
    return real.length ? real[real.length - 1].date : TODAY
  }, [events])

  // Projected liquidation event (if any)
  const projectedLiqEvent = useMemo(
    () => events?.find(e => e.event_type === 'Liquidation (projected)') ?? null,
    [events]
  )
  const projectedLiqDate = projectedLiqEvent?.date ?? null

  // Explicit exit date (only when user has set one and it differs from last real event)
  const showExitButton = exitDate !== null && exitDate !== lastRealEventDate

  // When cardDate is strictly past the projected exit, we project as-if no exit was planned
  const ignoringExitDate = projectedLiqDate !== null && cardDate > projectedLiqDate

  // Card values computed from local data as of cardDate
  const cardValues = useMemo(() => {
    if (!events || !loans) return null

    // Liq only "occurs" when cardDate is at (not past) the exit date; past it we ignore exit
    const liqOccurred = projectedLiqDate !== null && cardDate >= projectedLiqDate && !ignoringExitDate

    const effectiveDate = liqOccurred && projectedLiqDate ? projectedLiqDate : cardDate

    // Last event at or before effectiveDate
    let lastEvent: TimelineEvent | null = null
    for (const e of events) {
      if (e.date <= effectiveDate) lastEvent = e
      else break
    }
    // Next event after cardDate (still uses cardDate so "None" shows once past exit)
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
      + (liqOccurred ? (projectedLiqEvent?.estimated_tax ?? 0) : 0)
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
    // Unvested shares sell at cost basis (grant price) — compute their proceeds
    let unvestedCostProceeds = 0
    if (grantsData && liqOccurred) {
      for (const g of grantsData) {
        if (g.periods <= 0 || g.price <= 0) continue
        const vs = new Date(g.vest_start + 'T00:00:00')
        const base = Math.floor(g.shares / g.periods)
        const rem = g.shares % g.periods
        let vested = 0
        for (let p = 0; p < g.periods; p++) {
          const vd = new Date(vs)
          vd.setFullYear(vd.getFullYear() + p)
          if (vd.toISOString().slice(0, 10) <= effectiveDate) {
            vested += base + (p < rem ? 1 : 0)
          }
        }
        const unvested = g.shares - vested
        if (unvested > 0) unvestedCostProceeds += unvested * g.price
      }
    }
    const cashReceived = (sales
      ? sales.filter(s => s.date <= effectiveDate)
          .reduce((sum, s) => {
            const proceeds = s.shares * s.price_per_share
            const tax = saleTaxBySaleId.get(s.id) ?? 0
            const loanCovered = s.loan_id != null
              ? Math.max(0, (loanAmountById.get(s.loan_id) ?? 0) - (earlyPaidByLoan.get(s.loan_id) ?? 0))
              : 0
            return sum + proceeds - loanCovered - tax
          }, 0)
      : 0)
      + (liqOccurred && projectedLiqEvent
          ? Math.max(0, (projectedLiqEvent.gross_proceeds ?? 0) + unvestedCostProceeds - outstandingPrincipal - (projectedLiqEvent.estimated_tax ?? 0))
          : 0)

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
      // After projected liquidation, all loans are paid off from proceeds
      total_loan_principal: liqOccurred ? 0 : outstandingPrincipal,
      total_tax_paid: taxPaid - taxSavings,
      cash_received: cashReceived + taxSavings,
      interest_deduction_total: interestDeductionTotal,
      tax_savings_from_deduction: taxSavings,
      next_event: nextEvent,
    }
  }, [events, loans, grantsData, sales, taxSettings, dash, cardDate, projectedLiqDate, projectedLiqEvent, ignoringExitDate])

  // Per-grant holdings breakdown as of cardDate
  const grantHoldings = useMemo(() => {
    if (!grantsData || !events || !loans) return null

    const liqOccurred = projectedLiqDate !== null && cardDate >= projectedLiqDate && !ignoringExitDate
    const effectiveDate = liqOccurred && projectedLiqDate ? projectedLiqDate : cardDate
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
      const totalLoan = liqOccurred ? 0 : grantLoans.reduce(
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

      return {
        year: g.year,
        type: g.type,
        exerciseDate: g.exercise_date,
        costBasis: g.price,
        vestedShares: vested,
        unvestedShares: unvested,
        vestedValue: vested * currentPrice,
        totalTax: taxLoanTotal + vestingIncomeTax,
        totalLoan,
      }
    })
  }, [grantsData, events, loans, sales, taxSettings, cardDate, projectedLiqDate, ignoringExitDate])

  // Active (non-settled, non-refinanced) loans as of cardDate
  const activeLoans = useMemo(() => {
    if (!loans || !events) return null

    const liqOccurred = projectedLiqDate !== null && cardDate >= projectedLiqDate && !ignoringExitDate
    if (liqOccurred) return [] // all loans paid off at exit

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
  }, [loans, events, sales, cardDate, projectedLiqDate, ignoringExitDate])

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
            { label: 'Last event', date: lastRealEventDate, title: 'Jump to your last vesting event' },
            ...(showExitButton && exitDate ? [{ label: 'Exit', date: exitDate, title: 'Jump to your configured exit date' }] : []),
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
          {!readOnly ? (
            <button
              onClick={() => {
                setPendingExitDate(exitDate ?? '')
                setExitEditOpen(o => !o)
              }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              {exitDate ? (exitEditOpen ? '▲ exit date' : '▼ exit date') : '+ set exit date'}
            </button>
          ) : exitDate ? (
            <span className="text-xs text-gray-400 dark:text-slate-500">exit date: {exitDate}</span>
          ) : null}
        </div>
        {exitEditOpen && (
          <div className="mt-2 border-t border-stone-100 pt-2 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-slate-400">Exit date</span>
              <input
                type="date"
                value={pendingExitDate}
                disabled={savingExit}
                onChange={e => setPendingExitDate(e.target.value)}
                className="h-7 flex-1 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              />
              {!pendingExitChanged && exitDate && (
                <button
                  onClick={() => setPendingExitDate('')}
                  title="Clear exit date"
                  className="shrink-0 text-sm leading-none text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  ×
                </button>
              )}
            </div>
            {pendingExitChanged && (
              <div className="mt-2 rounded-md bg-stone-50 px-3 py-2 dark:bg-slate-800/60">
                {!pendingExitDate ? (
                  <p className="text-xs text-gray-500 dark:text-slate-400">This will remove your exit scenario</p>
                ) : exitPreview === 'loading' ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500">Calculating…</p>
                ) : exitPreview ? (
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    Cash out:{' '}
                    <span className="font-semibold text-gray-900 dark:text-slate-100">{fmt$(exitPreview.net_cash)}</span>
                    <span className="ml-1 text-gray-400 dark:text-slate-500">
                      (gross {fmt$(exitPreview.gross_proceeds)}, loans {fmt$(exitPreview.outstanding_loan_principal)}, tax {fmt$(exitPreview.estimated_tax)})
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-slate-500">No price data for this date</p>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => applyExitDate(pendingExitDate || null)}
                    disabled={savingExit}
                    className="rounded bg-rose-700 px-3 py-1 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                  >
                    {savingExit ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => { setPendingExitDate(exitDate ?? ''); setExitEditOpen(false) }}
                    disabled={savingExit}
                    className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {ignoringExitDate && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <span>Browsing past {readOnly ? 'the' : 'your'} exit date ({exitDate}) — exit not applied</span>
          {!readOnly && (
            <button
              onClick={() => { setPendingExitDate(cardDate); setExitEditOpen(true) }}
              className="shrink-0 rounded bg-amber-700 px-2 py-1 font-medium text-white hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              Move exit here
            </button>
          )}
        </div>
      )}

      {!readOnly && <TipCarousel onApply={() => { reloadDash(); reloadEvents(); reloadHorizon(); reloadTaxSettings() }} />}

      {/* (F) aria-live so screen readers announce summary updates when cardDate changes */}
      <div aria-live="polite" aria-atomic="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Share Price" value={fmtPrice(cv.current_price)} variant="price" />
        <Card label="Vested Shares" value={fmtNum(cv.total_shares)} variant="shares" />
        <Card label="Unvested Shares" value={fmtNum(grantHoldings?.reduce((s, h) => s + h.unvestedShares, 0) ?? 0)} variant="unvested" />
        <Card label="Total Income" value={fmt$(cv.total_income)} variant="income" />
        <Card label="Total Cap Gains" value={fmt$(cv.total_cap_gains)} variant="gains" />
        <Card label="Loan Principal" value={fmt$(cv.total_loan_principal)} variant="loans" />
        <Card label="Total Interest" value={fmt$(cv.total_interest)} variant="interest" />
        <Card label={hasInterestDeduction ? 'Tax Paid (after int. ded.)' : 'Tax Paid'} value={fmt$(cv.total_tax_paid)} variant="tax" />
        <Card label="Cash Received" value={fmt$(cv.cash_received)} variant="cash" />
        <Card
          label="Next Event"
          value={cv.next_event ? `${cv.next_event.date} — ${cv.next_event.event_type}` : 'None'}
          variant="event"
        />
      </div>
      {grantHoldings && grantHoldings.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <button
            onClick={() => setHoldingsOpen(o => !o)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Holdings by Grant</span>
            <span className="text-xs text-gray-400 dark:text-slate-500">{holdingsOpen ? '▲' : '▼'}</span>
          </button>
          {holdingsOpen && (
            <div className="border-t border-stone-100 dark:border-slate-700/50">
              {grantHoldings.map(h => (
                <div key={`${h.year}-${h.type}`} className="border-b border-stone-100 px-3 py-2 last:border-b-0 dark:border-slate-700/50">
                  <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">{h.year} {h.type}</p>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                    <span className="text-gray-500 dark:text-slate-400">Exercised <span className="font-medium text-gray-800 dark:text-slate-200">{fmtFullDate(h.exerciseDate)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Cost basis <span className="font-medium text-gray-800 dark:text-slate-200">{fmtPrice(h.costBasis)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Vested value <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.vestedValue)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Vested <span className="font-medium text-gray-800 dark:text-slate-200">{fmtNum(h.vestedShares)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Unvested <span className="font-medium text-gray-800 dark:text-slate-200">{fmtNum(h.unvestedShares)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Taxes <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.totalTax)}</span></span>
                    <span className="text-gray-500 dark:text-slate-400">Loans <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(h.totalLoan)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {activeLoans && activeLoans.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <button
            onClick={() => setLoansOpen(o => !o)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
              Active Loans
              <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-slate-500">({activeLoans.length})</span>
            </span>
            <span className="text-xs text-gray-400 dark:text-slate-500">{loansOpen ? '▲' : '▼'}</span>
          </button>
          {loansOpen && (
            <div className="border-t border-stone-100 dark:border-slate-700/50">
              {/* Header row on sm+ */}
              <div className="hidden px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 sm:grid sm:grid-cols-5 sm:gap-x-2 dark:text-slate-500">
                <span>Grant</span><span>Type</span><span>Balance</span><span>Rate</span><span>Due</span>
              </div>
              {activeLoans.map(l => (
                <div key={l.id} className="border-b border-stone-100 px-3 py-2 last:border-b-0 dark:border-slate-700/50">
                  {/* Mobile layout */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:hidden">
                    <span className="text-gray-500 dark:text-slate-400">{l.grantYear} {l.grantType} <span className="text-gray-400 dark:text-slate-500">· {l.loanType}</span></span>
                    <span className="text-right font-medium text-gray-800 dark:text-slate-200">{fmt$(l.balance)}</span>
                    <span className="text-gray-500 dark:text-slate-400">Rate <span className="font-medium text-gray-800 dark:text-slate-200">{(l.interestRate * 100).toFixed(2)}%</span></span>
                    <span className="text-right text-gray-500 dark:text-slate-400">Due <span className="font-medium text-gray-800 dark:text-slate-200">{fmtFullDate(l.dueDate)}</span></span>
                  </div>
                  {/* Desktop row */}
                  <div className="hidden text-xs sm:grid sm:grid-cols-5 sm:gap-x-2">
                    <span className="font-medium text-gray-800 dark:text-slate-200">{l.grantYear} {l.grantType}</span>
                    <span className="text-gray-600 dark:text-slate-400">{l.loanType}</span>
                    <span className="font-medium text-gray-800 dark:text-slate-200">{fmt$(l.balance)}</span>
                    <span className="text-gray-600 dark:text-slate-400">{(l.interestRate * 100).toFixed(2)}%</span>
                    <span className="text-gray-600 dark:text-slate-400">{fmtFullDate(l.dueDate)}</span>
                  </div>
                </div>
              ))}
            </div>
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
            <SharesChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} exitDate={projectedLiqDate} />
          </ChartBox>
        )}
        {events && events.length > 0 && (
          <ChartBox title="Income vs Cap Gains" range={range} setRange={setRange} maxDate={maxDate}>
            <IncomeCapGainsChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} exitDate={projectedLiqDate} />
          </ChartBox>
        )}
        {prices && prices.length > 0 && (
          <ChartBox title="Share Price History" range={range} setRange={setRange} maxDate={maxDate}>
            <PriceChart prices={prices} c={c} range={range} hasFuturePrices={hasFuturePrices} exitDate={projectedLiqDate} />
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
              exitDate={projectedLiqDate}
            />
          </ChartBox>
        )}
        {loans && loans.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') && (
          <ChartBox title="Interest Over Time" range={rangeInterest} setRange={setRangeInterest} maxDate={maxDate}>
            <InterestChart loans={loans} c={c} range={rangeInterest} exitDate={projectedLiqDate} />
          </ChartBox>
        )}
        {dash.loan_payment_by_year && dash.loan_payment_by_year.length > 0 && (
          <LoanChart loanPaymentByYear={dash.loan_payment_by_year} c={c} range={rangeLoan} setRange={setRangeLoan} maxDate={maxDate} />
        )}
      </div>
      {projectedLiqDate && !ignoringExitDate && (
        <p className="mt-2 text-center text-xs text-stone-600 dark:text-slate-400">
          Charts show the full event timeline — summary cards above are frozen at the exit date.
        </p>
      )}
    </div>
  )
}
