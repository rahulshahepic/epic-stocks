// Pure math helpers for the Total Comp Calculator.
// `outstandingPrincipalAt` mirrors the Dashboard's client-side principal IIFE
// (Dashboard.tsx:979-992) which itself mirrors backend `_compute_outstanding_principal`
// (events.py:66). `_build_interest_pool` (events.py:493) is referenced for context.

import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry } from '../../api.ts'

export interface CompInputs {
  loanPrincipal: number       // L: outstanding loan principal (avg over window)
  annualInterest: number      // I: average annual interest over the window
  appreciationRate: number    // r: annualized return over the window (decimal)
}

export interface CompTotals {
  base: number                // r·L − I
  withDeduction: number       // r·L − I·(1−m)
  deductionSavings: number    // I·m
  taxEquivBase: number        // base · (1−c) / (1−m)
  taxEquivWithDeduction: number
  afterTaxBase: number        // base · (1−c)
  afterTaxWithDeduction: number
}

/** Outstanding principal at the given date across all active loans.
 *  Excludes loans that were settled by a linked sale or refinanced by a later loan. */
export function outstandingPrincipalAt(
  loans: LoanEntry[],
  payments: LoanPaymentEntry[],
  sales: SaleEntry[],
  asOf: string,
): number {
  const year = parseInt(asOf.slice(0, 4))
  const settled = new Set(
    sales.filter(s => s.loan_id != null && s.date <= asOf).map(s => s.loan_id as number),
  )
  const refinanced = new Set(
    loans.filter(l => l.refinances_loan_id != null).map(l => l.refinances_loan_id as number),
  )
  const paid = new Map<number, number>()
  for (const p of payments) {
    if (p.date <= asOf) paid.set(p.loan_id, (paid.get(p.loan_id) ?? 0) + p.amount)
  }
  let total = 0
  for (const l of loans) {
    if (l.loan_year > year) continue
    if (settled.has(l.id) || refinanced.has(l.id)) continue
    total += Math.max(0, l.amount - (paid.get(l.id) ?? 0))
  }
  return total
}

/** Annual interest paid (or projected) in calendar year `Y`.
 *
 *  Mirrors Dashboard's per-year interest logic (Dashboard.tsx:1043-1067):
 *  - Recorded Interest-type loans for year `Y`: sum their amounts directly.
 *    (An Interest loan's `amount` IS the recorded interest expense; multiplying
 *    by its rate would double-count compounding.)
 *  - For each Purchase loan active in `Y`, project the year's interest
 *    (principal × rate) only when no Interest loan was recorded for that year.
 *    Add compounding on prior recorded Interest loans for that grant.
 *  - Tax loans don't contribute (taxes are not interest).
 *  - `payments` and `sales` are accepted for symmetry with the principal helper
 *    but are not currently applied — matching Dashboard's behavior.
 */
export function annualInterestForYear(
  loans: LoanEntry[],
  _payments: LoanPaymentEntry[],
  _sales: SaleEntry[],
  year: number,
): number {
  const purchaseLoans = loans.filter(l => l.loan_type === 'Purchase')
  const interestLoans = loans.filter(l => l.loan_type === 'Interest')

  // Recorded interest loans for this year — sum amounts directly.
  let total = interestLoans
    .filter(l => l.loan_year === year)
    .reduce((sum, l) => sum + l.amount, 0)

  // Project interest from Purchase loans for years not covered by recorded Interest loans.
  for (const p of purchaseLoans) {
    const dueYear = parseInt(p.due_date.slice(0, 4))
    if (year <= p.loan_year || year > dueYear) continue
    const related = interestLoans.filter(
      l => l.grant_year === p.grant_year && l.grant_type === p.grant_type,
    )
    if (related.some(l => l.loan_year === year)) continue
    total += p.amount * p.interest_rate
    for (const il of related) {
      if (il.loan_year < year) total += il.amount * il.interest_rate
    }
  }
  return total
}

/** Average annual interest over the W-year window ending at `asOf`. */
export function averageAnnualInterest(
  loans: LoanEntry[],
  payments: LoanPaymentEntry[],
  sales: SaleEntry[],
  asOf: string,
  windowYears: number,
): number {
  const endYear = parseInt(asOf.slice(0, 4))
  if (windowYears < 1) return 0
  let sum = 0
  for (let y = endYear - windowYears + 1; y <= endYear; y++) {
    sum += annualInterestForYear(loans, payments, sales, y)
  }
  return sum / windowYears
}

/** Average outstanding principal across the W-year window ending at `asOf`.
 *  Sample point: Dec 31 of each year in the window. */
export function averageOutstandingPrincipal(
  loans: LoanEntry[],
  payments: LoanPaymentEntry[],
  sales: SaleEntry[],
  asOf: string,
  windowYears: number,
): number {
  const endYear = parseInt(asOf.slice(0, 4))
  if (windowYears < 1) return 0
  let sum = 0
  for (let y = endYear - windowYears + 1; y <= endYear; y++) {
    sum += outstandingPrincipalAt(loans, payments, sales, `${y}-12-31`)
  }
  return sum / windowYears
}

/** Find the price at or before the given date (closest match looking back). */
export function priceAt(prices: PriceEntry[], date: string): number | null {
  const rec = priceRecordAt(prices, date)
  return rec ? rec.price : null
}

/** Find the price record at or before the given date. Useful when callers need
 *  to inspect `is_estimate` (e.g. to mark a year as projected). */
export function priceRecordAt(prices: PriceEntry[], date: string): PriceEntry | null {
  const sorted = [...prices].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  let last: PriceEntry | null = null
  for (const p of sorted) {
    if (p.effective_date <= date) last = p
    else break
  }
  return last
}

/** Annualized appreciation rate over W years ending at `asOf`.
 *  Returns null if either endpoint price is unavailable.
 *  Formula: (P_end / P_start)^(1/W) − 1 */
export function annualizedAppreciation(
  prices: PriceEntry[],
  asOf: string,
  windowYears: number,
): number | null {
  if (windowYears < 1) return null
  const endPrice = priceAt(prices, asOf)
  if (endPrice == null || endPrice <= 0) return null
  const startDate = shiftYears(asOf, -windowYears)
  const startPrice = priceAt(prices, startDate)
  if (startPrice == null || startPrice <= 0) return null
  if (windowYears === 1) return endPrice / startPrice - 1
  return Math.pow(endPrice / startPrice, 1 / windowYears) - 1
}

/** Subtract `n` years from an ISO date string (YYYY-MM-DD). */
export function shiftYears(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCFullYear(dt.getUTCFullYear() + n)
  return dt.toISOString().slice(0, 10)
}

/** Base net comp: appreciation on the loan-funded portion minus interest paid. */
export function computeBase(r: number, L: number, I: number): number {
  return r * L - I
}

/** Net comp with interest tax-deductibility applied.
 *  Effective interest cost = I·(1−m); savings from deduction = I·m. */
export function computeWithDeduction(r: number, L: number, I: number, m: number): number {
  return r * L - I * (1 - m)
}

/** Pretax salary required to match `comp` after tax.
 *  comp is taxed at cap-gains rate `c`; salary at ordinary rate `m`.
 *  After-tax comp = comp·(1−c); pretax salary = after_tax / (1−m).
 *  Returns Infinity if m >= 1 (degenerate). */
export function computeTaxEquivSalary(comp: number, c: number, m: number): number {
  if (m >= 1) return Infinity
  return (comp * (1 - c)) / (1 - m)
}

/** Bundle all four numbers we display on the summary screen. */
export function computeAll(inputs: CompInputs, m: number, c: number): CompTotals {
  const { appreciationRate: r, loanPrincipal: L, annualInterest: I } = inputs
  const base = computeBase(r, L, I)
  const withDeduction = computeWithDeduction(r, L, I, m)
  return {
    base,
    withDeduction,
    deductionSavings: I * m,
    taxEquivBase: computeTaxEquivSalary(base, c, m),
    taxEquivWithDeduction: computeTaxEquivSalary(withDeduction, c, m),
    afterTaxBase: base * (1 - c),
    afterTaxWithDeduction: withDeduction * (1 - c),
  }
}

/** Convenience: marginal ordinary rate from TaxSettings (federal + state, no NIIT). */
export function ordinaryRate(ts: { federal_income_rate: number; state_income_rate: number }): number {
  return ts.federal_income_rate + ts.state_income_rate
}

/** Convenience: blended LT cap-gains rate from TaxSettings (federal + state + NIIT). */
export function capGainsRate(ts: {
  federal_lt_cg_rate: number; state_lt_cg_rate: number; niit_rate: number
}): number {
  return ts.federal_lt_cg_rate + ts.state_lt_cg_rate + ts.niit_rate
}
