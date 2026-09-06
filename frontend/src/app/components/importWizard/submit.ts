import type { WizardGrant, WizardLoan } from '../../../api.ts'
import type { BonusRowType } from '../../grantTypes.ts'
import { reviewedToWizardLoans } from './loans.ts'
import type {
  BonusGrantRow, CatchUpRow, GrantDraft, LoanDraft, PurchaseGrantRow, ReviewedLoan, WizardPrice,
} from './types.ts'

export interface SanitizedSubmission {
  grants: WizardGrant[]
  prices: { effective_date: string; price: number }[]
  droppedLoans: { grant: string; reason: string }[]
  droppedPrices: { effective_date: string; reason: string }[]
  blockingIssues: string[]
}

/**
 * Drop empty/zero rows that the backend would reject and surface what's left.
 * - Loans with amount ≤ 0 are silently skipped (with a warning shown on Review).
 * - Prices with empty/non-positive value are silently skipped (with a warning).
 * - Anything else that the backend would reject (missing dates, zero shares,
 *   etc.) becomes a blocking issue — surfaced per row, submit disabled.
 */
export function sanitizeForSubmit(prices: WizardPrice[], grants: WizardGrant[]): SanitizedSubmission {
  const droppedLoans: { grant: string; reason: string }[] = []
  const droppedPrices: { effective_date: string; reason: string }[] = []
  const blockingIssues: string[] = []

  const cleanPrices: { effective_date: string; price: number }[] = []
  for (const p of prices) {
    if (!p.effective_date) continue // empty row — placeholder, ignore silently
    const trimmed = p.price.trim?.() ?? p.price
    const num = parseFloat(trimmed)
    if (!trimmed || isNaN(num) || num <= 0) {
      droppedPrices.push({
        effective_date: p.effective_date,
        reason: !trimmed ? 'no price entered' : 'price must be greater than 0',
      })
      continue
    }
    cleanPrices.push({ effective_date: p.effective_date, price: num })
  }

  const cleanGrants: WizardGrant[] = grants.map(g => {
    const tag = `${g.year} ${g.type}`
    const cleanLoans: WizardLoan[] = []
    for (const l of g.loans) {
      const loanTag = `${tag}: loan${l.loan_number ? ` #${l.loan_number}` : ''}`
      if (!(l.amount > 0)) {
        droppedLoans.push({
          grant: tag,
          reason: `${l.loan_type} loan${l.loan_number ? ` #${l.loan_number}` : ''} has $0 amount`,
        })
        continue
      }
      if (l.interest_rate < 0) blockingIssues.push(`${loanTag} has a negative interest rate`)
      if (!l.due_date) blockingIssues.push(`${loanTag} is missing a due date`)
      if (!l.loan_year) blockingIssues.push(`${loanTag} is missing a loan year`)
      cleanLoans.push(l)
    }
    return { ...g, loans: cleanLoans }
  })

  for (const g of cleanGrants) {
    const tag = `${g.year || '(no year)'} ${g.type}`
    if (g.year < 1900 || g.year > 2100) blockingIssues.push(`${tag}: grant year is missing or out of range`)
    if (!g.shares || g.shares <= 0) blockingIssues.push(`${tag}: shares must be greater than 0`)
    if (!g.periods || g.periods <= 0) blockingIssues.push(`${tag}: vesting periods must be greater than 0`)
    if (!g.vest_start) blockingIssues.push(`${tag}: vesting start date is missing`)
    if (!g.exercise_date) blockingIssues.push(`${tag}: exercise date is missing`)
    if (g.price < 0) blockingIssues.push(`${tag}: price cannot be negative`)
  }

  return { grants: cleanGrants, prices: cleanPrices, droppedLoans, droppedPrices, blockingIssues }
}

/** Turn one hand-entered grant draft and its loans into a submittable grant. */
export function draftToWizardGrant(draft: GrantDraft, loans: LoanDraft[]): WizardGrant {
  return {
    year: parseInt(draft.year) || 0,
    type: draft.type,
    shares: parseInt(draft.shares) || 0,
    price: parseFloat(draft.price) || 0,
    vest_start: draft.vest_start,
    periods: parseInt(draft.periods) || 0,
    exercise_date: draft.exercise_date,
    dp_shares: -(Math.abs(parseInt(draft.dp_shares) || 0)),
    election_83b: false,
    loans: loans.map(l => ({
      loan_number: l.loan_number,
      loan_type: l.loan_type,
      loan_year: parseInt(l.loan_year) || 0,
      amount: parseFloat(l.amount) || 0,
      interest_rate: parseFloat(l.interest_rate) || 0,
      due_date: l.due_date,
      refinances_loan_number: l.refinances_loan_number,
    })),
  }
}

export interface ScheduleRowsForSubmit {
  purchaseRows: PurchaseGrantRow[]
  catchUpRows: CatchUpRow[]
  bonusRows: BonusGrantRow[]
  reviewedLoans: ReviewedLoan[]
}

/** Turn the schedule-path tables and the reviewed loans into submittable grants. */
export function buildScheduleGrants(rows: ScheduleRowsForSubmit): WizardGrant[] {
  const { reviewedLoans } = rows
  return [
    ...rows.purchaseRows
      .filter(r => r.participated && parseInt(r.shares) > 0)
      .map(r => {
        const extraLoans = reviewedToWizardLoans(reviewedLoans, r.year, 'Purchase')
        // Find the last refinance in the chain so the current purchase loan references it
        const refiChain = extraLoans.filter(l => l.loan_type === 'Purchase' && l.refinances_loan_number)
        const lastRefiNum = refiChain.length > 0 ? refiChain[refiChain.length - 1].loan_number : ''
        // When a refi chain exists, the last entry in the chain IS the active loan.
        // Don't create a separate "current" loan — it would duplicate the original's
        // terms and generate a spurious payoff event at the old due date.
        const currentLoan: WizardLoan[] = refiChain.length > 0 ? [] : [{
          loan_number: r.existing_purchase_loan_number || `wiz-${r.year}-0`,
          loan_type: 'Purchase' as const, loan_year: r.year,
          amount: parseFloat(r.loan_amount)
            || Math.max(0, (parseInt(r.shares) || 0) * (parseFloat(r.purchase_price) || 0) - (parseFloat(r.dp_cash) || 0)),
          interest_rate: parseFloat(r.interest_rate) || 0,
          due_date: r.loan_due_date,
          refinances_loan_number: lastRefiNum,
        }]
        return {
          year: r.year, type: 'Purchase' as const,
          shares: parseInt(r.shares) || 0,
          price: parseFloat(r.purchase_price) || 0,
          vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
          dp_shares: -(Math.abs(parseInt(r.dp_shares) || 0)),
          election_83b: false,
          loans: [...currentLoan, ...extraLoans],
        }
      }),
    ...rows.catchUpRows
      .filter(r => r.included && parseInt(r.shares) > 0)
      .map(r => ({
        year: r.year, type: 'Catch-Up' as const,
        shares: parseInt(r.shares) || 0, price: 0,
        vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
        dp_shares: 0, election_83b: false,
        loans: reviewedToWizardLoans(reviewedLoans, r.year, 'Catch-Up'),
      })),
    ...rows.bonusRows
      .filter(r => parseInt(r.shares) > 0)
      .map(r => ({
        year: r.year, type: r.type as BonusRowType,
        shares: parseInt(r.shares) || 0,
        price: parseFloat(r.purchase_price) || 0,
        vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
        dp_shares: 0, election_83b: false,
        loans: reviewedToWizardLoans(reviewedLoans, r.year, r.type),
      })),
  ]
}
