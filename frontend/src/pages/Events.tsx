import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import type { TimelineEvent } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

const EVENT_TYPES = ['Exercise', 'Down payment exchange', 'Vesting', 'Share Price', 'Loan Repayment']

const TYPE_COLORS: Record<string, string> = {
  'Exercise': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Down payment exchange': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Vesting': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Share Price': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Loan Repayment': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n: number | null) {
  return n != null ? n.toLocaleString('en-US') : '—'
}

export default function Events() {
  const fetchEvents = useCallback(() => api.getEvents(), [])
  const { data: events, loading } = useApiData<TimelineEvent[]>(fetchEvents)
  const [typeFilter, setTypeFilter] = useState<string>('')

  if (loading) return <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
  if (!events) return <p className="p-6 text-center text-sm text-red-500">Failed to load events</p>

  const filtered = typeFilter ? events.filter(e => e.event_type === typeFilter) : events

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Events Timeline</h2>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">All types ({events.length})</option>
          {EVENT_TYPES.map(t => (
            <option key={t} value={t}>{t} ({events.filter(e => e.event_type === t).length})</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Grant</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Income</th>
              <th className="px-3 py-2 text-right">Cap Gains</th>
              <th className="px-3 py-2 text-right">Cum Shares</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((e, i) => (
              <tr key={i} className="bg-white dark:bg-gray-900">
                <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300">{e.date}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[e.event_type] ?? ''}`}>
                    {e.event_type}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">
                  {e.grant_year ? `${e.grant_year} ${e.grant_type}` : '—'}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtNum(e.vested_shares ?? e.granted_shares)}</td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtPrice(e.share_price)}</td>
                <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{e.income ? fmt$(e.income) : '—'}</td>
                <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">{e.total_cap_gains ? fmt$(e.total_cap_gains) : '—'}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmtNum(e.cum_shares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} events</p>
    </div>
  )
}
