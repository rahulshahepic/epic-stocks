import { fmtFullDate, fmtPct } from '../../../format.ts'
import { BackBtn, LoanReviewRow, NextBtn, RefiChainGroup, SkipBtn } from '../fields.tsx'
import { groupByGrant, purchaseChainFor } from '../loans.ts'
import type { WizardSchedule } from '../schedule.ts'
import type { PurchaseGrantRow, ReviewedLoan } from '../types.ts'

/**
 * One of the two flat loan-review screens (tax loans, then interest loans).
 *
 * Both show the same thing — the generated loans grouped under their grant, each
 * editable or switched off — so they differ only in wording and in which loans
 * they select.
 */
export function LoanReviewScreen({
  title, blurb, emptyText, accentClass, loans, nextLabel, onChangeLoan, onBack, onNext, onSkip,
}: {
  title: string
  blurb: string
  emptyText: string
  /** Colour of the "<year> <type>" group heading. */
  accentClass: string
  loans: ReviewedLoan[]
  nextLabel: string
  onChangeLoan: (updated: ReviewedLoan) => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">{title}</h2>
        <p className="mt-1 text-xs text-cs-muted">{blurb}</p>
      </div>
      {loans.length > 0 ? (
        <div className="space-y-3">
          {groupByGrant(loans).map(([label, group]) => (
            <div key={label}>
              <p className={`mb-1 text-[10px] font-medium ${accentClass}`}>{label}</p>
              <div className="space-y-1">
                {group.map(loan => (
                  <LoanReviewRow key={loan.key} loan={loan} onChange={onChangeLoan} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-cs-muted">{emptyText}</p>
      )}
      <div className="flex gap-2">
        <NextBtn label={nextLabel} onClick={onNext} />
        <SkipBtn onClick={onSkip} />
      </div>
    </div>
  )
}

/**
 * The refinance-chain screen. Unlike the flat screens it draws each chain as a
 * chain, and explains what the rate on the user's own loan implied.
 */
export function RefiReviewScreen({
  schedule, purchaseRows, loans, onChangeLoan, onBack, onNext, onSkip,
}: {
  schedule: WizardSchedule
  purchaseRows: PurchaseGrantRow[]
  loans: ReviewedLoan[]
  onChangeLoan: (updated: ReviewedLoan) => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  // Epic's documents carry no refinance dates, so the rate on each loan is what
  // says how far down the chain it went. Say so wherever that reading left out
  // steps the company schedule has, so it can be corrected here.
  const notes = purchaseRows
    .filter(r => r.participated && parseInt(r.shares) > 0 && schedule.purchaseRefiChains[r.year])
    .map(r => ({ row: r, full: schedule.purchaseRefiChains[r.year], ...purchaseChainFor(schedule, r) }))
    .filter(n => n.inference && (n.inference.steps < n.full.length || n.inference.basis === 'unmatched'))

  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Refinance chains</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Your purchase loan history from origination to current rate. Oldest on top, current
          at the bottom. These rates are used to estimate interest loan amounts on the next page.
        </p>
      </div>

      {notes.length > 0 && (
        <div className="rounded-md border border-cs-border bg-cs-raised p-2.5">
          <p className="text-[11px] font-medium text-cs-text-2">
            Read from your loan rates — Epic's documents never say when a loan was refinanced.
          </p>
          <ul className="mt-1 space-y-1">
            {notes.map(({ row, full, inference }) => {
              const pct = fmtPct(parseFloat(row.interest_rate) || 0)
              const steps = inference!.steps
              const skipped = full.length - steps
              return (
                <li key={row.year} className={`text-[11px] ${inference!.basis === 'unmatched' ? 'text-amber-600 dark:text-amber-400' : 'text-cs-muted'}`}>
                  <span className="font-medium">{row.year} purchase loan</span>{' — '}
                  {inference!.basis === 'unmatched'
                    ? `${pct} matches none of the ${full.length} refinances on record, so none were applied. Check the rate if that looks wrong.`
                    : steps === 0
                      ? `${pct} is the original rate, so no refinance was applied.`
                      : `${pct} matches the ${fmtFullDate(full[steps - 1].date)} refinance, so the ${skipped} later step${skipped === 1 ? '' : 's'} on record ${skipped === 1 ? 'was' : 'were'} not applied.`}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {loans.length > 0 ? (
        <div className="space-y-4">
          {groupByGrant(loans).map(([label, group]) => (
            <RefiChainGroup key={label} label={label} loans={group} onChangeLoan={onChangeLoan} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-cs-muted">No refinances detected for your grant years.</p>
      )}

      <div className="flex gap-2">
        <NextBtn label="Next: Interest loans →" onClick={onNext} />
        <SkipBtn onClick={onSkip} />
      </div>
    </div>
  )
}
