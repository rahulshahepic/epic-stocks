import type { ContentBlob, GrantEntry, LoanEntry, PriceEntry } from '../../../api.ts'
import { ZERO_BASIS_TYPES, isBonusRowType } from '../../grantTypes.ts'
import type { BonusRowType } from '../../grantTypes.ts'
import type {
  BonusGrantRow, BonusSchedule, CatchUpRow, KnownGrant, PurchaseGrantRow, WizardPrice,
} from './types.ts'

/** One step of a purchase-loan refinance chain. */
export interface PurchaseRefiStep { date: string; rate: number; loanYear: number; dueDate: string }

/** One step of a tax-loan refinance chain, which also rewrites the due date. */
export interface TaxRefiStep { date: string; rate: number; loanYear: number; origDueDate: string; newDueDate: string }

/**
 * Epic's grant schedule and loan rates, in the shape the wizard works in.
 *
 * All of it is admin-managed content fetched once per session; deriving it is
 * pure, so the wizard memoises one of these rather than rebuilding the maps on
 * every keystroke.
 */
export interface WizardSchedule {
  grants: KnownGrant[]
  /** Purchase years where shares could be exchanged as a down payment. */
  dpSharesYears: Set<number>
  /** Admin-set tax-loan due dates, keyed `${year}-${type}`; otherwise inherited. */
  taxDueDateByTemplate: Map<string, string>
  bonusSchedules: Record<BonusSchedule, { periods: number }>
  /** `${year}-${type}` keys that offered a choice of vesting schedule. */
  bonusVariantKeys: Set<string>
  defaultBonusVariant: BonusSchedule
  fallbackTaxRate: number
  priceYears: number[]
  interestLoanRates: Record<number, number>
  taxLoanRates: Record<string, Record<number, number>>
  originalPurchaseLoans: Record<number, { rate: number; dueDate: string }>
  purchaseRefiChains: Record<number, PurchaseRefiStep[]>
  taxLoanRefis: Record<string, TaxRefiStep[]>
}

export function deriveSchedule(content: ContentBlob): WizardSchedule {
  const grants: KnownGrant[] = content.grant_templates.map(g => ({
    year: g.year,
    type: g.type as KnownGrant['type'],
    vest_start: g.vest_start,
    periods: g.periods,
    exercise_date: g.exercise_date,
    defaultCatchUp: g.default_catch_up,
    showDpShares: g.show_dp_shares,
    defaultTaxDueDate: g.default_tax_due_date,
  }))

  const settings = content.grant_program_settings
  const priceYears: number[] = []
  for (let y = settings.price_years_start; y <= settings.price_years_end; y++) priceYears.push(y)

  return {
    grants,
    dpSharesYears: new Set(grants.filter(g => g.type === 'Purchase' && g.showDpShares).map(g => g.year)),
    taxDueDateByTemplate: new Map(
      grants.filter(g => g.defaultTaxDueDate).map(g => [`${g.year}-${g.type}`, g.defaultTaxDueDate as string]),
    ),
    bonusSchedules: Object.fromEntries(
      content.bonus_schedule_variants
        .filter(v => v.grant_year === 2020 && v.grant_type === 'Bonus')
        .map(v => [v.variant_code, { periods: v.periods }]),
    ) as Record<BonusSchedule, { periods: number }>,
    bonusVariantKeys: new Set(content.bonus_schedule_variants.map(v => `${v.grant_year}-${v.grant_type}`)),
    defaultBonusVariant: (content.bonus_schedule_variants.find(v => v.is_default)?.variant_code ?? 'C') as BonusSchedule,
    fallbackTaxRate: settings.tax_fallback_federal + settings.tax_fallback_state,
    priceYears,
    interestLoanRates: Object.fromEntries(
      Object.entries(content.loan_rates.interest).map(([k, v]) => [Number(k), v]),
    ),
    taxLoanRates: Object.fromEntries(
      Object.entries(content.loan_rates.tax).map(([gt, m]) => [
        gt,
        Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), v])),
      ]),
    ),
    originalPurchaseLoans: Object.fromEntries(
      Object.entries(content.loan_rates.purchase_original).map(([k, v]) => [Number(k), { rate: v.rate, dueDate: v.due_date }]),
    ),
    purchaseRefiChains: Object.fromEntries(
      Object.entries(content.loan_refinances.purchase).map(([k, arr]) => [
        Number(k),
        arr.map(e => ({ date: e.date, rate: e.rate, loanYear: e.loan_year, dueDate: e.due_date })),
      ]),
    ),
    taxLoanRefis: Object.fromEntries(
      Object.entries(content.loan_refinances.tax).map(([k, arr]) => [
        k,
        arr.map(e => ({
          date: e.date, rate: e.rate, loanYear: e.loan_year,
          origDueDate: e.orig_due_date, newDueDate: e.due_date,
        })),
      ]),
    ),
  }
}

// ── Blank rows ───────────────────────────────────────────────────────────────

export function initPurchaseRows(s: WizardSchedule): PurchaseGrantRow[] {
  return s.grants.filter(g => g.type === 'Purchase').map(g => {
    const origLoan = s.originalPurchaseLoans[g.year]
    const refiChain = s.purchaseRefiChains[g.year]
    const lastRefi = refiChain?.[refiChain.length - 1]
    return {
      year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
      participated: false,
      purchase_price: '',
      shares: '', dp_shares: '0', dp_cash: '',
      loan_amount: '',
      loan_due_date: lastRefi?.dueDate ?? origLoan?.dueDate ?? '',
      interest_rate: lastRefi ? String(lastRefi.rate) : (origLoan ? String(origLoan.rate) : ''),
      existing_purchase_loan_number: '',
      existing_refinance_loans: [],
    }
  })
}

export function initCatchUpRows(s: WizardSchedule): CatchUpRow[] {
  return s.grants.filter(g => g.type === 'Purchase' && g.defaultCatchUp).map(g => ({
    year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
    included: true, shares: '',
  }))
}

export function initBonusRows(s: WizardSchedule): BonusGrantRow[] {
  return s.grants.filter(g => isBonusRowType(g.type)).map(g => ({
    year: g.year, type: g.type as BonusRowType,
    // Free and Developer Bonus Shares grants are by definition $0. Bonus rows take
    // whatever the user enters — $0 if the grant is taxable at vest (RSU-style),
    // the FMV otherwise.
    purchase_price: ZERO_BASIS_TYPES.has(g.type) ? '0' : '', shares: '',
    isBonus2020: s.bonusVariantKeys.has(`${g.year}-${g.type}`),
    schedule: s.defaultBonusVariant,
    vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
  }))
}

export function blankPriceRows(s: WizardSchedule): WizardPrice[] {
  return s.priceYears.map(y => ({ effective_date: `${y}-01-01`, price: '' }))
}

// ── Rows pre-filled from what the user already has ───────────────────────────

export interface ExistingData {
  prices: PriceEntry[]
  grants: GrantEntry[]
  loans: LoanEntry[]
}

export interface ScheduleRows {
  purchaseRows: PurchaseGrantRow[]
  catchUpRows: CatchUpRow[]
  bonusRows: BonusGrantRow[]
  prices: WizardPrice[]
  /** Saved prices outside the schedule's price years — removed unless kept. */
  orphanPrices: PriceEntry[]
  /** Saved grants that are not in Epic's schedule at all — removed unless kept. */
  orphanGrants: GrantEntry[]
}

/** Lay the user's saved (or freshly imported) data over Epic's schedule. */
export function buildScheduleRows(s: WizardSchedule, existing: ExistingData): ScheduleRows {
  // Match prices by year of effective_date; orphan anything outside priceYears
  const priceByYear = new Map<number, PriceEntry>()
  const orphanPrices: PriceEntry[] = []
  for (const p of existing.prices) {
    const year = parseInt(p.effective_date.slice(0, 4))
    if (s.priceYears.includes(year)) {
      if (!priceByYear.has(year)) priceByYear.set(year, p)
    } else {
      orphanPrices.push(p)
    }
  }

  // Match grants and loans by (year, type)
  const grantByKey = new Map<string, GrantEntry>()
  for (const g of existing.grants) grantByKey.set(`${g.year}-${g.type}`, g)
  const loansByKey = new Map<string, LoanEntry[]>()
  for (const l of existing.loans) {
    const key = `${l.grant_year}-${l.grant_type}`
    if (!loansByKey.has(key)) loansByKey.set(key, [])
    loansByKey.get(key)!.push(l)
  }

  // Orphaned grants: not in the known schedule at all.
  // Catch-Up grants are stored as type "Catch-Up" in the DB but don't appear as a
  // separate entry in the schedule (they piggyback on the Purchase entry via
  // defaultCatchUp). Explicitly add them so they aren't treated as orphans.
  const scheduleKeys = new Set([
    ...s.grants.map(g => `${g.year}-${g.type}`),
    ...s.grants.filter(g => g.defaultCatchUp).map(g => `${g.year}-Catch-Up`),
  ])
  const orphanGrants = existing.grants.filter(g => !scheduleKeys.has(`${g.year}-${g.type}`))

  const purchaseRows: PurchaseGrantRow[] = s.grants
    .filter(g => g.type === 'Purchase')
    .map(g => {
      const saved = grantByKey.get(`${g.year}-Purchase`)
      const loans = loansByKey.get(`${g.year}-Purchase`) ?? []
      // Find the active (chain tip) purchase loan — the one NOT refinanced by any other loan.
      // This is the current loan the user cares about, not the historical original.
      const purchaseTypeLoans = loans.filter(l => l.loan_type === 'Purchase')
      const refinancedLoanIds = new Set(purchaseTypeLoans.map(l => l.refinances_loan_id).filter(Boolean))
      const activePurchaseLoan = purchaseTypeLoans.length > 0
        ? (purchaseTypeLoans.find(l => !refinancedLoanIds.has(l.id)) ?? purchaseTypeLoans[purchaseTypeLoans.length - 1])
        : null
      // Historical chain = all purchase-type loans except the active one
      const historicalChainLoans = purchaseTypeLoans.filter(l => l.id !== activePurchaseLoan?.id)
      // The loan on record carries the terms the user is actually on, and its rate
      // is what says how far down the refi chain it has got (see refiInference.ts).
      // With no loan on record there is nothing to infer from, so the chain's last
      // step stands in — that is what someone who refinanced with everyone else has.
      const origLoan = s.originalPurchaseLoans[g.year]
      const refiChain = s.purchaseRefiChains[g.year]
      const lastRefi = refiChain?.[refiChain.length - 1]
      return {
        year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
        participated: saved != null,
        purchase_price: saved ? String(saved.price) : '',
        shares: saved ? String(saved.shares) : '',
        dp_shares: saved ? String(Math.abs(saved.dp_shares)) : '0',
        dp_cash: '',
        loan_amount: activePurchaseLoan ? String(activePurchaseLoan.amount) : '',
        loan_due_date: activePurchaseLoan?.due_date || lastRefi?.dueDate || origLoan?.dueDate || '',
        interest_rate: activePurchaseLoan
          ? String(activePurchaseLoan.interest_rate)
          : (lastRefi ? String(lastRefi.rate) : (origLoan ? String(origLoan.rate) : '')),
        existing_purchase_loan_number: activePurchaseLoan?.loan_number ?? '',
        existing_refinance_loans: historicalChainLoans,
      }
    })

  const catchUpRows: CatchUpRow[] = s.grants
    .filter(g => g.type === 'Purchase' && g.defaultCatchUp)
    .map(g => {
      const saved = grantByKey.get(`${g.year}-Catch-Up`)
      return {
        year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
        included: saved != null,
        shares: saved ? String(saved.shares) : '',
      }
    })

  const bonusRows: BonusGrantRow[] = s.grants
    .filter(g => isBonusRowType(g.type))
    .map(g => {
      const saved = grantByKey.get(`${g.year}-${g.type}`)
      return {
        year: g.year, type: g.type as BonusRowType,
        purchase_price: saved ? String(saved.price) : (ZERO_BASIS_TYPES.has(g.type) ? '0' : ''),
        shares: saved ? String(saved.shares) : '',
        isBonus2020: s.bonusVariantKeys.has(`${g.year}-${g.type}`),
        schedule: s.defaultBonusVariant,
        vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
      }
    })

  return {
    purchaseRows, catchUpRows, bonusRows, orphanPrices, orphanGrants,
    prices: s.priceYears.map(y => ({
      effective_date: `${y}-01-01`,
      price: priceByYear.has(y) ? String(priceByYear.get(y)!.price) : '',
    })),
  }
}
