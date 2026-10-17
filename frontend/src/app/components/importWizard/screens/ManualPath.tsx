import type { RefObject } from 'react'
import { ReportableError } from '../../../../scaffold/components/ReportProblem.tsx'
import { GRANT_COLORS, GRANT_DESCRIPTIONS, GRANT_TYPE_NAMES } from '../../../grantTypes.ts'
import { fmtFullDate } from '../../../format.ts'
import { BackBtn, Field, LoanForm, NextBtn, PercentField, PriceRows, YesNo } from '../fields.tsx'
import type { GrantDraft, LoanDraft, TaxLoanDraft, WizardPrice } from '../types.ts'
import { emptyTaxLoanDraft } from '../types.ts'

/** The opening menu: the fast path first, the slower ones under it. */
export function Welcome({ isPage, scheduleLoading, onShareworks, onSchedule, onWorkbook, onManual }: {
  isPage: boolean
  scheduleLoading: boolean
  onShareworks: () => void
  onSchedule: () => void
  onWorkbook: () => void
  onManual: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 dark:border-rose-800 dark:bg-rose-950/30">
        <h2 className="text-base font-semibold text-cs-text">
          {isPage ? 'Setup Wizard' : "Let's set up your equity tracker."}
        </h2>
        <p className="mt-1 text-sm text-cs-brand">
          The quickest way is to let your Shareworks documents fill this in.
        </p>
      </div>

      <div className="grid gap-3">
        {/* Fastest path: the two documents Shareworks already has */}
        <button
          type="button"
          onClick={onShareworks}
          className="flex flex-col rounded-lg border-2 border-rose-400 bg-cs-surface p-4 text-left hover:border-rose-600 hover:shadow-md dark:border-rose-500 "
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-cs-brand">Import from Shareworks</span>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-cs-brand dark:bg-rose-900/50 dark:text-rose-300">
              Fastest
            </span>
          </div>
          <span className="mt-1 text-xs text-cs-muted">
            Download two documents from the Documents tab in Shareworks and upload
            them. Your shares, cost basis and every loan are read from them — you
            check the result here before anything is saved.
          </span>
        </button>

        {/* Fallback: type it in, guided by the company schedule */}
        <button
          type="button"
          onClick={onSchedule}
          disabled={scheduleLoading}
          className="flex flex-col rounded-lg border-2 border-cs-border bg-cs-surface p-4 text-left hover:border-rose-400 hover:shadow-md disabled:opacity-60 "
        >
          <span className="text-sm font-semibold text-cs-text">
            {scheduleLoading ? 'Loading your data…' : 'Enter it myself'}
          </span>
          <span className="mt-1 text-xs text-cs-muted">
            No documents to hand? We know Epic's grant schedule — fill in your
            shares and loan details grant by grant.
          </span>
        </button>

        {/* Rarely the right choice; kept for anyone with a workbook already */}
        <button
          type="button"
          onClick={onWorkbook}
          className="flex flex-col rounded-lg border-2 border-cs-border bg-cs-surface p-4 text-left hover:border-rose-400 hover:shadow-md "
        >
          <span className="text-sm font-semibold text-cs-text">Import a Vesting.xlsx</span>
          <span className="mt-1 text-xs text-cs-muted">
            Already have an export from this app, or a workbook someone shared?
          </span>
        </button>
      </div>

      {/* Kept for grants that do not match the company schedule at all. Quiet on
          purpose — it is almost never the right starting point. */}
      <button
        type="button"
        onClick={onManual}
        className="text-xs text-cs-text-2 underline hover:text-cs-text"
      >
        Manual entry — start from a blank slate
      </button>

      {isPage && (
        <p className="text-xs text-cs-muted">
          If you already have data, the wizard pre-loads it on each screen. Any unmatched existing records will be shown before you can choose to keep or remove them — nothing is deleted until the final step.
        </p>
      )}
    </div>
  )
}

export function Upload({ fileRef, uploading, uploadError, onFile, onBack, onSkip }: {
  fileRef: RefObject<HTMLInputElement | null>
  uploading: boolean
  uploadError: string
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBack: () => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h2 className="text-base font-semibold text-cs-text">Import a Vesting.xlsx</h2>
      <p className="text-xs text-cs-muted">
        Upload an Excel file with a Schedule and/or Prices sheet. Missing share counts and amounts are fine — you'll fill those in next. To import from Shareworks instead, use Import&nbsp;/&nbsp;Export.
      </p>

      <ReportableError message={uploadError} source="import" />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={onFile}
        disabled={uploading}
        className="block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
      />
      {uploading && <p className="text-xs text-gray-500">Parsing file...</p>}
      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-cs-muted hover:text-cs-text-2 "
      >
        Skip — enter manually instead
      </button>
    </div>
  )
}

export function PricesScreen({ prices, setPrices, onBack, onNext }: {
  prices: WizardPrice[]
  setPrices: (next: WizardPrice[]) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Share price history</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Enter one row per annual price announcement. The first row should be the price on your initial exercise date (e.g. 2018-12-31). After that, typically March 1 each year.
        </p>
      </div>
      <PriceRows prices={prices} onChange={setPrices} />
      <div className="flex gap-2 pt-1">
        <NextBtn onClick={onNext} label="Next: Add grants →" />
      </div>
    </div>
  )
}

export function GrantEntry({ draft, setDraft, templateCount, templateIdx, dpSharesYears, onBack, onNext }: {
  draft: GrantDraft
  setDraft: (fn: (d: GrantDraft) => GrantDraft) => void
  templateCount: number
  templateIdx: number
  dpSharesYears: Set<number>
  onBack: () => void
  onNext: () => void
}) {
  const usesStockDp = parseInt(draft.dp_shares) > 0 || draft.dp_shares === ''
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">
          {templateCount > 0 && templateIdx < templateCount
            ? `Grant ${templateIdx + 1} of ${templateCount}`
            : 'Add a grant'}
        </h2>
        {templateCount > 0 && (
          <p className="mt-0.5 text-xs text-cs-muted">
            Fields pre-filled from your structure file. Just enter the share count.
          </p>
        )}
      </div>

      {/* Grant type selector */}
      <div>
        <span className="text-xs text-cs-muted">Grant type</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {GRANT_TYPE_NAMES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setDraft(d => ({ ...d, type: t, price: t === 'Purchase' ? d.price : '0' }))}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                draft.type === t
                  ? GRANT_COLORS[t]
                  : 'bg-cs-raised text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700 '
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-cs-muted">{GRANT_DESCRIPTIONS[draft.type]}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Grant year" type="number" value={draft.year}
          onChange={v => setDraft(d => ({ ...d, year: v }))} />
        <Field label="Shares" type="number" value={draft.shares}
          onChange={v => setDraft(d => ({ ...d, shares: v }))} />
        {draft.type === 'Purchase' && (
          <Field label="Cost basis ($/share)" type="number" step="0.01" value={draft.price}
            onChange={v => setDraft(d => ({ ...d, price: v }))} />
        )}
        <Field label="Vest start" type="date" value={draft.vest_start}
          onChange={v => setDraft(d => ({ ...d, vest_start: v }))} />
        <Field label="Vesting periods" type="number" value={draft.periods}
          hint="usually 4"
          onChange={v => setDraft(d => ({ ...d, periods: v }))} />
        <Field label="Exercise date" type="date" value={draft.exercise_date}
          hint="usually 12/31"
          onChange={v => setDraft(d => ({ ...d, exercise_date: v }))} />
      </div>

      {draft.type === 'Purchase' && dpSharesYears.has(parseInt(draft.year)) && (
        <div className="rounded-md border border-cs-border p-3 ">
          <label className="flex items-start gap-2 text-xs text-cs-text-2">
            <input
              type="checkbox"
              checked={parseInt(draft.dp_shares) > 0}
              onChange={e => setDraft(d => ({ ...d, dp_shares: e.target.checked ? '' : '0' }))}
              className="mt-0.5 rounded"
            />
            <span>
              <span className="font-medium text-cs-text">Used shares as a down payment</span>
              <span className="ml-1 text-cs-muted">(stock DP)</span>
              <br />
              <span className="text-cs-muted ">
                You exchanged previously vested shares at exercise to reduce the loan amount. Check your purchase confirmation.
              </span>
            </span>
          </label>
          {usesStockDp && (
            <div className="mt-2 w-40">
              <Field
                label="Shares exchanged"
                type="number"
                min="1"
                value={draft.dp_shares}
                onChange={v => setDraft(d => ({ ...d, dp_shares: v }))}
                hint="from your confirmation"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <NextBtn onClick={onNext} />
      </div>
    </div>
  )
}

export function PurchaseLoanScreen({ draft, activeLoan, setActiveLoan, onBack, onYes, onNo, onSave }: {
  draft: GrantDraft
  activeLoan: LoanDraft
  setActiveLoan: (l: LoanDraft) => void
  onBack: () => void
  onYes: () => void
  onNo: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h2 className="text-base font-semibold text-cs-text">
        Loan for {draft.year} Purchase grant
      </h2>

      {draft.has_purchase_loan === null && (
        <div className="space-y-3">
          <p className="text-sm text-cs-text-2">
            Did you take out a loan to purchase this grant?
          </p>
          <YesNo onYes={onYes} onNo={onNo} />
        </div>
      )}

      {draft.has_purchase_loan === true && (
        <div className="space-y-4">
          <LoanForm
            loan={activeLoan}
            onChange={setActiveLoan}
            label={draft.loans.length === 0 ? 'Original loan' : undefined}
          />
          <div className="flex gap-2">
            <NextBtn label="Save loan" onClick={onSave} />
          </div>
        </div>
      )}
    </div>
  )
}

export function LoanRefinanceScreen({ lastLoanNumber, pending, setPending, onBack, onYes, onNo, onSave }: {
  lastLoanNumber: string
  pending: LoanDraft
  setPending: (l: LoanDraft) => void
  onBack: () => void
  onYes: () => void
  onNo: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h2 className="text-base font-semibold text-cs-text">Refinances</h2>

      {pending.loan_number === '' && (
        <div className="space-y-3">
          <p className="text-sm text-cs-text-2">
            Was <span className="font-medium">{lastLoanNumber || 'this loan'}</span> ever refinanced into a new loan?
          </p>
          <YesNo onYes={onYes} onNo={onNo} />
        </div>
      )}

      {/* Show the refinance form only when the user clicked Yes */}
      {pending.refinances_loan_number !== '' && (
        <div className="space-y-4">
          <LoanForm loan={pending} onChange={setPending} label="Refinance loan" showRefinancesField />
          <NextBtn label="Save refinance" onClick={onSave} />
        </div>
      )}
    </div>
  )
}

export function TaxLoansScreen({ draft, vestDates, onChangeTaxLoan, onBack, onDone }: {
  draft: GrantDraft
  vestDates: string[]
  onChangeTaxLoan: (i: number, updated: TaxLoanDraft) => void
  onBack: () => void
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">
          Tax loans for {draft.year} {draft.type}
        </h2>
        <p className="mt-1 text-xs text-cs-muted">
          This is a pre-tax grant — shares vest as ordinary income. Did you take a tax loan to cover withholding at any vesting?
        </p>
      </div>

      <div className="space-y-4">
        {vestDates.map((vestDate, i) => {
          const tl = draft.tax_loans[i] ?? emptyTaxLoanDraft()
          const update = (updated: TaxLoanDraft) => onChangeTaxLoan(i, updated)
          return (
            <div key={vestDate} className="rounded-md border border-cs-border p-3 ">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-cs-text-2">Vesting {fmtFullDate(vestDate)}</p>
                <label className="flex items-center gap-1.5 text-xs text-cs-text-2">
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
                  <Field label="Year issued" type="number"
                    value={tl.due_date.slice(0, 4) || String(new Date(vestDate).getFullYear())}
                    onChange={() => {}} />
                  <Field label="Amount ($)" type="number" step="0.01" value={tl.amount}
                    onChange={v => update({ ...tl, amount: v })} />
                  <PercentField label="Interest rate (%)"
                    value={tl.interest_rate}
                    onChange={v => update({ ...tl, interest_rate: v })}
                    hint="e.g. 5" />
                  <Field label="Due date" type="date" value={tl.due_date}
                    onChange={v => update({ ...tl, due_date: v })} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <NextBtn label="Done with tax loans →" onClick={onDone} />
    </div>
  )
}

export function MoreGrants({ grantCount, onBack, onAdd, onReview }: {
  grantCount: number
  onBack: () => void
  onAdd: () => void
  onReview: () => void
}) {
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <h2 className="text-base font-semibold text-cs-text">Add another grant?</h2>
      <p className="text-sm text-cs-text-2">
        You have {grantCount} grant{grantCount !== 1 ? 's' : ''} so far.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md bg-rose-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
        >
          Yes, add another
        </button>
        <button
          type="button"
          onClick={onReview}
          className="rounded-md bg-cs-raised px-4 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700 "
        >
          No, review &amp; submit
        </button>
      </div>
    </div>
  )
}
