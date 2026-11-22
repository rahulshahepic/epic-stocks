import type { PriceEntry, TimelineEvent } from '../../api.ts'
import { localToday } from '../dateUtils.ts'

/** Whether any future price actually differs from today's — what makes a projection worth marking as one. */
export function hasDivergentFuturePrice(prices: PriceEntry[] | null) {
  if (!prices) return false
  const today = localToday()
  const futurePrices = prices.filter(p => p.effective_date > today)
  if (!futurePrices.length) return false
  const pastPrices = prices.filter(p => p.effective_date <= today)
  const currentPrice = pastPrices.length ? pastPrices[pastPrices.length - 1].price : 0
  return futurePrices.some(p => Math.abs(p.price - currentPrice) > 0.005)
}

/** The furthest date anything is known about: the last event or the last price. */
export function maxTimelineDate(events: TimelineEvent[] | null, prices: PriceEntry[] | null) {
  let last = localToday()
  if (events?.length) last = events[events.length - 1].date > last ? events[events.length - 1].date : last
  if (prices?.length) {
    const lp = prices[prices.length - 1].effective_date
    if (lp > last) last = lp
  }
  return last
}

/** The newest real price when it predates this year. Estimates are the user's own
 *  projections, so they do not count as knowing this year's price. */
export function findStalePrice(prices: PriceEntry[] | null) {
  const real = (prices ?? []).filter(p => !p.is_estimate)
  if (real.length === 0) return null
  const newest = real[real.length - 1]
  const today = localToday()
  const year = today.slice(0, 4)
  const applicable = (prices ?? []).filter(p => p.is_estimate && p.effective_date <= today)
  const expected = applicable.at(-1)?.expected_announcement_date ?? `${year}-03-01`
  if (today < expected) return null
  return newest.effective_date.slice(0, 4) < year ? newest : null
}

/** Last substantive event or confirmed price; tentative prices do not move the shortcut. */
export function lastTimelineDate(events: TimelineEvent[] | null) {
  const substantive = events?.filter(e => e.event_type !== 'Share Price' || !(e.is_estimate || e.price_is_estimate))
  return substantive?.at(-1)?.date ?? localToday()
}
