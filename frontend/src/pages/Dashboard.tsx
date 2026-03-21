import { useCallback, useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
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
    let cumVestCg = 0
    let cumPriceCg = 0
    return filtered.map(e => {
      cumVestCg += e.vesting_cap_gains
      cumPriceCg += e.price_cap_gains
      const isPast = !hasFuturePrices || e.date <= TODAY
      return {
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        _cumVestCg: cumVestCg,
        _cumPriceCg: cumPriceCg,
        income: isPast ? e.cum_income : null as number | null,
        gains: isPast ? e.cum_cap_gains : null as number | null,
        projIncome: !isPast ? e.cum_income : null as number | null,
        projVestGains: !isPast ? cumVestCg : null as number | null,
        projPriceGains: !isPast ? cumPriceCg : null as number | null,
      }
    }).map((d, i, arr) => {
      if (hasFuturePrices && d.income !== null && (i === arr.length - 1 || arr[i + 1].projIncome !== null)) {
        return { ...d, projIncome: d.income, projVestGains: d._cumVestCg, projPriceGains: d._cumPriceCg }
      }
      return d
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
              <tspan fill="#c4b5fd">&#9632;</tspan> Projected
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
          {/* Solid fills — always present */}
          <Area type="monotone" dataKey="income" stackId="main" fill="#34d399" fillOpacity={0.7} stroke="#10b981" name="Income" connectNulls={false} />
          <Area type="monotone" dataKey="gains" stackId="main" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" name="Cap Gains" connectNulls={false} />
          {/* Projected — only when future prices exist */}
          {hasFuturePrices && <>
            <Area type="monotone" dataKey="projIncome" stackId="proj" fill="#34d399" fillOpacity={0.35} stroke="#10b981" strokeDasharray="6 3" name="projIncome" connectNulls={false} />
            <Area type="monotone" dataKey="projVestGains" stackId="proj" fill="#a78bfa" fillOpacity={0.35} stroke="#8b5cf6" strokeDasharray="6 3" name="projVestGains" connectNulls={false} />
            <Area type="monotone" dataKey="projPriceGains" stackId="proj" fill="#c4b5fd" fillOpacity={0.2} stroke="#c4b5fd" strokeDasharray="3 3" name="projPriceGains" connectNulls={false} />
          </>}
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
          <Bar dataKey="amount" fill="#f87171" radius={[4, 4, 0, 0]} />
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

  const { data: dash, loading: dashLoading } = useApiData<DashboardData>(fetchDashboard)
  const { data: events } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const c = useChartColors()
  const [range, setRange] = useState<DateRange>({ mode: 'all', start: '', end: '' })

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
        {loans && loans.length > 0 && <LoanChart loans={loans} c={c} />}
      </div>
    </div>
  )
}
