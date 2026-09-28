import type { TimelineEvent } from '../../api.ts'
import { fmt$, fmtNum } from '../format.ts'
import { Card, Eyebrow } from '../../scaffold/components/ui/Card.tsx'
import { localToday } from '../dateUtils.ts'

const MILESTONE_TONES = ['bg-cs-brand', 'bg-[#087A55]', 'bg-[#1769AA]', 'bg-[#71358A]', 'bg-[#B25B00]']

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value + 'T00:00:00'))
}

function journeyMilestones(events: TimelineEvent[], asOf: string) {
  const groups = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    if (event.date < asOf) continue
    const key = `${event.date}:${event.event_type}`
    const group = groups.get(key) ?? []
    group.push(event)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a[0].date.localeCompare(b[0].date)).slice(0, 5)
}

function eventLabel(group: TimelineEvent[]) {
  const [event] = group
  if (event.event_type === 'Vesting') {
    return `${fmtNum(group.reduce((sum, e) => sum + (e.vested_shares ?? 0), 0))} shares vest`
  }
  if (event.event_type === 'Loan Payoff') return group.length === 1 ? 'Loan payoff' : `${group.length} loan payoffs`
  if (event.event_type === 'Share Price') return event.is_estimate ? 'Estimated price' : 'New share price'
  return group.length === 1 ? event.event_type : `${group.length} ${event.event_type.toLowerCase()} events`
}

function eventDetail(group: TimelineEvent[], estimated: boolean) {
  const [event] = group
  if (event.event_type === 'Vesting') {
    const marketValue = group.reduce((sum, e) => sum + (e.vested_shares ?? 0) * e.share_price, 0)
    const valueAdded = group.reduce((sum, e) => sum + e.vesting_cap_gains + e.income, 0)
    return `${estimated ? 'Est. ' : ''}${fmt$(marketValue)} market value · ${estimated ? 'est. ' : ''}${fmt$(valueAdded)} value added · ${group.length} tranche${group.length === 1 ? '' : 's'}`
  }
  if (event.event_type === 'Loan Payoff') {
    const due = group.reduce((sum, e) => sum + (e.cash_due ?? 0), 0)
    return group.some(e => e.cash_due != null) ? `${fmt$(due)} due` : null
  }
  if (event.event_type === 'Sale') {
    const proceeds = group.reduce((sum, e) => sum + (e.gross_proceeds ?? 0), 0)
    return group.some(e => e.gross_proceeds != null) ? `${estimated ? 'Est. ' : ''}${fmt$(proceeds)} gross proceeds` : null
  }
  return null
}

/** A compact, data-driven map of the next stops in the owner's stock story. */
export function StockJourney({ events, asOf }: { events: TimelineEvent[]; asOf: string }) {
  const milestones = journeyMilestones(events, asOf)
  const today = localToday()

  // The latest price announcement at each milestone controls whether its valuation
  // is projected. Future monetary values are estimates even at the last real price.
  let latestPriceEstimated = false
  let priceIndex = 0
  const details = milestones.map(group => {
    while (priceIndex < events.length && events[priceIndex].date <= group[0].date) {
      const event = events[priceIndex++]
      if (event.event_type === 'Share Price') latestPriceEstimated = !!event.is_estimate
    }
    return eventDetail(group, group[0].date > today || latestPriceEstimated)
  })

  if (milestones.length === 0) return null

  return (
    <Card as="section" className="campus-map overflow-hidden border-cs-border-strong">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>Follow the garden path</Eyebrow>
          <h2 className="mt-1 font-serif text-xl font-semibold text-cs-text sm:text-2xl">Your stock journey</h2>
        </div>
        <p className="text-xs text-cs-muted">Next {milestones.length} milestone{milestones.length === 1 ? '' : 's'}</p>
      </div>

      <ol className="relative mt-5 grid gap-3 sm:min-h-40 sm:grid-cols-5 sm:items-start sm:gap-2">
        <div
          className="campus-route absolute bottom-5 left-[1.05rem] top-5 w-0.5 bg-cs-border-strong sm:bottom-auto sm:left-[10%] sm:right-[10%] sm:top-[1.05rem] sm:h-20 sm:w-auto sm:bg-transparent"
          aria-hidden="true"
        />
        {milestones.map((group, index) => (
          <li
            key={`${group[0].date}-${group[0].event_type}`}
            className={`campus-stop campus-stop-${index + 1} relative grid grid-cols-[2.25rem_1fr] items-start gap-3 sm:block sm:text-center`}
          >
            <span
              className={`campus-marker relative z-10 flex h-9 w-9 items-center justify-center border-4 border-cs-surface text-sm font-bold text-white shadow-sm ${MILESTONE_TONES[index % MILESTONE_TONES.length]}`}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5 sm:mt-3 sm:pt-0">
              <p className="text-sm font-bold leading-tight text-cs-text">{eventLabel(group)}</p>
              <p className="mt-1 text-xs font-semibold text-cs-text-2">{shortDate(group[0].date)}</p>
              {details[index] && <p className="mt-0.5 text-xs text-cs-muted">{details[index]}</p>}
              {group.length === 1 && group[0].grant_year && (
                <p className="mt-0.5 text-xs text-cs-muted">{group[0].grant_year} {group[0].grant_type}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
