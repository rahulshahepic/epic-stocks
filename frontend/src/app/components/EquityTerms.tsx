import { EQUITY_TERMS, type EquityTerm } from '../equityTerms.ts'
export type { EquityTerm } from '../equityTerms.ts'

export function InlineTerm({ term, figure }: {term: EquityTerm; figure?: string}) {
  const entry = EQUITY_TERMS[term]
  return <details data-equity-term={term} className="mt-2 text-xs leading-relaxed text-cs-text-2">
    <summary className="min-h-7 cursor-pointer font-medium underline decoration-dotted underline-offset-4">{entry.title} · explain</summary>
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
    <details className="rounded-lg border border-cs-border bg-cs-surface p-3 text-xs text-cs-text-2">
      <summary className="cursor-pointer py-1 font-medium text-cs-brand dark:text-rose-300">{title}</summary>
      <dl className="mt-3 space-y-3 leading-relaxed">
        {terms.map(key => <div key={key}><dt className="font-semibold text-cs-text">{EQUITY_TERMS[key].title}</dt><dd className="mt-1">{EQUITY_TERMS[key].definition} {EQUITY_TERMS[key].meaning}</dd></div>)}
      </dl>
    </details>
  )
}
