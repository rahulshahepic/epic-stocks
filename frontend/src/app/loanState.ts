import type { LoanEntry } from '../api.ts'

/** Origination is stored by year; a refinance takes effect in that year. */
export function refinancedLoanIds(loans: LoanEntry[], asOf: string): Set<number> {
  const year = Number(asOf.slice(0, 4))
  return new Set(loans.filter(l => l.loan_year <= year && l.refinances_loan_id != null
    && l.refinances_loan_id !== l.id).map(l => l.refinances_loan_id!))
}
