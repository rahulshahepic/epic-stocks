import { describe, it, expect } from 'vitest'
import { carriedGrantKeys, keepCarriedLoans } from '../app/components/importWizard/submit.ts'
import type { GrantEntry, LoanEntry, WizardGrant } from '../api.ts'

// Invented round numbers.
const grant = (over: Partial<GrantEntry>): GrantEntry => ({
  id: 7, version: 1, year: 2023, type: 'Purchase', shares: 1000, price: 10,
  vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31',
  dp_shares: 0, election_83b: false, ...over,
})
const loan = (over: Partial<LoanEntry>): LoanEntry => ({
  id: 11, version: 1, grant_year: 2023, grant_type: 'Purchase', loan_type: 'Interest',
  loan_year: 2023, amount: 300, interest_rate: 0.04, due_date: '2032-12-31',
  loan_number: '500200', refinances_loan_id: null, ...over,
})

describe('saved grants an import does not mention', () => {
  it('keep their own loans rather than the schedule\'s estimates', () => {
    // A hand-entered interest loan the one-per-year model has no slot for was
    // replaced by estimates the moment the user accepted an unrelated grant.
    const carried = carriedGrantKeys([grant({}), grant({ id: -1, year: 2026 })])
    expect([...carried]).toEqual(['2023-Purchase'])

    const built: WizardGrant[] = [
      { year: 2023, type: 'Purchase', shares: 1000, price: 10, vest_start: '2024-09-30',
        periods: 4, exercise_date: '2023-12-31', dp_shares: 0, election_83b: false,
        loans: [{ loan_number: 'wiz-2023-I2024', loan_type: 'Interest', loan_year: 2024,
          amount: 360, interest_rate: 0.037, due_date: '2032-12-31', refinances_loan_number: '' }] },
      { year: 2026, type: 'Purchase', shares: 2000, price: 5, vest_start: '2027-09-30',
        periods: 4, exercise_date: '2026-12-31', dp_shares: 0, election_83b: false, loans: [] },
    ]
    const kept = keepCarriedLoans(built, carried, [
      loan({}), loan({ id: 12, loan_type: 'Purchase', loan_number: '500100', amount: 9000 }),
      loan({ id: 13, loan_number: '500300', refinances_loan_id: 12 }),
    ])
    expect(kept[0].loans.map(l => [l.loan_number, l.amount, l.refinances_loan_number])).toEqual([
      ['500200', 300, ''], ['500100', 9000, ''], ['500300', 300, '500100'],
    ])
    expect(kept[1]).toBe(built[1])
  })
})
