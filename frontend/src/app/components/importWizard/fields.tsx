import { Field, PercentField } from '../../../scaffold/components/ui/Field.tsx'
import { fmtMonthYear, fmtPct } from '../../format.ts'
import type { LoanDraft, ReviewedLoan, WizardPrice } from './types.ts'

// Re-exported so the screens import their inputs from one place.
export { Field, PercentField }

const INLINE_INPUT = 'w-full rounded border border-cs-border bg-cs-raised px-1.5 py-0.5 text-xs text-cs-text '
const SECONDARY_BTN = 'rounded-md bg-cs-raised px-4 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700 '

export function LoanForm({
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
      {label && <p className="text-xs font-medium text-cs-text-2">{label}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan #" value={loan.loan_number} onChange={f('loan_number')} placeholder="e.g. 123456" />
        <Field label="Year issued" type="number" value={loan.loan_year} onChange={f('loan_year')} />
        <Field label="Amount ($)" type="number" step="0.01" value={loan.amount} onChange={f('amount')} />
        <PercentField label="Interest rate (%)"
          value={loan.interest_rate}
          onChange={f('interest_rate')}
          hint="e.g. 4.5" />
        <Field label="Due date" type="date" value={loan.due_date} onChange={f('due_date')} />
        {showRefinancesField && (
          <Field label="Refinances loan #" value={loan.refinances_loan_number} onChange={f('refinances_loan_number')} hint="prior loan #" />
        )}
      </div>
    </div>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-cs-muted hover:text-cs-text-2 ">
      ← Back
    </button>
  )
}

export function NextBtn({ onClick, disabled, label = 'Next →', saving }: {
  onClick: () => void; disabled?: boolean; label?: string; saving?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
    >
      {saving ? 'Saving...' : label}
    </button>
  )
}

/** The quieter sibling of NextBtn: moves on without taking what the screen offers. */
export function SkipBtn({ onClick, label = 'Skip', disabled }: {
  onClick: () => void; label?: string; disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${SECONDARY_BTN}disabled:opacity-50`}>
      {label}
    </button>
  )
}

/** A yes/no question, where "yes" opens a form and "no" moves on. */
export function YesNo({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onYes}
        className="rounded-md bg-rose-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-800">
        Yes
      </button>
      <button type="button" onClick={onNo} className={SECONDARY_BTN}>
        No
      </button>
    </div>
  )
}

// ── Price rows ───────────────────────────────────────────────────────────────

/** The date/price row editor, shared by both price screens. */
export function PriceRows({ prices, onChange }: {
  prices: WizardPrice[]
  onChange: (next: WizardPrice[]) => void
}) {
  const patch = (i: number, field: keyof WizardPrice, v: string) =>
    onChange(prices.map((x, j) => j === i ? { ...x, [field]: v } : x))

  return (
    <>
      <div className="space-y-2">
        {prices.map((p, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={i === 0 ? 'Date' : ''} type="date" value={p.effective_date}
                onChange={v => patch(i, 'effective_date', v)} />
            </div>
            <div className="w-28">
              <Field label={i === 0 ? 'Price ($)' : ''} type="number" step="0.01" value={p.price}
                onChange={v => patch(i, 'price', v)} placeholder="0.00" />
            </div>
            {prices.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(prices.filter((_, j) => j !== i))}
                className="mb-0.5 text-xs text-cs-muted hover:text-red-500"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...prices, { effective_date: '', price: '' }])}
        className="text-xs font-medium text-cs-brand hover:text-cs-brand-hover "
      >
        + Add price
      </button>
    </>
  )
}

// ── Loan review rows ─────────────────────────────────────────────────────────

/** Amount / rate / due date, the three figures every reviewed loan can be corrected on. */
function LoanTermsFields({ loan, onChange }: { loan: ReviewedLoan; onChange: (l: ReviewedLoan) => void }) {
  return (
    <div className="mt-1 grid grid-cols-3 gap-2">
      <div>
        <label className="block text-[10px] text-cs-muted">Amount ($)</label>
        <input
          type="number" step="0.01" value={loan.amount}
          onChange={e => onChange({ ...loan, amount: e.target.value })}
          className={INLINE_INPUT}
          placeholder="0.00"
        />
      </div>
      <div>
        <label className="block text-[10px] text-cs-muted">Rate (%)</label>
        <PercentField
          value={loan.interest_rate}
          onChange={v => onChange({ ...loan, interest_rate: v })}
          className={INLINE_INPUT}
        />
      </div>
      <div>
        <label className="block text-[10px] text-cs-muted">Due</label>
        <input
          type="date" value={loan.due_date}
          onChange={e => onChange({ ...loan, due_date: e.target.value })}
          className={INLINE_INPUT}
        />
      </div>
    </div>
  )
}

function SavedBadge() {
  return (
    <span className="rounded bg-green-100 px-1 text-[9px] text-green-600 dark:bg-green-900/40 dark:text-green-400">
      saved
    </span>
  )
}

export function LoanReviewRow({ loan, onChange }: { loan: ReviewedLoan; onChange: (l: ReviewedLoan) => void }) {
  return (
    <div className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${loan.enabled ? '' : 'opacity-40'}`}>
      <input
        type="checkbox" checked={loan.enabled}
        onChange={e => onChange({ ...loan, enabled: e.target.checked })}
        className="mt-0.5 rounded"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-cs-text-2">
            {loan.loan_type} {loan.loan_year}
          </span>
          {loan.refinances_loan_number && (
            <span className="rounded bg-violet-100 px-1 text-[9px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
              refi
            </span>
          )}
          {loan.is_existing && <SavedBadge />}
          <span className="text-cs-muted">{fmtPct(parseFloat(loan.interest_rate) || 0)}</span>
        </div>
        {loan.enabled && <LoanTermsFields loan={loan} onChange={onChange} />}
      </div>
    </div>
  )
}

/** Renders a refinance chain group with clear chronological ordering and chain flow indicators. */
export function RefiChainGroup({ label, loans, onChangeLoan }: {
  label: string
  loans: ReviewedLoan[]
  onChangeLoan: (updated: ReviewedLoan) => void
}) {
  // Sort by refi_date chronologically (oldest first), then by loan_year as fallback
  const sorted = [...loans].sort((a, b) => {
    if (a.refi_date && b.refi_date) return a.refi_date.localeCompare(b.refi_date)
    if (a.refi_date && !b.refi_date) return 1
    if (!a.refi_date && b.refi_date) return -1
    return a.loan_year - b.loan_year
  })

  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">{label}</p>
      <div className="space-y-0">
        {sorted.map((loan, i) => {
          const isFirst = i === 0
          const isLast = i === sorted.length - 1
          const isOnly = sorted.length === 1

          return (
            <div key={loan.key} className="relative">
              {/* Connecting line */}
              {!isOnly && (
                <div className="absolute left-[11px] top-0 bottom-0 w-px bg-violet-200 dark:bg-violet-800" />
              )}
              <div className={`relative flex items-start gap-2 rounded px-2 py-1.5 text-xs ${loan.enabled ? '' : 'opacity-40'}`}>
                {/* Chain dot */}
                <div className="relative z-10 mt-1 flex flex-col items-center">
                  <div className={`h-[7px] w-[7px] rounded-full border-2 ${
                    isLast && !isOnly
                      ? 'border-emerald-500 bg-emerald-500'
                      : isFirst
                        ? 'border-violet-400 bg-violet-400 dark:border-violet-500 dark:bg-violet-500'
                        : 'border-violet-300 bg-cs-surface dark:border-violet-600 '
                  }`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Chain position label */}
                    {isFirst && !isOnly && (
                      <span className="rounded bg-violet-100 px-1 text-[9px] font-medium text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
                        original
                      </span>
                    )}
                    {!isFirst && !isLast && (
                      <span className="rounded bg-violet-100 px-1 text-[9px] text-violet-500 dark:bg-violet-900/30 dark:text-violet-500">
                        refi
                      </span>
                    )}
                    {isLast && !isOnly && (
                      <span className="rounded bg-emerald-100 px-1 text-[9px] font-medium text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                        current
                      </span>
                    )}
                    <span className="font-medium text-cs-text-2">
                      {fmtPct(parseFloat(loan.interest_rate) || 0)}
                    </span>
                    {loan.refi_date && (
                      <span className="text-cs-muted">{fmtMonthYear(loan.refi_date)}</span>
                    )}
                    {loan.is_existing && <SavedBadge />}
                    <input
                      type="checkbox" checked={loan.enabled}
                      onChange={e => onChangeLoan({ ...loan, enabled: e.target.checked })}
                      className="ml-auto rounded"
                    />
                  </div>
                  {loan.enabled && <LoanTermsFields loan={loan} onChange={onChangeLoan} />}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
