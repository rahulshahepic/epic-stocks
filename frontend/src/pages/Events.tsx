import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import type { TimelineEvent, TaxSettings } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

const EVENT_TYPES = ['Exercise', 'Down payment exchange', 'Vesting', 'Share Price', 'Loan Payoff', 'Early Loan Payment', 'Sale']

const TYPE_COLORS: Record<string, string> = {
  'Exercise': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Down payment exchange': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Vesting': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Share Price': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Loan Payoff': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Early Loan Payment': 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  'Sale': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
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

const TODAY = new Date().toISOString().slice(0, 10)

const WI_TAX_DEFAULTS: TaxSettings = {
  federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
  niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765, lt_holding_days: 365, lot_selection_method: 'lifo',
  prefer_stock_dp: false, dp_min_percent: 0.10, dp_min_cap: 20000,
}

function estTaxForVesting(e: TimelineEvent, ts: TaxSettings): number {
  const incomeRate = ts.federal_income_rate + ts.state_income_rate
  const ltCgRate = ts.federal_lt_cg_rate + ts.niit_rate + ts.state_lt_cg_rate
  return (e.income > 0 ? e.income * incomeRate : 0)
       + (e.vesting_cap_gains > 0 ? e.vesting_cap_gains * ltCgRate : 0)
}

export default function Events() {
  const fetchEvents = useCallback(() => api.getEvents(), [])
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: events, loading } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const [typeFilter, setTypeFilter] = useState<string>('')

  const ts = taxSettings ?? WI_TAX_DEFAULTS

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
              <th className="px-3 py-2 text-right" title="Estimated tax due (income or cap gains events only). Price appreciation is unrealized — not a taxable event.">Est. Tax</th>
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
                <td className={`px-3 py-2 text-right ${e.event_type === 'Sale' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                  {e.event_type === 'Early Loan Payment'
                    ? (e.amount != null ? fmt$(e.amount) : '—')
                    : fmtNum(e.vested_shares ?? e.granted_shares)}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmtPrice(e.share_price)}</td>
                <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{e.income ? fmt$(e.income) : '—'}</td>
                <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">
                  {e.event_type === 'Loan Payoff' && e.cash_due != null
                    ? <span title={e.status === 'covered' ? 'Covered by linked sale' : 'No linked sale — cash required'}>
                        {fmt$(e.cash_due)}
                        {' '}
                        <span className={e.status === 'covered' ? 'text-emerald-600' : 'text-orange-500'}>
                          {e.status === 'covered' ? '✓' : '!'}
                        </span>
                      </span>
                    : e.event_type === 'Sale' && e.gross_proceeds != null
                    ? <span className="text-green-600 dark:text-green-400" title="Gross proceeds from sale">{fmt$(e.gross_proceeds)}</span>
                    : e.total_cap_gains ? fmt$(e.total_cap_gains) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {e.event_type === 'Vesting' && (e.income > 0 || e.vesting_cap_gains > 0) ? (
                    <span className="text-orange-600 dark:text-orange-400" title={
                      e.date > TODAY
                        ? `Future vesting — sell ≈${Math.ceil(estTaxForVesting(e, ts) / e.share_price)} shares to cover`
                        : 'Income/cap gains tax due at vesting'
                    }>
                      {fmt$(estTaxForVesting(e, ts))}
                    </span>
                  ) : e.event_type === 'Share Price' ? (
                    <span className="text-xs text-gray-400 dark:text-gray-600" title="Price appreciation is unrealized — not a taxable event">—*</span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmtNum(e.cum_shares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} events &nbsp;·&nbsp; * price appreciation is unrealized — not a taxable event &nbsp;·&nbsp; hover Est. Tax for sell-to-cover share count</p>
    </div>
  )
}
