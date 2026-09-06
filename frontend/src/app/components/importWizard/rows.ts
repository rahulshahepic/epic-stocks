import { PRE_TAX_TYPES } from '../../grantTypes.ts'
import type {
  BonusGrantRow, CatchUpRow, GrantDraft, PurchaseGrantRow, WizardPrice,
} from './types.ts'
import { addYears, sharesInPeriod } from './types.ts'
import type { WizardSchedule } from './schedule.ts'

/** Epic finances 90% of a purchase, and never asks for more than $20k down. */
const DOWN_PAYMENT_FRACTION = 0.10
const DOWN_PAYMENT_CAP = 20_000

/** The smallest down payment Epic accepts on a purchase of `total` dollars. */
export function minDownPayment(total: number): number {
  return total > 0 ? Math.min(total * DOWN_PAYMENT_FRACTION, DOWN_PAYMENT_CAP) : 0
}

/** The largest loan Epic writes against a purchase of `total` dollars. */
export function maxLoan(total: number): number {
  return total > 0 ? total - minDownPayment(total) : Infinity
}

export function purchaseTotal(row: PurchaseGrantRow): number {
  return (parseFloat(row.purchase_price) || 0) * (parseInt(row.shares) || 0)
}

/** A grant whose vesting is ordinary income: a pre-tax type with a $0 cost basis. */
export function isPreTax(draft: GrantDraft): boolean {
  if (!PRE_TAX_TYPES.has(draft.type)) return false
  const price = parseFloat(draft.price)
  return isNaN(price) || price === 0
}

/** The wizard price for a given year, or 0 if none was entered. */
export function priceForYear(prices: WizardPrice[], year: number): number {
  const match = prices.find(p => p.price && new Date(p.effective_date + 'T00:00:00').getFullYear() === year)
  return match ? parseFloat(match.price) || 0 : 0
}

/** Prices keyed by the year of their effective date, skipping blank rows. */
export function pricesByYear(prices: WizardPrice[]): Map<number, number> {
  const byYear = new Map<number, number>()
  for (const p of prices) {
    if (p.effective_date && p.price) {
      byYear.set(new Date(p.effective_date + 'T00:00:00').getFullYear(), parseFloat(p.price))
    }
  }
  return byYear
}

/**
 * Whether the down-payment-in-stock field applies to a purchase row: the years
 * the company offered the exchange, plus any row already carrying a figure. An
 * import can read one off the gap between cost basis and loan for a year the
 * schedule does not flag, and hiding it would submit a number nobody saw.
 */
export function dpAllowed(s: WizardSchedule, row: PurchaseGrantRow): boolean {
  return s.dpSharesYears.has(row.year) || Math.abs(parseInt(row.dp_shares) || 0) > 0
}

/** Count shares vested from all wizard grants before a target date (checks day before). */
export function vestedSharesBeforeDate(
  dateStr: string,
  rows: { purchaseRows: PurchaseGrantRow[]; catchUpRows: CatchUpRow[]; bonusRows: BonusGrantRow[] },
): number {
  const target = new Date(dateStr + 'T00:00:00')
  target.setDate(target.getDate() - 1)
  let total = 0
  const addVested = (vestStart: string, periods: number, shares: number) => {
    if (!vestStart || !periods || !shares) return
    for (let i = 0; i < periods; i++) {
      if (addYears(vestStart, i) <= target) total += sharesInPeriod(shares, periods, i)
    }
  }
  for (const row of rows.purchaseRows) {
    if (row.participated && parseInt(row.shares) > 0) addVested(row.vest_start, row.periods, parseInt(row.shares))
  }
  for (const row of rows.catchUpRows) {
    if (row.included && parseInt(row.shares) > 0) addVested(row.vest_start, row.periods, parseInt(row.shares))
  }
  for (const row of rows.bonusRows) {
    if (parseInt(row.shares) > 0) addVested(row.vest_start, row.periods, parseInt(row.shares))
  }
  return total
}

/** Count dp_shares consumed by other purchase grants exercised before the target date. */
export function dpSharesConsumedBefore(
  s: WizardSchedule, purchaseRows: PurchaseGrantRow[], exerciseDate: string, excludeYear: number,
): number {
  let consumed = 0
  for (const row of purchaseRows) {
    if (!row.participated || row.year === excludeYear || !dpAllowed(s, row)) continue
    if (row.exercise_date < exerciseDate) consumed += Math.abs(parseInt(row.dp_shares) || 0)
  }
  return consumed
}

/** A purchase row asking for more down-payment shares than prior grants have vested. */
export function dpSharesShortfall(
  s: WizardSchedule, purchaseRows: PurchaseGrantRow[],
  rows: { purchaseRows: PurchaseGrantRow[]; catchUpRows: CatchUpRow[]; bonusRows: BonusGrantRow[] },
  row: PurchaseGrantRow,
): { needed: number; available: number } | null {
  if (!row.participated || !dpAllowed(s, row)) return null
  const needed = Math.abs(parseInt(row.dp_shares) || 0)
  if (needed <= 0) return null
  const available = vestedSharesBeforeDate(row.exercise_date, rows)
    - dpSharesConsumedBefore(s, purchaseRows, row.exercise_date, row.year)
  return needed > available ? { needed, available } : null
}

/**
 * Apply a patch to one purchase row, re-deriving the loan amount from what is
 * left after the down payment — unless the caller set the loan amount itself, or
 * the row carries a loan already saved in the database.
 */
export function recalcLoan(rows: PurchaseGrantRow[], i: number, patch: Partial<PurchaseGrantRow>): PurchaseGrantRow[] {
  return rows.map((r, j) => {
    if (j !== i) return r
    const updated = { ...r, ...patch }
    if ('loan_amount' in patch) return updated
    if (updated.existing_purchase_loan_number && updated.loan_amount) return updated

    const total = purchaseTotal(updated)
    const dpCash = parseFloat(updated.dp_cash) || 0
    const effectiveDp = dpCash > 0 ? dpCash : minDownPayment(total)
    return { ...updated, loan_amount: Math.max(0, total - effectiveDp).toFixed(2) }
  })
}
