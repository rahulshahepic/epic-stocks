// Pure math helpers for the Total Comp Calculator.
// Mirrors backend semantics in app/routers/events.py:
//   _compute_outstanding_principal (line 66) and _build_interest_pool (line 493).

import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry } from '../../api.ts'

export interface CompInputs {
  loanPrincipal: number       // L: total outstanding loan principal at as_of
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

/** Annual interest paid in calendar year `Y` across all active loans.
 *  For each loan active during that year, contribution = (amount − early_payments_before_Y) × interest_rate.
 *  Early payments mid-year are not prorated — this is a deliberate simplification
 *  to match the user's mental model (annual statement-style interest). */
export function annualInterestForYear(
  loans: LoanEntry[],
  payments: LoanPaymentEntry[],
  sales: SaleEntry[],
  year: number,
): number {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const settledBeforeStart = new Set(
    sales.filter(s => s.loan_id != null && s.date < yearStart).map(s => s.loan_id as number),
  )
  const refinanced = new Set(
    loans.filter(l => l.refinances_loan_id != null).map(l => l.refinances_loan_id as number),
  )
  const paid = new Map<number, number>()
  for (const p of payments) {
    if (p.date < yearStart) paid.set(p.loan_id, (paid.get(p.loan_id) ?? 0) + p.amount)
  }
  let total = 0
  for (const l of loans) {
    if (l.loan_year > year) continue
    if (l.due_date < yearStart) continue            // matured before this year
    if (settledBeforeStart.has(l.id)) continue
    if (refinanced.has(l.id)) {
      // Refinanced loans no longer accrue interest after the refi date.
      // We approximate by including them only if they haven't yet been refinanced by a loan dated within or before this year.
      const successor = loans.find(s => s.refinances_loan_id === l.id)
      if (successor && successor.loan_year <= year) continue
    }
    const principal = Math.max(0, l.amount - (paid.get(l.id) ?? 0))
    total += principal * l.interest_rate
    void yearEnd  // (not needed beyond clarity)
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

/** Find the price at or before the given date (closest match looking back). */
export function priceAt(prices: PriceEntry[], date: string): number | null {
  const sorted = [...prices].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  let last: PriceEntry | null = null
  for (const p of sorted) {
    if (p.effective_date <= date) last = p
    else break
  }
  return last ? last.price : null
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
