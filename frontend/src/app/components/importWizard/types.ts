import type { GrantEntry, LoanEntry, PriceEntry } from '../../../api.ts'
import type { BonusRowType, GrantTypeName } from '../../grantTypes.ts'
import type { WizardGrantTemplate } from '../../../api.ts'

export type GrantType = GrantTypeName

/** A price row mid-edit. `price` is a string so a half-typed value stays valid. */
export interface WizardPrice {
  effective_date: string
  price: string
}

export interface LoanDraft {
  loan_number: string
  loan_type: 'Purchase' | 'Tax'
  loan_year: string
  amount: string
  interest_rate: string
  due_date: string
  refinances_loan_number: string
}

export interface TaxLoanDraft {
  has_loan: boolean
  loan_number: string
  amount: string
  interest_rate: string
  due_date: string
}

export interface GrantDraft {
  year: string
  type: GrantType
  shares: string
  price: string
  vest_start: string
  periods: string
  exercise_date: string
  dp_shares: string
  // loan section
  has_purchase_loan: boolean | null // null = not yet asked
  loans: LoanDraft[] // purchase loan + refinances
  // tax loans (for price=0 grants)
  tax_loans: TaxLoanDraft[] // one entry per vesting year
  tax_loans_asked: boolean
}

export type Screen =
  | 'welcome'
  | 'upload'
  | 'prices'
  | 'grant_entry' // enter shares (+ maybe other fields) for current grant draft
  | 'purchase_loan' // "did you take a loan?" + form
  | 'loan_refinance' // "was this refinanced?" + form
  | 'tax_loans' // tax loans per vesting year (for pre-tax RSU-type)
  | 'more_grants' // "add another grant year?"
  | 'review'
  | 'done'
  | 'schedule_intro'
  | 'schedule_prices' // prices entered BEFORE grants so they can pre-fill cost basis
  | 'schedule_grants'
  | 'schedule_loans_tax' // tax loans review
  | 'schedule_loans_refi' // refinance chains review
  | 'schedule_loans_interest' // interest loans review (uses data from prior two screens)
  | 'schedule_settings' // user preference questions (replaces old tax-rate step)

/** One entry of Epic's own grant schedule, as the wizard uses it. */
export interface KnownGrant {
  year: number
  type: 'Purchase' | BonusRowType
  vest_start: string
  periods: number
  exercise_date: string
  defaultCatchUp: boolean
  showDpShares: boolean
  defaultTaxDueDate: string | null
}

export type BonusSchedule = 'A' | 'B' | 'C'

export interface PurchaseGrantRow {
  year: number; vest_start: string; periods: number; exercise_date: string
  participated: boolean
  purchase_price: string
  shares: string; dp_shares: string; dp_cash: string
  loan_amount: string; loan_due_date: string; interest_rate: string
  existing_purchase_loan_number: string // loan_number from DB, used for merge matching
  existing_refinance_loans: LoanEntry[] // refinance loans loaded from DB, passed through on submit
}

export interface CatchUpRow {
  year: number; vest_start: string; periods: number; exercise_date: string
  included: boolean; shares: string
}

export interface BonusGrantRow {
  year: number; type: BonusRowType
  purchase_price: string; shares: string
  isBonus2020: boolean; schedule: BonusSchedule
  vest_start: string; periods: number; exercise_date: string
}

export interface ReviewedLoan {
  key: string // stable React key
  grant_year: number
  grant_type: string
  loan_type: 'Purchase' | 'Tax' | 'Interest'
  loan_year: number
  amount: string
  interest_rate: string
  due_date: string
  loan_number: string
  refinances_loan_number: string
  refi_date: string // date of refinance (or origination for the first loan in a chain)
  enabled: boolean
  is_existing: boolean // loaded from DB vs auto-generated
}

/** A draft to review instead of the user's saved data — see EpicFileImport. */
export type WizardPrefill = { grants: GrantEntry[]; loans: LoanEntry[]; prices: PriceEntry[] }

export function emptyLoan(type: 'Purchase' | 'Tax' = 'Purchase'): LoanDraft {
  return { loan_number: '', loan_type: type, loan_year: '', amount: '', interest_rate: '', due_date: '', refinances_loan_number: '' }
}

export function emptyGrantDraft(year = '', type: GrantType = 'Purchase', template?: WizardGrantTemplate): GrantDraft {
  return {
    year: String(template?.year ?? year),
    type: (template?.type as GrantType) ?? type,
    shares: '',
    price: template?.price != null ? String(template.price) : (type === 'Purchase' ? '' : '0'),
    vest_start: template?.vest_start ?? '',
    periods: template?.periods != null ? String(template.periods) : '4',
    exercise_date: template?.exercise_date ?? '',
    dp_shares: '0',
    has_purchase_loan: null,
    loans: [],
    tax_loans: [],
    tax_loans_asked: false,
  }
}

export function emptyTaxLoanDraft(): TaxLoanDraft {
  return { has_loan: false, loan_number: '', amount: '', interest_rate: '', due_date: '' }
}

/** Compute vesting dates for a draft grant: [vest_start + 0yr, +1yr, +2yr, ...] */
export function vestingYears(draft: GrantDraft): string[] {
  const start = draft.vest_start
  const periods = parseInt(draft.periods) || 0
  if (!start || !periods) return []
  const base = new Date(start + 'T00:00:00')
  return Array.from({ length: periods }, (_, i) => {
    const d = new Date(base)
    d.setFullYear(d.getFullYear() + i)
    return d.toISOString().slice(0, 10)
  })
}

/** The date `years` after an ISO date, as an ISO date. */
export function addYears(iso: string, years: number): Date {
  const d = new Date(iso + 'T00:00:00')
  d.setFullYear(d.getFullYear() + years)
  return d
}

/** Shares vesting in period `i` of `periods`; the last period takes the remainder. */
export function sharesInPeriod(totalShares: number, periods: number, i: number): number {
  const per = Math.floor(totalShares / periods)
  return i === periods - 1 ? totalShares - per * (periods - 1) : per
}
