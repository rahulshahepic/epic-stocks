import { describe, it, expect } from 'vitest'
import {
  outstandingPrincipalAt,
  annualInterestForYear,
  averageAnnualInterest,
  priceAt,
  annualizedAppreciation,
  shiftYears,
  computeBase,
  computeWithDeduction,
  computeTaxEquivSalary,
  computeAll,
  ordinaryRate,
  capGainsRate,
} from '../app/pages/CompCalculator.math.ts'
import type { LoanEntry, LoanPaymentEntry, PriceEntry, SaleEntry } from '../api.ts'

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
  it('multiplies principal by rate', () => {
    const loans = [loan({ amount: 100000, interest_rate: 0.04 })]
    expect(annualInterestForYear(loans, [], [], 2024)).toBeCloseTo(4000, 4)
  })
  it('skips loans matured before the year', () => {
    const loans = [loan({ amount: 100000, interest_rate: 0.04, due_date: '2022-12-31' })]
    expect(annualInterestForYear(loans, [], [], 2024)).toBe(0)
  })
  it('skips loans refinanced in or before the year', () => {
    const loans = [
      loan({ id: 1, amount: 100000, interest_rate: 0.04, loan_year: 2020 }),
      loan({ id: 2, amount: 100000, interest_rate: 0.05, loan_year: 2022, refinances_loan_id: 1 }),
    ]
    // For year 2023: original (id=1) was refinanced by id=2 in 2022, so only id=2 contributes
    expect(annualInterestForYear(loans, [], [], 2023)).toBeCloseTo(5000, 4)
  })
  it('subtracts early payments before the year', () => {
    const loans = [loan({ id: 1, amount: 100000, interest_rate: 0.04 })]
    const payments: LoanPaymentEntry[] = [
      { id: 1, version: 1, loan_id: 1, date: '2022-06-01', amount: 50000, notes: '' },
    ]
    expect(annualInterestForYear(loans, payments, [], 2024)).toBeCloseTo(2000, 4)
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
