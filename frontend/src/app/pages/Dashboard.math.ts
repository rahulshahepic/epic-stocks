import type {
  GrantEntry, LoanEntry, PriceEntry, SaleEntry, TaxSettings, TimelineEvent,
} from '../../api.ts'
import { TODAY } from '../components/chartAxes.ts'

/**
 * Everything the dashboard works out from the user's timeline, loans and sales.
 *
 * It was eight useMemo bodies inside the page component, which is why the
 * "which loans are still outstanding on this date" walk appears in four of
 * them, once with a comment noting it mirrors another. Pure functions here, so
 * they can be read and tested without rendering a dashboard.
 */

/**
 * Which loans a person still owes on a date, and how much has been paid off
 * early. A loan is gone if a sale settled it or a refinance replaced it; what
 * is left is its amount less any early payments.
 *
 * This walk was written out four times across the memos this module came from,
 * once with a comment noting it mirrored another. Any change to what counts as
 * settled has to reach all of them, so it is one function.
 */
export function loanStateAsOf(loans: LoanEntry[], events: TimelineEvent[], sales: SaleEntry[] | null, asOf: string) {
  const settledIds = new Set(
    (sales ?? []).filter(s => s.loan_id !== null && s.date <= asOf).map(s => s.loan_id),
  )
  const refinancedIds = new Set(
    loans.map(l => l.refinances_loan_id).filter((id): id is number => id !== null),
  )
  const earlyPaidByLoan = new Map<number, number>()
  for (const e of events) {
    if (e.event_type === 'Early Loan Payment' && e.date <= asOf && e.loan_id != null) {
      earlyPaidByLoan.set(e.loan_id, (earlyPaidByLoan.get(e.loan_id) ?? 0) + (e.amount ?? 0))
    }
  }
  const asOfYear = parseInt(asOf.slice(0, 4), 10)
  return {
    earlyPaidByLoan,
    /** Issued by this date, and neither settled nor refinanced away. */
    isOutstanding: (l: LoanEntry) => l.loan_year <= asOfYear && !settledIds.has(l.id) && !refinancedIds.has(l.id),
    /** What is left on a loan after any early payments. Never negative. */
    balanceOf: (l: LoanEntry) => Math.max(0, l.amount - (earlyPaidByLoan.get(l.id) ?? 0)),
    /** What a payoff sale actually cleared, for a sale that names a loan. */
    payoffFor: (loanId: number | null, amountById: Map<number, number>) =>
      loanId != null ? Math.max(0, (amountById.get(loanId) ?? 0) - (earlyPaidByLoan.get(loanId) ?? 0)) : 0,
  }
}

/** Whether any future price actually differs from today's — what makes a projection worth marking as one. */
export function hasDivergentFuturePrice(prices: PriceEntry[] | null) {
  if (!prices) return false
  const futurePrices = prices.filter(p => p.effective_date > TODAY)
  if (!futurePrices.length) return false
  const pastPrices = prices.filter(p => p.effective_date <= TODAY)
  const currentPrice = pastPrices.length ? pastPrices[pastPrices.length - 1].price : 0
  return futurePrices.some(p => Math.abs(p.price - currentPrice) > 0.005)
}

/** The furthest date anything is known about: the last event or the last price. */
export function maxTimelineDate(events: TimelineEvent[] | null, prices: PriceEntry[] | null) {
  let last = TODAY
  if (events?.length) last = events[events.length - 1].date > last ? events[events.length - 1].date : last
  if (prices?.length) {
    const lp = prices[prices.length - 1].effective_date
    if (lp > last) last = lp
  }
  return last
}

/** The newest real price when it predates this year. Estimates are the user's own
 *  projections, so they do not count as knowing this year's price. */
export function findStalePrice(prices: PriceEntry[] | null) {
  const real = (prices ?? []).filter(p => !p.is_estimate)
  if (real.length === 0) return null
  const newest = real[real.length - 1]
  return newest.effective_date.slice(0, 4) < TODAY.slice(0, 4) ? newest : null
}

/** The last date on the timeline, projections included — what "Last event" jumps to. */
export function lastTimelineDate(events: TimelineEvent[] | null) {
  if (!events?.length) return TODAY
  return events[events.length - 1].date
}

/** Every figure the headline cards show, as of one date. */
export function computeCardValues(events: TimelineEvent[] | null, loans: LoanEntry[] | null, sales: SaleEntry[] | null, taxSettings: TaxSettings | null, cardDate: string, prices: PriceEntry[] | null) {
  if (!events || !loans) return null

  const loanState = loanStateAsOf(loans, events, sales, cardDate)

  const effectiveDate = cardDate

  // Last event at or before effectiveDate
  let lastEvent: TimelineEvent | null = null
  for (const e of events) {
    if (e.date <= effectiveDate) lastEvent = e
    else break
  }
  // Next event after cardDate
  let nextEvent: TimelineEvent | null = null
  for (const e of events) {
    if (e.date > cardDate) { nextEvent = e; break }
  }

  const incomeRate = taxSettings
    ? taxSettings.federal_income_rate + taxSettings.state_income_rate
    : 0
  const taxPaid =
    loans.filter(l => l.loan_type === 'Tax' && l.loan_year <= parseInt(effectiveDate.slice(0, 4), 10))
      .reduce((sum, l) => sum + l.amount, 0)
      + events.filter(e => e.event_type === 'Sale' && e.date <= effectiveDate)
        .reduce((sum, e) => sum + (e.estimated_tax ?? 0), 0)
        + events
          .filter(e =>
            e.income > 0 &&
            e.date <= effectiveDate &&
            ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')
          )
          .reduce((sum, e) => sum + e.income * incomeRate, 0)

  // Outstanding loan principal just before (or at) the liq date, ignoring the virtual liq sale
  const outstandingPrincipal = (() => {
    const refDate = effectiveDate
    const refYear = parseInt(refDate.slice(0, 4), 10)
    const settledIds = new Set(
      (sales ?? []).filter(s => s.loan_id !== null && s.date <= refDate).map(s => s.loan_id)
    )
    const refinancedIds = new Set(loans.map(l => l.refinances_loan_id).filter((id): id is number => id !== null))
    const earlyPaidByLoan = new Map<number, number>()
    events.filter(e => e.event_type === 'Early Loan Payment' && e.date <= refDate && e.loan_id != null)
      .forEach(e => { earlyPaidByLoan.set(e.loan_id!, (earlyPaidByLoan.get(e.loan_id!) ?? 0) + (e.amount ?? 0)) })
    return loans
      .filter(l => l.loan_year <= refYear && !settledIds.has(l.id) && !refinancedIds.has(l.id))
      .reduce((sum, l) => sum + Math.max(0, l.amount - (earlyPaidByLoan.get(l.id) ?? 0)), 0)
  })()

  // Map sale_id -> estimated_tax from timeline events so we can subtract it below
  const saleTaxBySaleId = new Map<number, number>()
  for (const e of events) {
    if (e.event_type === 'Sale' && e.sale_id != null && e.estimated_tax != null) {
      saleTaxBySaleId.set(e.sale_id, e.estimated_tax)
    }
  }

  // Build loan amount map for payoff sale deductions
  const loanAmountById = new Map<number, number>()
  for (const l of loans) loanAmountById.set(l.id, l.amount)
  const cashReceived = sales
    ? sales.filter(s => s.date <= effectiveDate)
      .reduce((sum, s) => {
        const proceeds = s.shares * s.price_per_share
        const tax = saleTaxBySaleId.get(s.id) ?? 0
        const loanCovered = loanState.payoffFor(s.loan_id, loanAmountById)
        return sum + proceeds - loanCovered - tax
      }, 0)
    : 0

  const adjCumCg = lastEvent?.cum_cap_gains ?? 0
  const stcgRate = taxSettings
    ? taxSettings.federal_st_cg_rate + taxSettings.niit_rate + taxSettings.state_st_cg_rate
    : 0
  const ltcgRate = taxSettings
    ? taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate
    : 0
  let interestDeductionTotal = 0
  let taxSavings = 0
  for (const e of events) {
    if (e.date > effectiveDate) break
    interestDeductionTotal += e.interest_deduction_applied ?? 0
    taxSavings += (e.interest_deduction_on_stcg ?? 0) * stcgRate
      + (e.interest_deduction_on_ltcg ?? 0) * ltcgRate
  }
  return {
    current_price: lastEvent?.share_price ?? 0,
    total_shares: lastEvent?.cum_shares ?? 0,
    total_income: lastEvent?.cum_income ?? 0,
    total_cap_gains: adjCumCg,
    total_interest: (() => {
      const effYear = parseInt(effectiveDate.slice(0, 4), 10)
      const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
      const interestLoans = loans.filter(l => l.loan_type === 'Interest')
      let total = interestLoans
        .filter(l => l.loan_year <= effYear)
        .reduce((sum, l) => sum + l.amount, 0)
      for (const p of purchaseLoans) {
        const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
        const relatedInterestLoans = interestLoans.filter(
          l => l.grant_year === p.grant_year && l.grant_type === p.grant_type
        )
        for (let yr = p.loan_year + 1; yr <= Math.min(effYear, dueYear); yr++) {
          const exists = relatedInterestLoans.some(l => l.loan_year === yr)
          if (!exists) {
            total += p.amount * p.interest_rate
            // Also project interest accruing on outstanding interest loans for this year
            for (const il of relatedInterestLoans) {
              if (il.loan_year < yr) total += il.amount * il.interest_rate
            }
          }
        }
      }
      return total
    })(),
    total_loan_principal: outstandingPrincipal,
    total_tax_paid: taxPaid - taxSavings,
    cash_received: cashReceived,
    interest_deduction_total: interestDeductionTotal,
    tax_savings_from_deduction: taxSavings,
    next_event: nextEvent ? { date: nextEvent.date, event_type: nextEvent.event_type } : null,
    next_event_detail: nextEvent,
    price_is_estimate: (() => {
      if (!prices) return false
      let isEst = false
      for (const p of prices) {
        if (p.effective_date <= effectiveDate) isEst = !!p.is_estimate
        else break
      }
      return isEst
    })(),
  }
}

/** Per-grant holdings, value, tax and outstanding loans, as of one date. */
export function computeGrantHoldings(grantsData: GrantEntry[] | null, events: TimelineEvent[] | null, loans: LoanEntry[] | null, sales: SaleEntry[] | null, taxSettings: TaxSettings | null, cardDate: string) {
  if (!grantsData || !events || !loans) return null

  const loanState = loanStateAsOf(loans, events, sales, cardDate)

  const effectiveDate = cardDate
  const effYear = parseInt(effectiveDate.slice(0, 4), 10)

  // Current share price as of effectiveDate
  let currentPrice = 0
  for (const e of events) {
    if (e.date <= effectiveDate) currentPrice = e.share_price
    else break
  }

  const incomeRate = taxSettings
    ? taxSettings.federal_income_rate + taxSettings.state_income_rate
    : 0

  // Per-grant sold shares from explicit lot overrides (lot_overrides carries grant attribution).
  // Loan payoff sales carry no lot_overrides but do carry loan_id — attribute those to the
  // grant the loan belongs to, otherwise their shares never leave heldVested even after the
  // loan (and the shares that paid it off) are gone.
  const loanById = new Map(loans.map(l => [l.id, l]))
  const soldByGrant = new Map<string, number>()
  for (const s of (sales ?? [])) {
    if (s.date > effectiveDate) continue
    if (s.lot_overrides) {
      for (const lot of s.lot_overrides) {
        if (lot.grant_year == null || lot.grant_type == null) continue
        const key = `${lot.grant_year}-${lot.grant_type}`
        soldByGrant.set(key, (soldByGrant.get(key) ?? 0) + lot.shares)
      }
    } else if (s.loan_id != null) {
      const loan = loanById.get(s.loan_id)
      if (loan) {
        const key = `${loan.grant_year}-${loan.grant_type}`
        soldByGrant.set(key, (soldByGrant.get(key) ?? 0) + s.shares)
      }
    }
  }



  return grantsData.map(g => {
    // Vested shares from schedule
    let vested = 0
    if (g.periods > 0) {
      const vs = new Date(g.vest_start + 'T00:00:00')
      const base = Math.floor(g.shares / g.periods)
      const rem = g.shares % g.periods
      for (let p = 0; p < g.periods; p++) {
        const vd = new Date(vs)
        vd.setFullYear(vd.getFullYear() + p)
        if (vd.toISOString().slice(0, 10) <= effectiveDate) {
          vested += base + (p < rem ? 1 : 0)
        }
      }
    }
    const unvested = g.shares - vested
    // dp_shares are negative when shares were exchanged as a down payment; subtract
    // lot-attributed sales where the user recorded per-lot allocation
    const soldViaLots = soldByGrant.get(`${g.year}-${g.type}`) ?? 0
    const heldVested = Math.max(0, vested + (g.dp_shares ?? 0) - soldViaLots)

    // Outstanding loans for this grant
    const totalLoan = loans
      .filter(l => l.grant_year === g.year && l.grant_type === g.type && loanState.isOutstanding(l))
      .reduce((sum, l) => sum + loanState.balanceOf(l), 0)

    // Taxes: tax loans + income tax from vesting
    const taxLoanTotal = loans.filter(l =>
      l.loan_type === 'Tax' && l.grant_year === g.year && l.grant_type === g.type &&
      l.loan_year <= effYear
    ).reduce((sum, l) => sum + l.amount, 0)

    const vestingIncomeTax = events
      .filter(e =>
        e.grant_year === g.year && e.grant_type === g.type &&
        e.income > 0 && e.date <= effectiveDate &&
        ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')
      )
      .reduce((sum, e) => sum + e.income * incomeRate, 0)

    const vestedValue = heldVested * currentPrice
    const unvestedValue = unvested * g.price
    return {
      year: g.year,
      type: g.type,
      exerciseDate: g.exercise_date,
      costBasis: g.price,
      vestedShares: heldVested,
      unvestedShares: unvested,
      vestedValue,
      unvestedValue,
      totalValue: vestedValue + unvestedValue,
      totalTax: taxLoanTotal + vestingIncomeTax,
      totalLoan,
    }
  })
}

/** Loans still owed on a date: not settled by a sale, not refinanced away, not paid off. */
export function computeActiveLoans(loans: LoanEntry[] | null, events: TimelineEvent[] | null, sales: SaleEntry[] | null, cardDate: string) {
  if (!loans || !events) return null

  const loanState = loanStateAsOf(loans, events, sales, cardDate)


  return loans
    .filter(loanState.isOutstanding)
    .map(l => ({
      id: l.id,
      grantYear: l.grant_year,
      grantType: l.grant_type,
      loanType: l.loan_type,
      loanYear: l.loan_year,
      dueDate: l.due_date,
      balance: loanState.balanceOf(l),
      interestRate: l.interest_rate,
    }))
    .filter(l => l.balance > 0)
}

/** The line-by-line workings behind each headline card. */
export function computeBreakdowns(events: TimelineEvent[] | null, loans: LoanEntry[] | null, sales: SaleEntry[] | null, taxSettings: TaxSettings | null, cardDate: string) {
  if (!events || !loans) return null

  const loanState = loanStateAsOf(loans, events, sales, cardDate)
  const effectiveDate = cardDate
  const effYear = parseInt(effectiveDate.slice(0, 4), 10)

  // --- Cash Received: per-sale contribution ---
  const saleTaxBySaleId = new Map<number, number>()
  for (const e of events) {
    if (e.event_type === 'Sale' && e.sale_id != null && e.estimated_tax != null) {
      saleTaxBySaleId.set(e.sale_id, e.estimated_tax)
    }
  }
  const loanAmountById = new Map<number, number>()
  for (const l of loans) loanAmountById.set(l.id, l.amount)
  const loanById = new Map<number, LoanEntry>()
  for (const l of loans) loanById.set(l.id, l)
  const cashSales = (sales ?? [])
    .filter(s => s.date <= effectiveDate)
    .map(s => {
      const proceeds = s.shares * s.price_per_share
      const tax = saleTaxBySaleId.get(s.id) ?? 0
      const loanPayoff = loanState.payoffFor(s.loan_id, loanAmountById)
      const loan = s.loan_id != null ? loanById.get(s.loan_id) : null
      return {
        id: s.id,
        date: s.date,
        shares: s.shares,
        price: s.price_per_share,
        proceeds,
        tax,
        loanPayoff,
        loanLabel: loan ? `${loan.grant_year} ${loan.grant_type} ${loan.loan_type}` : null,
        net: proceeds - tax - loanPayoff,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  const cashTotals = cashSales.reduce(
    (acc, s) => ({
      proceeds: acc.proceeds + s.proceeds,
      tax: acc.tax + s.tax,
      loanPayoff: acc.loanPayoff + s.loanPayoff,
      net: acc.net + s.net,
    }),
    { proceeds: 0, tax: 0, loanPayoff: 0, net: 0 },
  )

  // --- Total Income: vesting events grouped by grant ---
  type IncomeGroup = { key: string; year: number; type: string; income: number; events: number }
  const incomeByGrant = new Map<string, IncomeGroup>()
  let incomeTotal = 0
  for (const e of events) {
    if (e.date > effectiveDate) break
    if (e.income > 0 && ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant')) {
      const key = `${e.grant_year}|${e.grant_type}`
      const grp = incomeByGrant.get(key) ?? {
        key,
        year: e.grant_year ?? 0,
        type: e.grant_type ?? '',
        income: 0,
        events: 0,
      }
      grp.income += e.income
      grp.events += 1
      incomeByGrant.set(key, grp)
      incomeTotal += e.income
    }
  }
  const incomeGroups = [...incomeByGrant.values()].sort(
    (a, b) => a.year - b.year || a.type.localeCompare(b.type),
  )

  // --- Total Cap Gains: split vesting (RSU cost-basis delta) vs price appreciation ---
  type CgGroup = { key: string; year: number; type: string; amount: number }
  const vestingCgByGrant = new Map<string, CgGroup>()
  let vestingCgTotal = 0
  let priceCgTotal = 0
  for (const e of events) {
    if (e.date > effectiveDate) break
    if (e.vesting_cap_gains && e.vesting_cap_gains !== 0) {
      const key = `${e.grant_year}|${e.grant_type}`
      const grp = vestingCgByGrant.get(key) ?? {
        key,
        year: e.grant_year ?? 0,
        type: e.grant_type ?? '',
        amount: 0,
      }
      grp.amount += e.vesting_cap_gains
      vestingCgByGrant.set(key, grp)
      vestingCgTotal += e.vesting_cap_gains
    }
    if (e.price_cap_gains) priceCgTotal += e.price_cap_gains
  }
  const vestingCgGroups = [...vestingCgByGrant.values()].sort(
    (a, b) => a.year - b.year || a.type.localeCompare(b.type),
  )

  // --- Total Interest: per-loan accrual ---
  type InterestRow = { id: number; label: string; amount: number; note?: string }
  const interestRows: InterestRow[] = []
  let interestTotal = 0
  const interestLoans = loans.filter(l => l.loan_type === 'Interest')
  const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
  // Interest loans booked on or before effYear: they ARE the accrued interest.
  for (const l of interestLoans) {
    if (l.loan_year > effYear) continue
    interestRows.push({
      id: l.id,
      label: `${l.grant_year} ${l.grant_type} interest booked ${l.loan_year}`,
      amount: l.amount,
    })
    interestTotal += l.amount
  }
  // Purchase loans accrue interest each year after loan_year up to min(effYear, dueYear)
  // in years where no explicit Interest loan replaces it.
  for (const p of purchaseLoans) {
    const dueYear = new Date(p.due_date + 'T00:00:00').getFullYear()
    const related = interestLoans.filter(
      l => l.grant_year === p.grant_year && l.grant_type === p.grant_type,
    )
    let accrued = 0
    let years = 0
    for (let yr = p.loan_year + 1; yr <= Math.min(effYear, dueYear); yr++) {
      const exists = related.some(l => l.loan_year === yr)
      if (!exists) {
        accrued += p.amount * p.interest_rate
        // Interest-on-interest for already-booked Interest loans this year
        for (const il of related) {
          if (il.loan_year < yr) accrued += il.amount * il.interest_rate
        }
        years += 1
      }
    }
    if (accrued > 0) {
      interestRows.push({
        id: p.id,
        label: `${p.grant_year} ${p.grant_type} estimated`,
        amount: accrued,
        note: `${(p.interest_rate * 100).toFixed(2)}% × ${years} yr`,
      })
      interestTotal += accrued
    }
  }
  interestRows.sort((a, b) => a.label.localeCompare(b.label))

  // --- Tax Paid: income tax + CG tax + deduction savings ---
  const incomeRate = taxSettings
    ? taxSettings.federal_income_rate + taxSettings.state_income_rate
    : 0
  const taxLoansSum = loans
    .filter(l => l.loan_type === 'Tax' && l.loan_year <= effYear)
    .reduce((sum, l) => sum + l.amount, 0)
  const vestingIncomeTax = events
    .filter(e =>
      e.income > 0 &&
      e.date <= effectiveDate &&
      ((e.event_type === 'Vesting' && !e.election_83b) || e.event_type === 'Grant'),
    )
    .reduce((sum, e) => sum + e.income * incomeRate, 0)
  const cgTaxFromSales = events
    .filter(e => e.event_type === 'Sale' && e.date <= effectiveDate)
    .reduce((sum, e) => sum + (e.estimated_tax ?? 0), 0)
  const stcgRate = taxSettings
    ? taxSettings.federal_st_cg_rate + taxSettings.niit_rate + taxSettings.state_st_cg_rate
    : 0
  const ltcgRate = taxSettings
    ? taxSettings.federal_lt_cg_rate + taxSettings.niit_rate + taxSettings.state_lt_cg_rate
    : 0
  let deductionSavings = 0
  for (const e of events) {
    if (e.date > effectiveDate) break
    deductionSavings += (e.interest_deduction_on_stcg ?? 0) * stcgRate
      + (e.interest_deduction_on_ltcg ?? 0) * ltcgRate
  }

  return {
    cash: { sales: cashSales, totals: cashTotals },
    income: { groups: incomeGroups, total: incomeTotal },
    capGains: {
      vestingGroups: vestingCgGroups,
      vestingTotal: vestingCgTotal,
      priceTotal: priceCgTotal,
      total: vestingCgTotal + priceCgTotal,
    },
    interest: { rows: interestRows, total: interestTotal },
    tax: {
      taxLoans: taxLoansSum,
      vestingIncomeTax,
      cgTaxFromSales,
      deductionSavings,
      total: taxLoansSum + vestingIncomeTax + cgTaxFromSales - deductionSavings,
    },
  }
}


/** What the headline cards show, once the data has arrived. */
export type CardValues = NonNullable<ReturnType<typeof computeCardValues>>
/** The workings behind those cards. */
export type Breakdowns = NonNullable<ReturnType<typeof computeBreakdowns>>
export type GrantHolding = NonNullable<ReturnType<typeof computeGrantHoldings>>[number]
export type ActiveLoan = NonNullable<ReturnType<typeof computeActiveLoans>>[number]
