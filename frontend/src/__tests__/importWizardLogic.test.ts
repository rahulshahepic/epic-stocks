import { describe, it, expect } from 'vitest'
import { MOCK_CONTENT } from './fixtures/content.ts'
import {
  buildScheduleRows, deriveSchedule, initPurchaseRows,
} from '../app/components/importWizard/schedule.ts'
import {
  dpSharesShortfall, maxLoan, minDownPayment, priceForYear, recalcLoan, vestedSharesBeforeDate,
} from '../app/components/importWizard/rows.ts'
import { groupByGrant, syncRefiAmounts } from '../app/components/importWizard/loans.ts'
import { buildScheduleGrants, draftToWizardGrant, sanitizeForSubmit } from '../app/components/importWizard/submit.ts'
import { emptyGrantDraft } from '../app/components/importWizard/types.ts'
import type {
  BonusGrantRow, CatchUpRow, PurchaseGrantRow, ReviewedLoan,
} from '../app/components/importWizard/types.ts'

const schedule = deriveSchedule(MOCK_CONTENT)

// Invented round numbers — never real Epic figures.
function purchaseRow(over: Partial<PurchaseGrantRow> = {}): PurchaseGrantRow {
  return {
    year: 2023, vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31',
    participated: true, purchase_price: '10', shares: '1000', dp_shares: '0', dp_cash: '',
    loan_amount: '', loan_due_date: '2032-06-30', interest_rate: '0.05',
    existing_purchase_loan_number: '', existing_refinance_loans: [],
    ...over,
  }
}

describe('deriveSchedule', () => {
  it('reads the grant schedule and rates out of the content blob', () => {
    expect(schedule.grants.filter(g => g.type === 'Purchase').map(g => g.year))
      .toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025])
    // Only the years the schedule flags offer the stock down payment.
    expect([...schedule.dpSharesYears].sort()).toEqual([2023, 2024, 2025])
    expect(schedule.defaultBonusVariant).toBe('C')
    expect(schedule.bonusSchedules.A.periods).toBe(2)
    expect(schedule.taxDueDateByTemplate.get('2020-Bonus')).toBe('2025-07-15')
  })

  it('starts every purchase row blank, with no price of any kind', () => {
    for (const row of initPurchaseRows(schedule)) {
      expect(row.purchase_price).toBe('')
      expect(row.shares).toBe('')
      expect(row.participated).toBe(false)
    }
  })
})

describe('buildScheduleRows', () => {
  it('marks a saved grant as participated and keeps its figures', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [{ id: 1, version: 1, effective_date: '2023-01-01', price: 10 }],
      grants: [{
        id: 7, version: 1, year: 2023, type: 'Purchase', shares: 1000, price: 10,
        vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31',
        dp_shares: -50, election_83b: false,
      }],
      loans: [],
    } as never)
    const row = rows.purchaseRows.find(r => r.year === 2023)!
    expect(row.participated).toBe(true)
    expect(row.shares).toBe('1000')
    expect(row.dp_shares).toBe('50') // stored negative, edited positive
    expect(rows.prices.find(p => p.effective_date.startsWith('2023'))!.price).toBe('10')
    expect(rows.orphanGrants).toEqual([])
  })

  it('orphans a grant the schedule has no entry for, but never a Catch-Up', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [],
      grants: [
        { id: 1, year: 1999, type: 'Purchase', shares: 1, price: 1, vest_start: '2000-01-01', periods: 1, exercise_date: '1999-12-31', dp_shares: 0, election_83b: false },
        { id: 2, year: 2020, type: 'Catch-Up', shares: 100, price: 0, vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', dp_shares: 0, election_83b: false },
      ],
      loans: [],
    } as never)
    expect(rows.orphanGrants.map(g => g.year)).toEqual([1999])
    expect(rows.catchUpRows.find(r => r.year === 2020)!.included).toBe(true)
  })

  it('orphans a price outside the schedule years', () => {
    const rows = buildScheduleRows(schedule, {
      prices: [{ id: 1, effective_date: '1999-01-01', price: 1 }],
      grants: [], loans: [],
    } as never)
    expect(rows.orphanPrices.map(p => p.id)).toEqual([1])
  })
})

describe('down payments and loan amounts', () => {
  it('takes 10% down, capped at $20k', () => {
    expect(minDownPayment(100_000)).toBe(10_000)
    expect(minDownPayment(1_000_000)).toBe(20_000)
    expect(minDownPayment(0)).toBe(0)
    expect(maxLoan(100_000)).toBe(90_000)
    expect(maxLoan(1_000_000)).toBe(980_000)
  })

  it('re-derives the loan from price × shares less the down payment', () => {
    const [row] = recalcLoan([purchaseRow({ loan_amount: '' })], 0, { shares: '1000' })
    expect(row.loan_amount).toBe('9000.00') // 1000 × $10, less $1,000 down
  })

  it('uses cash actually paid over the default down payment', () => {
    const [row] = recalcLoan([purchaseRow()], 0, { dp_cash: '4000' })
    expect(row.loan_amount).toBe('6000.00')
  })

  it('leaves a loan amount the caller set alone', () => {
    const [row] = recalcLoan([purchaseRow()], 0, { loan_amount: '1234.00' })
    expect(row.loan_amount).toBe('1234.00')
  })
})

describe('down payment paid in shares', () => {
  const rows = {
    purchaseRows: [
      purchaseRow({ year: 2020, vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', shares: '1000' }),
      purchaseRow({ year: 2024, vest_start: '2025-09-30', periods: 4, exercise_date: '2024-12-31', shares: '500', dp_shares: '300' }),
    ],
    catchUpRows: [] as CatchUpRow[],
    bonusRows: [] as BonusGrantRow[],
  }

  it('counts only shares vested before the date', () => {
    // The 2020 grant vests 200/yr from Sep 2021, so four vestings land before 2024-12-31.
    expect(vestedSharesBeforeDate('2024-12-31', rows)).toBe(800)
  })

  it('flags a row asking for more shares than have vested', () => {
    const short = dpSharesShortfall(schedule, rows.purchaseRows, rows, rows.purchaseRows[1])
    expect(short).toBeNull() // 300 needed, 800 available

    const greedy = { ...rows.purchaseRows[1], dp_shares: '900' }
    expect(dpSharesShortfall(schedule, [rows.purchaseRows[0], greedy], { ...rows, purchaseRows: [rows.purchaseRows[0], greedy] }, greedy))
      .toEqual({ needed: 900, available: 800 })
  })
})

describe('priceForYear', () => {
  it('finds the price whose effective date falls in that year', () => {
    const prices = [
      { effective_date: '2023-03-01', price: '10' },
      { effective_date: '2024-03-01', price: '' },
    ]
    expect(priceForYear(prices, 2023)).toBe(10)
    expect(priceForYear(prices, 2024)).toBe(0) // blank row does not count
    expect(priceForYear(prices, 2019)).toBe(0)
  })
})

describe('sanitizeForSubmit', () => {
  const grant = draftToWizardGrant(
    { ...emptyGrantDraft('2024'), shares: '100', price: '10', vest_start: '2025-09-30', periods: '4', exercise_date: '2024-12-31' },
    [],
  )

  it('passes a complete grant through untouched', () => {
    const s = sanitizeForSubmit([{ effective_date: '2024-03-01', price: '10' }], [grant])
    expect(s.blockingIssues).toEqual([])
    expect(s.prices).toEqual([{ effective_date: '2024-03-01', price: 10 }])
    expect(s.grants[0].shares).toBe(100)
  })

  it('drops a dated price row with no value, and says so', () => {
    const s = sanitizeForSubmit([{ effective_date: '2024-03-01', price: '' }], [])
    expect(s.prices).toEqual([])
    expect(s.droppedPrices).toEqual([{ effective_date: '2024-03-01', reason: 'no price entered' }])
    expect(s.blockingIssues).toEqual([])
  })

  it('ignores a wholly empty price row in silence', () => {
    const s = sanitizeForSubmit([{ effective_date: '', price: '' }], [])
    expect(s.prices).toEqual([])
    expect(s.droppedPrices).toEqual([])
  })

  it('drops a $0 loan but blocks on one missing its due date', () => {
    const withLoans = {
      ...grant,
      loans: [
        { loan_number: 'A', loan_type: 'Tax' as const, loan_year: 2025, amount: 0, interest_rate: 0.05, due_date: '2030-06-30', refinances_loan_number: '' },
        { loan_number: 'B', loan_type: 'Tax' as const, loan_year: 2025, amount: 500, interest_rate: 0.05, due_date: '', refinances_loan_number: '' },
      ],
    }
    const s = sanitizeForSubmit([], [withLoans])
    expect(s.droppedLoans).toEqual([{ grant: '2024 Purchase', reason: 'Tax loan #A has $0 amount' }])
    expect(s.blockingIssues).toEqual(['2024 Purchase: loan #B is missing a due date'])
    expect(s.grants[0].loans.map(l => l.loan_number)).toEqual(['B'])
  })

  it('blocks on a grant with no shares or no dates', () => {
    const s = sanitizeForSubmit([], [{ ...grant, shares: 0, vest_start: '' }])
    expect(s.blockingIssues).toEqual([
      '2024 Purchase: shares must be greater than 0',
      '2024 Purchase: vesting start date is missing',
    ])
  })
})

describe('buildScheduleGrants', () => {
  const reviewedLoans: ReviewedLoan[] = [{
    key: 'k', grant_year: 2023, grant_type: 'Purchase', loan_type: 'Interest', loan_year: 2024,
    amount: '100', interest_rate: '0.04', due_date: '2032-06-30', loan_number: 'wiz-2023-I2024',
    refinances_loan_number: '', refi_date: '', enabled: true, is_existing: false,
  }]

  it('submits only the rows the user filled in', () => {
    const grants = buildScheduleGrants({
      purchaseRows: [purchaseRow({ loan_amount: '9000' }), purchaseRow({ year: 2024, participated: false })],
      catchUpRows: [{ year: 2023, vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31', included: true, shares: '' }],
      bonusRows: [],
      reviewedLoans,
    })
    expect(grants.map(g => `${g.year} ${g.type}`)).toEqual(['2023 Purchase'])
    // The purchase loan plus the reviewed interest loan.
    expect(grants[0].loans.map(l => l.loan_type)).toEqual(['Purchase', 'Interest'])
    expect(grants[0].loans[0].amount).toBe(9000)
  })

  it('leaves the chain tip as the active loan when a refinance chain exists', () => {
    const chain: ReviewedLoan[] = [
      { ...reviewedLoans[0], key: 'a', loan_type: 'Purchase', loan_number: 'orig', refinances_loan_number: '' },
      { ...reviewedLoans[0], key: 'b', loan_type: 'Purchase', loan_number: 'refi1', refinances_loan_number: 'orig' },
    ]
    const grants = buildScheduleGrants({
      purchaseRows: [purchaseRow({ loan_amount: '9000' })], catchUpRows: [], bonusRows: [], reviewedLoans: chain,
    })
    // No extra "current" loan is invented — that would double the principal.
    expect(grants[0].loans.map(l => l.loan_number)).toEqual(['orig', 'refi1'])
  })

  it('stores down-payment shares as a negative figure', () => {
    const grants = buildScheduleGrants({
      purchaseRows: [purchaseRow({ dp_shares: '50', loan_amount: '9000' })],
      catchUpRows: [], bonusRows: [], reviewedLoans: [],
    })
    expect(grants[0].dp_shares).toBe(-50)
  })
})

describe('syncRefiAmounts', () => {
  it('gives every step of a chain the principal of the loan it started from', () => {
    const base = {
      grant_year: 2018, grant_type: 'Purchase', loan_type: 'Purchase' as const, loan_year: 2018,
      interest_rate: '0.03', due_date: '2025-07-15', refi_date: '', enabled: true, is_existing: false,
    }
    const synced = syncRefiAmounts([
      { ...base, key: '1', loan_number: 'orig', amount: '9000', refinances_loan_number: '' },
      { ...base, key: '2', loan_number: 'r1', amount: '', refinances_loan_number: 'orig' },
      { ...base, key: '3', loan_number: 'r2', amount: '', refinances_loan_number: 'r1' },
    ])
    expect(synced.map(l => l.amount)).toEqual(['9000', '9000', '9000'])
  })

  it('survives a chain that refinances itself', () => {
    const base = {
      grant_year: 2018, grant_type: 'Purchase', loan_type: 'Purchase' as const, loan_year: 2018,
      interest_rate: '0.03', due_date: '2025-07-15', refi_date: '', enabled: true, is_existing: false, amount: '1',
    }
    expect(() => syncRefiAmounts([
      { ...base, key: '1', loan_number: 'a', refinances_loan_number: 'b' },
      { ...base, key: '2', loan_number: 'b', refinances_loan_number: 'a' },
    ])).not.toThrow()
  })
})

describe('groupByGrant', () => {
  it('keeps one heading per grant, in generation order', () => {
    const l = (grant_year: number, grant_type: string, key: string): ReviewedLoan => ({
      key, grant_year, grant_type, loan_type: 'Tax', loan_year: 2024, amount: '1',
      interest_rate: '0.04', due_date: '', loan_number: key, refinances_loan_number: '',
      refi_date: '', enabled: true, is_existing: false,
    })
    expect(groupByGrant([l(2023, 'Bonus', 'a'), l(2022, 'Bonus', 'b'), l(2023, 'Bonus', 'c')])
      .map(([label, loans]) => [label, loans.length]))
      .toEqual([['2023 Bonus', 2], ['2022 Bonus', 1]])
  })
})
