import { fmt$M } from '../format.ts'
import type { PlannedEvent, SimResult } from './Retirement.math.ts'

const percent = (n: number, digits = 1) => (n * 100).toFixed(digits) + '%'
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
  const outcomes = result.eventOutcomes ?? []
  const countMax = Math.max(.01, ...(summary?.distribution ?? []).map(bin => bin.probability))
  const required = events.filter(event => !event.condition)
  return <section aria-label="Planned purchase outcomes" className="space-y-4 rounded-xl border border-cs-border bg-cs-raised p-4 text-cs-text">
    <h2 className="font-serif text-lg font-semibold">Planned purchases</h2>
    {invalid ? <p role="alert" className="text-sm">This plan needs {dollars(Math.max(baseline.preRetirementFundingGapM, result.preRetirementFundingGapM))} more
      pre-retirement cash than the modeled taxable funds can cover. Fund this gap before using purchase or retirement odds.</p> : <>
      {summary && outcomes.length > 0 && <>
        <div><strong className="text-3xl">{percent(summary.purchaseProbability)}</strong><p className="text-xs text-cs-text-2">Chance of at least one optional purchase</p></div>
        <div className="rounded-lg border border-cs-border p-3">
          <h3 className="text-sm font-semibold">Optional purchases per simulation</h3>
          <p className="text-xs text-cs-muted">Includes replacements</p>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable purchase counts"><div className="flex min-w-max items-end gap-2" role="img" aria-label="Distribution of conditional purchase counts">
            {summary.distribution.map(bin => <div key={bin.purchases} className="w-16 shrink-0 text-center text-xs">
              <span className="block">{percent(bin.probability)}</span>
              <div className="mt-1 flex h-24 items-end"><div className="w-full rounded-t bg-cs-text-2/70" style={{ height: `${bin.probability / countMax * 100}%`, minHeight: bin.probability ? 2 : 0 }} /></div>
              <span className="mt-1 block">{bin.purchases === 0 ? 'None' : bin.purchases}</span>
            </div>)}
          </div></div>
        </div>
      </>}
      <details className="rounded-lg border border-cs-border p-3 text-xs text-cs-text-2">
        <summary className="cursor-pointer font-semibold">{summary && outcomes.length ? 'Calculation details' : 'Plan comparison details'}</summary>
        <div className="mt-3 space-y-2">
          {summary && outcomes.length > 0 && <><p>{summary.pathsWithPurchase.toLocaleString()} of {summary.paths.toLocaleString()} simulations include an optional purchase.</p>
            <p><strong>Buy + fully fund retirement: {percent(summary.fundedPurchaseProbability, 2)}.</strong> This counts purchases only in simulations that also pay every modeled retirement bill. Purchase probability alone includes simulations with a funding shortfall.</p>
            <p>Timing percentages use all simulations. Required expenses stay scheduled in every simulation.</p></>}
          <div className="grid grid-cols-2 gap-3">
            {[['Without planned expenses', baseline], ['With planned expenses', result]].map(([label, value]) => {
              const r = value as SimResult
              return <div key={label as string}><p className="font-semibold">{label as string}</p><p>{percent(1 - r.pctRuin, 2)} fully funded</p><p>Median ending wealth: {fmt$M(r.medianFinalM)}</p></div>
            })}
          </div>
          <p>Both plans use the same market paths.</p>
        </div>
      </details>
      {outcomes.map(outcome => {
        const event = events.find(e => e.id === outcome.eventId)
        const waiting = event?.conditionFailure === 'defer'
        return <div key={outcome.eventId} className="space-y-2 border-t border-cs-border pt-3 text-xs">
          <div className="flex items-baseline justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold">{outcome.title}</h3><strong className="shrink-0">{percent(outcome.purchaseProbability)} bought</strong></div>
          <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={outcome.purchaseProbability * 100}
            aria-label={`${outcome.title} purchase probability`} aria-valuetext={percent(outcome.purchaseProbability)}
            className="h-2 w-full overflow-hidden rounded-full bg-cs-surface">
            <div className="h-full rounded-full bg-cs-text-2/70" style={{ width: `${outcome.purchaseProbability * 100}%` }} />
          </div>
          <p className="text-cs-text-2">{percent(outcome.onTimeProbability)} {waiting ? 'on schedule' : 'at the initial date'} · {percent(outcome.delayedProbability)} {waiting ? 'after waiting' : 'first bought at a replacement date'}</p>
          {!!outcome.firstPurchaseByYear?.length && <div className="space-y-1" role="img" aria-label={`${outcome.title} first purchase timing`}>
            <p className="text-cs-muted">First purchase year · share of all simulations</p>
            {timingBins(outcome.firstPurchaseByYear).map(bin => <div key={bin.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0">{bin.label}</span><div className="h-3 flex-1 rounded bg-cs-surface"><div className="h-3 rounded bg-cs-text-2/70" style={{ width: `${bin.probability * 100}%` }} /></div><span className="w-14 text-right">{percent(bin.probability)}</span>
            </div>)}
          </div>}
          <details className="text-cs-text-2"><summary className="cursor-pointer" aria-label={`Details for ${outcome.title}`}>Details</summary><div className="mt-2 space-y-1">
            <p>Never bought: {percent(outcome.skippedProbability, 2)}</p>
            <p>Buy + fully fund retirement: {percent(outcome.fundedPurchaseProbability, 2)}</p>
            {outcome.purchaseProbability > 0 && <p>{waiting ? 'Average wait among buyers' : 'Average time to first purchase among buyers'}: {(outcome.meanDelayMonths / 12).toFixed(1)} years</p>}
            {!!event?.replacementEveryYears && <p>Average purchases per simulation, including replacements: {outcome.meanPurchases.toFixed(2)}</p>}
            {event?.deadlineDate && <p>Last purchase date: {event.deadlineDate}</p>}
          </div></details>
        </div>
      })}
      {required.length > 0 && <div className="space-y-2 border-t border-cs-border pt-3 text-xs"><h3 className="text-sm font-semibold">Required expenses</h3><p className="text-cs-text-2">Scheduled in every simulation</p>
        {required.map(event => <p key={event.id}><strong>{event.title}</strong> · {event.date}</p>)}
      </div>}
    </>}
  </section>
}
