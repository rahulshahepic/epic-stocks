import type { VestingDate } from '../api.ts'
import { addCalendarYears } from './dateUtils.ts'

/** Anything with a schedule: a saved grant carries `vesting`; an older shape
 *  carries only its first date and count, read the way the server did then. */
export interface Scheduled {
  shares: number
  vest_start: string
  periods: number
  vesting?: VestingDate[]
}

/** The grant's vesting rows. The server owns the schedule; this only reads it. */
export function vestingOf(g: Scheduled): VestingDate[] {
  if (g.vesting?.length) return g.vesting
  if (!g.vest_start || g.periods <= 0) return []
  const base = Math.floor(g.shares / g.periods)
  const rem = g.shares % g.periods
  return Array.from({ length: g.periods }, (_, p) => ({
    date: addCalendarYears(g.vest_start, p),
    shares: base + (p < rem ? 1 : 0),
  }))
}

/** Shares vested on or before `asOf` (YYYY-MM-DD). */
export function vestedBy(g: Scheduled, asOf: string): number {
  return vestingOf(g).reduce((n, v) => (v.date <= asOf ? n + v.shares : n), 0)
}

/** Equal yearly parts, each rounded down, the rest on the last date — the
 *  same rule the server applies to a first date and a count. */
export function equalParts(shares: number, first: string, count: number): VestingDate[] {
  if (!first || count < 1) return []
  const part = Math.floor(shares / count)
  return Array.from({ length: count }, (_, i) => ({
    date: addCalendarYears(first, i),
    shares: i === count - 1 ? shares - part * (count - 1) : part,
  }))
}

export function scheduleProblem(rows: VestingDate[], shares: number): string | null {
  if (!rows.length) return 'Add at least one vesting date'
  if (rows.some(r => !r.date)) return 'Every row needs a date'
  if (new Set(rows.map(r => r.date)).size !== rows.length) return 'Two rows are on the same day'
  if (rows.some(r => r.shares < 0)) return 'Shares cannot be negative'
  const total = rows.reduce((n, r) => n + r.shares, 0)
  return total === shares ? null
    : `These add up to ${total.toLocaleString()} shares; the grant has ${shares.toLocaleString()}`
}
