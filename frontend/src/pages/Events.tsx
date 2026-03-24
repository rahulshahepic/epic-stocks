import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import type { TimelineEvent, TaxBreakdown, TaxSettings } from '../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { TaxCard } from './Sales.tsx'

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

function fmtPct(r: number) {
  return (r * 100).toFixed(2) + '%'
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
  return e.income * incomeRate
}

function est83bTax(e: TimelineEvent, ts: TaxSettings): number {
  const ltCgRate = ts.federal_lt_cg_rate + ts.niit_rate + ts.state_lt_cg_rate
  return e.income * ltCgRate
}

function TaxRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function VestingTaxCard({ e, ts }: { e: TimelineEvent; ts: TaxSettings }) {
  const incomeRate = ts.federal_income_rate + ts.state_income_rate
  const totalTax = e.income * incomeRate
  const sharesToCover = e.share_price > 0 ? Math.ceil(totalTax / e.share_price) : 0
  const isFuture = e.date > TODAY

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-xs dark:border-orange-800 dark:bg-orange-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Estimated Tax</h3>
      <div className="space-y-1">
        <TaxRow
          label={`Ordinary income × ${fmtPct(incomeRate)}`}
          value={`${fmt$(e.income)} → ${fmt$(totalTax)}`}
        />
        <div className="my-2 border-t border-orange-200 dark:border-orange-700" />
        <TaxRow label="Estimated total tax" value={fmt$(totalTax)} bold />
        {isFuture && sharesToCover > 0 && (
          <TaxRow label="Sell to cover" value={`≈ ${sharesToCover.toLocaleString()} shares`} />
        )}
      </div>
    </div>
  )
}

function Unrealized83bCard({ e, ts }: { e: TimelineEvent; ts: TaxSettings }) {
  const ltCgRate = ts.federal_lt_cg_rate + ts.niit_rate + ts.state_lt_cg_rate
  const potentialTax = e.income * ltCgRate
  const isFuture = e.date > TODAY

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-xs dark:border-violet-800 dark:bg-violet-900/20">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">83(b) Election — Unrealized Gain</h3>
      <div className="space-y-1">
        <TaxRow label="Unrealized gain at vesting" value={fmt$(e.income)} />
        <TaxRow label="Cost basis (83b at $0)" value="$0" />
        <div className="my-2 border-t border-violet-200 dark:border-violet-700" />
        <TaxRow label="No income tax due at vesting" value="$0" />
        <TaxRow
          label={`Potential LT cap gains × ${fmtPct(ltCgRate)}`}
          value={`→ ~${fmt$(potentialTax)}`}
        />
        {isFuture && (
          <p className="pt-1 text-gray-400">Gain realized only upon sale — holding period starts at vesting.</p>
        )}
      </div>
    </div>
  )
}

export default function Events() {
  const fetchEvents = useCallback(() => api.getEvents(), [])
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: events, loading } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Per-sale-row inline TaxCard state
  const [breakdowns, setBreakdowns] = useState<Map<number, TaxBreakdown>>(new Map())
  const [expandedSales, setExpandedSales] = useState<Set<number>>(new Set())
  const [loadingTaxIds, setLoadingTaxIds] = useState<Set<number>>(new Set())

  // Per-vesting-row expansion state (keyed by row index in filtered list)
  const [expandedVesting, setExpandedVesting] = useState<Set<number>>(new Set())

  const ts = taxSettings ?? WI_TAX_DEFAULTS

  function toggleVestingTax(idx: number) {
    setExpandedVesting(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  async function toggleSaleTax(saleId: number) {
    if (breakdowns.has(saleId)) {
      setExpandedSales(prev => {
        const next = new Set(prev)
        if (next.has(saleId)) next.delete(saleId)
        else next.add(saleId)
        return next
      })
      return
    }
    setLoadingTaxIds(prev => new Set(prev).add(saleId))
    try {
      const tax = await api.getSaleTax(saleId)
      setBreakdowns(prev => new Map(prev).set(saleId, tax))
      setExpandedSales(prev => new Set(prev).add(saleId))
    } catch {
      // silently ignore
    } finally {
      setLoadingTaxIds(prev => { const next = new Set(prev); next.delete(saleId); return next })
    }
  }

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
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2 text-right">Cum Shares</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((e, i) => {
              const saleId = e.sale_id ?? null
              const bd = saleId != null ? breakdowns.get(saleId) : undefined
              const isSaleExpanded = saleId != null && expandedSales.has(saleId)
              const isVestingExpanded = expandedVesting.has(i)
              const isLoadingSale = saleId != null && loadingTaxIds.has(saleId)
              const hasST = (e.st_shares ?? 0) > 0
              const is83b = e.event_type === 'Vesting' && e.income > 0 && !!e.election_83b
              const hasVestingTax = e.event_type === 'Vesting' && e.income > 0 && !e.election_83b

              return (
                <>
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
                    <td className="px-3 py-2 text-right">
                      {is83b
                        ? <span className="text-violet-500 dark:text-violet-400">~{fmt$(e.income)}</span>
                        : e.income
                        ? <span className="text-emerald-600 dark:text-emerald-400">{fmt$(e.income)}</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">
                      {e.event_type === 'Loan Payoff' && e.cash_due != null
                        ? <span>
                            {fmt$(e.cash_due)}
                            {' '}
                            <span className={e.status === 'covered' ? 'text-emerald-600' : 'text-orange-500'}>
                              {e.status === 'covered' ? '✓' : '!'}
                            </span>
                          </span>
                        : e.event_type === 'Sale' && e.gross_proceeds != null
                        ? <span className="text-green-600 dark:text-green-400">{fmt$(e.gross_proceeds)}</span>
                        : e.total_cap_gains ? fmt$(e.total_cap_gains) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.event_type === 'Sale' && saleId != null ? (
                        <button
                          onClick={() => toggleSaleTax(saleId)}
                          className="inline-flex items-center gap-1"
                        >
                          {isLoadingSale ? (
                            <span className="text-gray-400">...</span>
                          ) : (
                            <>
                              {hasST && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  ST
                                </span>
                              )}
                              <span className={`underline decoration-dotted ${hasST ? 'text-amber-700 dark:text-amber-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                {e.estimated_tax != null ? fmt$(e.estimated_tax) : '—'}
                              </span>
                            </>
                          )}
                        </button>
                      ) : is83b ? (
                        <button onClick={() => toggleVestingTax(i)}>
                          <span className="text-violet-500 underline decoration-dotted dark:text-violet-400">
                            ~{fmt$(est83bTax(e, ts))}
                          </span>
                        </button>
                      ) : hasVestingTax ? (
                        <button
                          onClick={() => toggleVestingTax(i)}
                        >
                          <span className="text-orange-600 underline decoration-dotted dark:text-orange-400">
                            {fmt$(estTaxForVesting(e, ts))}
                          </span>
                        </button>
                      ) : e.event_type === 'Share Price' ? (
                        <span className="text-xs text-gray-400 dark:text-gray-600">—*</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmtNum(e.cum_shares)}</td>
                  </tr>
                  {isSaleExpanded && bd && (
                    <tr key={`sale-tax-${saleId}`} className="bg-white dark:bg-gray-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <TaxCard breakdown={bd} />
                      </td>
                    </tr>
                  )}
                  {isVestingExpanded && hasVestingTax && (
                    <tr key={`vesting-tax-${i}`} className="bg-white dark:bg-gray-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <VestingTaxCard e={e} ts={ts} />
                      </td>
                    </tr>
                  )}
                  {isVestingExpanded && is83b && (
                    <tr key={`83b-tax-${i}`} className="bg-white dark:bg-gray-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <Unrealized83bCard e={e} ts={ts} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} events &nbsp;·&nbsp; * price appreciation is unrealized — not a taxable event</p>
    </div>
  )
}
