import type { TimelineEvent } from '../../api.ts'
import { fmtNum } from '../format.ts'
import { Card, Eyebrow } from '../../scaffold/components/ui/Card.tsx'

const MILESTONE_TONES = ['bg-cs-brand', 'bg-[#087A55]', 'bg-[#1769AA]', 'bg-[#71358A]', 'bg-[#B25B00]']

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value + 'T00:00:00'))
}

function eventLabel(event: TimelineEvent) {
  if (event.event_type === 'Vesting' && event.vested_shares) {
    return `${fmtNum(event.vested_shares)} shares vest`
  }
  if (event.event_type === 'Loan Payoff') return 'Loan payoff'
  if (event.event_type === 'Share Price') return event.is_estimate ? 'Estimated price' : 'New share price'
  return event.event_type
}

/** A compact, data-driven map of the next stops in the owner's stock story. */
export function StockJourney({ events, asOf }: { events: TimelineEvent[]; asOf: string }) {
  const milestones = events
    .filter(event => event.date >= asOf)
    .filter((event, index, all) =>
      index === all.findIndex(other => other.date === event.date && other.event_type === event.event_type)
    )
    .slice(0, 5)

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
        {milestones.map((event, index) => (
          <li
            key={`${event.date}-${event.event_type}-${index}`}
            className={`campus-stop campus-stop-${index + 1} relative grid grid-cols-[2.25rem_1fr] items-start gap-3 sm:block sm:text-center`}
          >
            <span
              className={`campus-marker relative z-10 flex h-9 w-9 items-center justify-center border-4 border-cs-surface text-sm font-bold text-white shadow-sm ${MILESTONE_TONES[index % MILESTONE_TONES.length]}`}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5 sm:mt-3 sm:pt-0">
              <p className="text-sm font-bold leading-tight text-cs-text">{eventLabel(event)}</p>
              <p className="mt-1 text-xs font-semibold text-cs-text-2">{shortDate(event.date)}</p>
              {event.grant_year && (
                <p className="mt-0.5 truncate text-xs text-cs-muted">
                  {event.grant_year} {event.grant_type}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
