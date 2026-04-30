import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry, TaxSettings, DashboardData } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import {
  outstandingPrincipalAt,
  averageAnnualInterest,
  annualizedAppreciation,
  computeAll,
  ordinaryRate,
  capGainsRate,
} from './CompCalculator.math.ts'

type Screen =
  | 'intro'
  | 'period'
  | 'inputs'
  | 'appreciation'
  | 'base'
  | 'deduct'
  | 'taxequiv'
  | 'summary'

interface AllData {
  loans: LoanEntry[]
  payments: LoanPaymentEntry[]
  prices: PriceEntry[]
  sales: SaleEntry[]
  taxSettings: TaxSettings
  dashboard: DashboardData
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

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</p>
        {hint && <p className="mt-0.5 text-[10px] leading-tight text-gray-400 dark:text-slate-500">{hint}</p>}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">{value}</p>
    </div>
  )
}

function HeadlineCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-5 text-center dark:border-rose-700 dark:bg-rose-950/30">
      <p className="text-xs font-medium uppercase text-rose-700 dark:text-rose-300">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">{sub}</p>}
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

  // Wizard nav
  const [history, setHistory] = useState<Screen[]>(['intro'])
  const screen = history[history.length - 1]
  const push = (s: Screen) => setHistory(h => [...h, s])
  const back = () => setHistory(h => (h.length > 1 ? h.slice(0, -1) : h))

  // Period selection
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [windowYears, setWindowYears] = useState<1 | 3 | 5>(1)

  // Appreciation override (null = use computed default)
  const [appreciationOverride, setAppreciationOverride] = useState<string>('')

  // Toggles
  const [deductOn, setDeductOn] = useState<boolean>(false)
  const [taxEquivOn, setTaxEquivOn] = useState<boolean>(false)

  // Initialize deduct toggle from settings once data loads
  useEffect(() => {
    if (data?.taxSettings) setDeductOn(data.taxSettings.deduct_investment_interest)
  }, [data])

  // Year range from data
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

  // Computed inputs
  const computed = useMemo(() => {
    if (!data) return null
    const asOf = `${year}-12-31`
    const L = outstandingPrincipalAt(data.loans, data.payments, data.sales, asOf)
    const I = averageAnnualInterest(data.loans, data.payments, data.sales, asOf, windowYears)
    const rDefault = annualizedAppreciation(data.prices, asOf, windowYears)
    return { asOf, L, I, rDefault }
  }, [data, year, windowYears])

  const r = useMemo(() => {
    if (appreciationOverride !== '') {
      const parsed = parseFloat(appreciationOverride)
      if (!isNaN(parsed)) return parsed / 100
    }
    return computed?.rDefault ?? null
  }, [appreciationOverride, computed])

  const totals = useMemo(() => {
    if (!data || !computed || r == null) return null
    const m = ordinaryRate(data.taxSettings)
    const c = capGainsRate(data.taxSettings)
    const ts = computeAll({ loanPrincipal: computed.L, annualInterest: computed.I, appreciationRate: r }, m, c)
    return { ts, m, c }
  }, [data, computed, r])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <p className="text-xs text-gray-500 dark:text-slate-400">Loading…</p>
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">Error: {error}</p>
  if (!data || !computed) return null

  const m = data.taxSettings ? ordinaryRate(data.taxSettings) : 0
  const c = data.taxSettings ? capGainsRate(data.taxSettings) : 0
  const compForToggles = deductOn ? totals?.ts.withDeduction ?? 0 : totals?.ts.base ?? 0

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Total Comp Calculator</h1>

      {screen === 'intro' && (
        <Section title="What is this?">
          <Explainer>
            <p className="mb-2">
              Epic's stock purchase program isn't a salary or a free stock grant — it's a low-rate <strong>loan</strong> Epic
              gives you to buy company stock. That makes it hard to compare with offers structured as cash + RSUs.
            </p>
            <p className="mb-2">
              This calculator turns the program into a single comparable number, in three steps:
            </p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>Pick a year and how to smooth the math (1, 3, or 5-year average).</li>
              <li>Confirm your loan balance, interest cost, and how much the stock grew.</li>
              <li>Optionally adjust for tax deductibility and salary equivalence.</li>
            </ol>
          </Explainer>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('period')} label="Start →" />
          </div>
        </Section>
      )}

      {screen === 'period' && (
        <Section title="Pick the period">
          <BackBtn onClick={back} />
          <Explainer>
            <p>
              Choose a year to evaluate. You can also pick a <strong>rolling average</strong> window — useful because
              Epic reprices the stock annually and any single year can swing high or low. A 3- or 5-year average
              smooths out those spikes.
            </p>
          </Explainer>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-slate-400">Year (as of Dec 31)</span>
              <select
                value={year}
                onChange={e => setYear(parseInt(e.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                {Array.from({ length: yearRange.max - yearRange.min + 1 }, (_, i) => yearRange.min + i).map(y => (
                  <option key={y} value={y}>{y}{y === CURRENT_YEAR ? ' (current)' : ''}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-slate-400">Rolling window</span>
              <select
                value={windowYears}
                onChange={e => setWindowYears(parseInt(e.target.value) as 1 | 3 | 5)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value={1}>1 year (just this year)</option>
                <option value={3}>3-year average</option>
                <option value={5}>5-year average</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <div />
            <NextBtn onClick={() => { setAppreciationOverride(''); push('inputs') }} />
          </div>
        </Section>
      )}

      {screen === 'inputs' && (
        <Section title="Your numbers">
          <BackBtn onClick={back} />
          <Explainer>
            <p>
              Here's what we computed for <strong>{year}</strong>{windowYears > 1 ? ` (averaged over ${windowYears} years)` : ''}.
              These come from your loans, payments, and prices.
            </p>
          </Explainer>
          <div className="space-y-2">
            <StatRow
              label="Total outstanding loan principal"
              value={fmt$(computed.L)}
              hint={`As of ${computed.asOf}. All active loans (purchase + tax), minus any payoffs.`}
            />
            <StatRow
              label={windowYears === 1 ? 'Annual loan interest cost' : `Average annual interest (${windowYears}-yr)`}
              value={fmt$(computed.I)}
              hint={`Sum of (principal × rate) per loan, ${windowYears === 1 ? `for ${year}` : `averaged across ${year - windowYears + 1}–${year}`}.`}
            />
            <StatRow
              label="Current stock value (reference)"
              value={fmt$(data.dashboard.current_price * data.dashboard.total_shares)}
              hint="Today's vested+unvested shares × current price. Shown for context — the comp formula uses only your loan principal."
            />
          </div>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('appreciation')} />
          </div>
        </Section>
      )}

      {screen === 'appreciation' && (
        <Section title="How fast is the stock growing?">
          <BackBtn onClick={back} />
          <Explainer>
            <p className="mb-2">
              We measure annualized appreciation over your chosen window:
              <br />
              <code className="text-[11px]">(price at end ÷ price at start)<sup>1/years</sup> − 1</code>
            </p>
            <p>You can override this — useful for forward-looking years or to test scenarios.</p>
          </Explainer>
          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Computed from your prices ({windowYears}-year window ending {computed.asOf}):
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-slate-100">
              {computed.rDefault != null ? fmtPct(computed.rDefault) : 'Not enough price history'}
            </p>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-slate-400">Override (annual %, optional)</span>
            <input
              type="number"
              step="0.1"
              placeholder={computed.rDefault != null ? (computed.rDefault * 100).toFixed(2) : 'e.g. 7'}
              value={appreciationOverride}
              onChange={e => setAppreciationOverride(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </label>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('base')} disabled={r == null} />
          </div>
        </Section>
      )}

      {screen === 'base' && totals && r != null && (
        <Section title="Your comp value">
          <BackBtn onClick={back} />
          <HeadlineCard
            label={`Net comp${windowYears > 1 ? ' (annual avg)' : ''}`}
            value={fmt$(totals.ts.base)}
            sub={`for ${year}${windowYears > 1 ? `, averaged over ${windowYears} years` : ''}`}
          />
          <Explainer>
            <p className="mb-1"><strong>How we got here:</strong></p>
            <p className="font-mono text-[11px]">
              {fmtPct(r)} × {fmt$(computed.L)} − {fmt$(computed.I)} = <strong>{fmt$(totals.ts.base)}</strong>
            </p>
            <p className="mt-2">
              In plain English: the stock grew by {fmtPct(r)} on the {fmt$(computed.L)} that Epic loaned you to
              buy it ({fmt$(r * computed.L)} of growth), minus what you paid in interest ({fmt$(computed.I)}).
              Whatever's left is your comp from the program.
            </p>
          </Explainer>
          <Explainer>
            <p className="text-gray-500 dark:text-slate-400">Two more things you might want to factor in:</p>
            <ul className="ml-4 mt-1 list-disc">
              <li><strong>Interest tax deductibility.</strong> If you itemize, your loan interest can offset taxes.</li>
              <li><strong>Tax-equivalent salary.</strong> Cap gains are taxed less than salary — what salary would match this after-tax?</li>
            </ul>
          </Explainer>
          <div className="flex justify-between">
            <NextBtn onClick={() => push('deduct')} label="Tax deductibility →" />
            <NextBtn onClick={() => push('summary')} label="Skip to summary →" />
          </div>
        </Section>
      )}

      {screen === 'deduct' && totals && (
        <Section title="Interest tax deductibility">
          <BackBtn onClick={back} />
          <Explainer>
            <p className="mb-2">
              The IRS lets you deduct investment-interest expense (Form 4952) against investment income, if you
              itemize. That means your loan interest effectively costs less:
              <br />
              <code className="text-[11px]">effective interest = interest × (1 − marginal rate)</code>
            </p>
            <p>
              Your marginal ordinary rate is <strong>{fmtPct(m)}</strong> (federal + state income from Settings).
              So the savings on this year's interest would be roughly{' '}
              <strong>{fmt$(totals.ts.deductionSavings)}</strong>.
            </p>
          </Explainer>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={deductOn}
              onChange={e => setDeductOn(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs">Apply interest deduction</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-center dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] uppercase text-gray-500 dark:text-slate-400">Without deduction</p>
              <p className="mt-1 text-base font-semibold tabular-nums">{fmt$(totals.ts.base)}</p>
            </div>
            <div className={`rounded-lg border-2 p-3 text-center ${deductOn ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30' : 'border-stone-200 bg-stone-50 dark:border-slate-700 dark:bg-slate-800'}`}>
              <p className="text-[10px] uppercase text-emerald-700 dark:text-emerald-300">With deduction</p>
              <p className="mt-1 text-base font-semibold tabular-nums">{fmt$(totals.ts.withDeduction)}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <NextBtn onClick={() => push('taxequiv')} />
          </div>
        </Section>
      )}

      {screen === 'taxequiv' && totals && (
        <Section title="What salary would match this?">
          <BackBtn onClick={back} />
          <Explainer>
            <p className="mb-2">
              Stock comp gets taxed at long-term capital-gains rates. Salary gets taxed as ordinary income. To
              compare apples-to-apples, we ask: <em>how much pretax salary would leave you with the same after-tax dollars?</em>
            </p>
            <p className="font-mono text-[11px]">
              salary = comp × (1 − cap-gains rate) ÷ (1 − ordinary rate)
            </p>
            <p className="mt-2">
              From your Settings: ordinary rate = <strong>{fmtPct(m)}</strong>, blended LT cap-gains rate (incl. NIIT) = <strong>{fmtPct(c)}</strong>.
            </p>
          </Explainer>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={taxEquivOn}
              onChange={e => setTaxEquivOn(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs">Show tax-equivalent salary</span>
          </label>
          {taxEquivOn && (
            <div className="space-y-2">
              <StatRow
                label="Comp (pretax)"
                value={fmt$(compForToggles)}
                hint={deductOn ? 'With interest deduction applied' : 'No deduction'}
              />
              <StatRow
                label="After-tax (cap gains)"
                value={fmt$(deductOn ? totals.ts.afterTaxWithDeduction : totals.ts.afterTaxBase)}
              />
              <StatRow
                label="Equivalent pretax salary"
                value={fmt$(deductOn ? totals.ts.taxEquivWithDeduction : totals.ts.taxEquivBase)}
                hint="Salary you'd need (taxed as ordinary income) to match the after-tax comp."
              />
            </div>
          )}
          <div className="flex justify-end">
            <NextBtn onClick={() => push('summary')} label="See summary →" />
          </div>
        </Section>
      )}

      {screen === 'summary' && totals && r != null && (
        <Section title="Summary">
          <BackBtn onClick={back} />
          <HeadlineCard
            label={`Net comp ${windowYears > 1 ? '(annual avg)' : ''}`}
            value={fmt$(deductOn ? totals.ts.withDeduction : totals.ts.base)}
            sub={`${year}${windowYears > 1 ? ` · ${windowYears}-yr avg` : ''} · appreciation ${fmtPct(r)}`}
          />
          <div className="space-y-2">
            <StatRow label="Loan principal" value={fmt$(computed.L)} />
            <StatRow label="Annual interest" value={fmt$(computed.I)} />
            <StatRow label="Stock appreciation (annualized)" value={fmtPct(r)} />
            <StatRow label="Gross comp from leverage" value={fmt$(r * computed.L)} hint="appreciation × loan principal" />
            <StatRow label="Net comp (no deduction)" value={fmt$(totals.ts.base)} />
            {deductOn && (
              <>
                <StatRow label="Tax savings from deduction" value={fmt$(totals.ts.deductionSavings)} hint={`interest × ${fmtPct(m)} marginal rate`} />
                <StatRow label="Net comp (with deduction)" value={fmt$(totals.ts.withDeduction)} />
              </>
            )}
            {taxEquivOn && (
              <StatRow
                label="Equivalent pretax salary"
                value={fmt$(deductOn ? totals.ts.taxEquivWithDeduction : totals.ts.taxEquivBase)}
                hint="Salary needed to match after-tax."
              />
            )}
          </div>
          <Explainer>
            <p>
              Estimates only — actual tax outcomes depend on your full return, AMT, state rules, and how interest
              deduction interacts with your other investment income. Update your rates in Settings to refine.
            </p>
          </Explainer>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setHistory(['period'])}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              ← Change period
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
