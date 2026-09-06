import type { LoanEntry, WizardLoan } from '../../../api.ts'
import { inferRefiSteps } from '../../refiInference.ts'
import type { RefiInference } from '../../refiInference.ts'
import type { PurchaseRefiStep, WizardSchedule } from './schedule.ts'
import { pricesByYear } from './rows.ts'
import type {
  BonusGrantRow, CatchUpRow, PurchaseGrantRow, ReviewedLoan, WizardPrice,
} from './types.ts'
import { addYears, sharesInPeriod } from './types.ts'

/**
 * The part of a grant year's refi chain the purchase loan on record has been through.
 *
 * Epic's statement gives every loan's current rate but never says when it was
 * refinanced, so the rate is what identifies the step. A user who already has
 * refinance loans saved has their own history — leave it alone and keep the
 * whole chain, as before.
 */
export function purchaseChainFor(s: WizardSchedule, row: PurchaseGrantRow | undefined): {
  chain: PurchaseRefiStep[] | undefined
  inference: RefiInference | null
} {
  const full = row ? s.purchaseRefiChains[row.year] : undefined
  if (!row || !full) return { chain: undefined, inference: null }
  if (row.existing_refinance_loans.length > 0) return { chain: full, inference: null }
  const inference = inferRefiSteps(full, s.originalPurchaseLoans[row.year], {
    rate: parseFloat(row.interest_rate),
    dueDate: row.loan_due_date,
  })
  return {
    chain: inference.steps > 0 ? full.slice(0, inference.steps) : undefined,
    inference,
  }
}

/** Compute interest on the purchase loan for a calendar year by summing each refi period. */
export function purchaseInterestForYear(
  loanYear: number,
  purchaseAmount: number,
  refiChain: PurchaseRefiStep[] | undefined,
  originalRate: number | undefined,
  fallbackRate: number,
): number {
  if (purchaseAmount <= 0) return 0

  // No refi data — use the purchase loan's own rate (from the wizard row)
  if (!refiChain || originalRate == null) return purchaseAmount * fallbackRate

  const yearStart = new Date(`${loanYear}-01-01T00:00:00`)
  const yearEnd = new Date(`${loanYear + 1}-01-01T00:00:00`)
  const daysInYear = (yearEnd.getTime() - yearStart.getTime()) / 86400000

  // Find rate at start of year
  let currentRate = originalRate
  for (const refi of refiChain) {
    if (new Date(refi.date + 'T00:00:00') <= yearStart) currentRate = refi.rate
  }

  // Calculate interest for each period within the year
  let total = 0
  let periodStart = yearStart
  for (const refi of refiChain) {
    const rd = new Date(refi.date + 'T00:00:00')
    if (rd > yearStart && rd < yearEnd) {
      total += purchaseAmount * currentRate * (rd.getTime() - periodStart.getTime()) / 86400000 / daysInYear
      currentRate = refi.rate
      periodStart = rd
    }
  }
  const remainDays = (yearEnd.getTime() - periodStart.getTime()) / 86400000
  return total + purchaseAmount * currentRate * remainDays / daysInYear
}

export interface GenerateLoansArgs {
  schedule: WizardSchedule
  prices: WizardPrice[]
  purchaseRows: PurchaseGrantRow[]
  catchUpRows: CatchUpRow[]
  bonusRows: BonusGrantRow[]
  existingLoans: LoanEntry[]
  incomeTaxRate: number
}

/**
 * The Tax, Interest and refinance loans Epic's schedule implies for these grants.
 *
 * Everything here is an estimate the user then checks and edits — except where a
 * loan is already saved in the database, whose figures win over the estimate.
 */
export function generateLoansForReview(args: GenerateLoansArgs): ReviewedLoan[] {
  const { schedule: s, purchaseRows, catchUpRows, bonusRows, incomeTaxRate } = args
  const loans: ReviewedLoan[] = []
  const priceByYear = pricesByYear(args.prices)

  const existingByKey = new Map<string, LoanEntry>()
  for (const rl of args.existingLoans) {
    existingByKey.set(`${rl.grant_year}-${rl.grant_type}-${rl.loan_type}-${rl.loan_year}`, rl)
  }

  // Interest loans inherit their due date from the purchase loan for that grant
  // year. If the user didn't participate in that year's purchase grant we fall
  // back to the original purchase-loan rate row's due_date.
  const inheritedDueDate = (grantYear: number): string =>
    purchaseRows.find(r => r.year === grantYear)?.loan_due_date
    || s.originalPurchaseLoans[grantYear]?.dueDate
    || ''

  // Tax loans use the admin-configured default_tax_due_date on the originating
  // template when set (Bonus/Free, or Purchase-with-catch-up). Otherwise they
  // fall back to inheriting from the purchase loan.
  const taxDueDate = (grantYear: number, grantType: string): string => {
    const templateType = grantType === 'Catch-Up' ? 'Purchase' : grantType
    return s.taxDueDateByTemplate.get(`${grantYear}-${templateType}`) || inheritedDueDate(grantYear)
  }

  /** Add a loan, letting a saved one override the estimate. Returns the amount used. */
  function pushLoan(
    key: string,
    fields: Omit<ReviewedLoan, 'key' | 'is_existing'> & { estimatedAmount: number },
    /** The saved loan to match against, when it isn't keyed the same as the row. */
    existingKey = key,
  ): number {
    const existing = existingByKey.get(existingKey)
    loans.push({
      key,
      grant_year: fields.grant_year, grant_type: fields.grant_type,
      loan_type: fields.loan_type, loan_year: fields.loan_year,
      amount: existing ? String(existing.amount) : (fields.estimatedAmount > 0 ? fields.estimatedAmount.toFixed(2) : fields.amount),
      interest_rate: existing ? String(existing.interest_rate) : fields.interest_rate,
      due_date: fields.due_date,
      loan_number: existing?.loan_number ?? fields.loan_number,
      refinances_loan_number: fields.refinances_loan_number,
      refi_date: fields.refi_date,
      enabled: fields.enabled,
      is_existing: !!existing,
    })
    return existing ? existing.amount : fields.estimatedAmount
  }

  // ── Phase 1: Tax loans (Catch-Up) — needed before interest calc ──
  // Track tax loan amounts per grant year for interest computation
  const taxAmountsByGrantYear = new Map<number, Map<number, number>>() // grantYear -> (loanYear -> amount)

  for (const row of catchUpRows) {
    if (!row.included || !(parseInt(row.shares) > 0)) continue
    const gy = row.year
    const totalShares = parseInt(row.shares) || 0
    const due = taxDueDate(gy, 'Catch-Up')

    if (!taxAmountsByGrantYear.has(gy)) taxAmountsByGrantYear.set(gy, new Map())
    const taxMap = taxAmountsByGrantYear.get(gy)!

    for (let i = 0; i < row.periods; i++) {
      const vestYear = addYears(row.vest_start, i).getFullYear()
      const rate = s.taxLoanRates['Catch-Up']?.[vestYear]
      if (!rate) continue
      const periodShares = sharesInPeriod(totalShares, row.periods, i)
      const taxAmount = periodShares * (priceByYear.get(vestYear) || 0) * incomeTaxRate

      taxMap.set(vestYear, pushLoan(`${gy}-Catch-Up-Tax-${vestYear}`, {
        grant_year: gy, grant_type: 'Catch-Up', loan_type: 'Tax', loan_year: vestYear,
        amount: '', estimatedAmount: taxAmount, interest_rate: String(rate), due_date: due,
        loan_number: `wiz-${gy}-CU-T${vestYear}`, refinances_loan_number: '', refi_date: '', enabled: true,
      }))
    }
  }

  // ── Phase 2: Refinance chains + Interest loans (Purchase) ──
  for (const row of purchaseRows) {
    if (!row.participated || !(parseInt(row.shares) > 0)) continue
    const gy = row.year
    const purchaseAmount = parseFloat(row.loan_amount) || 0
    const due = row.loan_due_date || inheritedDueDate(gy)
    const exerciseYear = new Date(row.exercise_date + 'T00:00:00').getFullYear()

    // Refinance chain — only as far as the rate on record says it went
    const { chain: refiChain } = purchaseChainFor(s, row)
    const origLoan = s.originalPurchaseLoans[gy]
    if (refiChain && origLoan) {
      const origNum = `wiz-${gy}-orig`
      loans.push({
        key: `${gy}-Purchase-refi-orig`, grant_year: gy, grant_type: 'Purchase',
        loan_type: 'Purchase', loan_year: gy, amount: purchaseAmount ? purchaseAmount.toFixed(2) : '',
        interest_rate: String(origLoan.rate), due_date: origLoan.dueDate, loan_number: origNum,
        refinances_loan_number: '', refi_date: row.exercise_date, enabled: true, is_existing: false,
      })
      let prevNum = origNum
      refiChain.forEach((refi, ri) => {
        const num = `wiz-${gy}-refi${ri + 1}`
        loans.push({
          key: `${gy}-Purchase-refi-${ri + 1}`, grant_year: gy, grant_type: 'Purchase',
          loan_type: 'Purchase', loan_year: refi.loanYear,
          amount: purchaseAmount ? purchaseAmount.toFixed(2) : '',
          interest_rate: String(refi.rate), due_date: refi.dueDate, loan_number: num,
          refinances_loan_number: prevNum, refi_date: refi.date, enabled: true, is_existing: false,
        })
        prevNum = num
      })
    }

    // Interest loans: for each year, interest = sum of (each loan × its own rate).
    // Purchase loan rate changes at each refi; other loans keep their origination rate.
    const taxMap = taxAmountsByGrantYear.get(gy) ?? new Map<number, number>()
    const purchaseRate = parseFloat(row.interest_rate) || 0 // current rate from wizard row
    // Track prior loans with their individual rates: { amount, rate }
    const priorLoans: { amount: number; rate: number }[] = []
    const interestYears = Object.keys(s.interestLoanRates).map(Number).sort((a, b) => a - b)
    for (const ly of interestYears) {
      if (ly <= exerciseYear) continue
      const interestLoanRate = s.interestLoanRates[ly]

      // Purchase loan interest: sum each refi period separately.
      // Prior loans interest: each at its own rate, full year.
      const estimatedAmount =
        purchaseInterestForYear(ly, purchaseAmount, refiChain, origLoan?.rate, purchaseRate)
        + priorLoans.reduce((sum, l) => sum + l.amount * l.rate, 0)

      const actual = pushLoan(`${gy}-Purchase-Interest-${ly}`, {
        grant_year: gy, grant_type: 'Purchase', loan_type: 'Interest', loan_year: ly,
        amount: '', estimatedAmount, interest_rate: String(interestLoanRate),
        due_date: due, loan_number: `wiz-${gy}-I${ly}`, refinances_loan_number: '', refi_date: '', enabled: true,
      })

      // This interest loan becomes a prior loan for next year (at its own rate)
      priorLoans.push({ amount: actual, rate: interestLoanRate })
      // Add any tax loans issued this year (at their rate) to prior loans for next year
      const taxThisYear = taxMap.get(ly)
      if (taxThisYear) priorLoans.push({ amount: taxThisYear, rate: s.taxLoanRates['Catch-Up']?.[ly] || 0 })
    }
  }

  // ── Phase 3: Bonus/Free Tax + Interest loans ──
  for (const row of bonusRows) {
    if (!(parseInt(row.shares) > 0)) continue
    const gy = row.year
    const grantType = row.type
    const totalShares = parseInt(row.shares) || 0
    const due = taxDueDate(gy, grantType)

    // Tax loans only when the user-entered cost basis is $0 (vesting = ordinary
    // income). Anything else — including a blank cost basis — skips tax loan
    // generation; the user must explicitly say "this grant is taxable at vest".
    const enteredPrice = parseFloat(row.purchase_price)
    if (isNaN(enteredPrice) || enteredPrice !== 0) continue

    const bonusTaxByYear = new Map<number, number>()
    for (let i = 0; i < row.periods; i++) {
      const vestDate = addYears(row.vest_start, i)
      const vestYear = vestDate.getFullYear()
      const rate = s.taxLoanRates[grantType]?.[vestYear]
      if (!rate) continue
      const periodShares = sharesInPeriod(totalShares, row.periods, i)
      const taxAmount = periodShares * (priceByYear.get(vestYear) || 0) * incomeTaxRate
      const existKey = `${gy}-${grantType}-Tax-${vestYear}`

      // Check if this tax loan has a refinance chain, and how far the loan on
      // record went down it — a tax refinance changes the rate and the due date,
      // so the loan's own terms say whether it happened (see refiInference.ts).
      const fullTaxRefi = s.taxLoanRefis[`${gy}-${grantType}-${vestYear}`]
      const existingTax = existingByKey.get(existKey)
      const taxSteps = fullTaxRefi
        ? inferRefiSteps(
          fullTaxRefi.map(r => ({ rate: r.rate, dueDate: r.newDueDate })),
          { rate, dueDate: fullTaxRefi[0].origDueDate },
          { rate: existingTax?.interest_rate, dueDate: existingTax?.due_date },
        ).steps
        : 0
      const taxRefi = taxSteps > 0 ? fullTaxRefi!.slice(0, taxSteps) : null

      if (!taxRefi) {
        bonusTaxByYear.set(vestYear, pushLoan(existKey, {
          grant_year: gy, grant_type: grantType, loan_type: 'Tax', loan_year: vestYear,
          amount: '', estimatedAmount: taxAmount, interest_rate: String(rate), due_date: due,
          loan_number: `wiz-${gy}-${grantType[0]}-T${vestYear}`, refinances_loan_number: '', refi_date: '', enabled: true,
        }))
        continue
      }

      // Original tax loan + its refinance chain
      const origNum = `wiz-${gy}-${grantType[0]}-T${vestYear}-orig`
      loans.push({
        key: `${existKey}-refi-orig`, grant_year: gy, grant_type: grantType,
        loan_type: 'Tax', loan_year: vestYear, amount: taxAmount > 0 ? taxAmount.toFixed(2) : '',
        interest_rate: String(rate), due_date: taxRefi[0].origDueDate, loan_number: origNum,
        refinances_loan_number: '', refi_date: vestDate.toISOString().slice(0, 10), enabled: true, is_existing: false,
      })
      let prevNum = origNum
      taxRefi.forEach((refi, ri) => {
        const num = `wiz-${gy}-${grantType[0]}-T${vestYear}-refi${ri + 1}`
        pushLoan(`${existKey}-refi-${ri + 1}`, {
          grant_year: gy, grant_type: grantType, loan_type: 'Tax', loan_year: vestYear,
          amount: '', estimatedAmount: taxAmount, interest_rate: String(refi.rate), due_date: refi.newDueDate,
          loan_number: num, refinances_loan_number: prevNum, refi_date: refi.date, enabled: true,
        }, existKey)
        prevNum = num
      })
      bonusTaxByYear.set(vestYear, taxAmount > 0 ? taxAmount : 0)
    }

    // Bonus Interest loans: only if there are tax loans to accrue interest on
    const firstTaxYear = new Date(row.vest_start + 'T00:00:00').getFullYear()
    const maxInterestYear = Math.max(0, ...Object.keys(s.interestLoanRates).map(Number))
    let bonusOutstanding = 0
    for (let ly = firstTaxYear; ly <= maxInterestYear; ly++) {
      bonusOutstanding += bonusTaxByYear.get(ly) || 0
      // Interest starts the year AFTER first tax loan accumulation
      const iRate = s.interestLoanRates[ly]
      if (!iRate || bonusOutstanding <= 0 || ly <= firstTaxYear) continue

      bonusOutstanding += pushLoan(`${gy}-${grantType}-Interest-${ly}`, {
        grant_year: gy, grant_type: grantType, loan_type: 'Interest', loan_year: ly,
        amount: '', estimatedAmount: bonusOutstanding * iRate, interest_rate: String(iRate), due_date: due,
        loan_number: `wiz-${gy}-${grantType[0]}-I${ly}`, refinances_loan_number: '', refi_date: '', enabled: true,
      })
    }
  }

  return loans
}

/** Regenerated loans, keeping the amounts and tick boxes the user already touched. */
export function mergeReviewedLoans(generated: ReviewedLoan[], previous: ReviewedLoan[]): ReviewedLoan[] {
  if (previous.length === 0) return generated
  const byKey = new Map(previous.map(l => [l.key, l]))
  return generated.map(g => {
    const prev = byKey.get(g.key)
    return prev ? { ...g, amount: prev.amount, enabled: prev.enabled } : g
  })
}

/** Re-estimate interest loans using the tax + refi data the user just confirmed. */
export function recomputeInterestEstimates(
  loans: ReviewedLoan[], s: WizardSchedule, purchaseRows: PurchaseGrantRow[],
): ReviewedLoan[] {
  // Collect confirmed tax loan amounts by (grant_year, loan_year)
  const confirmedTax = new Map<string, { amount: number; rate: number }>()
  for (const l of loans) {
    if (l.loan_type === 'Tax' && l.enabled && !l.refinances_loan_number) {
      confirmedTax.set(`${l.grant_year}-${l.loan_year}`, {
        amount: parseFloat(l.amount) || 0,
        rate: parseFloat(l.interest_rate) || 0,
      })
    }
  }

  const purchaseGrantYears = new Set(
    loans.filter(l => l.grant_type === 'Purchase' && l.loan_type === 'Interest').map(l => l.grant_year),
  )

  const updated = [...loans]
  for (const gy of purchaseGrantYears) {
    const row = purchaseRows.find(r => r.year === gy)
    if (!row) continue
    const purchaseAmount = parseFloat(row.loan_amount) || 0
    const purchaseRate = parseFloat(row.interest_rate) || 0
    const { chain: refiChain } = purchaseChainFor(s, row)
    const origRate = s.originalPurchaseLoans[gy]?.rate

    const priorLoans: { amount: number; rate: number }[] = []
    const interestIdxs = updated
      .map((l, i) => l.grant_year === gy && l.grant_type === 'Purchase' && l.loan_type === 'Interest' ? i : -1)
      .filter(i => i >= 0)
      .sort((a, b) => updated[a].loan_year - updated[b].loan_year)

    for (const idx of interestIdxs) {
      const l = updated[idx]
      // A loan saved in the database keeps its saved amount; only estimates move.
      let amount = parseFloat(l.amount) || 0
      if (!l.is_existing) {
        amount = purchaseInterestForYear(l.loan_year, purchaseAmount, refiChain, origRate, purchaseRate)
          + priorLoans.reduce((sum, pl) => sum + pl.amount * pl.rate, 0)
        updated[idx] = { ...l, amount: amount > 0 ? amount.toFixed(2) : '' }
      }
      priorLoans.push({ amount, rate: parseFloat(l.interest_rate) || 0 })
      const tax = confirmedTax.get(`${gy}-${l.loan_year}`)
      if (tax) priorLoans.push(tax)
    }
  }
  return updated
}

/** Sync refinance loan amounts from the loans they refinance. A refi keeps the same principal. */
export function syncRefiAmounts(loans: ReviewedLoan[]): ReviewedLoan[] {
  const byLoanNumber = new Map<string, ReviewedLoan>()
  for (const l of loans) byLoanNumber.set(l.loan_number, l)

  return loans.map(l => {
    if (!l.refinances_loan_number) return l
    // Walk up the chain to find the original (non-refi) loan
    const visited = new Set<string>()
    let parent = byLoanNumber.get(l.refinances_loan_number)
    while (parent?.refinances_loan_number) {
      if (visited.has(parent.loan_number)) break // circular reference guard
      visited.add(parent.loan_number)
      parent = byLoanNumber.get(parent.refinances_loan_number)
    }
    return parent?.amount ? { ...l, amount: parent.amount } : l
  })
}

/** The enabled reviewed loans for one grant, as the submit payload wants them. */
export function reviewedToWizardLoans(
  loans: ReviewedLoan[], grantYear: number, grantType: string,
): WizardLoan[] {
  return loans
    .filter(l => l.enabled && l.grant_year === grantYear && l.grant_type === grantType)
    .map(l => ({
      loan_number: l.loan_number,
      loan_type: l.loan_type,
      loan_year: l.loan_year,
      amount: parseFloat(l.amount) || 0,
      interest_rate: parseFloat(l.interest_rate) || 0,
      due_date: l.due_date,
      refinances_loan_number: l.refinances_loan_number,
    }))
}

/** Group loans under their "<year> <type>" heading, in the order they were generated. */
export function groupByGrant(loans: ReviewedLoan[]): [string, ReviewedLoan[]][] {
  const groups = new Map<string, ReviewedLoan[]>()
  for (const l of loans) {
    const k = `${l.grant_year} ${l.grant_type}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(l)
  }
  return Array.from(groups.entries())
}
