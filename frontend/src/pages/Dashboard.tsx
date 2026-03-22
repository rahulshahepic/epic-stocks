import { useCallback, useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { api } from '../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry, TaxSettings, SaleEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useDark } from '../hooks/useDark.ts'

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

/** Compute a tick interval that shows ~maxTicks evenly-spaced labels. */
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
        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
          isAll
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        }`}
      >
        All
      </button>
      <input
        type="date"
        aria-label="Range start date"
        value={range.mode === 'custom' ? range.start : ''}
        onChange={e => setRange({ mode: 'custom', start: e.target.value, end: range.end || maxDate })}
        className="h-6 rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      />
      <span className="text-xs text-gray-400">–</span>
      <input
        type="date"
        aria-label="Range end date"
        value={range.mode === 'custom' ? range.end : ''}
        onChange={e => setRange({ mode: 'custom', start: range.start || '0000-01-01', end: e.target.value })}
        className="h-6 rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
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
    ? { grid: '#374151', axis: '#9ca3af', tooltipBg: '#1f2937', tooltipText: '#f3f4f6' }
    : { grid: '#e5e7eb', axis: '#6b7280', tooltipBg: '#ffffff', tooltipText: '#111827' }
}

const CARD_STYLES: Record<string, { bg: string; border: string; label: string }> = {
  price:  { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', label: 'text-amber-700 dark:text-amber-400' },
  shares: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-200 dark:border-indigo-800', label: 'text-indigo-700 dark:text-indigo-400' },
  income: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', label: 'text-emerald-700 dark:text-emerald-400' },
  gains:  { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800', label: 'text-purple-700 dark:text-purple-400' },
  loans:  { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-red-200 dark:border-red-800', label: 'text-red-700 dark:text-red-400' },
  event:  { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-200 dark:border-sky-800', label: 'text-sky-700 dark:text-sky-400' },
  tax:    { bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800', label: 'text-orange-700 dark:text-orange-400' },
  cash:   { bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-800', label: 'text-green-700 dark:text-green-400' },
}

function Card({ label, value, variant }: { label: string; value: string; variant: string }) {
  const s = CARD_STYLES[variant] ?? CARD_STYLES.event
  return (
    <div className={`rounded-lg border p-4 ${s.bg} ${s.border}`}>
      <p className={`text-xs font-medium uppercase ${s.label}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

/** Detail card shown below a chart when user clicks a data point */
function DetailCard({ items, onClose }: { items: { label: string; value: string }[]; onClose: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {items.map(({ label, value }) => (
            <span key={label} className="text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-gray-200">{value}</span>{' '}{label}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">&times;</button>
      </div>
    </div>
  )
}

function SharesChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
      .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    return filtered.map(e => {
      const isPast = !hasFuturePrices || e.date <= TODAY
      return {
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
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={data[selected]._label} stroke="#818cf8" strokeWidth={1.5} />
          )}
          <Line type="monotone" dataKey="shares" stroke="#818cf8" strokeWidth={2} dot={false} name="Shares" connectNulls={false} />
          {hasFuturePrices && (
            <Line type="monotone" dataKey="projected" stroke="#818cf8" strokeWidth={2} dot={false} name="Projected" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
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
    </>
  )
}

function IncomeCapGainsChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
    // Track the portion of income and cap gains attributable solely to future price changes.
    // RSU vests (grant_price=0) produce income; option vests (grant_price>0) produce cap gains.
    // For the future price event: price_cap_gains is entirely price-driven surplus.
    // For future vests after a price change: extra = cumFuturePriceIncrease × shares_vested.
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0
    return filtered.map(e => {
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
      return {
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        income: e.cum_income - cumSurplusIncome,
        gains: e.cum_cap_gains - cumSurplusCg,
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
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{'  '}
              <tspan fill="#8b5cf6">&#9632;</tspan> Cap Gains{'  '}
              <tspan fill="#6ee7b7">&#9632;</tspan>/<tspan fill="#c4b5fd">&#9632;</tspan> Projected
            </text>
          )}
          {!hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{'  '}
              <tspan fill="#8b5cf6">&#9632;</tspan> Cap Gains
            </text>
          )}
          {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={data[selected]._label} stroke="#8b5cf6" strokeWidth={1.5} />
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
          ]}
        />
      )}
    </>
  )
}

function PriceChart({ prices, c, range, hasFuturePrices }: { prices: PriceEntry[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(prices, range, 'effective_date')
    if (filtered.length === 0) return []

    const result = filtered.map(p => {
      const isPast = !hasFuturePrices || p.effective_date <= TODAY
      return {
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
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={data[selected]._label} stroke="#fbbf24" strokeWidth={1.5} />
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
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
    let taxLoanIdx = 0
    let cumTaxPaid = 0

    // Track price-driven surplus (same approach as IncomeCapGainsChart)
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0

    const filtered = filterByDateRange(events, range, 'date')
    return filtered.map(e => {
      // Accumulate tax loan payments up to this event date
      while (taxLoanIdx < sortedTaxLoans.length && sortedTaxLoans[taxLoanIdx].due_date <= e.date) {
        cumTaxPaid += sortedTaxLoans[taxLoanIdx].amount
        taxLoanIdx++
      }
      // Accumulate Sale estimated taxes at the sale date
      if (e.event_type === 'Sale' && e.estimated_tax) {
        cumTaxPaid += e.estimated_tax
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

      // "Sure" tax = tax on base income + base vesting cap gains (no price surplus)
      const taxSure = Math.round(
        (e.cum_income - cumSurplusIncome) * incomeRate +
        (e.cum_cap_gains - cumSurplusCg) * ltCgRate
      )

      // "Half" tax = tax on price-driven surplus (uncertain - depends on future price)
      const hasSurplus = hasFuturePrices && (cumSurplusIncome + cumSurplusCg) > 0
      const taxHalf = hasSurplus
        ? Math.round(cumSurplusIncome * incomeRate + cumSurplusCg * ltCgRate)
        : null as number | null

      return {
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
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
            <tspan fill="#fb923c">&#9632;</tspan> Est. Tax (Sure){'  '}
            {hasFuturePrices && <><tspan fill="#fed7aa">&#9632;</tspan> +Projected{'  '}</>}
            <tspan fill="#ef4444">&#9632;</tspan> Paid
          </text>
          {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={data[selected]._label} stroke="#fb923c" strokeWidth={1.5} />
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

function LoanChart({ loanPaymentByYear, c }: {
  loanPaymentByYear: { year: string; same_tranche_sale: number; cash_in: number }[]
  c: ChartColors
}) {
  if (!loanPaymentByYear || loanPaymentByYear.length === 0) return null
  return (
    <ChartBox title="Loan Payments by Due Year">
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span style={{ color: '#4ade80' }}>&#9632;</span> Same-tranche sale{'  '}
        <span style={{ color: '#fb923c' }}>&#9632;</span> Cash in
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={loanPaymentByYear}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Bar dataKey="same_tranche_sale" stackId="a" fill="#4ade80" name="Same-tranche sale" radius={[0, 0, 0, 0]} />
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h3>
        {range && setRange && <RangeControls range={range} setRange={setRange} maxDate={maxDate ?? '2099-12-31'} />}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const fetchDashboard = useCallback(() => api.getDashboard(), [])
  const fetchEvents = useCallback(() => api.getEvents(), [])
  const fetchPrices = useCallback(() => api.getPrices(), [])
  const fetchLoans = useCallback(() => api.getLoans(), [])
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const fetchSales = useCallback(() => api.getSales(), [])

  const { data: dash, loading: dashLoading } = useApiData<DashboardData>(fetchDashboard)
  const { data: events } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const { data: sales } = useApiData<SaleEntry[]>(fetchSales)
  const c = useChartColors()
  const [range, setRange] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [cardDate, setCardDate] = useState<string>(TODAY)

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

  // Card values computed from local data as of cardDate
  const cardValues = useMemo(() => {
    if (!events || !loans) return null
    // Last event at or before cardDate
    let lastEvent: TimelineEvent | null = null
    for (const e of events) {
      if (e.date <= cardDate) lastEvent = e
      else break
    }
    // Next event after cardDate
    let nextEvent: { date: string; event_type: string } | null = null
    for (const e of events) {
      if (e.date > cardDate) { nextEvent = { date: e.date, event_type: e.event_type }; break }
    }
    const taxPaid =
      loans.filter(l => l.loan_type === 'Tax' && l.due_date <= cardDate)
        .reduce((sum, l) => sum + l.amount, 0)
      + events.filter(e => e.event_type === 'Sale' && e.date <= cardDate)
        .reduce((sum, e) => sum + (e.estimated_tax ?? 0), 0)
    const cashReceived = sales
      ? sales.filter(s => s.loan_id === null && s.date <= cardDate)
          .reduce((sum, s) => sum + s.shares * s.price_per_share, 0)
      : null
    return {
      current_price: lastEvent?.share_price ?? 0,
      total_shares: lastEvent?.cum_shares ?? 0,
      total_income: lastEvent?.cum_income ?? 0,
      total_cap_gains: lastEvent?.cum_cap_gains ?? 0,
      total_loan_principal: loans.reduce((sum, l) => sum + l.amount, 0),
      total_tax_paid: taxPaid,
      cash_received: cashReceived ?? 0,
      next_event: nextEvent,
    }
  }, [events, loans, sales, cardDate])

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  const cv = cardValues ?? {
    current_price: dash.current_price,
    total_shares: dash.total_shares,
    total_income: dash.total_income,
    total_cap_gains: dash.total_cap_gains,
    total_loan_principal: dash.total_loan_principal,
    total_tax_paid: dash.total_tax_paid ?? 0,
    cash_received: dash.cash_received ?? 0,
    next_event: dash.next_event,
  }

  return (
    <div className="space-y-6">
      {/* Date selector for card values */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">As of</span>
        <input
          type="date"
          value={cardDate}
          max={maxDate}
          onChange={e => setCardDate(e.target.value)}
          className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        />
        <button
          onClick={() => setCardDate(TODAY)}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            cardDate === TODAY
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setCardDate(maxDate)}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            cardDate === maxDate
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          End
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Share Price" value={fmtPrice(cv.current_price)} variant="price" />
        <Card label="Total Shares" value={fmtNum(cv.total_shares)} variant="shares" />
        <Card label="Total Income" value={fmt$(cv.total_income)} variant="income" />
        <Card label="Total Cap Gains" value={fmt$(cv.total_cap_gains)} variant="gains" />
        <Card label="Loan Principal" value={fmt$(cv.total_loan_principal)} variant="loans" />
        <Card label="Tax Paid" value={fmt$(cv.total_tax_paid)} variant="tax" />
        <Card label="Cash Received" value={fmt$(cv.cash_received)} variant="cash" />
        <Card
          label="Next Event"
          value={cv.next_event ? `${cv.next_event.date} — ${cv.next_event.event_type}` : 'None'}
          variant="event"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {events && events.length > 0 && (
          <ChartBox title="Shares Over Time" range={range} setRange={setRange} maxDate={maxDate}>
            <SharesChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
          </ChartBox>
        )}
        {events && events.length > 0 && (
          <ChartBox title="Income vs Cap Gains" range={range} setRange={setRange} maxDate={maxDate}>
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
        {dash.loan_payment_by_year && dash.loan_payment_by_year.length > 0 && (
          <LoanChart loanPaymentByYear={dash.loan_payment_by_year} c={c} />
        )}
      </div>
    </div>
  )
}
