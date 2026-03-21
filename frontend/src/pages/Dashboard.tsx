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

type Range = '1Y' | '3Y' | '5Y' | 'All'
const RANGES: Range[] = ['1Y', '3Y', '5Y', 'All']

function rangeStart(range: Range): string {
  if (range === 'All') return '0000-01-01'
  const d = new Date()
  d.setFullYear(d.getFullYear() - Number(range[0]))
  return d.toISOString().slice(0, 10)
}

/** Filter dated items to a time range. Items must have a `date` or `effective_date` field. */
function filterByRange<T>(items: T[], range: Range, dateKey: keyof T): T[] {
  if (range === 'All') return items
  const start = rangeStart(range)
  return items.filter(item => (item[dateKey] as string) >= start)
}

function RangeButtons({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <div className="flex gap-1">
      {RANGES.map(r => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            r === range
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          {r}
        </button>
      ))}
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

function SharesChart({ events, c, range }: { events: TimelineEvent[]; c: ChartColors; range: Range }) {
  const data = useMemo(() =>
    filterByRange(events, range, 'date')
      .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
      .map(e => ({ _date: e.date, _label: fmtDate(e.date), shares: e.cum_shares })),
    [events, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v) => fmtNum(Number(v))}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        <Line type="monotone" dataKey="shares" stroke="#818cf8" strokeWidth={2} dot={false} name="Shares" />
      </LineChart>
    </ResponsiveContainer>
  )
}

function IncomeCapGainsChart({ events, c, range }: { events: TimelineEvent[]; c: ChartColors; range: Range }) {
  const data = useMemo(() =>
    filterByRange(events, range, 'date').map(e => ({
      _date: e.date,
      _label: fmtDate(e.date),
      Income: e.cum_income,
      'Cap Gains': e.cum_cap_gains,
    })),
    [events, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v) => fmt$(Number(v))}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        <Area type="monotone" dataKey="Income" stackId="1" fill="#34d399" fillOpacity={0.7} stroke="#10b981" />
        <Area type="monotone" dataKey="Cap Gains" stackId="1" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function PriceChart({ prices, c, range }: { prices: PriceEntry[]; c: ChartColors; range: Range }) {
  const data = useMemo(() =>
    filterByRange(prices, range, 'effective_date').map(p => ({
      _date: p.effective_date,
      _label: fmtDate(p.effective_date),
      price: p.price,
    })),
    [prices, range])
  const tIdx = todayIndex(data)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(data.length)} />
        <YAxis tick={{ fontSize: 10, fill: c.axis }} />
        <Tooltip
          formatter={(v) => fmtPrice(Number(v))}
          contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
        />
        {tIdx !== null && <ReferenceLine x={data[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
        <Line type="monotone" dataKey="price" stroke="#fbbf24" strokeWidth={2} dot={false} name="Price" />
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
  range?: Range; setRange?: (r: Range) => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h3>
        {range && setRange && <RangeButtons range={range} setRange={setRange} />}
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
  const [range, setRange] = useState<Range>('All')

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
            <PriceChart prices={prices} c={c} range={range} />
          </ChartBox>
        )}
        {loans && loans.length > 0 && <LoanChart loans={loans} c={c} />}
      </div>
    </div>
  )
}
