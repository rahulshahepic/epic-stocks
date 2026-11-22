import { fmt$M } from '../format.ts'
import type { PlannedEvent, SimResult } from './Retirement.math.ts'

const percent = (n: number) => (n * 100).toFixed(2) + '%'
const dollars = (n: number) => (n * 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function timingBins(rows: Array<{ year: number; probability: number }>) {
  if (!rows.length) return []
  const first = rows[0].year, span = rows[rows.length - 1].year - first + 1
  const width = rows.length <= 10 ? 1 : [5, 10, 20, 50].find(n => Math.ceil(span / n) <= 10) ?? Math.ceil(span / 10)
  const bins = new Map<number, number>()
  for (const row of rows) {
    const start = first + Math.floor((row.year - first) / width) * width
    bins.set(start, (bins.get(start) ?? 0) + row.probability)
  }
  return [...bins].map(([year, probability]) => ({ label: width === 1 ? String(year) : `${year}–${year + width - 1}`, probability }))
}

export default function PurchaseResults({ events, comparison }: {
  events: PlannedEvent[]
  comparison: { baseline: SimResult; withEvents: SimResult }
}) {
  const { baseline, withEvents: result } = comparison
  const invalid = baseline.preRetirementFundingGapM > 1e-9 || result.preRetirementFundingGapM > 1e-9
  const summary = result.purchaseSummary
  return <section aria-label="Planned purchase outcomes" className="space-y-4 rounded-xl border border-cs-border bg-cs-raised p-4">
    <h2 className="font-serif text-lg font-semibold text-cs-text">Will the planned purchases happen?</h2>
    {invalid ? <p role="alert" className="text-sm text-cs-text">This plan needs {dollars(result.preRetirementFundingGapM)} more
      pre-retirement cash than the modeled taxable funds can cover. Fund this gap before using purchase or retirement odds.</p> : <>
      <div className="grid grid-cols-2 gap-3 text-xs text-cs-text">
        {[['Without events', baseline], ['With events', result]].map(([label, value]) => {
          const r = value as SimResult
          return <div key={label as string} className="rounded-lg border border-cs-border p-3"><p className="text-cs-text-2">{label as string}</p>
            <p className="text-xl font-bold">{percent(1 - r.pctRuin)}</p><p>Fully funded retirement</p>
            <p className="mt-1 text-cs-muted">Median ending: {fmt$M(r.medianFinalM)}</p></div>
        })}
      </div>
      {summary && <>
        <div className="grid gap-3 sm:grid-cols-2 text-cs-text">
          <div><strong className="text-2xl">{percent(summary.purchaseProbability)}</strong><p className="text-xs text-cs-text-2">Buy at least one optional purchase</p></div>
          <div><strong className="text-2xl">{percent(summary.fundedPurchaseProbability)}</strong><p className="text-xs text-cs-text-2">Buy and fund the entire retirement plan</p></div>
        </div>
        <div className="rounded-lg border border-cs-border p-3">
          <h3 className="text-sm font-semibold text-cs-text">Optional purchases per retirement</h3>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable purchase counts"><div className="flex h-40 min-w-max items-end gap-2" role="img" aria-label="Distribution of conditional purchase counts">
            {summary.distribution.map(bin => <div key={bin.purchases} className="flex h-full w-16 flex-col justify-end text-center text-xs text-cs-text">
              <span>{percent(bin.probability)}</span>
              <div className="mx-auto mt-1 w-full max-w-16 rounded-t bg-cs-brand" style={{ height: `${bin.probability * 100}%`, minHeight: bin.probability ? 2 : 0 }} />
              <span className="mt-1">{bin.purchases === 0 ? 'None' : bin.purchases}</span>
            </div>)}
          </div></div>
        </div>
      </>}
      {(result.eventOutcomes ?? []).map(outcome => {
        const waiting = events.find(e => e.id === outcome.eventId)?.conditionFailure === 'defer'
        return <div key={outcome.eventId} className="space-y-2 border-t border-cs-border pt-3 text-xs text-cs-text">
          <h3 className="text-sm font-semibold">{outcome.title}</h3>
          <meter min={0} max={1} value={outcome.purchaseProbability} className="h-4 w-full accent-cs-brand" aria-label={`${outcome.title} purchase probability`} />
          <p>{percent(outcome.purchaseProbability)} bought · {percent(outcome.skippedProbability)} never bought</p>
          <p>{percent(outcome.onTimeProbability)} {waiting ? 'on time' : 'initial purchase'} · {percent(outcome.delayedProbability)} {waiting ? 'after waiting' : 'first bought at a replacement'} · {percent(outcome.fundedPurchaseProbability)} bought with the whole plan funded</p>
          <p>Average purchases: {outcome.meanPurchases.toFixed(2)}. {waiting ? 'Average delay' : 'Average time to first ownership'} among buyers: {outcome.meanDelayMonths.toFixed(0)} months.</p>
          <div className="space-y-1" role="img" aria-label={`${outcome.title} first purchase timing`}>
            {timingBins(outcome.firstPurchaseByYear ?? []).map(bin => <div key={bin.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0">{bin.label}</span><div className="h-3 flex-1 rounded bg-cs-surface"><div className="h-3 rounded bg-cs-brand" style={{ width: `${bin.probability * 100}%` }} /></div><span className="w-14 text-right">{percent(bin.probability)}</span>
            </div>)}
          </div>
        </div>})}
      {events.filter(event => !event.condition).map(event => <p key={event.id} className="text-xs text-cs-text"><strong>{event.title}</strong> · {event.date} · required expense, no market condition</p>)}
    </>}
    <p className="text-xs text-cs-muted">Purchase odds count decisions to buy, not guaranteed affordability. Read them alongside funding shortfalls. Required expenses remain in every path. Comparisons use the same market paths.</p>
  </section>
}
