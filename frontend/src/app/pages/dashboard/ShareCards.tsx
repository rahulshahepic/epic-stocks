import { StatCard as Card } from '../../components/StatCard.tsx'
import { BreakdownRow, BreakdownShell } from './Breakdown.tsx'
import { TODAY } from '../../components/chartAxes.ts'
import { fmt$, fmtFullDate, fmtNum, fmtPrice } from '../../format.ts'
import type { CardValues, GrantHolding } from '../Dashboard.math.ts'

/** What the person holds, and what it is worth on the chosen date. */
export function ShareCards({ cv, cardDate, grantHoldings, totalValue, openBreakdowns, toggleBreakdown }: {
  cv: CardValues
  cardDate: string
  grantHoldings: GrantHolding[] | null
  totalValue: number
  openBreakdowns: Set<string>
  toggleBreakdown: (key: string) => void
}) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cs-muted">Your Shares</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card
          label={cardDate === TODAY ? 'Value Today' : `Value on ${fmtFullDate(cardDate)}`}
          value={grantHoldings ? fmt$(totalValue) : '—'}
          variant="value"
          subtitle="Vested at FMV + unvested at cost basis"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        <Card
          label="Total Cost Basis"
          value={grantHoldings ? fmt$(grantHoldings.reduce((s, h) => s + (h.vestedShares + h.unvestedShares) * h.costBasis, 0)) : '—'}
          variant="costbasis"
          subtitle="What you paid for all held shares"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        <Card label={cv.price_is_estimate ? 'Share Price (est.)' : 'Share Price'} value={fmtPrice(cv.current_price)} variant="price" subtitle="Price per share on this date" />
        <Card
          label="Vested Shares"
          value={fmtNum(cv.total_shares)}
          subvalue={fmt$(cv.total_shares * cv.current_price) + (cv.price_is_estimate ? ' (est.)' : '')}
          variant="shares"
          subtitle={`Value at ${fmtPrice(cv.current_price)}/share`}
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        <Card
          label="Unvested Shares"
          value={fmtNum(grantHoldings?.reduce((s, h) => s + h.unvestedShares, 0) ?? 0)}
          subvalue={grantHoldings ? fmt$(grantHoldings.reduce((s, h) => s + h.unvestedShares * h.costBasis, 0)) : undefined}
          variant="unvested"
          subtitle="Value at purchase price"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        <Card
          label="Next Event"
          value={cv.next_event ? `${cv.next_event.date} — ${cv.next_event.event_type}` : 'None'}
          variant="event"
          subtitle="Your next vesting or price date"
          onClick={cv.next_event_detail ? () => toggleBreakdown('nextEvent') : undefined}
          expanded={openBreakdowns.has('nextEvent')}
        />
      </div>
      {openBreakdowns.has('nextEvent') && cv.next_event_detail && (
        <BreakdownShell title="Next Event">
          <BreakdownRow label="Date" value={fmtFullDate(cv.next_event_detail.date)} />
          <BreakdownRow label="Type" value={cv.next_event_detail.event_type} />
          {cv.next_event_detail.grant_year != null && (
            <BreakdownRow label="Grant" value={`${cv.next_event_detail.grant_year} ${cv.next_event_detail.grant_type ?? ''}`} />
          )}
          {!!cv.next_event_detail.vested_shares && (
            <BreakdownRow label="Vesting shares" value={fmtNum(cv.next_event_detail.vested_shares)} />
          )}
          {!!cv.next_event_detail.granted_shares && (
            <BreakdownRow label="Granted shares" value={fmtNum(cv.next_event_detail.granted_shares)} />
          )}
          {!!cv.next_event_detail.share_price && (
            <BreakdownRow label="Share price" value={fmtPrice(cv.next_event_detail.share_price)} />
          )}
          {!!cv.next_event_detail.income && (
            <BreakdownRow label="Income" value={fmt$(cv.next_event_detail.income)} />
          )}
          {!!cv.next_event_detail.total_cap_gains && (
            <BreakdownRow label="Capital gains" value={fmt$(cv.next_event_detail.total_cap_gains)} />
          )}
          {!!cv.next_event_detail.amount && (
            <BreakdownRow label="Amount" value={fmt$(cv.next_event_detail.amount)} />
          )}
          {!!cv.next_event_detail.cash_due && (
            <BreakdownRow label="Cash due" value={fmt$(cv.next_event_detail.cash_due)} />
          )}
          {!!cv.next_event_detail.notes && (
            <BreakdownRow label="Notes" value={cv.next_event_detail.notes} />
          )}
        </BreakdownShell>
      )}
      {openBreakdowns.has('grants') && grantHoldings && grantHoldings.length > 0 && (
        <BreakdownShell title="Grants">
          {grantHoldings.map(h => (
            <div key={`${h.year}-${h.type}`} className="rounded border border-cs-border bg-cs-surface px-3 py-2 ">
              <p className="text-xs font-semibold text-cs-text">{h.year} {h.type}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-3">
                <span className="text-cs-muted">Purchased <span className="font-medium text-cs-text">{fmtFullDate(h.exerciseDate)}</span></span>
                <span className="text-cs-muted">Cost basis <span className="font-medium text-cs-text">{fmtPrice(h.costBasis)}</span></span>
                <span className="text-cs-muted">Vested <span className="font-medium text-cs-text">{fmtNum(h.vestedShares)}</span></span>
                <span className="text-cs-muted">Vested value <span className="font-medium text-cs-text">{fmt$(h.vestedValue)}</span></span>
                <span className="text-cs-muted">Unvested <span className="font-medium text-cs-text">{fmtNum(h.unvestedShares)}</span></span>
                <span className="text-cs-muted">Unvested value <span className="font-medium text-cs-text">{fmt$(h.unvestedValue)}</span></span>
                <span className="text-cs-muted">Total value <span className="font-medium text-cs-text">{fmt$(h.totalValue)}</span></span>
                <span className="text-cs-muted">Taxes <span className="font-medium text-cs-text">{fmt$(h.totalTax)}</span></span>
                <span className="text-cs-muted">Loans <span className="font-medium text-cs-text">{fmt$(h.totalLoan)}</span></span>
              </div>
            </div>
          ))}
        </BreakdownShell>
      )}
    </section>
  )
}
