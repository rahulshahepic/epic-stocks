import type { ReactNode } from 'react'

/** The expandable workings behind a headline card: a titled panel of labelled rows. */
export function BreakdownRow({ label, value, sub, bold, tone }: { label: ReactNode; value: string; sub?: string; bold?: boolean; tone?: 'positive' | 'negative' }) {
  const toneClass = tone === 'negative'
    ? 'text-red-700 dark:text-red-400'
    : tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : ''
  return (
    <div className="space-y-0.5">
      <div className={`flex justify-between gap-4 text-xs ${bold ? 'font-semibold text-cs-text' : 'text-cs-text-2'}`}>
        <span>{label}</span>
        <span className={`tabular-nums ${toneClass}`}>{value}</span>
      </div>
      {sub && <p className="pl-2 text-[10px] text-cs-muted">{sub}</p>}
    </div>
  )
}

export function BreakdownShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-cs-border bg-cs-raised p-4 text-xs ">
      <h3 className="mb-2 text-sm font-semibold text-cs-text">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
