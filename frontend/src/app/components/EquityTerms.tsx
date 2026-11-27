import { DisclosureSummary } from '../../scaffold/components/ui/Disclosure.tsx'
import { EQUITY_TERMS, type EquityTerm } from '../equityTerms.ts'
export type { EquityTerm } from '../equityTerms.ts'

export function InlineTerm({ term, figure }: {term: EquityTerm; figure?: string}) {
  const entry = EQUITY_TERMS[term]
  return <details data-equity-term={term} className="mt-2 text-xs leading-relaxed text-cs-text-2">
    <DisclosureSummary className="font-medium">{entry.title} · explain</DisclosureSummary>
    <div className="mt-1 rounded-lg bg-cs-raised p-2"><p>{entry.definition}</p>
      {figure && <p className="mt-1 font-semibold text-cs-text">On this card: {figure}.</p>}
      <p className="mt-1">{entry.meaning}</p>
    </div>
  </details>
}

export default function EquityTerms({ terms, title = 'What do these terms mean?' }: {
  terms: EquityTerm[]; title?: string
}) {
  return (
    <details className="rounded-xl border border-cs-border bg-cs-surface text-sm text-cs-text-2">
      <DisclosureSummary className="cursor-pointer px-4 py-3 font-semibold text-cs-text">{title}</DisclosureSummary>
      <dl className="space-y-3 px-4 pb-4 leading-relaxed">
        {terms.map(key => <div key={key}><dt className="font-semibold text-cs-text">{EQUITY_TERMS[key].title}</dt><dd className="mt-1">{EQUITY_TERMS[key].definition} {EQUITY_TERMS[key].meaning}</dd></div>)}
      </dl>
    </details>
  )
}
