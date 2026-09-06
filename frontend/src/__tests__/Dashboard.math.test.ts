import { describe, it, expect } from 'vitest'
import type { LoanEntry, PriceEntry, SaleEntry, TimelineEvent } from '../api.ts'
import {
  computeActiveLoans, findStalePrice, hasDivergentFuturePrice, lastTimelineDate,
  loanStateAsOf, maxTimelineDate,
} from '../app/pages/Dashboard.math.ts'

// Invented round numbers throughout — never real Epic figures.
function loan(over: Partial<LoanEntry> & { id: number }): LoanEntry {
  return {
    version: 1, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Purchase',
    loan_year: 2020, amount: 10_000, interest_rate: 0.05, due_date: '2030-06-30',
    loan_number: null, refinances_loan_id: null, ...over,
  }
}

function sale(over: Partial<SaleEntry> & { id: number }): SaleEntry {
  return {
    version: 1, date: '2024-01-01', shares: 100, price_per_share: 10, notes: '',
    loan_id: null, ...over,
  } as SaleEntry
}

function event(over: Partial<TimelineEvent> & { date: string }): TimelineEvent {
  return {
    event_type: 'Vesting', income: 0, cum_income: 0, cum_cap_gains: 0, cum_shares: 0,
    share_price: 0, ...over,
  } as TimelineEvent
}

const PAYMENT = (date: string, loan_id: number, amount: number) =>
  event({ date, event_type: 'Early Loan Payment', loan_id, amount })

describe('loanStateAsOf', () => {
  const loans = [
    loan({ id: 1 }),
    loan({ id: 2, loan_year: 2021 }),
    loan({ id: 3, loan_year: 2030 }),                     // not issued yet
    loan({ id: 4, refinances_loan_id: null }),
    loan({ id: 5, refinances_loan_id: 4 }),               // 4 was refinanced into 5
  ]

  it('counts a loan issued on or before the year', () => {
    const s = loanStateAsOf(loans, [], null, '2025-06-30')
    expect(loans.filter(s.isOutstanding).map(l => l.id)).toEqual([1, 2, 5])
  })

  it('drops a loan a sale settled, but only once the sale has happened', () => {
    const settled = [sale({ id: 1, loan_id: 2, date: '2024-01-01' })]
    expect(loans.filter(loanStateAsOf(loans, [], settled, '2025-06-30').isOutstanding).map(l => l.id))
      .toEqual([1, 5])
    expect(loans.filter(loanStateAsOf(loans, [], settled, '2023-12-31').isOutstanding).map(l => l.id))
      .toEqual([1, 2, 5])
  })

  it('subtracts early payments made by the date, and never goes negative', () => {
    const events = [PAYMENT('2023-01-01', 1, 4_000), PAYMENT('2024-01-01', 1, 1_000)]
    expect(loanStateAsOf(loans, events, null, '2023-06-30').balanceOf(loans[0])).toBe(6_000)
    expect(loanStateAsOf(loans, events, null, '2025-06-30').balanceOf(loans[0])).toBe(5_000)

    const overpaid = [PAYMENT('2023-01-01', 1, 99_999)]
    expect(loanStateAsOf(loans, overpaid, null, '2025-06-30').balanceOf(loans[0])).toBe(0)
  })

  it('reports what a payoff sale actually cleared', () => {
    const amounts = new Map(loans.map(l => [l.id, l.amount]))
    const s = loanStateAsOf(loans, [PAYMENT('2023-01-01', 1, 4_000)], null, '2025-06-30')
    expect(s.payoffFor(1, amounts)).toBe(6_000)
    expect(s.payoffFor(null, amounts)).toBe(0)   // a sale that pays off no loan
    expect(s.payoffFor(999, amounts)).toBe(0)    // a loan that is not there
  })
})

describe('computeActiveLoans', () => {
  it('lists what is still owed, dropping anything paid down to nothing', () => {
    const loans = [loan({ id: 1 }), loan({ id: 2, amount: 500 })]
    const events = [PAYMENT('2023-01-01', 2, 500)]
    const active = computeActiveLoans(loans, events, null, '2025-06-30')
    expect(active?.map(l => [l.id, l.balance])).toEqual([[1, 10_000]])
  })

  it('is null until the data it needs has arrived', () => {
    expect(computeActiveLoans(null, [], null, '2025-06-30')).toBeNull()
    expect(computeActiveLoans([], null, null, '2025-06-30')).toBeNull()
  })
})

describe('price helpers', () => {
  const price = (effective_date: string, p: number, is_estimate = false): PriceEntry =>
    ({ id: 1, version: 1, effective_date, price: p, is_estimate }) as PriceEntry

  it('only calls a future price divergent when it actually differs', () => {
    const today = new Date().toISOString().slice(0, 10)
    const future = `${new Date().getFullYear() + 5}-01-01`
    expect(hasDivergentFuturePrice([price('2020-01-01', 10), price(future, 10)])).toBe(false)
    expect(hasDivergentFuturePrice([price('2020-01-01', 10), price(future, 12)])).toBe(true)
    expect(hasDivergentFuturePrice([price(today, 10)])).toBe(false)
    expect(hasDivergentFuturePrice(null)).toBe(false)
  })

  it('calls the newest real price stale only when it predates this year', () => {
    const thisYear = new Date().getFullYear()
    expect(findStalePrice([price(`${thisYear - 2}-03-01`, 10)])?.price).toBe(10)
    expect(findStalePrice([price(`${thisYear}-03-01`, 10)])).toBeNull()
    // An estimate is the user's own projection, not knowledge of this year's price.
    expect(findStalePrice([price(`${thisYear - 2}-03-01`, 10), price(`${thisYear}-03-01`, 12, true)])?.price)
      .toBe(10)
    expect(findStalePrice([])).toBeNull()
  })
})

describe('timeline dates', () => {
  it('takes the furthest of the last event and the last price', () => {
    const events = [event({ date: '2030-01-01' })]
    const prices = [{ id: 1, version: 1, effective_date: '2035-01-01', price: 10 } as PriceEntry]
    expect(maxTimelineDate(events, prices)).toBe('2035-01-01')
    expect(maxTimelineDate(events, null)).toBe('2030-01-01')
  })

  it('reports the last scheduled event, projections included', () => {
    expect(lastTimelineDate([event({ date: '2024-01-01' }), event({ date: '2033-01-01' })]))
      .toBe('2033-01-01')
  })
})
