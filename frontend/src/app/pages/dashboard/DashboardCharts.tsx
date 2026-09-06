import { useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  ChartBox, DetailCard, IncomeCapGainsChart, PriceChart, SharesChart,
} from '../../components/charts.tsx'
import {
  TODAY, filterByDateRange, numericTicks, smartInterval, todayIndex,
  type ChartColors, type DateRange,
} from '../../components/chartAxes.ts'
import { fmt$, fmtDate, fmtFullDate } from '../../format.ts'
import type {
  DashboardData, LoanEntry, PriceEntry, TaxSettings, TimelineEvent,
} from '../../../api.ts'

const WI_TAX_DEFAULTS: TaxSettings = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
  lot_selection_method: 'lifo',
  loan_payoff_method: 'epic_lifo',
  flexible_payoff_enabled: false,
  prefer_stock_dp: false,
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

function TaxChart({ events, loans, taxSettings, c, range, hasFuturePrices }: {
  events: TimelineEvent[]
  loans: LoanEntry[]
  taxSettings: TaxSettings
  c: ChartColors
  range: DateRange
  hasFuturePrices: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const incomeRate = taxSettings.federal_income_rate + taxSettings.state_income_rate
    const ltCgRate = taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate

    // Build sorted list of Tax loans for running total computation
    const sortedTaxLoans = [...loans]
      .filter(l => l.loan_type === 'Tax')
      .sort((a, b) => a.loan_year - b.loan_year)
    let taxLoanIdx = 0
    let cumTaxPaid = 0

    // Track price-driven surplus (same approach as IncomeCapGainsChart)
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0

    const filtered = filterByDateRange(events, range, 'date')
    return filtered.map((e, i) => {
      // Accumulate tax loan payments up to this event's year (tax paid when loan was taken, not when due)
      const eYear = parseInt(e.date.slice(0, 4), 10)
      while (taxLoanIdx < sortedTaxLoans.length && sortedTaxLoans[taxLoanIdx].loan_year <= eYear) {
        cumTaxPaid += sortedTaxLoans[taxLoanIdx].amount
        taxLoanIdx++
      }
      // Accumulate Sale estimated taxes at the sale date
      if (e.event_type === 'Sale' && e.estimated_tax) {
        cumTaxPaid += e.estimated_tax
      }
      // Accumulate income tax on vesting events (RSU vesting without 83b) and grant events with income
      if (e.income > 0 && ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')) {
        cumTaxPaid += e.income * incomeRate
      }

      // Track future price surplus (same logic as IncomeCapGainsChart)
      if (hasFuturePrices && e.date > TODAY) {
        const vs = e.vested_shares ?? 0
        if (e.event_type === 'Share Price') {
          cumFuturePriceIncrease += e.price_increase
          cumSurplusCg += e.price_cap_gains
        } else if (cumFuturePriceIncrease > 0 && vs > 0) {
          if ((e.grant_price ?? 0) === 0) {
            cumSurplusIncome += cumFuturePriceIncrease * vs
          } else {
            cumSurplusCg += cumFuturePriceIncrease * vs
          }
        }
      }

      const effectiveCumCg = e.cum_cap_gains

      // "Sure" tax = tax on base income + base vesting cap gains (no price surplus)
      const taxSure = Math.round(
        (e.cum_income - cumSurplusIncome) * incomeRate +
        (effectiveCumCg - cumSurplusCg) * ltCgRate
      )

      // "Half" tax = tax on price-driven surplus (uncertain - depends on future price)
      const hasSurplus = hasFuturePrices && (cumSurplusIncome + cumSurplusCg) > 0
      const taxHalf = hasSurplus
        ? Math.round(cumSurplusIncome * incomeRate + cumSurplusCg * ltCgRate)
        : null as number | null

      return {
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        taxSure,
        taxHalf,
        taxPaid: cumTaxPaid > 0 ? cumTaxPaid : null as number | null,
      }
    })
  }, [events, loans, taxSettings, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
            <tspan fill="#fb923c">&#9632;</tspan> Est. Tax (Sure){' '}
            {hasFuturePrices && <><tspan fill="#fed7aa">&#9632;</tspan> +Projected{' '}</>}
            <tspan fill="#ef4444">&#9632;</tspan> Paid
          </text>
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#60a5fa" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#60a5fa', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#fb923c" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Stacked: sure tax + projected half tax */}
          <Area type="monotone" dataKey="taxSure" stackId="tax" fill="#fb923c" fillOpacity={0.7} stroke="#ea580c" name="Est. Tax (Sure)" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="taxHalf" stackId="tax" fill="#fed7aa" fillOpacity={0.5} stroke="#fed7aa" strokeDasharray="6 3" name="Est. Tax (Projected)" dot={false} />
          )}
          {/* Paid area overlaid (not stacked) — fills the tax-loan-covered region */}
          <Area type="monotone" dataKey="taxPaid" fill="#fca5a5" fillOpacity={0.45} stroke="#ef4444" strokeWidth={2} dot={false} name="Tax Paid" connectNulls />
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'est. tax (sure)', value: fmt$(sel.taxSure) },
            ...(sel.taxHalf ? [{ label: 'est. tax (projected)', value: fmt$(sel.taxHalf) }] : []),
            ...(sel.taxPaid ? [{ label: 'tax paid', value: fmt$(sel.taxPaid) }] : []),
          ]}
        />
      )}
    </>
  )
}

function InterestChart({ loans, c, range }: { loans: LoanEntry[]; c: ChartColors; range: DateRange }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
    const interestLoans = loans.filter(l => l.loan_type === 'Interest')

    if (purchaseLoans.length === 0 && interestLoans.length === 0) return []

    // Latest known interest rate (highest loan_year interest loan, fallback to purchase rate)
    const latestInterestLoan = [...interestLoans].sort((a, b) => b.loan_year - a.loan_year)[0]
    const latestRate = latestInterestLoan?.interest_rate
      ?? (purchaseLoans.length ? Math.max(...purchaseLoans.map(l => l.interest_rate)) : 0)

    // Year range
    const allYears = new Set<number>()
    for (const l of loans) {
      allYears.add(l.loan_year)
      allYears.add(new Date(l.due_date + 'T00:00:00').getFullYear())
    }
    if (allYears.size === 0) return []
    const minYear = Math.min(...allYears)
    const maxYear = Math.max(...allYears)

    const yearData: { year: number; guaranteedNew: number; projectedNew: number }[] = []

    for (let year = minYear; year <= maxYear; year++) {
      let guaranteedNew = 0
      let projectedNew = 0

      // Existing Interest loans for this year → guaranteed
      for (const l of interestLoans) {
        if (l.loan_year === year) guaranteedNew += l.amount
      }

      // Projected interest from Purchase loans for years not yet in DB → guaranteed
      for (const p of purchaseLoans) {
        const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
        if (year > p.loan_year && year <= dueYear) {
          const alreadyExists = interestLoans.some(
            l => l.grant_year === p.grant_year && l.grant_type === p.grant_type && l.loan_year === year
          )
          if (!alreadyExists) guaranteedNew += p.amount * p.interest_rate
        }
      }

      // Projected interest generated by existing Interest loans (second-order, at latest rate)
      if (latestRate > 0) {
        for (const il of interestLoans) {
          const parentPurchase = purchaseLoans.find(
            p => p.grant_year === il.grant_year && p.grant_type === il.grant_type
          )
          const dueYear = parentPurchase
            ? new Date(parentPurchase.due_date + 'T00:00:00').getFullYear()
            : new Date(il.due_date + 'T00:00:00').getFullYear()
          if (year > il.loan_year && year <= dueYear) {
            projectedNew += il.amount * latestRate
          }
        }

        // Projected interest from future (not-yet-in-DB) interest loans (at latest rate)
        for (const p of purchaseLoans) {
          const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
          for (let intYear = p.loan_year + 1; intYear < year && intYear <= dueYear; intYear++) {
            const existsInDB = interestLoans.some(
              l => l.grant_year === p.grant_year && l.grant_type === p.grant_type && l.loan_year === intYear
            )
            if (!existsInDB && year <= dueYear) {
              projectedNew += p.amount * p.interest_rate * latestRate
            }
          }
        }
      }

      yearData.push({ year, guaranteedNew, projectedNew })
    }

    // Cumulative
    let cumGuaranteed = 0
    let cumProjected = 0
    return yearData.map(d => {
      cumGuaranteed += d.guaranteedNew
      cumProjected += d.projectedNew
      return {
        _date: `${d.year}-01-01`,
        _label: String(d.year),
        guaranteed: cumGuaranteed,
        projected: cumProjected > 0 ? cumProjected : null as number | null,
      }
    })
  }, [loans])

  if (data.length === 0) return null

  const displayed = filterByDateRange(data, range, '_date')
  const tIdx = todayIndex(displayed)
  const sel = selected !== null && selected < displayed.length ? displayed[selected] : null
  const hasProjected = displayed.some(d => d.projected !== null && d.projected > 0)

  return (
    <>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span className="text-[#fb7185]">&#9632;</span> Recorded + Guaranteed{' '}
        {hasProjected && <><span className="text-[#fda4af]">&#9632;</span> + Est. interest-on-interest</>}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={displayed} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(displayed.length)} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={displayed[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < displayed.length && (
            <ReferenceLine x={displayed[selected]._label} stroke="#fb7185" strokeWidth={1.5} zIndex={600} />
          )}
          <Area type="monotone" dataKey="guaranteed" stackId="i" fill="#fb7185" fillOpacity={0.7} stroke="#e11d48" name="Guaranteed" dot={false} />
          {hasProjected && (
            <Area type="monotone" dataKey="projected" stackId="i" fill="#fda4af" fillOpacity={0.4} stroke="#fda4af" strokeDasharray="6 3" name="Est. interest-on-interest" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: String(sel._label) },
            { label: 'cumulative interest', value: fmt$(sel.guaranteed + (sel.projected ?? 0)) },
            ...(sel.projected ? [{ label: 'of which est.', value: fmt$(sel.projected) }] : []),
          ]}
        />
      )}
    </>
  )
}

function LoanChart({ loanPaymentByYear, c, range, setRange, maxDate }: {
  loanPaymentByYear: { year: string; payoff_sale: number; cash_in: number }[]
  c: ChartColors
  range: DateRange; setRange: (r: DateRange) => void; maxDate: string
}) {
  if (!loanPaymentByYear || loanPaymentByYear.length === 0) return null
  const displayed = range.mode === 'all' ? loanPaymentByYear
    : loanPaymentByYear.filter(d => {
      const y = d.year + '-01-01'
      return y >= range.start && y <= range.end
    })
  return (
    <ChartBox title="Loan Payments by Due Year" range={range} setRange={setRange} maxDate={maxDate}>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span className="text-[#4ade80]">&#9632;</span> Payoff sale{' '}
        <span className="text-[#fb923c]">&#9632;</span> Cash in
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={displayed}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Bar dataKey="payoff_sale" stackId="a" fill="#4ade80" name="Payoff sale" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cash_in" stackId="a" fill="#fb923c" name="Cash in" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** Every chart on the dashboard, in the order they appear. */
export function DashboardCharts({
  events, prices, loans, dash, taxSettings, c,
  range, setRange, rangeInterest, setRangeInterest, rangeLoan, setRangeLoan,
  maxDate, hasFuturePrices,
}: {
  events: TimelineEvent[] | null
  prices: PriceEntry[] | null
  loans: LoanEntry[] | null
  dash: DashboardData
  taxSettings: TaxSettings | null
  c: ChartColors
  range: DateRange
  setRange: (r: DateRange) => void
  rangeInterest: DateRange
  setRangeInterest: (r: DateRange) => void
  rangeLoan: DateRange
  setRangeLoan: (r: DateRange) => void
  maxDate: string
  hasFuturePrices: boolean
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {events && events.length > 0 && (
        <ChartBox title="Shares Over Time" range={range} setRange={setRange} maxDate={maxDate}>
          <SharesChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {events && events.length > 0 && (
        <ChartBox title="Income vs capital gains" range={range} setRange={setRange} maxDate={maxDate}>
          <IncomeCapGainsChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {prices && prices.length > 0 && (
        <ChartBox title="Share Price History" range={range} setRange={setRange} maxDate={maxDate}>
          <PriceChart prices={prices} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {events && events.length > 0 && loans !== undefined && (
        <ChartBox title="Estimated Tax Liability" range={range} setRange={setRange} maxDate={maxDate}>
          <TaxChart
            events={events}
            loans={loans ?? []}
            taxSettings={taxSettings ?? WI_TAX_DEFAULTS}
            c={c}
            range={range}
            hasFuturePrices={hasFuturePrices}
          />
        </ChartBox>
      )}
      {loans && loans.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') && (
        <ChartBox title="Interest Over Time" range={rangeInterest} setRange={setRangeInterest} maxDate={maxDate}>
          <InterestChart loans={loans} c={c} range={rangeInterest} />
        </ChartBox>
      )}
      {dash.loan_payment_by_year && dash.loan_payment_by_year.length > 0 && (
        <LoanChart loanPaymentByYear={dash.loan_payment_by_year} c={c} range={rangeLoan} setRange={setRangeLoan} maxDate={maxDate} />
      )}
    </div>
  )
}
