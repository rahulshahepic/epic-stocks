import { useCallback } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { api } from '../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function SharesChart({ events }: { events: TimelineEvent[] }) {
  const data = events
    .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    .map(e => ({ date: e.date, shares: e.cum_shares }))

  return (
    <ChartBox title="Shares Over Time">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => fmtNum(Number(v))} />
          <Line type="monotone" dataKey="shares" stroke="#6366f1" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function IncomeCapGainsChart({ events }: { events: TimelineEvent[] }) {
  const data = events.map(e => ({
    date: e.date,
    income: e.cum_income,
    cap_gains: e.cum_cap_gains,
  }))

  return (
    <ChartBox title="Income vs Cap Gains">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => fmt$(Number(v))} />
          <Area type="monotone" dataKey="income" stackId="1" fill="#34d399" stroke="#10b981" />
          <Area type="monotone" dataKey="cap_gains" stackId="1" fill="#818cf8" stroke="#6366f1" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function PriceChart({ prices }: { prices: PriceEntry[] }) {
  const data = prices.map(p => ({ date: p.effective_date, price: p.price }))

  return (
    <ChartBox title="Share Price History">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => fmt$(Number(v))} />
          <Line type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function LoanChart({ loans }: { loans: LoanEntry[] }) {
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
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => fmt$(Number(v))} />
          <Bar dataKey="amount" fill="#f87171" />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-700">{title}</h3>
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

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Share Price" value={fmt$(dash.current_price)} />
        <Card label="Total Shares" value={fmtNum(dash.total_shares)} />
        <Card label="Total Income" value={fmt$(dash.total_income)} />
        <Card label="Total Cap Gains" value={fmt$(dash.total_cap_gains)} />
        <Card label="Loan Principal" value={fmt$(dash.total_loan_principal)} />
        <Card
          label="Next Event"
          value={dash.next_event ? `${dash.next_event.date} — ${dash.next_event.event_type}` : 'None'}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {events && events.length > 0 && <SharesChart events={events} />}
        {events && events.length > 0 && <IncomeCapGainsChart events={events} />}
        {prices && prices.length > 0 && <PriceChart prices={prices} />}
        {loans && loans.length > 0 && <LoanChart loans={loans} />}
      </div>
    </div>
  )
}
