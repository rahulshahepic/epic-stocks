import { describe, it, expect } from 'vitest'
import { MOCK_CONTENT } from './fixtures/content.ts'
import { buildScheduleRows, deriveSchedule } from '../app/components/importWizard/schedule.ts'
import { generateLoansForReview } from '../app/components/importWizard/loans.ts'
import { sanitizeForSubmit } from '../app/components/importWizard/submit.ts'
import type { LoanEntry } from '../api.ts'

// Invented round numbers — never real Epic figures.
const schedule = deriveSchedule(MOCK_CONTENT)
const saved = {
  id: 7, version: 1, year: 2023, type: 'Purchase', shares: 1000, price: 10,
  vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31',
  dp_shares: 0, election_83b: false,
}
const loan = (over: Partial<LoanEntry>): LoanEntry => ({
  id: 11, version: 1, grant_year: 2023, grant_type: 'Purchase', loan_type: 'Interest',
  loan_year: 2023, amount: 300, interest_rate: 0.04, due_date: '2032-12-31',
  loan_number: '500200', refinances_loan_id: null, ...over,
})

function reviewed(loans: LoanEntry[]) {
  const rows = buildScheduleRows(schedule, { prices: [], grants: [saved], loans })
  return generateLoansForReview({
    schedule, prices: rows.prices, purchaseRows: rows.purchaseRows,
    catchUpRows: rows.catchUpRows, bonusRows: rows.bonusRows,
    existingLoans: loans, incomeTaxRate: 0.3,
  })
}

describe('saved loans the estimate slots do not match (#556)', () => {
  it('are listed as they are rather than dropped', () => {
    // A 2023 interest loan on a grant exercised in 2023: the slots start in
    // 2024, so nothing claims it and it used to vanish on submit.
    const out = reviewed([loan({})])
    const kept = out.find(l => l.key === 'saved-11')
    expect(kept).toMatchObject({ loan_number: '500200', amount: '300', enabled: true, is_existing: true })
  })

  it('are not listed twice when a slot already claimed them', () => {
    const out = reviewed([loan({ loan_year: 2024, amount: 360 })])
    expect(out.filter(l => l.loan_number === '500200')).toHaveLength(1)
    expect(out.some(l => l.key === 'saved-11')).toBe(false)
  })

  it('are left to the grant when it is not being submitted', () => {
    const rows = buildScheduleRows(schedule, { prices: [], grants: [], loans: [loan({})] })
    const out = generateLoansForReview({
      schedule, prices: rows.prices, purchaseRows: rows.purchaseRows,
      catchUpRows: rows.catchUpRows, bonusRows: rows.bonusRows,
      existingLoans: [loan({})], incomeTaxRate: 0.3,
    })
    expect(out.some(l => l.key === 'saved-11')).toBe(false)
  })
})

describe('saved prices (#557)', () => {
  it('keep their own date instead of moving to 1 January', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [{ id: 4, version: 1, effective_date: '2023-03-01', price: 10, is_estimate: false }],
      grants: [], loans: [],
    } as never)
    expect(rows.prices).toContainEqual({ effective_date: '2023-03-01', price: '10' })
    expect(rows.prices).toContainEqual({ effective_date: '2024-01-01', price: '' })
  })
})

describe('several saved prices in one year', () => {
  it('all reach the submission rather than only the first', () => {
    // Reported on #554: the table keeps one row per year, and the second price
    // was neither shown nor offered for removal, so submit deleted it.
    const rows = buildScheduleRows(schedule, {
      prices: [
        { id: 4, version: 1, effective_date: '2023-01-01', price: 10, is_estimate: false },
        { id: 5, version: 1, effective_date: '2023-07-01', price: 11, is_estimate: false },
      ],
      grants: [], loans: [],
    } as never)
    const submitted = sanitizeForSubmit(rows.prices, []).prices
    expect(submitted).toContainEqual({ effective_date: '2023-01-01', price: 10 })
    expect(submitted).toContainEqual({ effective_date: '2023-07-01', price: 11 })
    expect(rows.orphanPrices).toEqual([])
  })
})
