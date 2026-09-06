import type { GrantEntry, PriceEntry, WizardGrant } from '../../../../api.ts'
import { ReportableError } from '../../../../scaffold/components/ReportProblem.tsx'
import { fmtFullDate, fmtNum, fmtPrice } from '../../../format.ts'
import { BackBtn, NextBtn } from '../fields.tsx'
import type { SanitizedSubmission } from '../submit.ts'

function plural(n: number, word: string) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`
}

function loanSuffix(g: WizardGrant) {
  return g.loans.length > 0 ? ` · ${plural(g.loans.length, 'loan')}` : ''
}

export function ReviewScreen({
  submission, submitting, submitError, orphanPrices, orphanGrants,
  preservedPriceIds, preservedGrantIds, onBack, onSubmit,
}: {
  submission: SanitizedSubmission
  submitting: boolean
  submitError: string
  orphanPrices: PriceEntry[]
  orphanGrants: GrantEntry[]
  preservedPriceIds: Set<number>
  preservedGrantIds: Set<number>
  onBack: () => void
  onSubmit: () => void
}) {
  const { blockingIssues, droppedLoans, droppedPrices } = submission
  const removingPrices = orphanPrices.filter(p => !preservedPriceIds.has(p.id)).length
  const removingGrants = orphanGrants.filter(g => !preservedGrantIds.has(g.id)).length

  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h2 className="text-base font-semibold text-cs-text">Review</h2>
      <ReportableError message={submitError} source="import" />

      {blockingIssues.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <p className="text-xs font-medium text-red-800 dark:text-red-300">
            Fix {blockingIssues.length === 1 ? 'this' : 'these'} before submitting:
          </p>
          <ul className="mt-1 space-y-0.5">
            {blockingIssues.map((issue, i) => (
              <li key={i} className="text-[11px] text-red-700 dark:text-red-400">• {issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty rows that will be silently skipped */}
      {(droppedLoans.length > 0 || droppedPrices.length > 0) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Empty rows will be skipped:</p>
          <ul className="mt-1 space-y-0.5">
            {droppedPrices.map((d, i) => (
              <li key={`p-${i}`} className="text-[11px] text-amber-700 dark:text-amber-400">
                • Price on {fmtFullDate(d.effective_date)} — {d.reason}
              </li>
            ))}
            {droppedLoans.map((d, i) => (
              <li key={`l-${i}`} className="text-[11px] text-amber-700 dark:text-amber-400">
                • {d.grant}: {d.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
            Go back to fill them in, or submit to skip.
          </p>
        </div>
      )}

      <div className="rounded-md border border-cs-border bg-cs-surface p-3 ">
        <p className="text-xs font-medium text-cs-text-2">Prices ({submission.prices.length})</p>
        <div className="mt-1.5 space-y-0.5">
          {submission.prices.map((p, i) => (
            <p key={i} className="text-xs text-cs-muted">
              {fmtFullDate(p.effective_date)} — {fmtPrice(p.price)}
            </p>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-cs-border bg-cs-surface p-3 ">
        <p className="text-xs font-medium text-cs-text-2">Grants ({submission.grants.length})</p>
        <div className="mt-1.5 space-y-1.5">
          {submission.grants.map((g, i) => (
            <div key={i} className="text-xs">
              <p className="font-medium text-cs-text">
                {g.year} {g.type} — {fmtNum(g.shares)} shares{loanSuffix(g)}
              </p>
              <p className="text-cs-muted">{g.periods} periods from {fmtFullDate(g.vest_start)}</p>
            </div>
          ))}
        </div>
      </div>

      {(removingPrices > 0 || removingGrants > 0) && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {[
            removingGrants > 0 && plural(removingGrants, 'grant'),
            removingPrices > 0 && plural(removingPrices, 'price'),
          ].filter(Boolean).join(' and ')} will be removed (as marked on previous screens).
        </p>
      )}

      <NextBtn
        label="Submit →"
        saving={submitting}
        disabled={blockingIssues.length > 0}
        onClick={onSubmit}
      />
    </div>
  )
}

export function DoneScreen({ grants, priceCount, onComplete }: {
  grants: WizardGrant[]
  priceCount: number
  onComplete: () => void
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/40">
      <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">Setup complete!</h2>
      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
        Created {plural(grants.length, 'grant')} and {priceCount} prices.
        Your event timeline is now computing.
      </p>
      <div className="mt-2 space-y-0.5 text-xs text-emerald-700 dark:text-emerald-300">
        {grants.map((g, i) => (
          <p key={i}>✓ {g.year} {g.type} — {fmtNum(g.shares)} shares{loanSuffix(g)}</p>
        ))}
      </div>
      <button
        type="button"
        onClick={onComplete}
        className="mt-5 rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
      >
        View dashboard →
      </button>
    </div>
  )
}
