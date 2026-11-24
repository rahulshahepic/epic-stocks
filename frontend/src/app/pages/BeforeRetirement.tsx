import { planCashFlows, type PlannedEvent } from './Retirement.math.ts'

const dollars = (n: number) => (n * 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export default function BeforeRetirement({ events, retirementDate }: { events: PlannedEvent[]; retirementDate: string }) {
  const planned = planCashFlows(events, retirementDate, 1)
  const rows = new Map<string, { year: string; title: string; funding: string; amount: number }>()
  for (const row of planned.preRetirementSchedule) {
    const year = row.date.slice(0, 4), key = year + ':' + row.eventId
    const existing = rows.get(key) ?? { year, title: row.title, funding: row.funding, amount: 0 }
    existing.amount += row.netCashM; rows.set(key, existing)
  }
  const years = new Map<string, number>()
  for (const row of rows.values()) years.set(row.year, (years.get(row.year) ?? 0) + row.amount)
  const max = Math.max(0.000001, ...[...years.values()].map(Math.abs))
  return <section aria-label="Before retirement funding schedule" className="space-y-4 rounded-xl border border-cs-border bg-cs-raised p-4 text-cs-text">
    <h2 className="font-serif text-lg font-semibold">Cash needed before retirement</h2>
    <p className="text-sm">Planned cash needs through {retirementDate}: <strong>{dollars(planned.preRetirementNetM)}</strong>.</p>
    <p className="text-xs text-cs-text-2">Deducted from your projected retirement portfolio. Ongoing costs continue in the retirement simulation.</p>
    <div className="space-y-2" role="img" aria-label="Pre-retirement cash needs by year">
      {[...years].map(([year, amount]) => <div key={year} className="flex items-center gap-2 text-xs"><span className="w-9">{year}</span>
        <div className="h-4 flex-1 rounded bg-cs-surface"><div className="h-4 rounded bg-cs-brand" style={{ width: `${Math.abs(amount) / max * 100}%` }} /></div><span className="w-24 text-right">{dollars(amount)}</span></div>)}
    </div>
    {rows.size > 0 && <details><summary className="text-sm font-semibold">Review funding by year and expense</summary><div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Funding schedule table">
      <table className="w-full text-left text-xs"><thead><tr><th className="p-2">Year</th><th className="p-2">Expense</th><th className="p-2">Funding plan</th><th className="p-2 text-right">Net cash needed</th></tr></thead>
        <tbody>{[...rows].map(([key, row]) => <tr key={key} className="border-t border-cs-border"><td className="p-2">{row.year}</td><td className="p-2">{row.title}</td><td className="p-2">{row.funding === 'epic' ? 'Hypothetical Epic sale' : row.funding === 'mixed' ? 'Decide later' : row.funding}</td><td className="p-2 text-right">{dollars(row.amount)}</td></tr>)}</tbody></table>
    </div></details>}
    <details className="text-xs text-cs-text-2"><summary className="cursor-pointer">Estimate assumptions</summary><p className="mt-2">Amounts are in {retirementDate.slice(0, 4)} dollars. Working-life wages, investment returns and future stock-sale taxes are not simulated. An Epic funding label is a net cash target; it does not reserve shares. Review share availability, loan repayment and taxes before an actual sale.</p></details>
  </section>
}
