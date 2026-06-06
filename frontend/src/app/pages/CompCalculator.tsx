import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
 Bar, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine,
 ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../../api.ts'
import type { GrantEntry, LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry, TaxSettings, DashboardData } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import {
 outstandingPrincipalAt,
 averageOutstandingPrincipal,
 averageAdjustedPrincipal,
 averageAnnualInterest,
 annualInterestForYear,
 annualizedAppreciation,
 unvestedPrincipalAt,
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
 grants: GrantEntry[]
}

type CompEntries = Record<string, { salary?: number | null; bonus?: number | null }>

interface YearRow {
 year: number
 principal: number
 unvestedPrincipal: number
 interest: number
 appreciation: number
 comp: number
 comp3y: number | null
 comp5y: number | null
 taxEquiv: number
 taxEquiv3y: number | null
 taxEquiv5y: number | null
 isProjected: boolean
 afterExit: boolean
 salary: number
 bonus: number
 totalComp: number
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
 ? { grid: '#252220', axis: '#A8998F', tooltipBg: '#1C1917', tooltipText: '#F2EDE8' }
 : { grid: '#EAE7E3', axis: '#6B5F58', tooltipBg: '#ffffff', tooltipText: '#1A1411' }
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
 c: number,
 useDeduction: boolean,
 exitDate: string | null,
 compEntries: CompEntries,
): YearRow | null {
 const asOf = `${year}-12-31`
 const appreciation = annualizedAppreciation(data.prices, asOf, 1)
 if (appreciation == null) return null

 const exitYear = exitDate ? parseInt(exitDate.slice(0, 4)) : null
 const afterExit = exitYear != null && year > exitYear
 const entry = compEntries[String(year)]
 const salary = entry?.salary ?? 0
 const bonus = entry?.bonus ?? 0

 if (afterExit) {
 return {
 year,
 principal: 0,
 unvestedPrincipal: 0,
 interest: 0,
 appreciation,
 comp: 0,
 comp3y: null,
 comp5y: null,
 taxEquiv: 0,
 taxEquiv3y: null,
 taxEquiv5y: null,
 isProjected: isYearProjected(data.prices, year),
 afterExit: true,
 salary,
 bonus,
 totalComp: 0,
 }
 }

 const rawPrincipal = outstandingPrincipalAt(data.loans, data.payments, data.sales, asOf)
 const unvestedPrincipal = exitDate
 ? unvestedPrincipalAt(data.loans, data.payments, data.sales, data.grants, asOf, exitDate)
 : 0
 const principal = Math.max(0, rawPrincipal - unvestedPrincipal)
 const interest = annualInterestForYear(data.loans, data.payments, data.sales, year)
 const comp = useDeduction
 ? computeWithDeduction(appreciation, principal, interest, m)
 : computeBase(appreciation, principal, interest)

 const rolling = (w: 3 | 5): number | null => {
 const r = annualizedAppreciation(data.prices, asOf, w)
 if (r == null) return null
 const L = exitDate
 ? averageAdjustedPrincipal(data.loans, data.payments, data.sales, data.grants, asOf, w, exitDate)
 : averageOutstandingPrincipal(data.loans, data.payments, data.sales, asOf, w)
 const I = averageAnnualInterest(data.loans, data.payments, data.sales, asOf, w)
 return useDeduction ? computeWithDeduction(r, L, I, m) : computeBase(r, L, I)
 }

 const comp3y = rolling(3)
 const comp5y = rolling(5)

 return {
 year,
 principal,
 unvestedPrincipal,
 interest,
 appreciation,
 comp,
 comp3y,
 comp5y,
 taxEquiv: computeTaxEquivSalary(comp, c, m),
 taxEquiv3y: comp3y != null ? computeTaxEquivSalary(comp3y, c, m) : null,
 taxEquiv5y: comp5y != null ? computeTaxEquivSalary(comp5y, c, m) : null,
 isProjected: isYearProjected(data.prices, year),
 afterExit: false,
 salary,
 bonus,
 totalComp: comp + salary + bonus,
 }
}

interface ChartTooltipPayload {
 payload: YearRow
}
function ChartTooltip({ active, payload, label, c, useDeduction, m, taxEquivView }: {
 active?: boolean
 payload?: ChartTooltipPayload[]
 label?: number
 c: ChartColors
 useDeduction: boolean
 m: number
 taxEquivView: boolean
}) {
 if (!active || !payload?.length) return null
 const row = payload[0].payload
 const interestCost = useDeduction ? row.interest * (1 - m) : row.interest
 return (
 <div
 className="rounded-md border px-2 py-1.5 text-[11px] shadow-sm"
 style={{ background: c.tooltipBg, color: c.tooltipText, borderColor: c.grid }}
 >
 <p className="font-semibold tabular-nums">{label}{row.isProjected ? ' · projected' : ''}</p>
 {taxEquivView ? (
 <p className="tabular-nums">Tax equiv salary: {fmt$(row.taxEquiv)}</p>
 ) : (
 <p className="tabular-nums">Net comp: {fmt$(row.comp)}</p>
 )}
 <p className="tabular-nums opacity-80">Appreciation: {fmtPct(row.appreciation)}</p>
 <p className="tabular-nums opacity-80">
 Interest{useDeduction ? ' (after deduction)' : ''}: {fmt$(interestCost)}
 </p>
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
 <div className="rounded-lg border border-cs-border bg-cs-raised p-4 text-xs text-cs-text-2 ">
 Not enough price history to compute comp for {year}. Pick a different year on the chart, or add a Dec 31 price for {year - 1} and {year} in <em>Settings → Prices</em>.
 </div>
 )
 }
 if (row.afterExit) {
 return (
 <div className="rounded-lg border border-cs-border bg-cs-raised p-4 text-xs text-cs-text-2 ">
 <p className="font-medium text-cs-text-2">After planned exit — no compensation realized in {year}.</p>
 <p className="mt-1">Unvested shares are sold back at cost basis on exit; appreciation after your exit date is not realized.</p>
 </div>
 )
 }
 const gain = row.appreciation * row.principal
 const taxBenefit = row.interest * m
 const interestCost = useDeduction ? row.interest - taxBenefit : row.interest
 const afterTax = row.comp * (1 - c)
 return (
 <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30">
 <div className="flex items-baseline justify-between gap-2">
 <p className="text-xs font-semibold uppercase tracking-wide text-cs-brand">
 {row.year}{row.year === CURRENT_YEAR ? ' · current year' : ''}
 </p>
 {row.isProjected && (
 <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
 Projected
 </span>
 )}
 </div>
 <p className="mt-1 text-3xl font-bold tabular-nums text-cs-text">{fmt$(row.comp)}</p>
 <p className="mt-0.5 text-[11px] text-cs-muted">net compensation in {row.year}</p>

 <dl className="mt-4 space-y-1.5 text-xs">
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Stock appreciation in {row.year}</dt>
 <dd className="tabular-nums text-cs-text">{fmtPct(row.appreciation)}</dd>
 </div>
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">
 {row.unvestedPrincipal > 0 ? `Vested loan principal (Dec 31, ${row.year})` : `Loan principal (Dec 31, ${row.year})`}
 </dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.principal)}</dd>
 </div>
 {row.unvestedPrincipal > 0 && (
 <div className="flex justify-between gap-2 pl-3 text-[11px]">
 <dt className="text-cs-muted">Unvested principal excluded (early exit)</dt>
 <dd className="tabular-nums text-cs-muted">−{fmt$(row.unvestedPrincipal)}</dd>
 </div>
 )}
 <div className="flex justify-between gap-2 border-t border-rose-200 pt-1.5 dark:border-rose-800">
 <dt className="text-cs-text-2">Gain on principal</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(gain)}</dd>
 </div>
 {useDeduction ? (
 <>
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Interest paid in {row.year}</dt>
 <dd className="tabular-nums text-cs-text">−{fmt$(row.interest)}</dd>
 </div>
 <div className="flex justify-between gap-2 pl-3 text-[11px]">
 <dt className="text-cs-muted">
 Tax benefit ({fmtPct(m, 1)} × {fmt$(row.interest)})
 </dt>
 <dd className="tabular-nums text-emerald-700 dark:text-emerald-400">+{fmt$(taxBenefit)}</dd>
 </div>
 <div className="flex justify-between gap-2 pl-3 text-[11px]">
 <dt className="text-cs-muted">Net interest cost</dt>
 <dd className="tabular-nums text-cs-text-2">−{fmt$(interestCost)}</dd>
 </div>
 </>
 ) : (
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Interest paid in {row.year}</dt>
 <dd className="tabular-nums text-cs-text">−{fmt$(interestCost)}</dd>
 </div>
 )}
 <div className="flex justify-between gap-2 border-t border-rose-200 pt-1.5 dark:border-rose-800">
 <dt className="font-semibold text-cs-text">Net comp</dt>
 <dd className="font-semibold tabular-nums text-cs-text">{fmt$(row.comp)}</dd>
 </div>
 </dl>

 <dl className="mt-4 space-y-1.5 border-t border-rose-200 pt-3 text-xs dark:border-rose-800">
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">After capital gains tax ({fmtPct(c, 1)})</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(afterTax)}</dd>
 </div>
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Equivalent pretax salary (ordinary income {fmtPct(m, 1)})</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.taxEquiv)}</dd>
 </div>
 </dl>

 {(row.salary > 0 || row.bonus > 0) && (
 <dl className="mt-4 space-y-1.5 border-t border-rose-200 pt-3 text-xs dark:border-rose-800">
 <p className="text-[10px] uppercase tracking-wide text-cs-muted">Total compensation</p>
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Net Epic stock comp</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.comp)}</dd>
 </div>
 {row.salary > 0 && (
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Base salary</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.salary)}</dd>
 </div>
 )}
 {row.bonus > 0 && (
 <div className="flex justify-between gap-2">
 <dt className="text-cs-text-2">Bonus</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.bonus)}</dd>
 </div>
 )}
 <div className="flex justify-between gap-2 border-t border-rose-200 pt-1.5 font-semibold dark:border-rose-800">
 <dt className="text-cs-text">Total comp</dt>
 <dd className="tabular-nums text-cs-text">{fmt$(row.totalComp)}</dd>
 </div>
 </dl>
 )}

 {(row.comp3y != null || row.comp5y != null) && (
 <dl className="mt-4 space-y-1.5 border-t border-rose-200 pt-3 text-xs dark:border-rose-800">
 <p className="text-[10px] uppercase tracking-wide text-cs-muted">Smoothed across recent years</p>
 {row.comp3y != null && (
 <div className="space-y-0.5">
 <p className="font-medium text-cs-text-2">3-year rolling average</p>
 <div className="flex justify-between gap-2 pl-2 text-[11px]">
 <dt className="text-cs-text-2">Equiv. pretax salary</dt>
 <dd className="font-medium tabular-nums text-cs-text">{fmt$(row.taxEquiv3y ?? 0)} / yr</dd>
 </div>
 <div className="flex justify-between gap-2 pl-2 text-[11px]">
 <dt className="text-cs-muted">Net comp</dt>
 <dd className="tabular-nums text-cs-muted">{fmt$(row.comp3y)} / yr</dd>
 </div>
 </div>
 )}
 {row.comp5y != null && (
 <div className="space-y-0.5">
 <p className="font-medium text-cs-text-2">5-year rolling average</p>
 <div className="flex justify-between gap-2 pl-2 text-[11px]">
 <dt className="text-cs-text-2">Equiv. pretax salary</dt>
 <dd className="font-medium tabular-nums text-cs-text">{fmt$(row.taxEquiv5y ?? 0)} / yr</dd>
 </div>
 <div className="flex justify-between gap-2 pl-2 text-[11px]">
 <dt className="text-cs-muted">Net comp</dt>
 <dd className="tabular-nums text-cs-muted">{fmt$(row.comp5y)} / yr</dd>
 </div>
 </div>
 )}
 </dl>
 )}
 </div>
 )
}

function parseDollar(raw: string): number | null {
 const cleaned = raw.replace(/[$,\s]/g, '')
 if (cleaned === '' || cleaned === '-') return null
 const n = parseFloat(cleaned)
 return isFinite(n) ? n : null
}

function SalaryBonusTable({ rows, compEntries, readOnly, onChange }: {
 rows: YearRow[]
 compEntries: CompEntries
 readOnly: boolean
 onChange: (year: number, field: 'salary' | 'bonus', value: number | null) => void
}) {
 const [open, setOpen] = useState(false)
 const yearsWithData = rows.filter(r => !r.afterExit)
 const hasAnyData = yearsWithData.some(r => r.salary > 0 || r.bonus > 0)

 return (
 <div className="rounded-lg border border-cs-border bg-cs-raised ">
 <button
 type="button"
 onClick={() => setOpen(o => !o)}
 className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-cs-text-2"
 >
 <span>
 Salary & bonus
 {hasAnyData && <span className="ml-2 rounded-full bg-cs-brand/10 px-1.5 py-0.5 text-[10px] text-cs-brand">data entered</span>}
 </span>
 <span className="text-cs-muted">{open ? '▲' : '▼'}</span>
 </button>
 {open && (
 <div className="border-t border-cs-border px-4 pb-4 pt-3">
 <p className="mb-3 text-[11px] text-cs-text-2">
 {readOnly
 ? 'Base salary and bonus by year. When filled in, the detail panel shows total compensation.'
 : 'Enter your base salary and bonus for each year. When filled in, the detail panel shows total comp (Epic stock comp + salary + bonus). Saved automatically.'}
 </p>
 <div className="overflow-x-auto">
 <table className="w-full text-xs">
 <thead>
 <tr className="border-b border-cs-border text-left">
 <th className="pb-1.5 pr-3 font-medium text-cs-text-2">Year</th>
 <th className="pb-1.5 pr-3 font-medium text-cs-text-2">Base salary</th>
 <th className="pb-1.5 font-medium text-cs-text-2">Bonus</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-cs-border">
 {yearsWithData.map(row => {
 const entry = compEntries[String(row.year)] ?? {}
 return (
 <tr key={row.year}>
 <td className="py-1.5 pr-3 tabular-nums text-cs-text-2">{row.year}</td>
 <td className="py-1 pr-3">
 {readOnly ? (
 <span className="tabular-nums text-cs-text">
 {entry.salary != null && entry.salary > 0 ? fmt$(entry.salary) : '—'}
 </span>
 ) : (
 <input
 type="text"
 inputMode="numeric"
 placeholder="$0"
 defaultValue={entry.salary != null && entry.salary > 0 ? String(entry.salary) : ''}
 key={`${row.year}-salary-${entry.salary ?? ''}`}
 onBlur={e => onChange(row.year, 'salary', parseDollar(e.target.value))}
 className="w-28 rounded border border-cs-border-strong bg-cs-surface px-2 py-0.5 tabular-nums text-cs-text placeholder-cs-muted focus:border-rose-400 focus:outline-none"
 />
 )}
 </td>
 <td className="py-1">
 {readOnly ? (
 <span className="tabular-nums text-cs-text">
 {entry.bonus != null && entry.bonus > 0 ? fmt$(entry.bonus) : '—'}
 </span>
 ) : (
 <input
 type="text"
 inputMode="numeric"
 placeholder="$0"
 defaultValue={entry.bonus != null && entry.bonus > 0 ? String(entry.bonus) : ''}
 key={`${row.year}-bonus-${entry.bonus ?? ''}`}
 onBlur={e => onChange(row.year, 'bonus', parseDollar(e.target.value))}
 className="w-28 rounded border border-cs-border-strong bg-cs-surface px-2 py-0.5 tabular-nums text-cs-text placeholder-cs-muted focus:border-rose-400 focus:outline-none"
 />
 )}
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 )
}

export default function CompCalculator() {
 const { viewing } = useViewing()
 const vid = viewing?.invitationId
 const fetcher = useCallback(async (): Promise<AllData> => {
 const [loans, prices, sales, taxSettings, dashboard, payments, grants] = await Promise.all([
 vid ? api.getSharedLoans(vid) : api.getLoans(),
 vid ? api.getSharedPrices(vid) : api.getPrices(),
 vid ? api.getSharedSales(vid) : api.getSales(),
 vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(),
 vid ? api.getSharedDashboard(vid) : api.getDashboard(),
 vid ? Promise.resolve([] as LoanPaymentEntry[]) : api.getLoanPayments(),
 vid ? api.getSharedGrants(vid) : api.getGrants(),
 ])
 return { loans, payments, prices, sales, taxSettings, dashboard, grants }
 }, [vid])
 const { data, loading, error } = useApiData<AllData>(fetcher)

 const [deductOn, setDeductOn] = useState<boolean>(false)
 const [show3y, setShow3y] = useState<boolean>(false)
 const [show5y, setShow5y] = useState<boolean>(false)
 const [taxEquivView, setTaxEquivView] = useState<boolean>(false)
 const [selectedYear, setSelectedYear] = useState<number | null>(null)
 const [explainerOpen, setExplainerOpen] = useState<boolean>(false)
 const [exitDate, setExitDate] = useState<string | null>(null)
 const [compEntries, setCompEntries] = useState<CompEntries>({})
 const [compEntriesDirty, setCompEntriesDirty] = useState(false)
 const retirementParamsRef = useRef<Record<string, unknown>>({})

 useEffect(() => {
 if (data?.taxSettings) setDeductOn(data.taxSettings.deduct_investment_interest)
 }, [data])

 useEffect(() => {
 const load = vid
 ? api.getSharedRetirementParams(vid)
 : api.getRetirementParams()
 load.then(r => {
 const params = (r.params ?? {}) as Record<string, unknown>
 retirementParamsRef.current = params
 if (typeof params.retirementDate === 'string' && params.retirementDate) {
 setExitDate(params.retirementDate)
 }
 }).catch(() => {})
 }, [vid])

 useEffect(() => {
 const load = vid ? api.getSharedCompEntries(vid) : api.getCompEntries()
 load.then(r => setCompEntries(r.entries)).catch(() => {})
 }, [vid])

 useEffect(() => {
 if (vid || !compEntriesDirty) return
 const t = setTimeout(() => {
 api.saveCompEntries(compEntries).catch(() => {})
 }, 500)
 return () => clearTimeout(t)
 }, [compEntries, compEntriesDirty, vid])

 function handleExitDateChange(date: string | null) {
 setExitDate(date)
 if (!vid) {
 const merged = { ...retirementParamsRef.current }
 if (date) {
 merged.retirementDate = date
 } else {
 delete merged.retirementDate
 }
 retirementParamsRef.current = merged
 api.saveRetirementParams(merged).catch(() => {})
 }
 }

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
 const row = computeYearRow(data, y, m, c, deductOn, exitDate, compEntries)
 if (row) out.push(row)
 }
 return out
 }, [data, m, c, deductOn, exitDate, compEntries])

 useEffect(() => {
 if (!rows.length) return
 if (selectedYear != null && rows.some(r => r.year === selectedYear)) return
 const current = rows.find(r => r.year === CURRENT_YEAR)
 setSelectedYear(current ? current.year : rows[rows.length - 1].year)
 }, [rows, selectedYear])

 if (loading) return <p className="text-xs text-cs-muted">Loading…</p>
 if (error) return <p className="text-xs text-red-600 dark:text-red-400">Error: {error}</p>
 if (!data) return null

 const selectedRow = selectedYear != null ? rows.find(r => r.year === selectedYear) ?? null : null
 const hasProjected = rows.some(r => r.isProjected)

 return (
 <div className="space-y-5">
 <h1 className="text-lg font-bold text-cs-text">Total Comp Calculator</h1>

 <div className="rounded-lg border border-cs-border bg-cs-raised ">
 <button
 type="button"
 onClick={() => setExplainerOpen(o => !o)}
 className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-cs-text-2"
 >
 <span>What is this?</span>
 <span className="text-cs-muted">{explainerOpen ? '▲' : '▼'}</span>
 </button>
 {explainerOpen && (
 <div className="border-t border-cs-border px-4 py-3 text-xs leading-relaxed text-cs-text-2 ">
 <p className="mb-2">
 Epic's stock purchase program isn't a salary or a free stock grant — it's a low-rate <strong>loan</strong>{' '}
 Epic gives you to buy company stock. That makes it hard to compare with offers structured as cash + RSUs.
 </p>
 <p className="mb-2">In one number, your annual comp from the program is:</p>
 <p className="font-mono text-[11px]">net comp = (stock appreciation %) × (loan principal) − (interest paid)</p>
 <p className="mt-2">
 The chart below shows that figure for every year we have price data for. Pick a year (or click a bar) to see the breakdown.
 Toggle the rolling-average overlays to smooth out spikes from Epic's annual repricing.
 </p>
 </div>
 )}
 </div>

 <div className="flex flex-wrap items-center gap-3 rounded-lg border border-cs-border bg-cs-surface p-3 ">
 <label className="flex items-center gap-2 text-xs font-medium text-cs-text">
 <span>Planned exit date</span>
 <input
 type="date"
 value={exitDate ?? ''}
 onChange={e => handleExitDateChange(e.target.value || null)}
 disabled={!!vid}
 className="rounded border border-cs-border-strong bg-cs-surface px-2 py-0.5 text-xs tabular-nums text-cs-text-2 disabled:opacity-50"
 />
 </label>
 {exitDate && !vid && (
 <button
 type="button"
 onClick={() => handleExitDateChange(null)}
 className="text-xs text-cs-muted hover:text-cs-text-2 "
 >
 Clear
 </button>
 )}
 <p className="text-[10px] text-cs-muted">
 {exitDate
 ? 'Comp reduced for shares that would not vest before this date. Synced with Retirement tab.'
 : 'Optional · synced with Retirement tab · excludes unvested shares from comp calculations'}
 </p>
 </div>

 {rows.length > 0 && (
 <SalaryBonusTable
 rows={rows}
 compEntries={compEntries}
 readOnly={!!vid}
 onChange={(year, field, value) => {
 setCompEntries(prev => ({
 ...prev,
 [String(year)]: { ...prev[String(year)], [field]: value },
 }))
 setCompEntriesDirty(true)
 }}
 />
 )}

 {rows.length === 0 ? (
 <div className="rounded-lg border border-cs-border bg-cs-surface p-4 text-xs text-cs-muted ">
 Not enough price history yet. Add Dec 31 prices for at least two consecutive years in <em>Settings → Prices</em> to see comp by year.
 </div>
 ) : (
 <>
 <div className="rounded-lg border border-cs-border bg-cs-surface p-4 ">
 <div className="mb-2 flex flex-wrap items-center gap-2">
 <p className="text-xs font-medium text-cs-text-2">
 {taxEquivView ? 'Tax-equivalent salary by year' : 'Net comp by year'}
 </p>
 <label className="ml-auto flex items-center gap-1.5 text-[11px] text-cs-text-2">
 <span>Year</span>
 <select
 value={selectedYear ?? ''}
 onChange={e => {
 const y = parseInt(e.target.value)
 if (!isNaN(y)) setSelectedYear(y)
 }}
 className="rounded border border-cs-border-strong bg-cs-surface px-1.5 py-0.5 text-[11px] tabular-nums text-cs-text-2 "
 >
 {rows.map(r => (
 <option key={r.year} value={r.year}>
 {r.year}{r.isProjected ? ' (projected)' : ''}
 </option>
 ))}
 </select>
 </label>
 <button
 type="button"
 onClick={() => setTaxEquivView(s => !s)}
 title="Show tax-equivalent salary"
 className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${taxEquivView
 ? 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
 : 'border-cs-border-strong bg-cs-surface text-cs-text-2 '}`}
 >
 Tax equiv $
 </button>
 <button
 type="button"
 onClick={() => setShow3y(s => !s)}
 title="Toggle 3-year rolling average"
 className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${show3y
 ? 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300'
 : 'border-cs-border-strong bg-cs-surface text-cs-text-2 '}`}
 >
 3-year average
 </button>
 <button
 type="button"
 onClick={() => setShow5y(s => !s)}
 title="Toggle 5-year rolling average"
 className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${show5y
 ? 'border-purple-400 bg-purple-100 text-purple-800 dark:border-purple-600 dark:bg-purple-950/40 dark:text-purple-300'
 : 'border-cs-border-strong bg-cs-surface text-cs-text-2 '}`}
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
 <Tooltip content={<ChartTooltip c={chartColors} useDeduction={deductOn} m={m} taxEquivView={taxEquivView} />} cursor={{ fill: 'rgba(225, 29, 72, 0.08)' }} />
 <ReferenceLine y={0} stroke={chartColors.axis} strokeWidth={1} />
 {rows.some(r => r.year === CURRENT_YEAR) && (
 <ReferenceLine x={CURRENT_YEAR} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />
 )}
 {exitDate && (
 <ReferenceLine x={parseInt(exitDate.slice(0, 4))} stroke="#6366f1" strokeDasharray="4 4" label={{ value: 'Exit', fontSize: 10, fill: '#6366f1', position: 'insideTopRight' }} />
 )}
 <Bar dataKey={taxEquivView ? 'taxEquiv' : 'comp'} name={taxEquivView ? 'Tax equiv salary' : 'Net comp'} radius={[2, 2, 0, 0]}>
 {rows.map(r => {
 const selected = r.year === selectedYear
 const baseFill = r.afterExit ? '#9ca3af' : (selected ? '#9f1239' : '#e11d48')
 const faded = r.isProjected || r.afterExit
 return (
 <Cell
 key={r.year}
 fill={baseFill}
 fillOpacity={faded ? 0.4 : 1}
 stroke={faded ? baseFill : 'none'}
 strokeDasharray={faded ? '3 2' : undefined}
 strokeWidth={faded ? 1 : 0}
 />
 )
 })}
 </Bar>
 {show3y && (
 <Line type="monotone" dataKey={taxEquivView ? 'taxEquiv3y' : 'comp3y'} name="3-year average" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls />
 )}
 {show5y && (
 <Line type="monotone" dataKey={taxEquivView ? 'taxEquiv5y' : 'comp5y'} name="5-year average" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />
 )}
 </ComposedChart>
 </ResponsiveContainer>
 <p className="mt-1 text-[10px] text-cs-muted">
 Pick a year above or click a bar to see its breakdown.
 {hasProjected ? ' Striped, lighter bars use estimated prices.' : ''}
 {rows.some(r => r.afterExit) ? ' Gray bars are after your planned exit (comp not realized).' : ''}
 </p>
 </div>

 <YearDetailPanel
 row={selectedRow}
 m={m}
 c={c}
 useDeduction={deductOn}
 year={selectedYear ?? CURRENT_YEAR}
 />

 <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-cs-border bg-cs-surface p-3 ">
 <input
 type="checkbox"
 checked={deductOn}
 onChange={e => setDeductOn(e.target.checked)}
 className="rounded"
 />
 <div>
 <p className="text-xs font-medium text-cs-text">Deduct loan interest as investment-interest expense</p>
 <p className="mt-0.5 text-[10px] text-cs-muted">
 If you itemize and use Form 4952, your interest cost is reduced by your marginal ordinary income rate ({fmtPct(m, 1)}).
 </p>
 </div>
 </label>

 <div className="rounded-lg border border-cs-border bg-cs-raised p-4 text-xs leading-relaxed text-cs-text-2 ">
 <p>
 <strong>Equivalent pretax salary</strong> is what you'd need in pretax salary (taxed at your ordinary income rate of{' '}
 <strong>{fmtPct(m, 1)}</strong>) to net the same after-tax dollars as this comp (taxed at your blended long-term capital gains rate of <strong>{fmtPct(c, 1)}</strong>). Tweak rates in <em>Settings → Tax Rates</em>.
 </p>
 <p className="mt-2 text-cs-muted">
 Estimates only — actual outcomes depend on AMT, state rules, and how your investment-interest deduction interacts with the rest of your return.
 </p>
 </div>
 </>
 )}

 <footer className="pt-4 text-center text-[10px] text-cs-muted">
 As of {TODAY}. All calculations are local to your browser.
 </footer>
 </div>
 )
}
