import type { LoanEntry } from '../api.ts'

/** Match the server's explicit draw date with the legacy loan-year fallback. */
export function loanIsDrawn(loan: LoanEntry, asOf: string): boolean {
  return loan.loan_year <= Number(asOf.slice(0, 4))
    && (!loan.disbursed_on || loan.disbursed_on <= asOf)
}

/** A refinance replaces its predecessor only once the replacement is drawn. */
export function refinancedLoanIds(loans: LoanEntry[], asOf: string): Set<number> {
  return new Set(loans.filter(l => loanIsDrawn(l, asOf) && l.refinances_loan_id != null
    && l.refinances_loan_id !== l.id).map(l => l.refinances_loan_id!))
}
