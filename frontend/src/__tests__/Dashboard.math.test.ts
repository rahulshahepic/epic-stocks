import { describe, it, expect, vi } from 'vitest'
import type { PriceEntry, TimelineEvent } from '../api.ts'
import { findStalePrice, hasDivergentFuturePrice, lastTimelineDate, maxTimelineDate } from '../app/pages/Dashboard.math.ts'
function event(over: Partial<TimelineEvent> & { date: string }): TimelineEvent { return over as TimelineEvent }

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

it('does not call last year stale before the expected announcement', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2027-01-15T12:00:00'))
    const rows = [{id: 1, version: 1, effective_date: '2026-01-01', price: 100},
      {id: 2, version: 1, effective_date: '2027-01-01', price: 110, is_estimate: true, expected_announcement_date: '2027-03-01'}]
    expect(findStalePrice(rows)).toBeNull()
    vi.setSystemTime(new Date('2027-03-02T12:00:00'))
    expect(findStalePrice(rows)?.price).toBe(100)
    expect(rows[1].is_estimate).toBe(true)
  } finally { vi.useRealTimers() }
})
