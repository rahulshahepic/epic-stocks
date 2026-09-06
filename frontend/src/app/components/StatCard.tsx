import { IconTile, type TileTone } from '../../scaffold/components/ui/Card.tsx'
import { IconTrendUp, IconPieChart, IconDocument, IconCompass } from '../../scaffold/components/ui/icons.tsx'

/**
 * The dashboard's stat tile. Shared with the no-account preview (/try) so the
 * figures someone sees before signing up are presented exactly as the ones they
 * see after.
 */

const CARD_STYLES: Record<string, { tone: TileTone; icon: React.ReactNode }> = {
  price: { tone: 'amber', icon: <IconTrendUp className="h-4 w-4" /> },
  shares: { tone: 'brand', icon: <IconTrendUp className="h-4 w-4" /> },
  income: { tone: 'emerald', icon: <IconDocument className="h-4 w-4" /> },
  gains: { tone: 'violet', icon: <IconTrendUp className="h-4 w-4" /> },
  loans: { tone: 'brand', icon: <IconPieChart className="h-4 w-4" /> },
  interest: { tone: 'brand', icon: <IconPieChart className="h-4 w-4" /> },
  event: { tone: 'sky', icon: <IconCompass className="h-4 w-4" /> },
  tax: { tone: 'amber', icon: <IconDocument className="h-4 w-4" /> },
  cash: { tone: 'emerald', icon: <IconTrendUp className="h-4 w-4" /> },
  unvested: { tone: 'slate', icon: <IconPieChart className="h-4 w-4" /> },
  value: { tone: 'brand', icon: <IconTrendUp className="h-4 w-4" /> },
  costbasis: { tone: 'slate', icon: <IconDocument className="h-4 w-4" /> },
}

export function StatCard({ label, value, subvalue, variant, subtitle, onClick, expanded }: { label: string; value: string; subvalue?: string; variant: string; subtitle?: string; onClick?: () => void; expanded?: boolean }) {
  const s = CARD_STYLES[variant] ?? CARD_STYLES.event
  const clickable = !!onClick
  const content = (
    <>
      <div className="flex items-center justify-between">
        <IconTile tone={s.tone} className="h-8 w-8 rounded-lg">{s.icon}</IconTile>
        {clickable && (
          <span className={`text-cs-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        )}
      </div>
      <p className="mt-2.5 text-xs font-medium uppercase tracking-wide text-cs-text-2">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-cs-text">{value}</p>
      {subvalue && <p className="mt-0.5 text-sm font-medium tabular-nums text-cs-text-2">{subvalue}</p>}
      {subtitle && <p className="mt-1 text-[11px] leading-tight text-cs-muted">{subtitle}</p>}
    </>
  )
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={!!expanded}
        className="rounded-2xl border border-cs-border bg-cs-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
      >
        {content}
      </button>
    )
  }
  return <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">{content}</div>
}
