import { useCallback } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { api } from '../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useDark } from '../hooks/useDark.ts'

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function shortDate(d: string) {
  return d.slice(2, 7) // "2021-03-01" → "21-03"
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

function SharesChart({ events, c }: { events: TimelineEvent[]; c: ChartColors }) {
  const data = events
    .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    .map(e => ({ date: shortDate(e.date), shares: e.cum_shares }))

  return (
    <ChartBox title="Shares Over Time">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: c.axis }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Tooltip
            formatter={(v) => fmtNum(Number(v))}
            contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
          />
          <Line type="monotone" dataKey="shares" stroke="#818cf8" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function IncomeCapGainsChart({ events, c }: { events: TimelineEvent[]; c: ChartColors }) {
  const data = events.map(e => ({
    date: shortDate(e.date),
    income: e.cum_income,
    cap_gains: e.cum_cap_gains,
  }))

  return (
    <ChartBox title="Income vs Cap Gains">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: c.axis }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Tooltip
            formatter={(v) => fmt$(Number(v))}
            contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="income" stackId="1" fill="#34d399" fillOpacity={0.7} stroke="#10b981" />
          <Area type="monotone" dataKey="cap_gains" stackId="1" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function PriceChart({ prices, c }: { prices: PriceEntry[]; c: ChartColors }) {
  const data = prices.map(p => ({ date: shortDate(p.effective_date), price: p.price }))

  return (
    <ChartBox title="Share Price History">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: c.axis }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Tooltip
            formatter={(v) => fmt$(Number(v))}
            contentStyle={{ backgroundColor: c.tooltipBg, color: c.tooltipText, border: 'none', borderRadius: 8 }}
          />
          <Line type="monotone" dataKey="price" stroke="#fbbf24" strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
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

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h3>
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

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Share Price" value={fmt$(dash.current_price)} variant="price" />
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
        {events && events.length > 0 && <SharesChart events={events} c={c} />}
        {events && events.length > 0 && <IncomeCapGainsChart events={events} c={c} />}
        {prices && prices.length > 0 && <PriceChart prices={prices} c={c} />}
        {loans && loans.length > 0 && <LoanChart loans={loans} c={c} />}
      </div>
    </div>
  )
}
