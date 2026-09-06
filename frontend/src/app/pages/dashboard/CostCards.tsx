import { StatCard as Card } from '../../components/StatCard.tsx'
import { BreakdownRow, BreakdownShell } from './Breakdown.tsx'
import { fmt$, fmtFullDate } from '../../format.ts'
import type { ActiveLoan, Breakdowns, CardValues } from '../Dashboard.math.ts'

/** What is owed: loan principal, interest and tax. */
export function CostCards({ cv, activeLoans, breakdowns, hasInterestDeduction, openBreakdowns, toggleBreakdown }: {
  cv: CardValues
  activeLoans: ActiveLoan[] | null
  breakdowns: Breakdowns | null
  hasInterestDeduction: boolean
  openBreakdowns: Set<string>
  toggleBreakdown: (key: string) => void
}) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cs-muted">Costs</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card
          label="Loan Principal"
          value={fmt$(cv.total_loan_principal)}
          variant="loans"
          subtitle="Total amount borrowed"
          onClick={activeLoans && activeLoans.length > 0 ? () => toggleBreakdown('activeLoans') : undefined}
          expanded={openBreakdowns.has('activeLoans')}
        />
        <Card
          label="Total Interest"
          value={fmt$(cv.total_interest)}
          variant="interest"
          subtitle="Interest accrued on loans"
          onClick={breakdowns && breakdowns.interest.rows.length > 0 ? () => toggleBreakdown('interest') : undefined}
          expanded={openBreakdowns.has('interest')}
        />
        <Card
          label={hasInterestDeduction ? 'Tax Paid (after int. ded.)' : 'Tax Paid'}
          value={fmt$(cv.total_tax_paid)}
          variant="tax"
          subtitle="Taxes withheld through this date"
          onClick={breakdowns && (breakdowns.tax.taxLoans > 0 || breakdowns.tax.vestingIncomeTax > 0 || breakdowns.tax.cgTaxFromSales > 0) ? () => toggleBreakdown('tax') : undefined}
          expanded={openBreakdowns.has('tax')}
        />
      </div>
      {openBreakdowns.has('activeLoans') && activeLoans && activeLoans.length > 0 && (
        <BreakdownShell title={`Active Loans (${activeLoans.length})`}>
          <div className="hidden px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-cs-muted sm:grid sm:grid-cols-5 sm:gap-x-2 ">
            <span>Grant</span><span>Type</span><span>Balance</span><span>Rate</span><span>Due</span>
          </div>
          {activeLoans.map(l => (
            <div key={l.id} className="rounded border border-cs-border bg-cs-surface px-3 py-2 text-[11px] ">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:hidden">
                <span className="text-cs-muted">{l.grantYear} {l.grantType} <span className="text-cs-muted">· {l.loanType}</span></span>
                <span className="text-right font-medium text-cs-text">{fmt$(l.balance)}</span>
                <span className="text-cs-muted">Rate <span className="font-medium text-cs-text">{(l.interestRate * 100).toFixed(2)}%</span></span>
                <span className="text-right text-cs-muted">Due <span className="font-medium text-cs-text">{fmtFullDate(l.dueDate)}</span></span>
              </div>
              <div className="hidden sm:grid sm:grid-cols-5 sm:gap-x-2">
                <span className="font-medium text-cs-text">{l.grantYear} {l.grantType}</span>
                <span className="text-cs-text-2">{l.loanType}</span>
                <span className="font-medium text-cs-text">{fmt$(l.balance)}</span>
                <span className="text-cs-text-2">{(l.interestRate * 100).toFixed(2)}%</span>
                <span className="text-cs-text-2">{fmtFullDate(l.dueDate)}</span>
              </div>
            </div>
          ))}
        </BreakdownShell>
      )}
      {openBreakdowns.has('interest') && breakdowns && breakdowns.interest.rows.length > 0 && (
        <BreakdownShell title="Total Interest breakdown">
          {breakdowns.interest.rows.map(r => (
            <BreakdownRow key={r.id} label={r.label} value={fmt$(r.amount)} sub={r.note} />
          ))}
          <div className="my-1 border-t border-cs-border-strong" />
          <BreakdownRow label="Total" value={fmt$(breakdowns.interest.total)} bold />
          <p className="mt-2 text-[10px] text-cs-muted">
            "Booked" rows are Interest-type loans you've already recorded; "estimated" rows project future interest on Purchase loans each year until due.
          </p>
        </BreakdownShell>
      )}
      {openBreakdowns.has('tax') && breakdowns && (breakdowns.tax.taxLoans > 0 || breakdowns.tax.vestingIncomeTax > 0 || breakdowns.tax.cgTaxFromSales > 0) && (
        <BreakdownShell title="Tax Paid breakdown">
          {breakdowns.tax.taxLoans > 0 && (
            <BreakdownRow
              label="Income tax withheld at vest (Tax loans)"
              value={fmt$(breakdowns.tax.taxLoans)}
              sub="Sum of Tax-type loan rows (actual amounts withheld)"
            />
          )}
          {breakdowns.tax.vestingIncomeTax > 0 && (
            <BreakdownRow
              label="Income tax estimated on vesting"
              value={fmt$(breakdowns.tax.vestingIncomeTax)}
              sub="Σ(income × federal+state income rate) across vesting events"
            />
          )}
          {breakdowns.tax.cgTaxFromSales > 0 && (
            <BreakdownRow
              label="Est. capital gains tax on sales"
              value={fmt$(breakdowns.tax.cgTaxFromSales)}
              sub="Sum of estimated_tax across recorded sales"
            />
          )}
          {breakdowns.tax.deductionSavings > 0 && (
            <BreakdownRow
              label="Interest deduction savings"
              value={`−${fmt$(breakdowns.tax.deductionSavings)}`}
              sub="Loan interest subtracted from capital gains before tax (IRS Form 4952)"
              tone="positive"
            />
          )}
          <div className="my-1 border-t border-cs-border-strong" />
          <BreakdownRow label="Total" value={fmt$(breakdowns.tax.total)} bold />
        </BreakdownShell>
      )}
    </section>
  )
}
