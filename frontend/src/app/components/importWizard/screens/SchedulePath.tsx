import type { GrantEntry, PriceEntry } from '../../../../api.ts'
import { ReportableError } from '../../../../scaffold/components/ReportProblem.tsx'
import { GRANT_COLORS, ZERO_BASIS_TYPES } from '../../../grantTypes.ts'
import { fmtFullDate, fmtPct, fmtPrice } from '../../../format.ts'
import { BackBtn, Field, NextBtn, PercentField, PriceRows, SkipBtn } from '../fields.tsx'
import { OrphanList } from './OrphanList.tsx'
import { dpAllowed, maxLoan, minDownPayment, purchaseTotal } from '../rows.ts'
import type { WizardSchedule } from '../schedule.ts'
import type {
  BonusGrantRow, BonusSchedule, CatchUpRow, PurchaseGrantRow, WizardPrice,
} from '../types.ts'

const SCHEDULE_LABELS: Record<BonusSchedule, string> = {
  A: '2 periods (50%/50%)',
  B: '3 periods (34%/33%/33%)',
  C: '4 periods (25% each)',
}

export function ScheduleIntro({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="space-y-5">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">What you'll need</h2>
        <p className="mt-1 text-xs text-cs-muted">
          We know Epic's grant schedule — years, vesting dates, and purchase prices. We just need the numbers specific to you.
        </p>
      </div>
      <div className="rounded-md border border-cs-border p-3 ">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-cs-text-2">What you'll enter</span>
          <span className="font-medium text-cs-text-2">Where to find it</span>
          <span className="text-cs-text-2">Annual share prices</span>
          <span className="text-cs-muted">Epic stocks SharePoint</span>
          <span className="text-cs-text-2">Shares purchased / DP shares</span>
          <span className="text-cs-muted">DocuSign or Shareworks</span>
          <span className="text-cs-text-2">Catch-up / bonus shares</span>
          <span className="text-cs-muted">DocuSign or Shareworks</span>
          <span className="text-cs-text-2">Loan interest rate</span>
          <span className="text-cs-muted">Loan statement or DocuSign</span>
        </div>
      </div>
      <NextBtn label="Let's go →" onClick={onNext} />
    </div>
  )
}

export function SchedulePrices({
  prices, setPrices, orphanPrices, preservedPriceIds, onToggleOrphanPrice, onBack, onNext,
}: {
  prices: WizardPrice[]
  setPrices: (next: WizardPrice[]) => void
  orphanPrices: PriceEntry[]
  preservedPriceIds: Set<number>
  onToggleOrphanPrice: (id: number, remove: boolean) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Step 1 of 2 — Annual share prices</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Enter the price per share from each annual Epic announcement. Find these on the Epic stocks SharePoint. These will be used to pre-fill cost basis in your grants.
        </p>
      </div>
      <PriceRows prices={prices} onChange={setPrices} />
      <OrphanList
        title="Existing prices not covered above — will be removed"
        rows={orphanPrices} preserved={preservedPriceIds} onToggle={onToggleOrphanPrice}
      >
        {p => <>{fmtFullDate(p.effective_date)} — {fmtPrice(p.price)}</>}
      </OrphanList>
      <NextBtn label="Next: Enter grants →" onClick={onNext} />
    </div>
  )
}

export interface ScheduleGrantsProps {
  schedule: WizardSchedule
  purchaseRows: PurchaseGrantRow[]
  catchUpRows: CatchUpRow[]
  bonusRows: BonusGrantRow[]
  setPurchaseField: (i: number, patch: Partial<PurchaseGrantRow>, recalc?: boolean) => void
  setCatchUpField: (i: number, patch: Partial<CatchUpRow>) => void
  setBonusField: (i: number, patch: Partial<BonusGrantRow>) => void
  onAddBonusRow: () => void
  /** The wizard price for a year, used for the "min N shares at $X" hint. */
  priceForYear: (year: number) => number
  /** Set when the row asks for more down-payment shares than have vested. */
  dpShortfall: (row: PurchaseGrantRow) => { needed: number; available: number } | null
  orphanGrants: GrantEntry[]
  preservedGrantIds: Set<number>
  onToggleOrphanGrant: (id: number, remove: boolean) => void
  onBack: () => void
  onNext: () => void
}

export function ScheduleGrants(p: ScheduleGrantsProps) {
  const { purchaseRows, bonusRows } = p
  return (
    <div className="space-y-5">
      <BackBtn onClick={p.onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Step 2 of 2 — Your grants</h2>
        <p className="mt-0.5 text-xs text-cs-muted">
          Check each year you participated. Vesting dates and periods are pre-filled — just enter your shares, confirm the cost basis, and add loan details.
        </p>
      </div>

      {/* Purchase grants (catch-up and free shown inline where applicable) */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-cs-text-2">Purchase grants</p>
        {purchaseRows.map((row, i) => (
          <PurchaseRow key={row.year} {...p} row={row} index={i} />
        ))}
      </div>

      {/* Bonus / Free grants — Free grants with a matching purchase year are shown inline above */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-cs-text-2">Bonus, Free &amp; Developer Bonus grants</p>
        <p className="text-[11px] text-cs-muted">Leave shares blank for years you didn't receive a bonus.</p>
        {bonusRows.map((row, i) => {
          // Free grants that have a matching purchase year are rendered inline above
          if (row.type === 'Free' && purchaseRows.some(pr => pr.year === row.year)) return null
          return (
            <BonusRow key={`${row.year}-${row.type}`} row={row} index={i} setBonusField={p.setBonusField} />
          )
        })}
        <button
          type="button"
          onClick={p.onAddBonusRow}
          className="text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
        >
          + Add bonus grant
        </button>
      </div>

      <OrphanList
        title="Existing grants not in Epic's schedule — will be removed"
        rows={p.orphanGrants} preserved={p.preservedGrantIds} onToggle={p.onToggleOrphanGrant}
      >
        {g => <>{g.year} {g.type} — {g.shares.toLocaleString()} shares</>}
      </OrphanList>

      <NextBtn label="Next: Review loans →" onClick={p.onNext}
        disabled={purchaseRows.some(row => p.dpShortfall(row) != null)} />
    </div>
  )
}

function PurchaseRow({
  row, index: i, schedule, catchUpRows, bonusRows,
  setPurchaseField, setCatchUpField, setBonusField, priceForYear, dpShortfall,
}: ScheduleGrantsProps & { row: PurchaseGrantRow; index: number }) {
  const catchUpIdx = catchUpRows.findIndex(c => c.year === row.year)
  const catchUp = catchUpIdx >= 0 ? catchUpRows[catchUpIdx] : null
  const freeIdx = bonusRows.findIndex(b => b.year === row.year && b.type === 'Free')
  const freeGrant = freeIdx >= 0 ? bonusRows[freeIdx] : null
  const dpOk = dpAllowed(schedule, row)
  const shortfall = dpShortfall(row)

  /** "min 260 at $2.50/sh" — how many shares would cover the gap left by the loan. */
  function dpHint(): string {
    if (!dpOk) return 'not available for this grant year'
    const gap = purchaseTotal(row) - (parseFloat(row.loan_amount) || 0)
    const marketPrice = priceForYear(new Date(row.exercise_date + 'T00:00:00').getFullYear())
    if (gap > 0 && marketPrice > 0) return `min ${Math.ceil(gap / marketPrice).toLocaleString()} at $${marketPrice}/sh`
    return 'shares exchanged at exercise'
  }

  return (
    <div className="rounded-md border border-cs-border">
      <label className="flex cursor-pointer items-center gap-3 p-3">
        <input
          type="checkbox"
          checked={row.participated}
          onChange={e => setPurchaseField(i, { participated: e.target.checked })}
          className="rounded"
        />
        <span className="text-sm font-medium text-cs-text">{row.year}</span>
        <span className="text-[11px] text-cs-muted">
          exercised {row.exercise_date} · vests {row.vest_start} · {row.periods} periods
        </span>
      </label>
      {row.participated && (
        <div className="border-t border-cs-border p-3 space-y-3 ">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase price ($/share)" type="number" step="0.01"
              value={row.purchase_price}
              onChange={v => setPurchaseField(i, { purchase_price: v }, true)} />
            <Field label="Shares" type="number" value={row.shares}
              onChange={v => setPurchaseField(i, { shares: v }, true)} />
            <Field label="DP shares" type="number" value={dpOk ? row.dp_shares : '0'}
              onChange={v => setPurchaseField(i, { dp_shares: v })}
              hint={dpHint()}
              disabled={!dpOk}
              placeholder={dpOk ? '0' : 'not available'} />
          </div>
          {shortfall && (
            <p className="text-[10px] text-red-600 dark:text-red-400">
              Not enough vested shares: need {shortfall.needed.toLocaleString()},
              only {shortfall.available.toLocaleString()} available from prior grants
            </p>
          )}

          <details>
            <summary className="cursor-pointer text-xs font-medium text-cs-brand hover:text-cs-brand-hover list-none">
              Loan details ›
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="DP cash paid ($)" type="number" step="0.01" value={row.dp_cash}
                onChange={v => setPurchaseField(i, { dp_cash: v }, true)}
                placeholder={purchaseTotal(row) > 0 ? `default: ${minDownPayment(purchaseTotal(row)).toFixed(0)}` : '0'} />
              <Field label="Loan amount ($)" type="number" step="0.01" value={row.loan_amount}
                onChange={v => {
                  const total = purchaseTotal(row)
                  const capped = Math.min(parseFloat(v) || 0, maxLoan(total))
                  setPurchaseField(i, { loan_amount: total > 0 ? capped.toFixed(2) : v })
                }} />
              <PercentField label="Interest rate (%)"
                value={row.interest_rate}
                onChange={v => setPurchaseField(i, { interest_rate: v })}
                placeholder="e.g. 1.78" hint="from loan statement" />
              <Field label="Due date" type="date" value={row.loan_due_date}
                onChange={v => setPurchaseField(i, { loan_due_date: v })} />
            </div>
          </details>

          {/* Existing refinance loans — read-only indicator */}
          {row.existing_refinance_loans.length > 0 && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-2 dark:border-violet-800 dark:bg-violet-950/30">
              <p className="text-[11px] font-medium text-violet-700 dark:text-violet-400">
                {row.existing_refinance_loans.length} refinance loan{row.existing_refinance_loans.length !== 1 ? 's' : ''} will be preserved
              </p>
              {row.existing_refinance_loans.map((rl, j) => (
                <p key={j} className="text-[11px] text-violet-600 dark:text-violet-500">
                  {rl.loan_number ? `#${rl.loan_number}` : 'Refinance'} — ${rl.amount.toLocaleString()} · {fmtPct(rl.interest_rate)} · due {rl.due_date}
                </p>
              ))}
            </div>
          )}

          {/* Inline catch-up grant for this year */}
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

          {/* Inline free grant for this year */}
          {freeGrant && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">{row.year} Free grant</span>
                <span className="text-[11px] text-amber-600 dark:text-amber-500">
                  zero cost basis · vests {fmtFullDate(freeGrant.vest_start)} · {freeGrant.periods} period{freeGrant.periods !== 1 ? 's' : ''}
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
}

function BonusRow({ row, index: i, setBonusField }: {
  row: BonusGrantRow
  index: number
  setBonusField: (i: number, patch: Partial<BonusGrantRow>) => void
}) {
  return (
    <div className="rounded-md border border-cs-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${GRANT_COLORS[row.type]}`}>{row.year} {row.type}</span>
        {row.type !== 'Free'
          ? <span className="text-[11px] text-cs-muted">{row.periods} periods from {fmtFullDate(row.vest_start)}</span>
          : <span className="text-[11px] text-cs-muted">vests {fmtFullDate(row.vest_start)}</span>}
      </div>
      {row.isBonus2020 && (
        <div>
          <p className="text-xs text-cs-muted mb-1">
            Vesting schedule — <span className="italic">check which you initialed in your 2020 bonus agreement</span>
          </p>
          <div className="flex gap-1.5">
            {(Object.keys(SCHEDULE_LABELS) as BonusSchedule[]).map(s => (
              <button key={s} type="button"
                onClick={() => setBonusField(i, { schedule: s })}
                className={`rounded-md px-3 py-1 text-xs font-medium ${row.schedule === s ? 'bg-emerald-700 text-white' : 'bg-cs-raised text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700 '}`}
              >
                {s}
              </button>
            ))}
            <span className="ml-1 text-[11px] text-cs-muted self-center">{SCHEDULE_LABELS[row.schedule]}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shares" type="number" value={row.shares}
          onChange={v => setBonusField(i, { shares: v })} />
        {!ZERO_BASIS_TYPES.has(row.type) && (
          <Field label="Cost basis ($/share)" type="number" step="0.01" value={row.purchase_price}
            onChange={v => setBonusField(i, { purchase_price: v })}
            hint="0 if taxable at vest as ordinary income" />
        )}
      </div>
    </div>
  )
}

export function ScheduleSettings({ deductInterest, setDeductInterest, submitting, submitError, onBack, onSave, onSkip }: {
  deductInterest: boolean
  setDeductInterest: (v: boolean) => void
  submitting: boolean
  submitError: string
  onBack: () => void
  onSave: () => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-5">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">A couple quick questions</h2>
        <p className="mt-1 text-xs text-cs-muted">
          These affect how gains and deductions are calculated. You can change them on the Settings page anytime.
        </p>
      </div>
      <ReportableError message={submitError} source="import" />

      <div className="rounded-md border border-cs-border p-4 space-y-1 ">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={deductInterest}
            onChange={e => setDeductInterest(e.target.checked)}
            className="mt-0.5 rounded"
          />
          <div>
            <p className="text-sm font-medium text-cs-text">Deduct investment interest expense</p>
            <p className="mt-0.5 text-xs text-cs-muted">
              Check this if you itemize deductions (not standard) and want to claim loan interest against investment income (IRS Form 4952). You can customize which years on the Settings page. Most people leave this unchecked.
            </p>
          </div>
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <NextBtn label="Save & review →" saving={submitting} onClick={onSave} />
        <SkipBtn onClick={onSkip} disabled={submitting} />
      </div>
    </div>
  )
}
