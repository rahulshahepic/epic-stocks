import { describe, it, expect } from 'vitest'
import { MOCK_CONTENT } from './fixtures/content.ts'
import { buildScheduleRows, deriveSchedule } from '../app/components/importWizard/schedule.ts'
import {
  carriedGrantKeys, keepCarriedLoans, proposedToWizardGrants,
} from '../app/components/importWizard/submit.ts'
import type { GrantEntry, LoanEntry } from '../api.ts'

// An assistant staged these from paperwork the schedule has never seen. Before,
// the wizard treated them as stale saved data with nothing to delete — so they
// vanished without a word. Invented round numbers.
const schedule = deriveSchedule(MOCK_CONTENT)

const grant = (over: Partial<GrantEntry>): GrantEntry => ({
  id: -1, version: 1, year: 2031, type: 'Purchase', shares: 2000, price: 5,
  vest_start: '2032-09-30', periods: 4, exercise_date: '2031-12-31',
  dp_shares: 0, election_83b: false, ...over,
})
const loan = (over: Partial<LoanEntry>): LoanEntry => ({
  id: -1001, version: 1, grant_year: 2031, grant_type: 'Purchase', loan_type: 'Purchase',
  loan_year: 2031, amount: 9000, interest_rate: 0.04, due_date: '2040-12-31',
  loan_number: '900001', refinances_loan_id: null, ...over,
})

describe('grants an import proposes off the schedule', () => {
  it('are listed for review rather than orphaned', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [],
      grants: [grant({}), grant({ id: -2, year: 2025, type: 'Retention', price: 0 }),
        grant({ id: 9, year: 1999 })],
      loans: [],
    })
    expect(rows.proposedGrants.map(g => g.type)).toEqual(['Purchase', 'Retention'])
    // A saved grant off the schedule is still the user's call to clear out.
    expect(rows.orphanGrants.map(g => g.id)).toEqual([9])
  })

  it('bring their prices into the editable rows', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [{ id: -1, version: 1, effective_date: '2031-01-01', price: 5, is_estimate: false },
        { id: 4, version: 1, effective_date: '1999-01-01', price: 1, is_estimate: false }],
      grants: [], loans: [],
    } as never)
    expect(rows.prices.find(p => p.effective_date === '2031-01-01')?.price).toBe('5')
    expect(rows.orphanPrices.map(p => p.id)).toEqual([4])
  })

  it('are submitted with their own loans and refinance links', () => {
    const [g] = proposedToWizardGrants([grant({})], [
      loan({}),
      loan({ id: -1002, loan_number: '900002', refinances_loan_id: -1001, loan_year: 2032 }),
      loan({ id: -2001, grant_year: 2030 }),
    ])
    expect(g).toMatchObject({ year: 2031, type: 'Purchase', shares: 2000, periods: 4 })
    expect(g.loans.map(l => [l.loan_number, l.refinances_loan_number])).toEqual([
      ['900001', ''], ['900002', '900001'],
    ])
  })
})

describe('saved grants an import does not mention', () => {
  it('keep their own loans rather than the schedule\'s estimates', () => {
    // A hand-entered interest loan the one-per-year model has no slot for was
    // replaced by estimates the moment the user accepted an unrelated grant.
    const saved = grant({ id: 7, year: 2023 })
    const proposed = grant({ id: -1, year: 2023, type: 'Bonus' })
    const carried = carriedGrantKeys([saved, proposed])
    expect([...carried]).toEqual(['2023-Purchase'])

    const built = [
      { ...proposedToWizardGrants([saved], [])[0], loans: [{ loan_number: 'wiz-2023-I2024',
        loan_type: 'Interest' as const, loan_year: 2024, amount: 360, interest_rate: 0.037,
        due_date: '2032-12-31', refinances_loan_number: '' }] },
      proposedToWizardGrants([proposed], [])[0],
    ]
    const kept = keepCarriedLoans(built, carried, [
      loan({ id: 11, grant_year: 2023, loan_type: 'Interest', loan_number: '500200', amount: 300 }),
    ])
    expect(kept[0].loans.map(l => [l.loan_number, l.amount])).toEqual([['500200', 300]])
    expect(kept[1]).toBe(built[1])
  })
})
