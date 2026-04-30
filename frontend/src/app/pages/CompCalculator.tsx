import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../../api.ts'
import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry, TaxSettings, DashboardData } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import {
  outstandingPrincipalAt,
  averageOutstandingPrincipal,
  averageAnnualInterest,
  annualInterestForYear,
  annualizedAppreciation,
  priceRecordAt,
  computeBase,
  computeWithDeduction,
  computeTaxEquivSalary,
  ordinaryRate,
  capGainsRate,
} from './CompCalculator.math.ts'

interface AllData {
  loans: LoanEntry[]
  payments: LoanPaymentEntry[]
  prices: PriceEntry[]
  sales: SaleEntry[]
  taxSettings: TaxSettings
  dashboard: DashboardData
}

interface YearRow {
  year: number
  principal: number
  interest: number
  appreciation: number
  comp: number
  comp3y: number | null
  comp5y: number | null
  isProjected: boolean
}

function fmt$(n: number): string {
  if (!isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return sign + abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPct(n: number, digits = 2): string {
  return (n * 100).toFixed(digits) + '%'
}

const TODAY = new Date().toISOString().slice(0, 10)
const CURRENT_YEAR = new Date().getFullYear()

interface ChartColors { grid: string; axis: string; tooltipBg: string; tooltipText: string }
function useChartColors(): ChartColors {
  const dark = useDark()
  return dark
    ? { grid: '#1e293b', axis: '#94a3b8', tooltipBg: '#0f172a', tooltipText: '#f1f5f9' }
    : { grid: '#e7e5e4', axis: '#78716c', tooltipBg: '#ffffff', tooltipText: '#1c1917' }
}

function isYearProjected(prices: PriceEntry[], year: number): boolean {
  const end = priceRecordAt(prices, `${year}-12-31`)
  const start = priceRecordAt(prices, `${year - 1}-12-31`)
  return !!(end?.is_estimate || start?.is_estimate)
}

function computeYearRow(
  data: AllData,
  year: number,
  m: number,
  useDeduction: boolean,
): YearRow | null {
  const asOf = `${year}-12-31`
  const appreciation = annualizedAppreciation(data.prices, asOf, 1)
  if (appreciation == null) return null
  const principal = outstandingPrincipalAt(data.loans, data.payments, data.sales, asOf)
  const interest = annualInterestForYear(data.loans, data.payments, data.sales, year)
  const comp = useDeduction
    ? computeWithDeduction(appreciation, principal, interest, m)
    : computeBase(appreciation, principal, interest)

  const rolling = (w: 3 | 5): number | null => {
    const r = annualizedAppreciation(data.prices, asOf, w)
    if (r == null) return null
    const L = averageOutstandingPrincipal(data.loans, data.payments, data.sales, asOf, w)
    const I = averageAnnualInterest(data.loans, data.payments, data.sales, asOf, w)
    return useDeduction ? computeWithDeduction(r, L, I, m) : computeBase(r, L, I)
  }

  return {
    year,
    principal,
    interest,
    appreciation,
    comp,
    comp3y: rolling(3),
    comp5y: rolling(5),
    isProjected: isYearProjected(data.prices, year),
  }
}

interface ChartTooltipPayload {
  payload: YearRow
}
function ChartTooltip({ active, payload, label, c, useDeduction }: {
  active?: boolean
  payload?: ChartTooltipPayload[]
  label?: number
  c: ChartColors
  useDeduction: boolean
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div
      className="rounded-md border px-2 py-1.5 text-[11px] shadow-sm"
      style={{ background: c.tooltipBg, color: c.tooltipText, borderColor: c.grid }}
    >
      <p className="font-semibold tabular-nums">{label}{row.isProjected ? ' · projected' : ''}</p>
      <p className="tabular-nums">Net comp: {fmt$(row.comp)}</p>
      <p className="tabular-nums opacity-80">Appreciation: {fmtPct(row.appreciation)}</p>
      <p className="tabular-nums opacity-80">Interest: {fmt$(row.interest)}</p>
      {useDeduction && <p className="opacity-60">After interest deduction</p>}
    </div>
  )
}

function YearDetailPanel({ row, m, c, useDeduction, year }: {
  row: YearRow | null
  m: number
  c: number
  useDeduction: boolean
  year: number
}) {
  if (!row) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Not enough price history to compute comp for {year}. Pick a different year on the chart, or add a Dec 31 price for {year - 1} and {year} in <em>Settings → Prices</em>.
      </div>
    )
  }
  const gain = row.appreciation * row.principal
  const interestCost = useDeduction ? row.interest * (1 - m) : row.interest
  const afterTax = row.comp * (1 - c)
  const equivSalary = computeTaxEquivSalary(row.comp, c, m)
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
          {row.year}{row.year === CURRENT_YEAR ? ' · current year' : ''}
        </p>
        {row.isProjected && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            Projected
          </span>
        )}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{fmt$(row.comp)}</p>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">net compensation in {row.year}</p>

      <dl className="mt-4 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600 dark:text-slate-300">Stock appreciation in {row.year}</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmtPct(row.appreciation)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600 dark:text-slate-300">Loan principal (Dec 31, {row.year})</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(row.principal)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-rose-200 pt-1.5 dark:border-rose-800">
          <dt className="text-gray-600 dark:text-slate-300">Gain on principal</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(gain)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600 dark:text-slate-300">
            Interest paid in {row.year}{useDeduction ? ' (after deduction)' : ''}
          </dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">−{fmt$(interestCost)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-rose-200 pt-1.5 dark:border-rose-800">
          <dt className="font-semibold text-gray-900 dark:text-slate-100">Net comp</dt>
          <dd className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">{fmt$(row.comp)}</dd>
        </div>
      </dl>

      <dl className="mt-4 space-y-1.5 border-t border-rose-200 pt-3 text-xs dark:border-rose-800">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600 dark:text-slate-300">After capital gains tax ({fmtPct(c, 1)})</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(afterTax)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600 dark:text-slate-300">Equivalent pretax salary (ordinary income {fmtPct(m, 1)})</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(equivSalary)}</dd>
        </div>
      </dl>

      {(row.comp3y != null || row.comp5y != null) && (
        <dl className="mt-4 space-y-1.5 border-t border-rose-200 pt-3 text-xs dark:border-rose-800">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Smoothed across recent years</p>
          {row.comp3y != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600 dark:text-slate-300">3-year rolling average</dt>
              <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(row.comp3y)} / yr</dd>
            </div>
          )}
          {row.comp5y != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-600 dark:text-slate-300">5-year rolling average</dt>
              <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(row.comp5y)} / yr</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

export default function CompCalculator() {
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const fetcher = useCallback(async (): Promise<AllData> => {
    const [loans, prices, sales, taxSettings, dashboard, payments] = await Promise.all([
      vid ? api.getSharedLoans(vid) : api.getLoans(),
      vid ? api.getSharedPrices(vid) : api.getPrices(),
      vid ? api.getSharedSales(vid) : api.getSales(),
      vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(),
      vid ? api.getSharedDashboard(vid) : api.getDashboard(),
      vid ? Promise.resolve([] as LoanPaymentEntry[]) : api.getLoanPayments(),
    ])
    return { loans, payments, prices, sales, taxSettings, dashboard }
  }, [vid])
  const { data, loading, error } = useApiData<AllData>(fetcher)

  const [deductOn, setDeductOn] = useState<boolean>(false)
  const [show3y, setShow3y] = useState<boolean>(false)
  const [show5y, setShow5y] = useState<boolean>(false)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [explainerOpen, setExplainerOpen] = useState<boolean>(false)

  useEffect(() => {
    if (data?.taxSettings) setDeductOn(data.taxSettings.deduct_investment_interest)
  }, [data])

  const m = data ? ordinaryRate(data.taxSettings) : 0
  const c = data ? capGainsRate(data.taxSettings) : 0
  const chartColors = useChartColors()

  const rows: YearRow[] = useMemo(() => {
    if (!data) return []
    const years = new Set<number>()
    for (const l of data.loans) years.add(l.loan_year)
    for (const p of data.prices) years.add(parseInt(p.effective_date.slice(0, 4)))
    if (!years.size) return []
    const min = Math.min(...years)
    const max = Math.max(...years)
    const out: YearRow[] = []
    for (let y = min; y <= max; y++) {
      const row = computeYearRow(data, y, m, deductOn)
      if (row) out.push(row)
    }
    return out
  }, [data, m, deductOn])

  useEffect(() => {
    if (!rows.length) return
    if (selectedYear != null && rows.some(r => r.year === selectedYear)) return
    const current = rows.find(r => r.year === CURRENT_YEAR)
    setSelectedYear(current ? current.year : rows[rows.length - 1].year)
  }, [rows, selectedYear])

  if (loading) return <p className="text-xs text-gray-500 dark:text-slate-400">Loading…</p>
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">Error: {error}</p>
  if (!data) return null

  const selectedRow = selectedYear != null ? rows.find(r => r.year === selectedYear) ?? null : null
  const hasProjected = rows.some(r => r.isProjected)

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Total Comp Calculator</h1>

      <div className="rounded-lg border border-stone-200 bg-stone-50 dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setExplainerOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-700 dark:text-slate-200"
        >
          <span>What is this?</span>
          <span className="text-gray-400 dark:text-slate-500">{explainerOpen ? '▲' : '▼'}</span>
        </button>
        {explainerOpen && (
          <div className="border-t border-stone-200 px-4 py-3 text-xs leading-relaxed text-gray-600 dark:border-slate-700 dark:text-slate-300">
            <p className="mb-2">
              Epic's stock purchase program isn't a salary or a free stock grant — it's a low-rate <strong>loan</strong>{' '}
              Epic gives you to buy company stock. That makes it hard to compare with offers structured as cash + RSUs.
            </p>
            <p className="mb-2">In one number, your annual comp from the program is:</p>
            <p className="font-mono text-[11px]">net comp = (stock appreciation %) × (loan principal) − (interest paid)</p>
            <p className="mt-2">
              The chart below shows that figure for every year we have price data for. Click a bar to see the breakdown.
              Toggle the rolling-average overlays to smooth out spikes from Epic's annual repricing.
            </p>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Not enough price history yet. Add Dec 31 prices for at least two consecutive years in <em>Settings → Prices</em> to see comp by year.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="mr-auto text-xs font-medium text-gray-700 dark:text-slate-200">Net comp by year</p>
              <button
                type="button"
                onClick={() => setShow3y(s => !s)}
                title="Toggle 3-year rolling average"
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${show3y
                  ? 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300'
                  : 'border-stone-300 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}
              >
                3-year average
              </button>
              <button
                type="button"
                onClick={() => setShow5y(s => !s)}
                title="Toggle 5-year rolling average"
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${show5y
                  ? 'border-purple-400 bg-purple-100 text-purple-800 dark:border-purple-600 dark:bg-purple-950/40 dark:text-purple-300'
                  : 'border-stone-300 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}
              >
                5-year average
              </button>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart
                data={rows}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                onClick={(state: { activeLabel?: string | number }) => {
                  if (state?.activeLabel != null) {
                    const y = typeof state.activeLabel === 'number' ? state.activeLabel : parseInt(String(state.activeLabel))
                    if (!isNaN(y)) setSelectedYear(y)
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: chartColors.axis }} />
                <YAxis
                  tick={{ fontSize: 10, fill: chartColors.axis }}
                  tickFormatter={(v: number) => v >= 1000 || v <= -1000 ? `${Math.round(v / 1000)}k` : `${v}`}
                />
                <Tooltip content={<ChartTooltip c={chartColors} useDeduction={deductOn} />} cursor={{ fill: 'rgba(225, 29, 72, 0.08)' }} />
                <ReferenceLine y={0} stroke={chartColors.axis} strokeWidth={1} />
                {rows.some(r => r.year === CURRENT_YEAR) && (
                  <ReferenceLine x={CURRENT_YEAR} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />
                )}
                <Bar dataKey="comp" name="Net comp" radius={[2, 2, 0, 0]}>
                  {rows.map(r => {
                    const selected = r.year === selectedYear
                    const baseFill = selected ? '#9f1239' : '#e11d48'
                    return (
                      <Cell
                        key={r.year}
                        fill={baseFill}
                        fillOpacity={r.isProjected ? 0.35 : 1}
                        stroke={r.isProjected ? '#e11d48' : 'none'}
                        strokeDasharray={r.isProjected ? '3 2' : undefined}
                        strokeWidth={r.isProjected ? 1 : 0}
                      />
                    )
                  })}
                </Bar>
                {show3y && (
                  <Line type="monotone" dataKey="comp3y" name="3-year average" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls />
                )}
                {show5y && (
                  <Line type="monotone" dataKey="comp5y" name="5-year average" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[10px] text-gray-500 dark:text-slate-500">
              Click a bar for that year's breakdown.{hasProjected ? ' Striped, lighter bars are projected (use estimated prices).' : ''}
            </p>
          </div>

          <YearDetailPanel
            row={selectedRow}
            m={m}
            c={c}
            useDeduction={deductOn}
            year={selectedYear ?? CURRENT_YEAR}
          />

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={deductOn}
              onChange={e => setDeductOn(e.target.checked)}
              className="rounded"
            />
            <div>
              <p className="text-xs font-medium text-gray-900 dark:text-slate-100">Deduct loan interest as investment-interest expense</p>
              <p className="mt-0.5 text-[10px] text-gray-500 dark:text-slate-400">
                If you itemize and use Form 4952, your interest cost is reduced by your marginal ordinary income rate ({fmtPct(m, 1)}).
              </p>
            </div>
          </label>

          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <p>
              <strong>Equivalent pretax salary</strong> is what you'd need in pretax salary (taxed at your ordinary income rate of{' '}
              <strong>{fmtPct(m, 1)}</strong>) to net the same after-tax dollars as this comp (taxed at your blended long-term capital gains rate of <strong>{fmtPct(c, 1)}</strong>). Tweak rates in <em>Settings → Tax Rates</em>.
            </p>
            <p className="mt-2 text-gray-500 dark:text-slate-400">
              Estimates only — actual outcomes depend on AMT, state rules, and how your investment-interest deduction interacts with the rest of your return.
            </p>
          </div>
        </>
      )}

      <footer className="pt-4 text-center text-[10px] text-gray-400 dark:text-slate-500">
        As of {TODAY}. All calculations are local to your browser.
      </footer>
    </div>
  )
}
