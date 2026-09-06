import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api.ts'
import type {
  ContentBlob, GrantEntry, LoanEntry, PriceEntry, TaxSettings, WizardGrant, WizardGrantTemplate,
} from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { useContent } from '../hooks/useContent.ts'
import { ZERO_BASIS_TYPES } from '../grantTypes.ts'
import {
  generateLoansForReview, mergeReviewedLoans, recomputeInterestEstimates, syncRefiAmounts,
} from './importWizard/loans.ts'
import {
  blankPriceRows, buildScheduleRows, deriveSchedule, initBonusRows, initCatchUpRows, initPurchaseRows,
} from './importWizard/schedule.ts'
import {
  dpSharesShortfall, isPreTax, priceForYear, recalcLoan,
} from './importWizard/rows.ts'
import { buildScheduleGrants, draftToWizardGrant, sanitizeForSubmit } from './importWizard/submit.ts'
import type {
  BonusGrantRow, CatchUpRow, GrantDraft, LoanDraft, PurchaseGrantRow, ReviewedLoan, Screen,
  TaxLoanDraft, WizardPrefill, WizardPrice,
} from './importWizard/types.ts'
import { emptyGrantDraft, emptyLoan, emptyTaxLoanDraft, vestingYears } from './importWizard/types.ts'
import {
  GrantEntry as GrantEntryScreen, LoanRefinanceScreen, MoreGrants, PricesScreen,
  PurchaseLoanScreen, TaxLoansScreen, Upload, Welcome,
} from './importWizard/screens/ManualPath.tsx'
import {
  ScheduleGrants, ScheduleIntro, SchedulePrices, ScheduleSettings,
} from './importWizard/screens/SchedulePath.tsx'
import { LoanReviewScreen, RefiReviewScreen } from './importWizard/screens/LoanReview.tsx'
import { DoneScreen, ReviewScreen } from './importWizard/screens/Finish.tsx'

/**
 * The setup wizard: two paths onto the same submit payload.
 *
 * The schedule path (`schedule_*` screens) lays Epic's own grant schedule out as
 * tables the user fills in, and generates the tax, interest and refinance loans
 * that schedule implies for them to check. The manual path walks one grant at a
 * time and asks about each loan, for grants the schedule does not cover.
 *
 * Everything computed lives in ./importWizard as pure functions; what is left
 * here is the state and the order the screens come in.
 */
export default function ImportWizard(props: {
  onComplete?: () => void
  isPage?: boolean
  prefill?: WizardPrefill
}) {
  const content = useContent()
  if (!content) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-cs-muted">Loading…</p>
      </div>
    )
  }
  return <ImportWizardInner {...props} content={content} />
}

function ImportWizardInner({ onComplete, isPage = false, prefill, content }: {
  onComplete?: () => void
  isPage?: boolean
  prefill?: WizardPrefill
  content: ContentBlob
}) {
  const schedule = useMemo(() => deriveSchedule(content), [content])

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)

  // Navigation
  const [history, setHistory] = useState<Screen[]>(['welcome'])
  const screen = history[history.length - 1]
  const push = (s: Screen) => setHistory(h => [...h, s])
  const back = () => setHistory(h => h.length > 1 ? h.slice(0, -1) : h)

  // Data accumulated
  const [prices, setPrices] = useState<WizardPrice[]>([{ effective_date: '', price: '' }])
  const [completedGrants, setCompletedGrants] = useState<WizardGrant[]>([])

  // Current grant being built
  const [grantDraft, setGrantDraft] = useState<GrantDraft>(emptyGrantDraft())

  // Templates from file parse
  const [templates, setTemplates] = useState<WizardGrantTemplate[]>([])
  const [templateIdx, setTemplateIdx] = useState(0) // next template to process

  // Loan sub-state
  const [activeLoanDraft, setActiveLoanDraft] = useState<LoanDraft>(emptyLoan())
  const [pendingRefinance, setPendingRefinance] = useState<LoanDraft>(emptyLoan('Purchase'))

  // Misc
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Orphaned existing data (populated when entering schedule mode)
  const [orphanPrices, setOrphanPrices] = useState<PriceEntry[]>([])
  const [orphanGrants, setOrphanGrants] = useState<GrantEntry[]>([])
  const [preserveOrphanPriceIds, setPreserveOrphanPriceIds] = useState<Set<number>>(new Set())
  const [preserveOrphanGrantIds, setPreserveOrphanGrantIds] = useState<Set<number>>(new Set())
  const [scheduleLoading, setScheduleLoading] = useState(false)

  // ── Schedule path state ────────────────────────────────────────────────────
  const [purchaseRows, setPurchaseRows] = useState<PurchaseGrantRow[]>(() => initPurchaseRows(schedule))
  const [catchUpRows, setCatchUpRows] = useState<CatchUpRow[]>(() => initCatchUpRows(schedule))
  const [bonusRows, setBonusRows] = useState<BonusGrantRow[]>(() => initBonusRows(schedule))
  const [deductInterest, setDeductInterest] = useState(false)
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  useEffect(() => { if (taxSettings) setDeductInterest(taxSettings.deduct_investment_interest) }, [taxSettings])

  // Loans review state — auto-generated Tax/Interest/Refinance loans for schedule mode
  const [reviewedLoans, setReviewedLoans] = useState<ReviewedLoan[]>([])
  const [allExistingLoans, setAllExistingLoans] = useState<LoanEntry[]>([])

  // Auto-enter schedule mode when navigated with ?mode=schedule (from Import
  // page), or when handed a draft to review — someone who has just uploaded their
  // Shareworks files has already chosen how to start, and asking again strands
  // them on a menu instead of the figures they came to check.
  const autoScheduleTriggered = useRef(false)
  useEffect(() => {
    if (autoScheduleTriggered.current) return
    if (prefill || searchParams.get('mode') === 'schedule') {
      autoScheduleTriggered.current = true
      enterScheduleMode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, prefill])

  // ── Manual path ─────────────────────────────────────────────────────────────

  function startNextTemplate() {
    // Move to the next template grant, or to more_grants if done
    const next = templateIdx + 1
    if (next < templates.length) {
      setTemplateIdx(next)
      setGrantDraft(emptyGrantDraft('', 'Purchase', templates[next]))
      push('grant_entry')
    } else {
      push('more_grants')
    }
  }

  /** Done with loans and tax loans for the current draft — bank it and move on. */
  function finishGrant(draft = grantDraft) {
    setCompletedGrants(prev => [...prev, draftToWizardGrant(draft, draft.loans)])
    if (templates.length > 0) startNextTemplate()
    else push('more_grants')
  }

  /** Pre-tax grants owe a tax loan question per vesting; everything else is done. */
  function askTaxLoansOrFinish(): boolean {
    if (!isPreTax(grantDraft)) return false
    const years = vestingYears(grantDraft)
    if (years.length === 0) return false
    setGrantDraft(d => ({ ...d, tax_loans: years.map(emptyTaxLoanDraft) }))
    push('tax_loans')
    return true
  }

  function afterGrantDetails() {
    if (grantDraft.type === 'Purchase') push('purchase_loan')
    else if (!askTaxLoansOrFinish()) finishGrant()
  }

  function afterPurchaseLoan() {
    if (!askTaxLoansOrFinish()) finishGrant()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const result = await api.wizardParseFile(file)
      if (result.prices.length > 0) {
        setPrices(result.prices.map(p => ({
          effective_date: p.effective_date,
          price: p.price != null ? String(p.price) : '',
        })))
      }
      if (result.grants.length > 0) {
        setTemplates(result.grants)
        setTemplateIdx(0)
        setGrantDraft(emptyGrantDraft('', 'Purchase', result.grants[0]))
      }
      push('prices')
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submission = sanitizeForSubmit(prices, completedGrants)

  async function handleSubmit() {
    if (submission.blockingIssues.length > 0) {
      setSubmitError(submission.blockingIssues.join('; '))
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      await api.wizardSubmit({
        grants: submission.grants,
        prices: submission.prices,
        clear_existing: false,
        generate_payoff_sales: true,
        preserve_grant_ids: Array.from(preserveOrphanGrantIds),
        preserve_price_ids: Array.from(preserveOrphanPriceIds),
      })
      push('done')
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleComplete() {
    if (onComplete) onComplete()
    else navigate('/')
  }

  // ── Schedule path ───────────────────────────────────────────────────────────

  async function enterScheduleMode() {
    setScheduleLoading(true)
    try {
      // A prefilled draft stands in for the user's saved data, so the review
      // screens look the same whether they typed the numbers or an import
      // produced them. Nothing is written until they finish the wizard.
      const [existingPrices, existingGrants, existingLoans] = prefill
        ? [prefill.prices, prefill.grants, prefill.loans]
        : await Promise.all([api.getPrices(), api.getGrants(), api.getLoans()])
      setAllExistingLoans(existingLoans)

      const rows = buildScheduleRows(schedule, {
        prices: existingPrices, grants: existingGrants, loans: existingLoans,
      })
      setPurchaseRows(rows.purchaseRows)
      setCatchUpRows(rows.catchUpRows)
      setBonusRows(rows.bonusRows)
      setPrices(rows.prices)
      setOrphanPrices(rows.orphanPrices)
      setOrphanGrants(rows.orphanGrants)
      setPreserveOrphanPriceIds(new Set())
      setPreserveOrphanGrantIds(new Set())
    } catch {
      // Fall back to blank rows if fetch fails
      setPurchaseRows(initPurchaseRows(schedule))
      setCatchUpRows(initCatchUpRows(schedule))
      setBonusRows(initBonusRows(schedule))
      setPrices(blankPriceRows(schedule))
      setOrphanPrices([])
      setOrphanGrants([])
    } finally {
      setScheduleLoading(false)
      push('schedule_intro')
    }
  }

  function setPurchaseField(i: number, patch: Partial<PurchaseGrantRow>, recalc = false) {
    setPurchaseRows(rows => recalc ? recalcLoan(rows, i, patch) : rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  }

  function setCatchUpField(i: number, patch: Partial<CatchUpRow>) {
    setCatchUpRows(rows => rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  }

  function setBonusField(i: number, patch: Partial<BonusGrantRow>) {
    setBonusRows(rows => rows.map((r, j) => {
      if (j !== i) return r
      const updated = { ...r, ...patch }
      if ('schedule' in patch && r.isBonus2020) {
        updated.periods = schedule.bonusSchedules[updated.schedule].periods
      }
      return updated
    }))
  }

  /** Fill each grant's cost basis from the price the user entered for its
   *  exercise year — as typed, so "2.50" does not come back as "2.5". */
  function prefillCostBasis() {
    const priceAtExercise = (exerciseDate: string) => {
      const year = new Date(exerciseDate + 'T00:00:00').getFullYear()
      return prices.find(p => p.price && new Date(p.effective_date + 'T00:00:00').getFullYear() === year)?.price
    }

    setPurchaseRows(rows => rows.map(r => {
      if (r.purchase_price) return r
      const price = priceAtExercise(r.exercise_date)
      return price ? { ...r, purchase_price: price } : r
    }))
    // 2020's bonus is $0-basis; other bonus grants take the FMV at exercise.
    setBonusRows(rows => rows.map(r => {
      if (r.purchase_price || ZERO_BASIS_TYPES.has(r.type)) return r
      if (r.year === 2020 && r.type === 'Bonus') return { ...r, purchase_price: '0' }
      const price = priceAtExercise(r.exercise_date)
      return price ? { ...r, purchase_price: price } : r
    }))
  }

  function enterLoansReview() {
    const generated = generateLoansForReview({
      schedule, prices, purchaseRows, catchUpRows, bonusRows,
      existingLoans: allExistingLoans,
      incomeTaxRate: taxSettings
        ? taxSettings.federal_income_rate + taxSettings.state_income_rate
        : schedule.fallbackTaxRate,
    })
    setReviewedLoans(prev => mergeReviewedLoans(generated, prev))
    push('schedule_loans_tax')
  }

  const updateReviewedLoan = (updated: ReviewedLoan) =>
    setReviewedLoans(prev => prev.map(l => l.key === updated.key ? updated : l))

  /** Switch off every loan the given screen is showing, then move on. */
  const disableAll = (match: (l: ReviewedLoan) => boolean) =>
    setReviewedLoans(prev => prev.map(l => match(l) ? { ...l, enabled: false } : l))

  async function handleScheduleReview(saveSettings: boolean) {
    setSubmitting(true)
    setSubmitError('')
    try {
      if (saveSettings) {
        try { await api.updateTaxSettings({ deduct_investment_interest: deductInterest }) } catch { /* non-fatal */ }
      }
      setCompletedGrants(buildScheduleGrants({ purchaseRows, catchUpRows, bonusRows, reviewedLoans }))
      push('review')
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isTaxLoan = (l: ReviewedLoan) => l.loan_type === 'Tax' && !l.refinances_loan_number
  const isRefiLoan = (l: ReviewedLoan) => l.loan_type === 'Purchase' || (l.loan_type === 'Tax' && !!l.refinances_loan_number)
  const isInterestLoan = (l: ReviewedLoan) => l.loan_type === 'Interest'

  const toggleOrphan = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) =>
    (id: number, remove: boolean) => setter(prev => {
      const next = new Set(prev)
      if (remove) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-5">
      {screen === 'welcome' && (
        <Welcome
          isPage={isPage}
          scheduleLoading={scheduleLoading}
          onShareworks={() => navigate('/import')}
          onSchedule={enterScheduleMode}
          onWorkbook={() => push('upload')}
          onManual={() => {
            setTemplates([])
            setPrices([{ effective_date: '', price: '' }])
            push('prices')
          }}
        />
      )}

      {screen === 'upload' && (
        <Upload
          fileRef={fileRef}
          uploading={uploading}
          uploadError={uploadError}
          onFile={handleFileUpload}
          onBack={back}
          onSkip={() => { setTemplates([]); push('prices') }}
        />
      )}

      {screen === 'prices' && (
        <PricesScreen
          prices={prices}
          setPrices={setPrices}
          onBack={back}
          onNext={() => {
            if (templates.length === 0) setGrantDraft(emptyGrantDraft())
            push('grant_entry')
          }}
        />
      )}

      {screen === 'grant_entry' && (
        <GrantEntryScreen
          draft={grantDraft}
          setDraft={setGrantDraft}
          templateCount={templates.length}
          templateIdx={templateIdx}
          dpSharesYears={schedule.dpSharesYears}
          onBack={back}
          onNext={afterGrantDetails}
        />
      )}

      {screen === 'purchase_loan' && (
        <PurchaseLoanScreen
          draft={grantDraft}
          activeLoan={activeLoanDraft}
          setActiveLoan={setActiveLoanDraft}
          onBack={back}
          onYes={() => {
            setActiveLoanDraft(emptyLoan('Purchase'))
            setGrantDraft(d => ({ ...d, has_purchase_loan: true }))
          }}
          onNo={() => {
            setGrantDraft(d => ({ ...d, has_purchase_loan: false }))
            afterPurchaseLoan()
          }}
          onSave={() => {
            setGrantDraft(d => ({ ...d, loans: [...d.loans, { ...activeLoanDraft }] }))
            setActiveLoanDraft(emptyLoan('Purchase'))
            setPendingRefinance(emptyLoan('Purchase'))
            push('loan_refinance')
          }}
        />
      )}

      {screen === 'loan_refinance' && (
        <LoanRefinanceScreen
          lastLoanNumber={grantDraft.loans[grantDraft.loans.length - 1]?.loan_number ?? ''}
          pending={pendingRefinance}
          setPending={setPendingRefinance}
          onBack={back}
          onYes={() => setPendingRefinance({
            ...emptyLoan('Purchase'),
            refinances_loan_number: grantDraft.loans[grantDraft.loans.length - 1]?.loan_number ?? '',
          })}
          onNo={afterPurchaseLoan}
          onSave={() => {
            setGrantDraft(d => ({ ...d, loans: [...d.loans, pendingRefinance] }))
            setPendingRefinance(emptyLoan('Purchase'))
            // Ask about a further refinance on a fresh screen
            back()
            push('loan_refinance')
          }}
        />
      )}

      {screen === 'tax_loans' && (() => {
        const vestDates = vestingYears(grantDraft)
        return (
          <TaxLoansScreen
            draft={grantDraft}
            vestDates={vestDates}
            onChangeTaxLoan={(i, updated) => setGrantDraft(d => ({
              ...d, tax_loans: d.tax_loans.map((x, j) => j === i ? updated : x),
            }))}
            onBack={back}
            onDone={() => {
              const taxLoans = toTaxLoanDrafts(grantDraft.tax_loans, vestDates)
              const draft = { ...grantDraft, loans: [...grantDraft.loans, ...taxLoans] }
              setGrantDraft(draft)
              finishGrant(draft)
            }}
          />
        )
      })()}

      {screen === 'more_grants' && (
        <MoreGrants
          grantCount={completedGrants.length}
          onBack={back}
          onAdd={() => { setGrantDraft(emptyGrantDraft()); push('grant_entry') }}
          onReview={() => push('review')}
        />
      )}

      {screen === 'review' && (
        <ReviewScreen
          submission={submission}
          submitting={submitting}
          submitError={submitError}
          orphanPrices={orphanPrices}
          orphanGrants={orphanGrants}
          preservedPriceIds={preserveOrphanPriceIds}
          preservedGrantIds={preserveOrphanGrantIds}
          onBack={back}
          onSubmit={handleSubmit}
        />
      )}

      {screen === 'schedule_intro' && (
        <ScheduleIntro onBack={back} onNext={() => push('schedule_prices')} />
      )}

      {screen === 'schedule_prices' && (
        <SchedulePrices
          prices={prices}
          setPrices={setPrices}
          orphanPrices={orphanPrices}
          preservedPriceIds={preserveOrphanPriceIds}
          onToggleOrphanPrice={toggleOrphan(setPreserveOrphanPriceIds)}
          onBack={back}
          onNext={() => { prefillCostBasis(); push('schedule_grants') }}
        />
      )}

      {screen === 'schedule_grants' && (
        <ScheduleGrants
          schedule={schedule}
          purchaseRows={purchaseRows}
          catchUpRows={catchUpRows}
          bonusRows={bonusRows}
          setPurchaseField={setPurchaseField}
          setCatchUpField={setCatchUpField}
          setBonusField={setBonusField}
          onAddBonusRow={() => setBonusRows(rows => [...rows, {
            year: new Date().getFullYear(), type: 'Bonus',
            purchase_price: '', shares: '',
            isBonus2020: false, schedule: 'C',
            vest_start: '', periods: 3, exercise_date: '',
          }])}
          priceForYear={year => priceForYear(prices, year)}
          dpShortfall={row => dpSharesShortfall(
            schedule, purchaseRows, { purchaseRows, catchUpRows, bonusRows }, row,
          )}
          orphanGrants={orphanGrants}
          preservedGrantIds={preserveOrphanGrantIds}
          onToggleOrphanGrant={toggleOrphan(setPreserveOrphanGrantIds)}
          onBack={back}
          onNext={enterLoansReview}
        />
      )}

      {screen === 'schedule_loans_tax' && (
        <LoanReviewScreen
          title="Tax loans"
          blurb="For Catch-Up and Bonus grants that vest as income. Amounts are estimated from vested shares x price x your tax rate. Check your Shareworks loan statement for exact amounts."
          emptyText="No tax loans — no Catch-Up or Bonus grants with vesting in range."
          accentClass="text-amber-600 dark:text-amber-400"
          loans={reviewedLoans.filter(isTaxLoan)}
          nextLabel="Next: Refinances →"
          onChangeLoan={updateReviewedLoan}
          onBack={back}
          onNext={() => {
            setReviewedLoans(syncRefiAmounts)
            push('schedule_loans_refi')
          }}
          onSkip={() => {
            disableAll(isTaxLoan)
            setReviewedLoans(syncRefiAmounts)
            push('schedule_loans_refi')
          }}
        />
      )}

      {screen === 'schedule_loans_refi' && (
        <RefiReviewScreen
          schedule={schedule}
          purchaseRows={purchaseRows}
          loans={reviewedLoans.filter(isRefiLoan)}
          onChangeLoan={updateReviewedLoan}
          onBack={back}
          onNext={() => {
            setReviewedLoans(prev => recomputeInterestEstimates(prev, schedule, purchaseRows))
            push('schedule_loans_interest')
          }}
          onSkip={() => {
            disableAll(isRefiLoan)
            setReviewedLoans(prev => recomputeInterestEstimates(prev, schedule, purchaseRows))
            push('schedule_loans_interest')
          }}
        />
      )}

      {screen === 'schedule_loans_interest' && (
        <LoanReviewScreen
          title="Interest loans"
          blurb="Annual interest on all outstanding loans for each grant, estimated from the tax loans and refinance rates you entered. Check your Shareworks loan statement for exact amounts."
          emptyText="No interest loans — no participated purchase grants."
          accentClass="text-sky-600 dark:text-sky-400"
          loans={reviewedLoans.filter(isInterestLoan)}
          nextLabel="Next: Preferences →"
          onChangeLoan={updateReviewedLoan}
          onBack={back}
          onNext={() => push('schedule_settings')}
          onSkip={() => { disableAll(isInterestLoan); push('schedule_settings') }}
        />
      )}

      {screen === 'schedule_settings' && (
        <ScheduleSettings
          deductInterest={deductInterest}
          setDeductInterest={setDeductInterest}
          submitting={submitting}
          submitError={submitError}
          onBack={back}
          onSave={() => handleScheduleReview(true)}
          onSkip={() => handleScheduleReview(false)}
        />
      )}

      {screen === 'done' && (
        <DoneScreen
          grants={completedGrants}
          priceCount={prices.filter(p => p.effective_date && p.price !== '').length}
          onComplete={handleComplete}
        />
      )}
    </div>
  )
}

/** The tax loans the user ticked, as loan drafts on the grant. */
function toTaxLoanDrafts(taxLoans: TaxLoanDraft[], vestDates: string[]): LoanDraft[] {
  return taxLoans.flatMap((tl, i): LoanDraft[] => !tl.has_loan ? [] : [{
    loan_number: tl.loan_number,
    loan_type: 'Tax',
    loan_year: String(new Date(vestDates[i] ?? '').getFullYear() || ''),
    amount: tl.amount,
    interest_rate: tl.interest_rate,
    due_date: tl.due_date,
    refinances_loan_number: '',
  }])
}
