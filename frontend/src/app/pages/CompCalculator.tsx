import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry, TaxSettings, DashboardData } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import {
  outstandingPrincipalAt,
  averageOutstandingPrincipal,
  averageAnnualInterest,
  annualizedAppreciation,
  computeAll,
  ordinaryRate,
  capGainsRate,
} from './CompCalculator.math.ts'
import type { CompTotals } from './CompCalculator.math.ts'

type Screen = 'intro' | 'year' | 'results'

interface AllData {
  loans: LoanEntry[]
  payments: LoanPaymentEntry[]
  prices: PriceEntry[]
  sales: SaleEntry[]
  taxSettings: TaxSettings
  dashboard: DashboardData
}

interface WindowResult {
  windowYears: 1 | 3 | 5
  principal: number
  interest: number
  appreciation: number | null
  totals: CompTotals | null
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

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
    >
      ← Back
    </button>
  )
}

function NextBtn({ onClick, label = 'Next →', disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
    >
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  )
}

function Explainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </div>
  )
}

const WINDOW_LABELS: Record<1 | 3 | 5, string> = {
  1: 'This year',
  3: '3-year avg',
  5: '5-year avg',
}

function ResultCard({
  result, displayCompKey, m, c,
}: {
  result: WindowResult
  displayCompKey: 'base' | 'withDeduction'
  m: number
  c: number
}) {
  const label = WINDOW_LABELS[result.windowYears]
  if (result.totals == null || result.appreciation == null) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">Not enough price history for a {result.windowYears}-year window.</p>
      </div>
    )
  }
  const comp = result.totals[displayCompKey]
  const isPrimary = result.windowYears === 1
  return (
    <div className={`rounded-lg border p-4 ${isPrimary
      ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30'
      : 'border-stone-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${isPrimary ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-slate-400'}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{fmt$(comp)}</p>
      <p className="mt-0.5 text-[10px] text-gray-500 dark:text-slate-500">net comp / yr</p>
      <dl className="mt-3 space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-400">Loan principal</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(result.principal)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-400">Annual interest</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$(result.interest)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-400">Appreciation</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">{fmtPct(result.appreciation)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-stone-200 pt-1 dark:border-slate-700">
          <dt className="text-gray-500 dark:text-slate-400">After-tax (cap gains {fmtPct(c, 1)})</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">
            {fmt$(displayCompKey === 'withDeduction' ? result.totals.afterTaxWithDeduction : result.totals.afterTaxBase)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-400">Salary equiv (ord {fmtPct(m, 1)})</dt>
          <dd className="tabular-nums text-gray-900 dark:text-slate-100">
            {fmt$(displayCompKey === 'withDeduction' ? result.totals.taxEquivWithDeduction : result.totals.taxEquivBase)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

const TODAY = new Date().toISOString().slice(0, 10)
const CURRENT_YEAR = new Date().getFullYear()

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
      // Loan payments aren't exposed to viewers; treat as empty when viewing.
      vid ? Promise.resolve([] as LoanPaymentEntry[]) : api.getLoanPayments(),
    ])
    return { loans, payments, prices, sales, taxSettings, dashboard }
  }, [vid])
  const { data, loading, error } = useApiData<AllData>(fetcher)

  const [history, setHistory] = useState<Screen[]>(['intro'])
  const screen = history[history.length - 1]
  const push = (s: Screen) => setHistory(h => [...h, s])
  const back = () => setHistory(h => (h.length > 1 ? h.slice(0, -1) : h))

  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [appreciationOverride, setAppreciationOverride] = useState<string>('')
  const [deductOn, setDeductOn] = useState<boolean>(false)

  useEffect(() => {
    if (data?.taxSettings) setDeductOn(data.taxSettings.deduct_investment_interest)
  }, [data])

  const yearRange = useMemo(() => {
    const years = new Set<number>()
    if (data) {
      for (const l of data.loans) years.add(l.loan_year)
      for (const p of data.prices) years.add(parseInt(p.effective_date.slice(0, 4)))
    }
    const min = years.size ? Math.min(...years) : CURRENT_YEAR - 1
    const max = CURRENT_YEAR + 5
    return { min, max }
  }, [data])

  const m = data ? ordinaryRate(data.taxSettings) : 0
  const c = data ? capGainsRate(data.taxSettings) : 0

  const results: WindowResult[] = useMemo(() => {
    if (!data) return []
    const asOf = `${year}-12-31`
    const windows: (1 | 3 | 5)[] = [1, 3, 5]
    return windows.map(w => {
      const principal = w === 1
        ? outstandingPrincipalAt(data.loans, data.payments, data.sales, asOf)
        : averageOutstandingPrincipal(data.loans, data.payments, data.sales, asOf, w)
      const interest = averageAnnualInterest(data.loans, data.payments, data.sales, asOf, w)
      let appreciation = annualizedAppreciation(data.prices, asOf, w)
      // Override only applies to the 1-year view (since rolling avgs derive from price history).
      if (w === 1 && appreciationOverride !== '') {
        const parsed = parseFloat(appreciationOverride)
        if (!isNaN(parsed)) appreciation = parsed / 100
      }
      const totals = appreciation != null
        ? computeAll({ loanPrincipal: principal, annualInterest: interest, appreciationRate: appreciation }, m, c)
        : null
      return { windowYears: w, principal, interest, appreciation, totals }
    })
  }, [data, year, appreciationOverride, m, c])

  if (loading) return <p className="text-xs text-gray-500 dark:text-slate-400">Loading…</p>
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">Error: {error}</p>
  if (!data) return null

  const oneYear = results.find(r => r.windowYears === 1)
  const compKey: 'base' | 'withDeduction' = deductOn ? 'withDeduction' : 'base'

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Total Comp Calculator</h1>

      {screen === 'intro' && (
        <Section title="What is this?">
          <Explainer>
            <p className="mb-2">
              Epic's stock purchase program isn't a salary or a free stock grant — it's a low-rate <strong>loan</strong>{' '}
              Epic gives you to buy company stock. That makes it hard to compare with offers structured as cash + RSUs.
            </p>
            <p className="mb-2">In one number, your annual comp from the program is:</p>
            <p className="font-mono text-[11px]">
              comp = (stock appreciation %) × (loan principal) − (interest paid)
            </p>
            <p className="mt-2">
              Pick a year, and we'll show that comp three ways: just that year, a 3-year average, and a 5-year average.
              The averages flatten out spikes from Epic's annual repricing.
            </p>
          </Explainer>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('year')} label="Start →" />
          </div>
        </Section>
      )}

      {screen === 'year' && (
        <Section title="Pick a year">
          <BackBtn onClick={back} />
          <Explainer>
            <p>Choose a year to evaluate (as of Dec 31). You can pick a past year, the current year, or up to 5 years out.</p>
          </Explainer>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Year</span>
            <select
              value={year}
              onChange={e => setYear(parseInt(e.target.value))}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {Array.from({ length: yearRange.max - yearRange.min + 1 }, (_, i) => yearRange.min + i).map(y => (
                <option key={y} value={y}>{y}{y === CURRENT_YEAR ? ' (current)' : ''}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('results')} label="See comp →" />
          </div>
        </Section>
      )}

      {screen === 'results' && (
        <Section title={`Comp for ${year}`}>
          <BackBtn onClick={back} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {results.map(r => (
              <ResultCard key={r.windowYears} result={r} displayCompKey={compKey} m={m} c={c} />
            ))}
          </div>

          {oneYear && oneYear.appreciation != null && (
            <Explainer>
              <p className="mb-1"><strong>How "this year" was computed:</strong></p>
              <p className="font-mono text-[11px]">
                {fmtPct(oneYear.appreciation)} × {fmt$(oneYear.principal)} − {fmt$(oneYear.interest)}
                {' = '}<strong>{fmt$(oneYear.totals?.[compKey] ?? 0)}</strong>
              </p>
              <p className="mt-2">
                The 3- and 5-year columns use the average outstanding principal, average interest, and{' '}
                annualized appreciation (CAGR) over those windows.
              </p>
            </Explainer>
          )}

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-slate-400">Override 1-year appreciation (optional %)</span>
              <input
                type="number"
                step="0.1"
                placeholder={oneYear?.appreciation != null ? (oneYear.appreciation * 100).toFixed(2) : 'e.g. 7'}
                value={appreciationOverride}
                onChange={e => setAppreciationOverride(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              <span className="mt-1 block text-[10px] text-gray-400 dark:text-slate-500">
                Useful for forward-looking years or stress tests. Only affects the "this year" column.
              </span>
            </label>
          </div>

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
                If you itemize and use Form 4952, your interest cost is reduced by your marginal ordinary rate ({fmtPct(m, 1)}).
              </p>
            </div>
          </label>

          <Explainer>
            <p>
              <strong>Salary equiv</strong> is what you'd need in pretax salary (taxed at your ordinary rate of{' '}
              <strong>{fmtPct(m, 1)}</strong>) to net the same after-tax dollars as this comp (taxed at your blended LT cap-gains rate of <strong>{fmtPct(c, 1)}</strong>). Tweak rates in <em>Settings → Tax Rates</em>.
            </p>
            <p className="mt-2 text-gray-500 dark:text-slate-400">
              Estimates only — actual outcomes depend on AMT, state rules, and how your investment-interest deduction interacts with the rest of your return.
            </p>
          </Explainer>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setHistory(['year'])}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              ← Change year
            </button>
            <button
              type="button"
              onClick={() => setHistory(['intro'])}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              Start over
            </button>
          </div>
        </Section>
      )}

      <footer className="pt-4 text-center text-[10px] text-gray-400 dark:text-slate-500">
        As of {TODAY}. All calculations are local to your browser.
      </footer>
    </div>
  )
}
