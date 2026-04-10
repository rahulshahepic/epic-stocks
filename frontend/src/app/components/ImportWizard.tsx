import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api.ts'
import type { WizardGrant, WizardLoan, WizardGrantTemplate, TaxSettings, GrantEntry, PriceEntry, LoanEntry } from '../../api.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { useApiData } from '../hooks/useApiData.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

type GrantType = 'Purchase' | 'Catch-Up' | 'Bonus' | 'Free'

interface WizardPrice {
  effective_date: string
  price: string  // string so empty is valid during editing
}

interface LoanDraft {
  loan_number: string
  loan_type: 'Purchase' | 'Tax'
  loan_year: string
  amount: string
  interest_rate: string
  due_date: string
  refinances_loan_number: string
}

interface TaxLoanDraft {
  has_loan: boolean
  loan_number: string
  amount: string
  interest_rate: string
  due_date: string
}

interface GrantDraft {
  year: string
  type: GrantType
  shares: string
  price: string
  vest_start: string
  periods: string
  exercise_date: string
  dp_shares: string
  // loan section
  has_purchase_loan: boolean | null  // null = not yet asked
  loans: LoanDraft[]  // purchase loan + refinances
  // tax loans (for price=0 grants)
  tax_loans: TaxLoanDraft[]  // one entry per vesting year
  tax_loans_asked: boolean
}

type Screen =
  | 'welcome'
  | 'upload'
  | 'prices'
  | 'grant_entry'       // enter shares (+ maybe other fields) for current grant draft
  | 'purchase_loan'     // "did you take a loan?" + form
  | 'loan_refinance'    // "was this refinanced?" + form
  | 'tax_loans'         // tax loans per vesting year (for pre-tax RSU-type)
  | 'more_grants'       // "add another grant year?"
  | 'review'
  | 'done'
  | 'schedule_intro'
  | 'schedule_prices'   // prices entered BEFORE grants so they can pre-fill cost basis
  | 'schedule_grants'
  | 'schedule_settings' // user preference questions (replaces old tax-rate step)

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRANT_COLORS: Record<GrantType, string> = {
  'Purchase': 'bg-rose-700 text-white',
  'Catch-Up': 'bg-sky-700 text-white',
  'Bonus': 'bg-emerald-700 text-white',
  'Free': 'bg-amber-600 text-white',
}

const GRANT_DESCRIPTIONS: Record<GrantType, string> = {
  'Purchase': 'You paid the share price',
  'Catch-Up': 'Zero-basis catch-up grant',
  'Bonus': 'RSU bonus grant',
  'Free': 'Free/other grant',
}

function emptyLoan(type: 'Purchase' | 'Tax' = 'Purchase'): LoanDraft {
  return { loan_number: '', loan_type: type, loan_year: '', amount: '', interest_rate: '', due_date: '', refinances_loan_number: '' }
}

function emptyGrantDraft(year = '', type: GrantType = 'Purchase', template?: WizardGrantTemplate): GrantDraft {
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

function isPreTax(draft: GrantDraft): boolean {
  const price = parseFloat(draft.price)
  return (draft.type === 'Catch-Up' || draft.type === 'Bonus' || draft.type === 'Free') && (isNaN(price) || price === 0)
}

/** Compute vesting dates for a draft grant: [vest_start + 0yr, +1yr, +2yr, ...] */
function vestingYears(draft: GrantDraft): string[] {
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

function fmtDate(d: string) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Epic Grant Schedule ───────────────────────────────────────────────────────

interface KnownGrant {
  year: number
  type: 'Purchase' | 'Bonus' | 'Free'
  defaultPrice: number
  vest_start: string
  periods: number
  exercise_date: string
  defaultCatchUp: boolean
}

type BonusSchedule = 'A' | 'B' | 'C'

const BONUS_SCHEDULES: Record<BonusSchedule, { periods: number }> = {
  A: { periods: 2 },
  B: { periods: 3 },
  C: { periods: 4 },
}

// Company-wide grant structure. All values are defaults — user can override any field.
// Purchase prices are NOT included here — user enters them from the Epic stocks SharePoint.
const EPIC_GRANT_SCHEDULE: KnownGrant[] = [
  { year: 2018, type: 'Purchase', defaultPrice: 0, vest_start: '2020-06-15', periods: 6, exercise_date: '2018-12-31', defaultCatchUp: true },
  { year: 2019, type: 'Purchase', defaultPrice: 0, vest_start: '2021-06-15', periods: 6, exercise_date: '2019-12-31', defaultCatchUp: true },
  { year: 2020, type: 'Purchase', defaultPrice: 0, vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', defaultCatchUp: true },
  { year: 2020, type: 'Bonus',    defaultPrice: 0, vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', defaultCatchUp: false },
  { year: 2021, type: 'Purchase', defaultPrice: 0, vest_start: '2021-09-30', periods: 5, exercise_date: '2021-12-31', defaultCatchUp: true },
  { year: 2021, type: 'Bonus',    defaultPrice: 0, vest_start: '2022-09-30', periods: 3, exercise_date: '2021-12-31', defaultCatchUp: false },
  { year: 2022, type: 'Purchase', defaultPrice: 0, vest_start: '2022-09-30', periods: 4, exercise_date: '2022-12-31', defaultCatchUp: false },
  { year: 2022, type: 'Bonus',    defaultPrice: 0, vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', defaultCatchUp: false },
  { year: 2022, type: 'Free',     defaultPrice: 0, vest_start: '2027-09-30', periods: 1, exercise_date: '2022-12-31', defaultCatchUp: false },
  { year: 2023, type: 'Purchase', defaultPrice: 0, vest_start: '2023-09-30', periods: 4, exercise_date: '2023-12-31', defaultCatchUp: false },
  { year: 2023, type: 'Bonus',    defaultPrice: 0, vest_start: '2024-09-30', periods: 3, exercise_date: '2023-12-31', defaultCatchUp: false },
  { year: 2024, type: 'Purchase', defaultPrice: 0, vest_start: '2024-09-30', periods: 4, exercise_date: '2024-12-31', defaultCatchUp: false },
  { year: 2024, type: 'Bonus',    defaultPrice: 0, vest_start: '2025-09-30', periods: 3, exercise_date: '2024-12-31', defaultCatchUp: false },
  { year: 2025, type: 'Purchase', defaultPrice: 0, vest_start: '2025-09-30', periods: 4, exercise_date: '2025-12-31', defaultCatchUp: false },
  { year: 2025, type: 'Bonus',    defaultPrice: 0, vest_start: '2026-09-30', periods: 3, exercise_date: '2025-12-31', defaultCatchUp: false },
]

const LOAN_TERM_YEARS = 10
const PRICE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

interface PurchaseGrantRow {
  year: number; vest_start: string; periods: number; exercise_date: string
  participated: boolean
  purchase_price: string
  shares: string; dp_shares: string; dp_cash: string
  loan_amount: string; loan_due_date: string; interest_rate: string
  existing_purchase_loan_number: string  // loan_number from DB, used for merge matching
}

interface CatchUpRow {
  year: number; vest_start: string; periods: number; exercise_date: string
  included: boolean; shares: string
}

interface BonusGrantRow {
  year: number; type: 'Bonus' | 'Free'
  purchase_price: string; shares: string
  isBonus2020: boolean; schedule: BonusSchedule
  vest_start: string; periods: number; exercise_date: string
}

function addYearsToDate(dateStr: string, years: number): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().slice(0, 10)
}

function initPurchaseRows(): PurchaseGrantRow[] {
  return EPIC_GRANT_SCHEDULE.filter(g => g.type === 'Purchase').map(g => ({
    year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
    participated: false,
    purchase_price: '',
    shares: '', dp_shares: '0', dp_cash: '',
    loan_amount: '', loan_due_date: addYearsToDate(g.exercise_date, LOAN_TERM_YEARS), interest_rate: '',
    existing_purchase_loan_number: '',
  }))
}

function initCatchUpRows(): CatchUpRow[] {
  return EPIC_GRANT_SCHEDULE.filter(g => g.type === 'Purchase' && g.defaultCatchUp).map(g => ({
    year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
    included: true, shares: '',
  }))
}

function initBonusRows(): BonusGrantRow[] {
  return EPIC_GRANT_SCHEDULE.filter(g => g.type === 'Bonus' || g.type === 'Free').map(g => ({
    year: g.year, type: g.type as 'Bonus' | 'Free',
    purchase_price: g.type === 'Free' ? '0' : '', shares: '',
    isBonus2020: g.year === 2020 && g.type === 'Bonus', schedule: 'C' as BonusSchedule,
    vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
  }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({
  label, type = 'text', value, onChange, step, min, placeholder, hint,
}: {
  label: string; type?: string; value: string | number; onChange: (v: string) => void
  step?: string; min?: string; placeholder?: string; hint?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      {hint && <span className="ml-1.5 text-[10px] text-gray-400 dark:text-slate-500">{hint}</span>}
      <input
        type={type} step={step} min={min} placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      />
    </label>
  )
}

function LoanForm({
  loan, onChange, label, showRefinancesField = false,
}: {
  loan: LoanDraft
  onChange: (l: LoanDraft) => void
  label?: string
  showRefinancesField?: boolean
}) {
  const f = (k: keyof LoanDraft) => (v: string) => onChange({ ...loan, [k]: v })
  return (
    <div className="space-y-3">
      {label && <p className="text-xs font-medium text-gray-700 dark:text-slate-300">{label}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan #" value={loan.loan_number} onChange={f('loan_number')} placeholder="e.g. 123456" />
        <Field label="Year issued" type="number" value={loan.loan_year} onChange={f('loan_year')} />
        <Field label="Amount ($)" type="number" step="0.01" value={loan.amount} onChange={f('amount')} />
        <Field label="Interest rate" type="number" step="0.001" value={loan.interest_rate} onChange={f('interest_rate')} hint="e.g. 0.045" />
        <Field label="Due date" type="date" value={loan.due_date} onChange={f('due_date')} />
        {showRefinancesField && (
          <Field label="Refinances loan #" value={loan.refinances_loan_number} onChange={f('refinances_loan_number')} hint="prior loan #" />
        )}
      </div>
    </div>
  )
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
    >
      ← Back
    </button>
  )
}

function NextBtn({ onClick, disabled, label = 'Next →', saving }: { onClick: () => void; disabled?: boolean; label?: string; saving?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
    >
      {saving ? 'Saving...' : label}
    </button>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function ImportWizard({ onComplete, isPage = false }: { onComplete?: () => void; isPage?: boolean }) {
  const navigate = useNavigate()
  const config = useConfig()
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
  const [templateIdx, setTemplateIdx] = useState(0)  // next template to process

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
  const [purchaseRows, setPurchaseRows] = useState<PurchaseGrantRow[]>(initPurchaseRows)
  const [catchUpRows, setCatchUpRows]   = useState<CatchUpRow[]>(initCatchUpRows)
  const [bonusRows, setBonusRows]       = useState<BonusGrantRow[]>(initBonusRows)
  const [deductInterest, setDeductInterest] = useState(false)
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  useEffect(() => { if (taxSettings) setDeductInterest(taxSettings.deduct_investment_interest) }, [taxSettings])

  // ── Helpers ─────────────────────────────────────────────────────────────────

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

  function saveCurrentGrant(draft: GrantDraft, loans: LoanDraft[]): WizardGrant {
    const wizLoans: WizardLoan[] = loans.map(l => ({
      loan_number: l.loan_number,
      loan_type: l.loan_type,
      loan_year: parseInt(l.loan_year) || 0,
      amount: parseFloat(l.amount) || 0,
      interest_rate: parseFloat(l.interest_rate) || 0,
      due_date: l.due_date,
      refinances_loan_number: l.refinances_loan_number,
    }))
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
      loans: wizLoans,
    }
  }

  function finishGrant() {
    // Called when we're done with loans and tax loans for the current draft
    const grant = saveCurrentGrant(grantDraft, grantDraft.loans)
    setCompletedGrants(prev => [...prev, grant])

    if (templates.length > 0) {
      startNextTemplate()
    } else {
      push('more_grants')
    }
  }

  function afterGrantDetails() {
    // After filling in grant details, decide next screen
    if (grantDraft.type === 'Purchase') {
      push('purchase_loan')
    } else if (isPreTax(grantDraft)) {
      // Pre-tax RSU — ask about tax loans
      const years = vestingYears(grantDraft)
      if (years.length > 0) {
        setGrantDraft(d => ({
          ...d,
          tax_loans: years.map(() => ({ has_loan: false, loan_number: '', amount: '', interest_rate: '', due_date: '' })),
        }))
        push('tax_loans')
      } else {
        finishGrant()
      }
    } else {
      finishGrant()
    }
  }

  function afterPurchaseLoan() {
    // After purchase loan decision, check for tax loans or finish
    if (isPreTax(grantDraft)) {
      const years = vestingYears(grantDraft)
      if (years.length > 0) {
        setGrantDraft(d => ({
          ...d,
          tax_loans: years.map(() => ({ has_loan: false, loan_number: '', amount: '', interest_rate: '', due_date: '' })),
        }))
        push('tax_loans')
        return
      }
    }
    finishGrant()
  }

  // ── File upload ──────────────────────────────────────────────────────────────

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const result = await api.wizardParseFile(file)
      // Pre-fill prices
      if (result.prices.length > 0) {
        setPrices(result.prices.map(p => ({
          effective_date: p.effective_date,
          price: p.price != null ? String(p.price) : '',
        })))
      }
      // Store templates
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

  // ── Submit / Preview ──────────────────────────────────────────────────────────

  function buildPricesPayload() {
    return prices
      .filter(p => p.effective_date && p.price !== '')
      .map(p => ({ effective_date: p.effective_date, price: parseFloat(p.price) }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError('')
    try {
      await api.wizardSubmit({
        grants: completedGrants,
        prices: buildPricesPayload(),
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

  // ── Schedule path helpers ─────────────────────────────────────────────────

  async function enterScheduleMode() {
    setScheduleLoading(true)
    try {
      const [existingPrices, existingGrants, existingLoans] = await Promise.all([
        api.getPrices(), api.getGrants(), api.getLoans(),
      ])

      // Match prices by year of effective_date; orphan anything outside PRICE_YEARS
      const priceByYear = new Map<number, PriceEntry>()
      const newOrphanPrices: PriceEntry[] = []
      for (const p of existingPrices) {
        const year = parseInt(p.effective_date.slice(0, 4))
        if (PRICE_YEARS.includes(year)) {
          if (!priceByYear.has(year)) priceByYear.set(year, p)
        } else {
          newOrphanPrices.push(p)
        }
      }

      // Match grants and loans by (year, type)
      const grantByKey = new Map<string, GrantEntry>()
      for (const g of existingGrants) grantByKey.set(`${g.year}-${g.type}`, g)
      const loansByKey = new Map<string, LoanEntry[]>()
      for (const l of existingLoans) {
        const key = `${l.grant_year}-${l.grant_type}`
        if (!loansByKey.has(key)) loansByKey.set(key, [])
        loansByKey.get(key)!.push(l)
      }

      // Orphaned grants: not in the known schedule at all.
      // Catch-Up grants are stored as type "Catch-Up" in the DB but don't appear as a
      // separate entry in EPIC_GRANT_SCHEDULE (they piggyback on the Purchase entry via
      // defaultCatchUp). Explicitly add them so they aren't treated as orphans.
      const scheduleKeys = new Set([
        ...EPIC_GRANT_SCHEDULE.map(g => `${g.year}-${g.type}`),
        ...EPIC_GRANT_SCHEDULE.filter(g => g.defaultCatchUp).map(g => `${g.year}-Catch-Up`),
      ])
      const newOrphanGrants = existingGrants.filter(g => !scheduleKeys.has(`${g.year}-${g.type}`))

      // Pre-populate purchase rows
      const newPurchaseRows: PurchaseGrantRow[] = EPIC_GRANT_SCHEDULE
        .filter(g => g.type === 'Purchase')
        .map(g => {
          const existing = grantByKey.get(`${g.year}-Purchase`)
          const loans = loansByKey.get(`${g.year}-Purchase`) ?? []
          const purchaseLoan = loans.find(l => l.loan_type === 'Purchase')
          return {
            year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
            participated: existing != null,
            purchase_price: existing ? String(existing.price) : '',
            shares: existing ? String(existing.shares) : '',
            dp_shares: existing ? String(Math.abs(existing.dp_shares)) : '0',
            dp_cash: '',
            loan_amount: purchaseLoan ? String(purchaseLoan.amount) : '',
            loan_due_date: purchaseLoan ? purchaseLoan.due_date : addYearsToDate(g.exercise_date, LOAN_TERM_YEARS),
            interest_rate: purchaseLoan ? String(purchaseLoan.interest_rate) : '',
            existing_purchase_loan_number: purchaseLoan?.loan_number ?? '',
          }
        })

      // Pre-populate catch-up rows
      const newCatchUpRows: CatchUpRow[] = EPIC_GRANT_SCHEDULE
        .filter(g => g.type === 'Purchase' && g.defaultCatchUp)
        .map(g => {
          const existing = grantByKey.get(`${g.year}-Catch-Up`)
          return {
            year: g.year, vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
            included: existing != null,
            shares: existing ? String(existing.shares) : '',
          }
        })

      // Pre-populate bonus/free rows
      const newBonusRows: BonusGrantRow[] = EPIC_GRANT_SCHEDULE
        .filter(g => g.type === 'Bonus' || g.type === 'Free')
        .map(g => {
          const existing = grantByKey.get(`${g.year}-${g.type}`)
          return {
            year: g.year, type: g.type as 'Bonus' | 'Free',
            purchase_price: existing ? String(existing.price) : (g.type === 'Free' ? '0' : ''),
            shares: existing ? String(existing.shares) : '',
            isBonus2020: g.year === 2020 && g.type === 'Bonus', schedule: 'C' as BonusSchedule,
            vest_start: g.vest_start, periods: g.periods, exercise_date: g.exercise_date,
          }
        })

      setPurchaseRows(newPurchaseRows)
      setCatchUpRows(newCatchUpRows)
      setBonusRows(newBonusRows)
      setPrices(PRICE_YEARS.map(y => ({
        effective_date: `${y}-01-01`,
        price: priceByYear.has(y) ? String(priceByYear.get(y)!.price) : '',
      })))
      setOrphanPrices(newOrphanPrices)
      setOrphanGrants(newOrphanGrants)
      setPreserveOrphanPriceIds(new Set())
      setPreserveOrphanGrantIds(new Set())
    } catch {
      // Fall back to blank rows if fetch fails
      setPurchaseRows(initPurchaseRows())
      setCatchUpRows(initCatchUpRows())
      setBonusRows(initBonusRows())
      setPrices(PRICE_YEARS.map(y => ({ effective_date: `${y}-01-01`, price: '' })))
      setOrphanPrices([])
      setOrphanGrants([])
    } finally {
      setScheduleLoading(false)
      push('schedule_intro')
    }
  }

  function recalcLoan(rows: PurchaseGrantRow[], i: number, patch: Partial<PurchaseGrantRow>): PurchaseGrantRow[] {
    return rows.map((r, j) => {
      if (j !== i) return r
      const updated = { ...r, ...patch }
      const p = parseFloat(updated.purchase_price) || 0
      const s = parseInt(updated.shares) || 0
      const dp = parseFloat(updated.dp_cash) || 0
      return { ...updated, loan_amount: Math.max(0, p * s - dp).toFixed(2) }
    })
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
        updated.periods = BONUS_SCHEDULES[updated.schedule].periods
      }
      return updated
    }))
  }

  async function handleScheduleReview(saveSettings = false) {
    setSubmitting(true)
    setSubmitError('')
    try {
      if (saveSettings) {
        try { await api.updateTaxSettings({ deduct_investment_interest: deductInterest }) } catch { /* non-fatal */ }
      }
      const grants: WizardGrant[] = [
        ...purchaseRows
          .filter(r => r.participated && parseInt(r.shares) > 0)
          .map(r => ({
            year: r.year, type: 'Purchase' as const,
            shares: parseInt(r.shares) || 0,
            price: parseFloat(r.purchase_price) || 0,
            vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
            dp_shares: -(Math.abs(parseInt(r.dp_shares) || 0)),
            election_83b: false,
            loans: [{
              loan_number: r.existing_purchase_loan_number || `wiz-${r.year}-0`,
              loan_type: 'Purchase' as const, loan_year: r.year,
              amount: parseFloat(r.loan_amount) || Math.max(0, (parseInt(r.shares) || 0) * (parseFloat(r.purchase_price) || 0) - (parseFloat(r.dp_cash) || 0)),
              interest_rate: parseFloat(r.interest_rate) || 0,
              due_date: r.loan_due_date,
              refinances_loan_number: '',
            }] as WizardLoan[],
          })),
        ...catchUpRows
          .filter(r => r.included && parseInt(r.shares) > 0)
          .map(r => ({
            year: r.year, type: 'Catch-Up' as const,
            shares: parseInt(r.shares) || 0, price: 0,
            vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
            dp_shares: 0, election_83b: false, loans: [] as WizardLoan[],
          })),
        ...bonusRows
          .filter(r => parseInt(r.shares) > 0)
          .map(r => ({
            year: r.year, type: r.type as 'Bonus' | 'Free',
            shares: parseInt(r.shares) || 0,
            price: parseFloat(r.purchase_price) || 0,
            vest_start: r.vest_start, periods: r.periods, exercise_date: r.exercise_date,
            dp_shares: 0, election_83b: false, loans: [] as WizardLoan[],
          })),
      ]
      setCompletedGrants(grants)
      push('review')
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleComplete() {
    if (onComplete) {
      onComplete()
    } else {
      navigate('/')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const vYears = screen === 'tax_loans' ? vestingYears(grantDraft) : []

  return (
    <div className="space-y-5">
      {/* ── Welcome ── */}
      {screen === 'welcome' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 dark:border-rose-800 dark:bg-rose-950/30">
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {isPage ? 'Setup Wizard' : "Let's set up your equity tracker."}
            </h2>
            <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
              Choose how you'd like to get started.
            </p>
          </div>

          <div className="grid gap-3">
            {/* Option 1: Guided wizard — recommended */}
            <button
              type="button"
              onClick={enterScheduleMode}
              disabled={scheduleLoading}
              className="flex flex-col rounded-lg border-2 border-rose-400 bg-white p-4 text-left hover:border-rose-600 hover:shadow-md disabled:opacity-60 dark:border-rose-500 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                  {scheduleLoading ? 'Loading your data…' : 'Setup Wizard'}
                </span>
                {!scheduleLoading && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                    Recommended
                  </span>
                )}
              </div>
              <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                We know Epic's grant schedule — enter your prices first, then just fill in your shares and loan details grant by grant.
              </span>
            </button>

            {/* Option 2: Import from file */}
            <button
              type="button"
              onClick={() => push('upload')}
              className="flex flex-col rounded-lg border-2 border-stone-200 bg-white p-4 text-left hover:border-rose-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">Import from file</span>
              <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Upload an Excel structure file to pre-fill your schedule.
              </span>
            </button>

            {/* Option 3: Manual entry */}
            <button
              type="button"
              onClick={() => { setTemplates([]); setPrices([{ effective_date: '', price: '' }]); push('prices') }}
              className="flex flex-col rounded-lg border-2 border-stone-200 bg-white p-4 text-left hover:border-rose-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">Manual entry</span>
              <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Enter everything yourself — prices, grants, loans.
              </span>
            </button>
          </div>

          {isPage && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              If you already have data, the wizard pre-loads it on each screen. Any unmatched existing records will be shown before you can choose to keep or remove them — nothing is deleted until the final step.
            </p>
          )}
        </div>
      )}

      {/* ── Upload ── */}
      {screen === 'upload' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Import from file</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Upload an Excel file with a Schedule and/or Prices sheet. Missing share counts and amounts are fine — you'll fill those in next.
          </p>

          {config?.epic_onboarding_url && (
            <a
              href={config.epic_onboarding_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col rounded-lg border-2 border-rose-200 bg-rose-50 p-3 hover:border-rose-400 dark:border-rose-800 dark:bg-rose-950/30"
            >
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">On Epic's network? Download your pre-filled structure file →</span>
              <span className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                Pre-fills your vesting schedule. Upload it below.
              </span>
            </a>
          )}
          {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={uploading}
            className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-rose-700 hover:file:bg-rose-100 disabled:opacity-50 dark:text-slate-400 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
          {uploading && <p className="text-xs text-gray-500">Parsing file...</p>}
          <button
            type="button"
            onClick={() => { setTemplates([]); push('prices') }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            Skip — enter manually instead
          </button>
        </div>
      )}

      {/* ── Prices ── */}
      {screen === 'prices' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Share price history</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Enter one row per annual price announcement. The first row should be the price on your initial exercise date (e.g. 2018-12-31). After that, typically March 1 each year.
            </p>
          </div>
          <div className="space-y-2">
            {prices.map((p, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={i === 0 ? 'Date' : ''}
                    type="date"
                    value={p.effective_date}
                    onChange={v => setPrices(prev => prev.map((x, j) => j === i ? { ...x, effective_date: v } : x))}
                  />
                </div>
                <div className="w-28">
                  <Field
                    label={i === 0 ? 'Price ($)' : ''}
                    type="number"
                    step="0.01"
                    value={p.price}
                    onChange={v => setPrices(prev => prev.map((x, j) => j === i ? { ...x, price: v } : x))}
                    placeholder="0.00"
                  />
                </div>
                {prices.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPrices(prev => prev.filter((_, j) => j !== i))}
                    className="mb-0.5 text-xs text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPrices(prev => [...prev, { effective_date: '', price: '' }])}
            className="text-xs font-medium text-rose-700 hover:text-rose-800 dark:text-rose-400"
          >
            + Add price
          </button>
          <div className="flex gap-2 pt-1">
            <NextBtn
              onClick={() => {
                if (templates.length > 0) {
                  push('grant_entry')
                } else {
                  setGrantDraft(emptyGrantDraft())
                  push('grant_entry')
                }
              }}
              label="Next: Add grants →"
            />
          </div>
        </div>
      )}

      {/* ── Grant entry ── */}
      {screen === 'grant_entry' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {templates.length > 0 && templateIdx < templates.length
                ? `Grant ${templateIdx + 1} of ${templates.length}`
                : 'Add a grant'}
            </h2>
            {templates.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                Fields pre-filled from your structure file. Just enter the share count.
              </p>
            )}
          </div>

          {/* Grant type selector */}
          <div>
            <span className="text-xs text-gray-500 dark:text-slate-400">Grant type</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(['Purchase', 'Catch-Up', 'Bonus', 'Free'] as GrantType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setGrantDraft(d => ({
                    ...d,
                    type: t,
                    price: t === 'Purchase' ? d.price : '0',
                  }))}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    grantDraft.type === t
                      ? GRANT_COLORS[t]
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">{GRANT_DESCRIPTIONS[grantDraft.type]}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Grant year" type="number" value={grantDraft.year}
              onChange={v => setGrantDraft(d => ({ ...d, year: v }))} />
            <Field label="Shares" type="number" value={grantDraft.shares}
              onChange={v => setGrantDraft(d => ({ ...d, shares: v }))} />
            {grantDraft.type === 'Purchase' && (
              <Field label="Cost basis ($/share)" type="number" step="0.01" value={grantDraft.price}
                onChange={v => setGrantDraft(d => ({ ...d, price: v }))} />
            )}
            <Field label="Vest start" type="date" value={grantDraft.vest_start}
              onChange={v => setGrantDraft(d => ({ ...d, vest_start: v }))} />
            <Field label="Vesting periods" type="number" value={grantDraft.periods}
              hint="usually 4"
              onChange={v => setGrantDraft(d => ({ ...d, periods: v }))} />
            <Field label="Exercise date" type="date" value={grantDraft.exercise_date}
              hint="usually 12/31"
              onChange={v => setGrantDraft(d => ({ ...d, exercise_date: v }))} />
          </div>

          {grantDraft.type === 'Purchase' && (
            <div className="rounded-md border border-stone-200 p-3 dark:border-slate-700">
              <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={parseInt(grantDraft.dp_shares) > 0}
                  onChange={e => setGrantDraft(d => ({ ...d, dp_shares: e.target.checked ? '' : '0' }))}
                  className="mt-0.5 rounded"
                />
                <span>
                  <span className="font-medium text-gray-800 dark:text-slate-200">Used shares as a down payment</span>
                  <span className="ml-1 text-stone-500">(stock DP)</span>
                  <br />
                  <span className="text-stone-500 dark:text-slate-500">
                    You exchanged previously vested shares at exercise to reduce the loan amount. Check your purchase confirmation.
                  </span>
                </span>
              </label>
              {parseInt(grantDraft.dp_shares) > 0 || grantDraft.dp_shares === '' ? (
                <div className="mt-2 w-40">
                  <Field
                    label="Shares exchanged"
                    type="number"
                    min="1"
                    value={grantDraft.dp_shares}
                    onChange={v => setGrantDraft(d => ({ ...d, dp_shares: v }))}
                    hint="from your confirmation"
                  />
                </div>
              ) : null}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <NextBtn onClick={afterGrantDetails} />
          </div>
        </div>
      )}

      {/* ── Purchase loan ── */}
      {screen === 'purchase_loan' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Loan for {grantDraft.year} Purchase grant
          </h2>

          {grantDraft.has_purchase_loan === null && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 dark:text-slate-300">
                Did you take out a loan to purchase this grant?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveLoanDraft(emptyLoan('Purchase'))
                    setGrantDraft(d => ({ ...d, has_purchase_loan: true }))
                  }}
                  className="rounded-md bg-rose-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGrantDraft(d => ({ ...d, has_purchase_loan: false }))
                    afterPurchaseLoan()
                  }}
                  className="rounded-md bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {grantDraft.has_purchase_loan === true && (
            <div className="space-y-4">
              <LoanForm
                loan={activeLoanDraft}
                onChange={setActiveLoanDraft}
                label={grantDraft.loans.length === 0 ? 'Original loan' : undefined}
              />
              <div className="flex gap-2">
                <NextBtn
                  label="Save loan"
                  onClick={() => {
                    const saved = { ...activeLoanDraft }
                    setGrantDraft(d => ({ ...d, loans: [...d.loans, saved] }))
                    setActiveLoanDraft(emptyLoan('Purchase'))
                    // Ask about refinance
                    setPendingRefinance(emptyLoan('Purchase'))
                    push('loan_refinance')
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Loan refinance ── */}
      {screen === 'loan_refinance' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Refinances
          </h2>

          {pendingRefinance.loan_number === '' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 dark:text-slate-300">
                Was{' '}
                <span className="font-medium">
                  {grantDraft.loans[grantDraft.loans.length - 1]?.loan_number || 'this loan'}
                </span>{' '}
                ever refinanced into a new loan?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const lastLoan = grantDraft.loans[grantDraft.loans.length - 1]
                    setPendingRefinance({
                      ...emptyLoan('Purchase'),
                      refinances_loan_number: lastLoan?.loan_number ?? '',
                    })
                  }}
                  className="rounded-md bg-rose-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => afterPurchaseLoan()}
                  className="rounded-md bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {pendingRefinance.loan_number !== '' || pendingRefinance.refinances_loan_number !== '' ? (
            // Show the refinance form only when the user clicked Yes
            pendingRefinance.refinances_loan_number !== '' && (
              <div className="space-y-4">
                <LoanForm
                  loan={pendingRefinance}
                  onChange={setPendingRefinance}
                  label="Refinance loan"
                  showRefinancesField
                />
                <NextBtn
                  label="Save refinance"
                  onClick={() => {
                    setGrantDraft(d => ({ ...d, loans: [...d.loans, pendingRefinance] }))
                    setPendingRefinance(emptyLoan('Purchase'))
                    // Ask about another refinance
                    back()  // pop loan_refinance
                    push('loan_refinance')  // push fresh
                  }}
                />
              </div>
            )
          ) : null}
        </div>
      )}

      {/* ── Tax loans ── */}
      {screen === 'tax_loans' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
              Tax loans for {grantDraft.year} {grantDraft.type}
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              This is a pre-tax grant — shares vest as ordinary income. Did you take a tax loan to cover withholding at any vesting?
            </p>
          </div>

          <div className="space-y-4">
            {vYears.map((vestDate, i) => {
              const tl = grantDraft.tax_loans[i] ?? { has_loan: false, loan_number: '', amount: '', interest_rate: '', due_date: '' }
              const update = (updated: TaxLoanDraft) =>
                setGrantDraft(d => ({
                  ...d,
                  tax_loans: d.tax_loans.map((x, j) => j === i ? updated : x),
                }))

              return (
                <div key={vestDate} className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
                      Vesting {fmtDate(vestDate)}
                    </p>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={tl.has_loan}
                        onChange={e => update({ ...tl, has_loan: e.target.checked })}
                        className="rounded"
                      />
                      Took a tax loan
                    </label>
                  </div>
                  {tl.has_loan && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Loan #" value={tl.loan_number} onChange={v => update({ ...tl, loan_number: v })} />
                      <Field label="Year issued" type="number" value={tl.due_date.slice(0, 4) || String(new Date(vestDate).getFullYear())} onChange={_ => {}} />
                      <Field label="Amount ($)" type="number" step="0.01" value={tl.amount} onChange={v => update({ ...tl, amount: v })} />
                      <Field label="Interest rate" type="number" step="0.001" value={tl.interest_rate} onChange={v => update({ ...tl, interest_rate: v })} hint="e.g. 0.05" />
                      <Field label="Due date" type="date" value={tl.due_date} onChange={v => update({ ...tl, due_date: v })} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <NextBtn
            label="Done with tax loans →"
            onClick={() => {
              // Merge tax loans into grantDraft.loans
              const taxLoans: LoanDraft[] = grantDraft.tax_loans
                .flatMap((tl, i): LoanDraft[] => !tl.has_loan ? [] : [{
                  loan_number: tl.loan_number,
                  loan_type: 'Tax',
                  loan_year: String(new Date(vYears[i] ?? '').getFullYear() || ''),
                  amount: tl.amount,
                  interest_rate: tl.interest_rate,
                  due_date: tl.due_date,
                  refinances_loan_number: '',
                }])
              setGrantDraft(d => ({ ...d, loans: [...d.loans, ...taxLoans] }))
              finishGrant()
            }}
          />
        </div>
      )}

      {/* ── More grants ── */}
      {screen === 'more_grants' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Add another grant?
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-400">
            You have {completedGrants.length} grant{completedGrants.length !== 1 ? 's' : ''} so far.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setGrantDraft(emptyGrantDraft())
                push('grant_entry')
              }}
              className="rounded-md bg-rose-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
            >
              Yes, add another
            </button>
            <button
              type="button"
              onClick={() => push('review')}
              className="rounded-md bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400"
            >
              No, review &amp; submit
            </button>
          </div>
        </div>
      )}

      {/* ── Review ── */}
      {screen === 'review' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Review</h2>
          {submitError && <p className="text-xs text-red-500">{submitError}</p>}

          {/* Prices */}
          <div className="rounded-md border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
              Prices ({prices.filter(p => p.effective_date && p.price !== '').length})
            </p>
            <div className="mt-1.5 space-y-0.5">
              {prices.filter(p => p.effective_date && p.price !== '').map((p, i) => (
                <p key={i} className="text-xs text-gray-500 dark:text-slate-400">
                  {fmtDate(p.effective_date)} — ${parseFloat(p.price).toFixed(2)}
                </p>
              ))}
            </div>
          </div>

          {/* Grants */}
          <div className="rounded-md border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
              Grants ({completedGrants.length})
            </p>
            <div className="mt-1.5 space-y-1.5">
              {completedGrants.map((g, i) => (
                <div key={i} className="text-xs">
                  <p className="font-medium text-gray-800 dark:text-slate-200">
                    {g.year} {g.type} — {g.shares.toLocaleString()} shares
                    {g.loans.length > 0 && ` · ${g.loans.length} loan${g.loans.length !== 1 ? 's' : ''}`}
                  </p>
                  <p className="text-gray-400 dark:text-slate-500">
                    {g.periods} periods from {fmtDate(g.vest_start)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Summary of orphans being removed */}
          {(() => {
            const removingPrices = orphanPrices.filter(p => !preserveOrphanPriceIds.has(p.id))
            const removingGrants = orphanGrants.filter(g => !preserveOrphanGrantIds.has(g.id))
            if (removingPrices.length === 0 && removingGrants.length === 0) return null
            return (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                {[
                  removingGrants.length > 0 && `${removingGrants.length} grant${removingGrants.length !== 1 ? 's' : ''}`,
                  removingPrices.length > 0 && `${removingPrices.length} price${removingPrices.length !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' and ')} will be removed (as marked on previous screens).
              </p>
            )
          })()}

          <NextBtn
            label="Submit →"
            saving={submitting}
            onClick={handleSubmit}
          />
        </div>
      )}

      {/* ── Schedule: Intro ── */}
      {screen === 'schedule_intro' && (
        <div className="space-y-5">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">What you'll need</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              We know Epic's grant schedule — years, vesting dates, and purchase prices. We just need the numbers specific to you.
            </p>
          </div>
          <div className="rounded-md border border-stone-200 p-3 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <span className="font-medium text-gray-700 dark:text-slate-300">What you'll enter</span>
              <span className="font-medium text-gray-700 dark:text-slate-300">Where to find it</span>
              <span className="text-gray-600 dark:text-slate-400">Annual share prices</span>
              <span className="text-gray-500 dark:text-slate-500">Epic stocks SharePoint</span>
              <span className="text-gray-600 dark:text-slate-400">Shares purchased / DP shares</span>
              <span className="text-gray-500 dark:text-slate-500">DocuSign or Shareworks</span>
              <span className="text-gray-600 dark:text-slate-400">Catch-up / bonus shares</span>
              <span className="text-gray-500 dark:text-slate-500">DocuSign or Shareworks</span>
              <span className="text-gray-600 dark:text-slate-400">Loan interest rate</span>
              <span className="text-gray-500 dark:text-slate-500">Loan statement or DocuSign</span>
            </div>
          </div>
          <NextBtn label="Let's go →" onClick={() => push('schedule_prices')} />
        </div>
      )}

      {/* ── Schedule: Grants table ── */}
      {screen === 'schedule_grants' && (
        <div className="space-y-5">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Step 2 of 2 — Your grants</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
              Check each year you participated. Vesting dates and periods are pre-filled — just enter your shares, confirm the cost basis, and add loan details.
            </p>
          </div>

          {/* Purchase grants (catch-up and free shown inline where applicable) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Purchase grants</p>
            {purchaseRows.map((row, i) => {
              const catchUpIdx = catchUpRows.findIndex(c => c.year === row.year)
              const catchUp = catchUpIdx >= 0 ? catchUpRows[catchUpIdx] : null
              const freeIdx = bonusRows.findIndex(b => b.year === row.year && b.type === 'Free')
              const freeGrant = freeIdx >= 0 ? bonusRows[freeIdx] : null
              return (
                <div key={row.year} className="rounded-md border border-stone-200 dark:border-slate-700">
                  <label className="flex cursor-pointer items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={row.participated}
                      onChange={e => setPurchaseField(i, { participated: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{row.year}</span>
                    <span className="text-[11px] text-gray-400 dark:text-slate-500">
                      exercised {row.exercise_date} · vests {row.vest_start} · {row.periods} periods
                    </span>
                  </label>
                  {row.participated && (
                    <div className="border-t border-stone-100 p-3 space-y-3 dark:border-slate-800">
                      {/* Purchase fields */}
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Purchase price ($/share)" type="number" step="0.01"
                          value={row.purchase_price}
                          onChange={v => setPurchaseField(i, { purchase_price: v }, true)} />
                        <Field label="Shares" type="number" value={row.shares}
                          onChange={v => setPurchaseField(i, { shares: v }, true)} />
                        <Field label="DP shares" type="number" value={row.dp_shares}
                          onChange={v => setPurchaseField(i, { dp_shares: v })}
                          hint="shares exchanged at exercise" />
                      </div>
                      {/* Loan details */}
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-rose-700 hover:text-rose-800 dark:text-rose-400 list-none">
                          Loan details ›
                        </summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <Field label="DP cash paid ($)" type="number" step="0.01" value={row.dp_cash}
                            onChange={v => setPurchaseField(i, { dp_cash: v }, true)} placeholder="0" />
                          <Field label="Loan amount ($)" type="number" step="0.01" value={row.loan_amount}
                            onChange={v => setPurchaseField(i, { loan_amount: v })} />
                          <Field label="Interest rate" type="number" step="0.0001" value={row.interest_rate}
                            onChange={v => setPurchaseField(i, { interest_rate: v })}
                            placeholder="e.g. 0.0178" hint="from loan statement" />
                          <Field label="Due date" type="date" value={row.loan_due_date}
                            onChange={v => setPurchaseField(i, { loan_due_date: v })} />
                        </div>
                      </details>
                      {/* Inline catch-up grant for this year (2018–2021) */}
                      {catchUp && (
                        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/30">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={catchUp.included}
                              onChange={e => setCatchUpField(catchUpIdx, { included: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-xs font-medium text-sky-800 dark:text-sky-300">{row.year} Catch-Up grant</span>
                            <span className="text-[11px] text-sky-600 dark:text-sky-500">
                              zero cost basis · vests {catchUp.vest_start} · {catchUp.periods} periods
                            </span>
                          </label>
                          {catchUp.included && (
                            <div className="mt-2 w-40">
                              <Field label="Catch-up shares" type="number" value={catchUp.shares}
                                onChange={v => setCatchUpField(catchUpIdx, { shares: v })} />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Inline free grant for this year (e.g. 2022 Free) */}
                      {freeGrant && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">{row.year} Free grant</span>
                            <span className="text-[11px] text-amber-600 dark:text-amber-500">
                              zero cost basis · vests {fmtDate(freeGrant.vest_start)} · {freeGrant.periods} period{freeGrant.periods !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="mt-2 w-40">
                            <Field label="Free shares" type="number" value={freeGrant.shares}
                              onChange={v => setBonusField(freeIdx, { shares: v })} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Bonus / Free grants — Free grants with a matching purchase year are shown inline above */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Bonus &amp; Free grants</p>
            <p className="text-[11px] text-gray-400 dark:text-slate-500">Leave shares blank for years you didn't receive a bonus.</p>
            {bonusRows.map((row, i) => {
              // Free grants that have a matching purchase year are rendered inline above
              if (row.type === 'Free' && purchaseRows.some(p => p.year === row.year)) return null
              return (
              <div key={`${row.year}-${row.type}`} className="rounded-md border border-stone-200 p-3 dark:border-slate-700 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GRANT_COLORS[row.type]}`}>{row.year} {row.type}</span>
                  {row.type !== 'Free' && <span className="text-[11px] text-gray-400 dark:text-slate-500">{row.periods} periods from {fmtDate(row.vest_start)}</span>}
                  {row.type === 'Free' && <span className="text-[11px] text-gray-400 dark:text-slate-500">vests {fmtDate(row.vest_start)}</span>}
                </div>
                {row.isBonus2020 && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">
                      Vesting schedule — <span className="italic">check which you initialed in your 2020 bonus agreement</span>
                    </p>
                    <div className="flex gap-1.5">
                      {(['A', 'B', 'C'] as BonusSchedule[]).map(s => (
                        <button key={s} type="button"
                          onClick={() => setBonusField(i, { schedule: s })}
                          className={`rounded-md px-3 py-1 text-xs font-medium ${row.schedule === s ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400'}`}
                        >
                          {s}
                        </button>
                      ))}
                      <span className="ml-1 text-[11px] text-gray-400 self-center">
                        {row.schedule === 'A' ? '2 periods (50%/50%)' : row.schedule === 'B' ? '3 periods (34%/33%/33%)' : '4 periods (25% each)'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Shares" type="number" value={row.shares}
                    onChange={v => setBonusField(i, { shares: v })} />
                  {row.type !== 'Free' && (
                    <Field label="Cost basis ($/share)" type="number" step="0.01" value={row.purchase_price}
                      onChange={v => setBonusField(i, { purchase_price: v })}
                      hint={row.year === 2020 ? 'usually $0' : 'usually = annual price'} />
                  )}
                </div>
              </div>
              )
            })}
            <button
              type="button"
              onClick={() => setBonusRows(rows => [...rows, {
                year: new Date().getFullYear(), type: 'Bonus',
                purchase_price: '', shares: '',
                isBonus2020: false, schedule: 'C',
                vest_start: '', periods: 3, exercise_date: '',
              }])}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
            >
              + Add bonus grant
            </button>
          </div>

          {orphanGrants.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                Existing grants not in Epic's schedule — will be removed
              </p>
              <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-500">Uncheck to keep.</p>
              <div className="mt-2 space-y-1">
                {orphanGrants.map(g => (
                  <label key={g.id} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                    <input
                      type="checkbox"
                      checked={!preserveOrphanGrantIds.has(g.id)}
                      onChange={e => setPreserveOrphanGrantIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) { next.delete(g.id) } else { next.add(g.id) }
                        return next
                      })}
                      className="rounded border-red-300"
                    />
                    {g.year} {g.type} — {g.shares.toLocaleString()} shares
                  </label>
                ))}
              </div>
            </div>
          )}

          <NextBtn label="Next: Preferences →" onClick={() => push('schedule_settings')} />
        </div>
      )}

      {/* ── Schedule: Prices table ── */}
      {screen === 'schedule_prices' && (
        <div className="space-y-4">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Step 1 of 2 — Annual share prices</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Enter the price per share from each annual Epic announcement. Find these on the Epic stocks SharePoint. These will be used to pre-fill cost basis in your grants.
            </p>
          </div>
          <div className="space-y-2">
            {prices.map((p, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={i === 0 ? 'Date' : ''}
                    type="date" value={p.effective_date}
                    onChange={v => setPrices(prev => prev.map((x, j) => j === i ? { ...x, effective_date: v } : x))}
                  />
                </div>
                <div className="w-28">
                  <Field
                    label={i === 0 ? 'Price ($)' : ''}
                    type="number" step="0.01" value={p.price}
                    onChange={v => setPrices(prev => prev.map((x, j) => j === i ? { ...x, price: v } : x))}
                    placeholder="0.00"
                  />
                </div>
                {prices.length > 1 && (
                  <button type="button"
                    onClick={() => setPrices(prev => prev.filter((_, j) => j !== i))}
                    className="mb-0.5 text-xs text-gray-400 hover:text-red-500"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button"
            onClick={() => setPrices(prev => [...prev, { effective_date: '', price: '' }])}
            className="text-xs font-medium text-rose-700 hover:text-rose-800 dark:text-rose-400"
          >
            + Add price
          </button>
          {orphanPrices.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                Existing prices not covered above — will be removed
              </p>
              <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-500">Uncheck to keep.</p>
              <div className="mt-2 space-y-1">
                {orphanPrices.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                    <input
                      type="checkbox"
                      checked={!preserveOrphanPriceIds.has(p.id)}
                      onChange={e => setPreserveOrphanPriceIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) { next.delete(p.id) } else { next.add(p.id) }
                        return next
                      })}
                      className="rounded border-red-300"
                    />
                    {fmtDate(p.effective_date)} — ${p.price.toFixed(2)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <NextBtn label="Next: Enter grants →" onClick={() => {
            // Pre-fill purchase price for each row from the price entered for that exercise year
            setPurchaseRows(rows => rows.map(r => {
              if (r.purchase_price) return r
              const exerciseYear = new Date(r.exercise_date + 'T00:00:00').getFullYear()
              const match = prices.find(p => p.price && new Date(p.effective_date + 'T00:00:00').getFullYear() === exerciseYear)
              return match ? { ...r, purchase_price: match.price } : r
            }))
            push('schedule_grants')
          }} />
        </div>
      )}

      {/* ── Schedule: Preferences ── */}
      {screen === 'schedule_settings' && (
        <div className="space-y-5">
          <BackBtn onClick={back} />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">A couple quick questions</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              These affect how gains and deductions are calculated. You can change them on the Settings page anytime.
            </p>
          </div>
          {submitError && <p className="text-xs text-red-500">{submitError}</p>}

          <div className="rounded-md border border-stone-200 p-4 space-y-1 dark:border-slate-700">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deductInterest}
                onChange={e => setDeductInterest(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200">
                  Deduct investment interest expense
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  Check this if you itemize deductions and claim loan interest against investment income (IRS Form 4952). Most people leave this unchecked.
                </p>
              </div>
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <NextBtn label="Save & review →" saving={submitting} onClick={() => handleScheduleReview(true)} />
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleScheduleReview(false)}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* ── Done ── */}
      {screen === 'done' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/40">
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
            Setup complete!
          </h2>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            Created {completedGrants.length} grant{completedGrants.length !== 1 ? 's' : ''} and{' '}
            {prices.filter(p => p.effective_date && p.price !== '').length} prices.
            Your event timeline is now computing.
          </p>
          <div className="mt-2 space-y-0.5 text-xs text-emerald-700 dark:text-emerald-300">
            {completedGrants.map((g, i) => (
              <p key={i}>✓ {g.year} {g.type} — {g.shares.toLocaleString()} shares{g.loans.length > 0 ? ` · ${g.loans.length} loan${g.loans.length !== 1 ? 's' : ''}` : ''}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={handleComplete}
            className="mt-5 rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
          >
            View dashboard →
          </button>
        </div>
      )}
    </div>
  )
}
