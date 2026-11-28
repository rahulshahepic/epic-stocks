import { InlineTerm } from '../../components/EquityTerms.tsx'
import { StatCard as Card } from '../../components/StatCard.tsx'
import { BreakdownRow, BreakdownShell } from './Breakdown.tsx'
import { useToday } from '../../dateUtils.ts'
import { fmt$, fmtFullDate, fmtNum, fmtPrice } from '../../format.ts'
import type { CardValues, GrantHolding } from '../Dashboard.types.ts'

/** What the person holds, and what it is worth on the chosen date. */
export function ShareCards({ cv, cardDate, grantHoldings, totalValue, openBreakdowns, toggleBreakdown, headingAs: Heading = 'h2', hideNextEvent = false, showValue = true }: {
  hideNextEvent?: boolean
  showValue?: boolean
  headingAs?: 'h2' | 'h3'
  cv: CardValues
  cardDate: string
  grantHoldings: GrantHolding[] | null
  totalValue: number | null
  openBreakdowns: Set<string>
  toggleBreakdown: (key: string) => void
}) {
  const today = useToday()
  const next = cv.next_event_detail
  const estimatedPriceChange = next?.event_type === 'Share Price' && !!next.price_is_estimate
  return (
    <section className="space-y-3">
      <Heading className="text-sm font-semibold text-cs-muted">Your shares</Heading>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-3">
        {showValue && totalValue !== null && <Card
          label={cardDate === today ? 'Value Today' : `Value on ${fmtFullDate(cardDate)}`}
          value={totalValue !== null ? fmt$(totalValue) : '—'}
          variant="value"
          explanation="stock_value"
          subtitle="Vested at FMV + unvested at cost basis"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
          className="min-h-36 bg-gradient-to-br from-cs-surface to-cs-brand-subtle min-[360px]:col-span-2"
        />}
        <Card
          label="Total Cost Basis"
          value={fmt$(cv.total_cost_basis)}
          variant="costbasis"
          subtitle="What you paid for all held shares"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        {cv.current_price !== null && <Card label={cv.price_is_estimate ? 'Share Price (est.)' : 'Share Price'} value={(cv.current_price === null ? '—' : fmtPrice(cv.current_price))} variant="price" subtitle="Price per share on this date" />}
        <Card
          label="Vested Shares"
          value={fmtNum(cv.total_shares)}
          subvalue={cv.vested_stock_value === null ? undefined : fmt$(cv.vested_stock_value) + (cv.price_is_estimate ? ' (est.)' : '')}
          variant="shares"
          showExplanation={false}
          subtitle={cv.current_price === null ? undefined : `Value at ${fmtPrice(cv.current_price)}/share`}
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />
        {cv.unvested_shares > 0 && <Card
          label="Unvested Shares"
          value={fmtNum(cv.unvested_shares)}
          subvalue={fmt$(cv.purchased_unvested_stock_value)}
          variant="unvested"
          showExplanation={false}
          subtitle="Value at purchase price"
          onClick={grantHoldings && grantHoldings.length > 0 ? () => toggleBreakdown('grants') : undefined}
          expanded={openBreakdowns.has('grants')}
        />}
        {!hideNextEvent && cv.next_event && <Card
          label="Next Event"
          value={cv.next_event ? `${fmtFullDate(cv.next_event.date)} — ${cv.next_event.event_type}${estimatedPriceChange ? ' (est.)' : ''}` : 'None'}
          variant="event"
          subtitle={estimatedPriceChange
            ? `Estimated price; announcement expected ~${next?.expected_announcement_date ? fmtFullDate(next.expected_announcement_date) : 'later'}`
            : 'Your next vesting or price date'}
          onClick={cv.next_event_detail ? () => toggleBreakdown('nextEvent') : undefined}
          expanded={openBreakdowns.has('nextEvent')}
          className="min-[360px]:col-span-2 md:col-span-1"
        />}
      </div>
      <InlineTerm term="vesting" />
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
            <BreakdownRow label="Share price" value={fmtPrice(cv.next_event_detail.share_price) + (cv.next_event_detail.price_is_estimate ? ' (est.)' : '')} />
          )}
          {cv.next_event_detail.price_is_estimate && cv.next_event_detail.expected_announcement_date && (
            <BreakdownRow label="Announcement expected" value={fmtFullDate(cv.next_event_detail.expected_announcement_date)} />
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
                <span className="text-cs-muted">Vested value <span className="font-medium text-cs-text">{(h.vestedValue === null ? '—' : fmt$(h.vestedValue))}</span></span>
                <span className="text-cs-muted">Unvested <span className="font-medium text-cs-text">{fmtNum(h.unvestedShares)}</span></span>
                <span className="text-cs-muted">Unvested value <span className="font-medium text-cs-text">{fmt$(h.unvestedValue)}</span></span>
                <span className="text-cs-muted">Total value <span className="font-medium text-cs-text">{(h.totalValue === null ? '—' : fmt$(h.totalValue))}</span></span>
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
