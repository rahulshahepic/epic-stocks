import { StatCard as Card } from '../../components/StatCard.tsx'
import { BreakdownRow, BreakdownShell } from './Breakdown.tsx'
import { fmt$, fmtNum, fmtPrice } from '../../format.ts'
import type { Breakdowns, CardValues } from '../Dashboard.math.ts'

/** Income and capital gains to date. */
export function EarningsCards({ cv, breakdowns, openBreakdowns, toggleBreakdown }: {
  cv: CardValues
  breakdowns: Breakdowns | null
  openBreakdowns: Set<string>
  toggleBreakdown: (key: string) => void
}) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cs-muted">Earnings</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card
          label="Total Income"
          value={fmt$(cv.total_income)}
          variant="income"
          subtitle="Taxed as ordinary income at vest"
          onClick={breakdowns && breakdowns.income.groups.length > 0 ? () => toggleBreakdown('income') : undefined}
          expanded={openBreakdowns.has('income')}
        />
        <Card
          label="Total capital gains"
          value={fmt$(cv.total_cap_gains)}
          variant="gains"
          subtitle="Growth since your grants"
          onClick={breakdowns && (breakdowns.capGains.vestingGroups.length > 0 || breakdowns.capGains.priceTotal !== 0) ? () => toggleBreakdown('capGains') : undefined}
          expanded={openBreakdowns.has('capGains')}
        />
        <Card
          label="Cash Received"
          value={fmt$(cv.cash_received)}
          variant="cash"
          subtitle="Net proceeds from sales through this date"
          onClick={breakdowns && breakdowns.cash.sales.length > 0 ? () => toggleBreakdown('cash') : undefined}
          expanded={openBreakdowns.has('cash')}
        />
      </div>
      {openBreakdowns.has('income') && breakdowns && breakdowns.income.groups.length > 0 && (
        <BreakdownShell title="Total Income breakdown">
          {breakdowns.income.groups.map(g => (
            <BreakdownRow
              key={g.key}
              label={`${g.year} ${g.type}`}
              value={fmt$(g.income)}
              sub={`${g.events} vesting event${g.events === 1 ? '' : 's'}`}
            />
          ))}
          <div className="my-1 border-t border-cs-border-strong" />
          <BreakdownRow label="Total" value={fmt$(breakdowns.income.total)} bold />
          <p className="mt-2 text-[10px] text-cs-muted">
            Ordinary income recognized at each vest (grant-price × shares for RSUs, share-price × shares for bonus/free grants without 83(b)).
          </p>
        </BreakdownShell>
      )}
      {openBreakdowns.has('capGains') && breakdowns && (breakdowns.capGains.vestingGroups.length > 0 || breakdowns.capGains.priceTotal !== 0) && (
        <BreakdownShell title="Total capital gains breakdown">
          {breakdowns.capGains.vestingGroups.length > 0 && (
            <>
              <p className="text-[10px] font-medium uppercase tracking-wider text-cs-muted">Gains at vest (share price − what you paid)</p>
              {breakdowns.capGains.vestingGroups.map(g => (
                <BreakdownRow key={g.key} label={`${g.year} ${g.type}`} value={fmt$(g.amount)} />
              ))}
              <BreakdownRow label="Vesting gains subtotal" value={fmt$(breakdowns.capGains.vestingTotal)} bold />
            </>
          )}
          {breakdowns.capGains.priceTotal !== 0 && (
            <>
              {breakdowns.capGains.vestingGroups.length > 0 && <div className="my-1 border-t border-cs-border-strong" />}
              <p className="text-[10px] font-medium uppercase tracking-wider text-cs-muted">Price appreciation on holdings</p>
              <BreakdownRow
                label="Share-price changes × shares held"
                value={fmt$(breakdowns.capGains.priceTotal)}
                sub="Unrealized gain from share-price increases on shares you already held"
              />
            </>
          )}
          <div className="my-1 border-t border-cs-border-strong" />
          <BreakdownRow label="Total" value={fmt$(breakdowns.capGains.total)} bold />
        </BreakdownShell>
      )}
      {openBreakdowns.has('cash') && breakdowns && breakdowns.cash.sales.length > 0 && (
        <BreakdownShell title="Cash Received breakdown">
          {breakdowns.cash.sales.map(s => (
            <BreakdownRow
              key={s.id}
              label={`${s.date} ${fmtNum(s.shares)} sh × ${fmtPrice(s.price)}`}
              value={fmt$(s.net)}
              sub={[
                `${fmt$(s.proceeds)} proceeds`,
                s.tax > 0 ? `− ${fmt$(s.tax)} est. CG tax` : null,
                s.loanPayoff > 0 ? `− ${fmt$(s.loanPayoff)} loan payoff${s.loanLabel ? ` (${s.loanLabel})` : ''}` : null,
              ].filter(Boolean).join(' ')}
              tone={s.net < 0 ? 'negative' : undefined}
            />
          ))}
          <div className="my-1 border-t border-cs-border-strong" />
          <BreakdownRow label="Gross proceeds" value={fmt$(breakdowns.cash.totals.proceeds)} />
          {breakdowns.cash.totals.tax > 0 && (
            <BreakdownRow label="Est. CG tax on sales" value={`−${fmt$(breakdowns.cash.totals.tax)}`} />
          )}
          {breakdowns.cash.totals.loanPayoff > 0 && (
            <BreakdownRow label="Loan principal paid off from sales" value={`−${fmt$(breakdowns.cash.totals.loanPayoff)}`} />
          )}
          <BreakdownRow label="Cash received" value={fmt$(breakdowns.cash.totals.net)} bold tone={breakdowns.cash.totals.net < 0 ? 'negative' : undefined} />
          {breakdowns.cash.totals.net < 0 && (
            <p className="mt-2 text-[10px] text-cs-muted">
              Negative means payoff sales didn't cover their loan plus estimated CG tax — usually because tax rates or lot methods changed after the sale was sized.
            </p>
          )}
        </BreakdownShell>
      )}
    </section>
  )
}
