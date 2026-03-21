import { useCallback, useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine,
} from 'recharts'
import { api } from '../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry } from '../api.ts'
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

function RangeControls({ range, setRange }: { range: DateRange; setRange: (r: DateRange) => void }) {
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
        onChange={e => setRange({ mode: 'custom', start: e.target.value, end: range.end || '2099-12-31' })}
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

function SharesChart({ events, c, range }: { events: TimelineEvent[]; c: ChartColors; range: DateRange }) {
  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
      .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    return filtered.map(e => {
      const isPast = e.date <= TODAY
      return {
        _date: e.date,
        _label: fmtDate(e.date),
        pastShares: isPast ? e.cum_shares : null,
        futureShares: !isPast ? e.cum_shares : null,
      }
    }).map((d, i, arr) => {
      // overlap: last past point also gets futureShares for line continuity
      if (d.pastShares !== null && (i === arr.length - 1 || arr[i + 1].futureShares !== null)) {
        return { ...d, futureShares: d.pastShares }
      }
      return d
    })
  }, [events, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v, name) => [fmtNum(Number(v)), name === 'futureShares' ? 'Shares (projected)' : 'Shares']}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        <Line type="monotone" dataKey="pastShares" stroke="#818cf8" strokeWidth={2} dot={false} name="Shares" connectNulls={false} />
        <Line type="monotone" dataKey="futureShares" stroke="#818cf8" strokeWidth={2} dot={false} name="Shares (projected)" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function IncomeCapGainsChart({ events, c, range }: { events: TimelineEvent[]; c: ChartColors; range: DateRange }) {
  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
    // Compute cumulative vesting vs price cap gains for the future split
    let cumVestCg = 0
    let cumPriceCg = 0
    return filtered.map(e => {
      cumVestCg += e.vesting_cap_gains
      cumPriceCg += e.price_cap_gains
      const isPast = e.date <= TODAY
      return {
        _date: e.date,
        _label: fmtDate(e.date),
        // Past: solid series
        pastIncome: isPast ? e.cum_income : null,
        pastGains: isPast ? e.cum_cap_gains : null,
        // Future: solid for vesting-driven, half-shade for price-driven
        futureIncome: !isPast ? e.cum_income : null,
        futureVestGains: !isPast ? cumVestCg : null,
        futurePriceGains: !isPast ? cumPriceCg : null,
      }
    }).map((d, i, arr) => {
      // overlap: last past point also gets future values for area continuity
      if (d.pastIncome !== null && (i === arr.length - 1 || arr[i + 1].futureIncome !== null)) {
        return { ...d, futureIncome: d.pastIncome, futureVestGains: d.pastGains, futurePriceGains: 0 }
      }
      return d
    })
  }, [events, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v, name) => {
            const label = String(name).startsWith('future') ? `${String(name).replace('future', '')} (projected)` : String(name)
            return [fmt$(Number(v)), label]
          }}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} content={() => (
          <div className="flex justify-center gap-3 text-[11px]">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#10b981' }} />Income</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#8b5cf6' }} />Cap Gains</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#c4b5fd' }} />Projected</span>
          </div>
        )} />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        {/* Past: solid fills */}
        <Area type="monotone" dataKey="pastIncome" stackId="past" fill="#34d399" fillOpacity={0.7} stroke="#10b981" name="Income" connectNulls={false} />
        <Area type="monotone" dataKey="pastGains" stackId="past" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" name="Cap Gains" connectNulls={false} />
        {/* Future: solid for vesting-driven gains */}
        <Area type="monotone" dataKey="futureIncome" stackId="future" fill="#34d399" fillOpacity={0.35} stroke="#10b981" strokeDasharray="6 3" name="futureIncome" connectNulls={false} />
        <Area type="monotone" dataKey="futureVestGains" stackId="future" fill="#a78bfa" fillOpacity={0.35} stroke="#8b5cf6" strokeDasharray="6 3" name="futureVestGains" connectNulls={false} />
        {/* Future: half-shade for price-driven (speculative) gains */}
        <Area type="monotone" dataKey="futurePriceGains" stackId="future" fill="#c4b5fd" fillOpacity={0.2} stroke="#c4b5fd" strokeDasharray="3 3" name="futurePriceGains" connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function PriceChart({ prices, events, c, range }: { prices: PriceEntry[]; events: TimelineEvent[]; c: ChartColors; range: DateRange }) {
  const data = useMemo(() => {
    const filtered = filterByDateRange(prices, range, 'effective_date')
    if (filtered.length === 0) return []

    // Build past price data
    const result = filtered.map(p => ({
      _date: p.effective_date,
      _label: fmtDate(p.effective_date),
      pastPrice: p.effective_date <= TODAY ? p.price : null,
      futurePrice: p.effective_date > TODAY ? p.price : null,
    }))

    // Find last known price and last event date for flat-forward projection
    const lastPrice = filtered[filtered.length - 1].price
    const lastPriceDate = filtered[filtered.length - 1].effective_date
    const lastEventDate = events.length > 0 ? events[events.length - 1].date : null

    if (lastEventDate && lastEventDate > lastPriceDate) {
      // Overlap: last past/known point also gets futurePrice
      const lastKnownIdx = result.findIndex(d => d._date > TODAY) - 1
      const overlapIdx = lastKnownIdx >= 0 ? lastKnownIdx : result.length - 1
      if (result[overlapIdx]) {
        result[overlapIdx] = { ...result[overlapIdx], futurePrice: result[overlapIdx].pastPrice ?? lastPrice }
      }

      // Add flat-forward endpoint at last event date (if within custom range)
      if (range.mode === 'all' || lastEventDate <= range.end) {
        result.push({
          _date: lastEventDate,
          _label: fmtDate(lastEventDate),
          pastPrice: null,
          futurePrice: lastPrice,
        })
      }
    }

    return result
  }, [prices, events, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} padding={{ right: 10 }} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v, name) => [fmtPrice(Number(v)), name === 'futurePrice' ? 'Price (projected)' : 'Price']}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        <Line type="monotone" dataKey="pastPrice" stroke="#fbbf24" strokeWidth={2} dot={false} name="Price" connectNulls={false} />
        <Line type="monotone" dataKey="futurePrice" stroke="#fbbf24" strokeWidth={2} dot={false} name="Price (projected)" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function LoanChart({ loans, c }: { loans: LoanEntry[]; c: ChartColors }) {
  const byYear: Record<string, number> = {}
  for (const l of loans) {
    const year = l.due_date.slice(0, 4)
    byYear[year] = (byYear[year] ?? 0) + l.amount
  }
  const data = Object.entries(byYear)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, amount]) => ({ year, amount }))

  return (
    <ChartBox title="Loan Principal by Due Year">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Tooltip
            formatter={(v) => fmt$(Number(v))}
            contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
          />
          <Bar dataKey="amount" fill="#f87171" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function ChartBox({ title, children, range, setRange }: {
  title: string; children: React.ReactNode
  range?: DateRange; setRange?: (r: DateRange) => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h3>
        {range && setRange && <RangeControls range={range} setRange={setRange} />}
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

  const { data: dash, loading: dashLoading } = useApiData<DashboardData>(fetchDashboard)
  const { data: events } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const c = useChartColors()
  const [range, setRange] = useState<DateRange>({ mode: 'all', start: '', end: '' })

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Share Price" value={fmtPrice(dash.current_price)} variant="price" />
        <Card label="Total Shares" value={fmtNum(dash.total_shares)} variant="shares" />
        <Card label="Total Income" value={fmt$(dash.total_income)} variant="income" />
        <Card label="Total Cap Gains" value={fmt$(dash.total_cap_gains)} variant="gains" />
        <Card label="Loan Principal" value={fmt$(dash.total_loan_principal)} variant="loans" />
        <Card
          label="Next Event"
          value={dash.next_event ? `${dash.next_event.date} — ${dash.next_event.event_type}` : 'None'}
          variant="event"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {events && events.length > 0 && (
          <ChartBox title="Shares Over Time" range={range} setRange={setRange}>
            <SharesChart events={events} c={c} range={range} />
          </ChartBox>
        )}
        {events && events.length > 0 && (
          <ChartBox title="Income vs Cap Gains" range={range} setRange={setRange}>
            <IncomeCapGainsChart events={events} c={c} range={range} />
          </ChartBox>
        )}
        {prices && prices.length > 0 && (
          <ChartBox title="Share Price History" range={range} setRange={setRange}>
            <PriceChart prices={prices} events={events ?? []} c={c} range={range} />
          </ChartBox>
        )}
        {loans && loans.length > 0 && <LoanChart loans={loans} c={c} />}
      </div>
    </div>
  )
}
