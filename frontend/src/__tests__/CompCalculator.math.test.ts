import { describe, it, expect } from 'vitest'
import {
  outstandingPrincipalAt,
  annualInterestForYear,
  averageAnnualInterest,
  averageOutstandingPrincipal,
  averageAdjustedPrincipal,
  unvestedPrincipalAt,
  priceAt,
  priceRecordAt,
  annualizedAppreciation,
  shiftYears,
  computeBase,
  computeWithDeduction,
  computeTaxEquivSalary,
  computeAll,
  ordinaryRate,
  capGainsRate,
} from '../app/pages/CompCalculator.math.ts'
import type { GrantEntry, LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry } from '../api.ts'

function loan(over: Partial<LoanEntry> = {}): LoanEntry {
  return {
    id: 1, version: 1, grant_year: 2020, grant_type: 'Purchase',
    loan_type: 'Purchase', loan_year: 2020, amount: 100000, interest_rate: 0.04,
    due_date: '2030-12-31', loan_number: 'L1', refinances_loan_id: null,
    ...over,
  }
}

describe('shiftYears', () => {
  it('subtracts whole years', () => {
    expect(shiftYears('2025-06-15', -3)).toBe('2022-06-15')
  })
  it('adds whole years', () => {
    expect(shiftYears('2020-01-31', 5)).toBe('2025-01-31')
  })
})

describe('priceAt', () => {
  const prices: PriceEntry[] = [
    { id: 1, version: 1, effective_date: '2020-03-01', price: 100 },
    { id: 2, version: 1, effective_date: '2021-03-01', price: 110 },
    { id: 3, version: 1, effective_date: '2022-03-01', price: 125 },
  ]
  it('returns price on or before date', () => {
    expect(priceAt(prices, '2021-06-15')).toBe(110)
  })
  it('returns latest before earliest date', () => {
    expect(priceAt(prices, '2019-12-31')).toBeNull()
  })
  it('matches exact date', () => {
    expect(priceAt(prices, '2022-03-01')).toBe(125)
  })
})

describe('priceRecordAt', () => {
  const prices: PriceEntry[] = [
    { id: 1, version: 1, effective_date: '2020-12-31', price: 100 },
    { id: 2, version: 1, effective_date: '2023-12-31', price: 130, is_estimate: true },
  ]
  it('returns the full record on or before date', () => {
    expect(priceRecordAt(prices, '2024-06-01')).toMatchObject({ id: 2, is_estimate: true })
  })
  it('returns null when no price exists yet', () => {
    expect(priceRecordAt(prices, '2019-01-01')).toBeNull()
  })
  it('returns the actual record when one exists, regardless of estimate status', () => {
    expect(priceRecordAt(prices, '2021-06-01')).toMatchObject({ id: 1 })
    expect(priceRecordAt(prices, '2021-06-01')?.is_estimate).toBeFalsy()
  })
})

describe('annualizedAppreciation', () => {
  const prices: PriceEntry[] = [
    { id: 1, version: 1, effective_date: '2020-12-31', price: 100 },
    { id: 2, version: 1, effective_date: '2023-12-31', price: 133.1 },
  ]
  it('computes 1-year simple ratio', () => {
    const single = [
      { id: 1, version: 1, effective_date: '2022-12-31', price: 100 },
      { id: 2, version: 1, effective_date: '2023-12-31', price: 110 },
    ] as PriceEntry[]
    const r = annualizedAppreciation(single, '2023-12-31', 1)
    expect(r).toBeCloseTo(0.1, 4)
  })
  it('computes 3-year CAGR', () => {
    const r = annualizedAppreciation(prices, '2023-12-31', 3)
    expect(r).toBeCloseTo(0.1, 3) // (133.1/100)^(1/3) - 1 = 0.1
  })
  it('returns null when start price unavailable', () => {
    expect(annualizedAppreciation([prices[1]], '2023-12-31', 3)).toBeNull()
  })
  it('returns null when end price unavailable', () => {
    expect(annualizedAppreciation(prices, '2019-12-31', 1)).toBeNull()
  })
})

describe('outstandingPrincipalAt', () => {
  it('sums active loans not yet matured', () => {
    const loans = [loan({ id: 1, amount: 100 }), loan({ id: 2, amount: 200, loan_year: 2021 })]
    const total = outstandingPrincipalAt(loans, [], [], '2025-12-31')
    expect(total).toBe(300)
  })
  it('excludes loans whose loan_year is after the date', () => {
    const loans = [loan({ id: 1, amount: 100, loan_year: 2025 })]
    expect(outstandingPrincipalAt(loans, [], [], '2024-12-31')).toBe(0)
  })
  it('excludes settled (sale-linked) loans', () => {
    const loans = [loan({ id: 1, amount: 100 }), loan({ id: 2, amount: 200 })]
    const sales: SaleEntry[] = [{
      id: 1, version: 1, date: '2024-01-15', shares: 10, price_per_share: 50,
      notes: '', loan_id: 1,
    } as SaleEntry]
    expect(outstandingPrincipalAt(loans, [], sales, '2025-01-01')).toBe(200)
  })
  it('excludes refinanced loans', () => {
    const loans = [
      loan({ id: 1, amount: 100, loan_year: 2020 }),
      loan({ id: 2, amount: 100, loan_year: 2022, refinances_loan_id: 1 }),
    ]
    expect(outstandingPrincipalAt(loans, [], [], '2025-01-01')).toBe(100)
  })
  it('subtracts early payments', () => {
    const loans = [loan({ id: 1, amount: 100 })]
    const payments: LoanPaymentEntry[] = [
      { id: 1, version: 1, loan_id: 1, date: '2023-06-01', amount: 30, notes: '' },
    ]
    expect(outstandingPrincipalAt(loans, payments, [], '2025-01-01')).toBe(70)
  })
})

describe('annualInterestForYear', () => {
  it('projects Purchase principal × rate for years with no recorded Interest loan', () => {
    const loans = [loan({ loan_type: 'Purchase', amount: 100000, interest_rate: 0.04 })]
    expect(annualInterestForYear(loans, [], [], 2024)).toBeCloseTo(4000, 4)
  })
  it('skips loans matured before the year', () => {
    const loans = [loan({ amount: 100000, interest_rate: 0.04, due_date: '2022-12-31' })]
    expect(annualInterestForYear(loans, [], [], 2024)).toBe(0)
  })
  it('refinanced original is dropped via its due_date (matches Epic refi flow)', () => {
    const loans = [
      loan({ id: 1, amount: 100000, interest_rate: 0.04, loan_year: 2020, due_date: '2022-12-31' }),
      loan({ id: 2, amount: 100000, interest_rate: 0.05, loan_year: 2022, due_date: '2030-12-31', refinances_loan_id: 1 }),
    ]
    // For year 2023: original matured at end of 2022, only the refi (id=2) contributes.
    expect(annualInterestForYear(loans, [], [], 2023)).toBeCloseTo(5000, 4)
  })
  it('ignores Tax loans (taxes do not accrue interest)', () => {
    const loans = [loan({ loan_type: 'Tax', amount: 100000, interest_rate: 0.04 })]
    expect(annualInterestForYear(loans, [], [], 2024)).toBe(0)
  })
  it('sums recorded Interest loan amounts directly (no rate multiplication)', () => {
    const loans = [
      loan({ id: 1, loan_type: 'Purchase', amount: 100000, interest_rate: 0.04, loan_year: 2020, grant_year: 2020, grant_type: 'Purchase' }),
      loan({ id: 2, loan_type: 'Interest', amount: 4000, interest_rate: 0.04, loan_year: 2024, grant_year: 2020, grant_type: 'Purchase' }),
    ]
    // For 2024: Interest loan is recorded → use its amount; Purchase doesn't double-count.
    expect(annualInterestForYear(loans, [], [], 2024)).toBe(4000)
  })
  it('compounds on prior Interest loans when projecting later years', () => {
    const loans = [
      loan({ id: 1, loan_type: 'Purchase', amount: 100000, interest_rate: 0.04, loan_year: 2020, grant_year: 2020, grant_type: 'Purchase' }),
      loan({ id: 2, loan_type: 'Interest', amount: 4000, interest_rate: 0.04, loan_year: 2024, grant_year: 2020, grant_type: 'Purchase' }),
    ]
    // For 2025 (no recorded Interest): 100k × 0.04 + 4k × 0.04 = 4160
    expect(annualInterestForYear(loans, [], [], 2025)).toBeCloseTo(4160, 4)
  })
})

describe('averageAnnualInterest', () => {
  it('averages over the window', () => {
    const loans = [loan({ amount: 100000, interest_rate: 0.04 })]
    expect(averageAnnualInterest(loans, [], [], '2024-12-31', 3)).toBeCloseTo(4000, 4)
  })
  it('returns 0 for empty window', () => {
    expect(averageAnnualInterest([], [], [], '2024-12-31', 0)).toBe(0)
  })
})

describe('averageOutstandingPrincipal', () => {
  it('averages year-end principal across the window', () => {
    // loan 1 starts 2020 at $100, loan 2 starts 2023 at $200
    const loans = [
      loan({ id: 1, amount: 100, loan_year: 2020 }),
      loan({ id: 2, amount: 200, loan_year: 2023 }),
    ]
    // 3-year window ending 2024: 2022=100, 2023=300, 2024=300 → avg ≈ 233.33
    expect(averageOutstandingPrincipal(loans, [], [], '2024-12-31', 3)).toBeCloseTo(233.33, 1)
  })
  it('1-year window equals year-end principal', () => {
    const loans = [loan({ amount: 100, loan_year: 2020 })]
    expect(averageOutstandingPrincipal(loans, [], [], '2024-12-31', 1)).toBe(100)
  })
})

describe('computeBase', () => {
  it('appreciates loan principal minus interest', () => {
    expect(computeBase(0.1, 4_000_000, 50_000)).toBe(350_000)
  })
  it('handles r=0', () => {
    expect(computeBase(0, 4_000_000, 50_000)).toBe(-50_000)
  })
  it('handles L=0', () => {
    expect(computeBase(0.1, 0, 50_000)).toBe(-50_000)
  })
  it('can be negative', () => {
    expect(computeBase(0.01, 1_000_000, 50_000)).toBe(-40_000)
  })
})

describe('computeWithDeduction', () => {
  it('m=0 reduces to base', () => {
    expect(computeWithDeduction(0.1, 4_000_000, 50_000, 0)).toBe(350_000)
  })
  it('m=1 ignores interest cost entirely', () => {
    expect(computeWithDeduction(0.1, 4_000_000, 50_000, 1)).toBe(400_000)
  })
  it('half-rate halves interest cost', () => {
    expect(computeWithDeduction(0.1, 4_000_000, 50_000, 0.5)).toBe(375_000)
  })
})

describe('computeTaxEquivSalary', () => {
  it('m=c returns same comp', () => {
    expect(computeTaxEquivSalary(100_000, 0.4, 0.4)).toBeCloseTo(100_000, 4)
  })
  it('lower cap-gains rate means salary > comp', () => {
    expect(computeTaxEquivSalary(100_000, 0.2, 0.4)).toBeCloseTo(133_333.33, 1)
  })
  it('returns Infinity when m >= 1', () => {
    expect(computeTaxEquivSalary(100_000, 0.2, 1)).toBe(Infinity)
  })
})

describe('computeAll', () => {
  it('produces all derived numbers', () => {
    const totals = computeAll(
      { loanPrincipal: 4_000_000, annualInterest: 50_000, appreciationRate: 0.1 },
      0.4, 0.25,
    )
    expect(totals.base).toBe(350_000)
    expect(totals.deductionSavings).toBe(20_000)
    expect(totals.withDeduction).toBe(370_000)
    expect(totals.afterTaxBase).toBeCloseTo(262_500, 1)
    expect(totals.taxEquivBase).toBeCloseTo(437_500, 1)
  })
})

function grant(over: Partial<GrantEntry> = {}): GrantEntry {
  return {
    id: 1, version: 1, year: 2020, type: 'Purchase',
    shares: 10000, price: 10, vest_start: '2021-03-01', periods: 5,
    exercise_date: '2020-09-01', dp_shares: 0, election_83b: false,
    ...over,
  }
}

describe('unvestedPrincipalAt', () => {
  // Grant: 10,000 shares, 5 periods, vest_start 2021-03-01
  // Tranches vest: 2021-03-01, 2022-03-01, 2023-03-01, 2024-03-01, 2025-03-01 (2000 each)
  const g = grant()
  const l = loan({ id: 1, amount: 100000, grant_year: 2020, grant_type: 'Purchase' })

  it('returns 0 when no exit date effect (all vested)', () => {
    // Exit after all tranches vest → 0 unvested
    expect(unvestedPrincipalAt([l], [], [], [g], '2025-12-31', '2026-01-01')).toBe(0)
  })

  it('returns full loan when exit before any vesting', () => {
    // Exit 2020-12-31 → all 5 tranches unvested → fraction=1
    expect(unvestedPrincipalAt([l], [], [], [g], '2025-12-31', '2020-12-31')).toBe(100000)
  })

  it('computes correct unvested fraction mid-vesting', () => {
    // Exit 2023-06-30 → tranches 2021, 2022, 2023 vest (6000/10000); 2024, 2025 unvested (4000/10000)
    const unvested = unvestedPrincipalAt([l], [], [], [g], '2025-12-31', '2023-06-30')
    expect(unvested).toBeCloseTo(40000, 1) // 40% × $100,000
  })

  it('includes Interest loans in the unvested fraction', () => {
    const interestLoan = loan({ id: 2, loan_type: 'Interest', amount: 4000, loan_year: 2021, grant_year: 2020, grant_type: 'Purchase' })
    // Exit 2023-06-30: 40% unvested on both Purchase ($100k) and Interest ($4k)
    const unvested = unvestedPrincipalAt([l, interestLoan], [], [], [g], '2025-12-31', '2023-06-30')
    expect(unvested).toBeCloseTo(41600, 1) // 40% × $104,000
  })

  it('excludes Tax loans from unvested calculation', () => {
    const taxLoan = loan({ id: 3, loan_type: 'Tax', amount: 5000, grant_year: 2020, grant_type: 'Purchase' })
    const unvested = unvestedPrincipalAt([l, taxLoan], [], [], [g], '2025-12-31', '2023-06-30')
    expect(unvested).toBeCloseTo(40000, 1) // Tax loan not included
  })

  it('skips grants with no matching loans', () => {
    const otherGrant = grant({ id: 2, year: 2022, type: 'Bonus' })
    // otherGrant has no loans → no additional unvested principal
    expect(unvestedPrincipalAt([l], [], [], [g, otherGrant], '2025-12-31', '2023-06-30')).toBeCloseTo(40000, 1)
  })

  it('handles remainder shares correctly for uneven periods', () => {
    // 10 shares, 3 periods → tranches: 4, 3, 3 (base=3, rem=1)
    const g3 = grant({ shares: 10, periods: 3, vest_start: '2021-01-01' })
    const l3 = loan({ id: 10, amount: 90000, grant_year: 2020, grant_type: 'Purchase' })
    // Exit after first tranche (2021-01-01) only: 2nd (2022) and 3rd (2023) unvested = 6/10
    const unvested = unvestedPrincipalAt([l3], [], [], [g3], '2025-12-31', '2021-06-01')
    expect(unvested).toBeCloseTo(54000, 1) // 60% × $90,000
  })

  it('subtracts early payments before applying fraction', () => {
    const payment: LoanPaymentEntry = { id: 1, version: 1, loan_id: 1, date: '2022-01-01', amount: 20000, notes: '' }
    // Outstanding = $80,000; 40% unvested = $32,000
    const unvested = unvestedPrincipalAt([l], [payment], [], [g], '2025-12-31', '2023-06-30')
    expect(unvested).toBeCloseTo(32000, 1)
  })

  it('returns 0 for grant with zero shares', () => {
    const emptyGrant = grant({ shares: 0 })
    expect(unvestedPrincipalAt([l], [], [], [emptyGrant], '2025-12-31', '2023-06-30')).toBe(0)
  })
})

describe('averageAdjustedPrincipal', () => {
  const g = grant()
  const l = loan({ id: 1, amount: 100000, grant_year: 2020, grant_type: 'Purchase' })

  it('equals outstandingPrincipalAt when all vested by exit date', () => {
    // Exit in 2030, all tranches already vest by 2025 → no adjustment
    const adjusted = averageAdjustedPrincipal([l], [], [], [g], '2025-12-31', 1, '2030-01-01')
    expect(adjusted).toBe(100000)
  })

  it('reduces principal by unvested fraction', () => {
    // Exit 2023-06-30: 40% unvested → effective = $60,000; 1-year window
    const adjusted = averageAdjustedPrincipal([l], [], [], [g], '2025-12-31', 1, '2023-06-30')
    expect(adjusted).toBeCloseTo(60000, 1)
  })

  it('averages adjusted values across the window', () => {
    // 3-year window ending 2025; same unvested fraction each year
    // Exit 2023-06-30 → all three years have 40% unvested: avg = $60,000
    const adjusted = averageAdjustedPrincipal([l], [], [], [g], '2025-12-31', 3, '2023-06-30')
    expect(adjusted).toBeCloseTo(60000, 1)
  })

  it('returns 0 for zero-length window', () => {
    expect(averageAdjustedPrincipal([l], [], [], [g], '2025-12-31', 0, '2030-01-01')).toBe(0)
  })
})

describe('rate helpers', () => {
  it('ordinaryRate sums federal+state income', () => {
    expect(ordinaryRate({ federal_income_rate: 0.32, state_income_rate: 0.05 })).toBeCloseTo(0.37, 4)
  })
  it('capGainsRate sums federal+state LT + NIIT', () => {
    expect(capGainsRate({
      federal_lt_cg_rate: 0.20, state_lt_cg_rate: 0.05, niit_rate: 0.038,
    })).toBeCloseTo(0.288, 4)
  })
})
