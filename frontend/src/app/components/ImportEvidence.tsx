import type { ReconciliationEvidence } from '../epicImport.ts'

const LABELS = {
  matched: 'Matched', mismatch: 'Needs review', not_available: 'Not available',
  estimated: 'Estimated', stale: 'Stale statement',
}

export default function ImportEvidence({ evidence }: { evidence: ReconciliationEvidence[] }) {
  if (!evidence.length) return null
  return (
    <section aria-label="Import checks" className="space-y-3">
      <h3 className="text-sm font-semibold text-cs-text">What could we check?</h3>
      {evidence.map(e => (
        <div key={e.label} className="rounded-lg border border-cs-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <h4 className="font-semibold text-cs-text">{e.label}</h4>
            <span className={e.status === 'matched' ? 'text-emerald-700 dark:text-emerald-300' : 'text-cs-text-2'}>{LABELS[e.status]}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-cs-text-2">{e.detail}</p>
          {e.rule_ids.length > 0 && <p className="mt-1 text-xs text-cs-muted">Checks: {e.rule_ids.join(', ')}</p>}
        </div>
      ))}
    </section>
  )
}
