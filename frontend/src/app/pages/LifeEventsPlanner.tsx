import { useState } from 'react'
import type { PlannedEvent, PlannedEventKind, SimResult } from './Retirement.math.ts'

const KINDS: Array<[PlannedEventKind, string]> = [
  ['home', 'House'], ['vehicle', 'Car'], ['education', 'College / tuition'],
  ['wedding', 'Wedding'], ['travel', 'Vacation / travel'],
  ['childcare', 'Kids / childcare'], ['care', 'Eldercare / medical'],
  ['renovation', 'Renovation'], ['gift', 'Family gift'], ['other', 'Other'],
]
const dollar = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const toM = (n: string) => Math.max(0, Number(n) || 0) / 1_000_000
const fromM = (n?: number) => String(Math.round((n ?? 0) * 1_000_000))
const pct = (n: number) => (n * 100).toFixed(2) + '%'

const blank = (kind: PlannedEventKind, date: string): PlannedEvent => ({
  id: '', title: KINDS.find(k => k[0] === kind)?.[1] ?? 'Expense',
  kind, date, amountM: 0, funding: 'mixed',
  ...(kind === 'home' ? { downPaymentPct: 0.2, loanRate: 0.06, inflationRate: 0.025, loanYears: 30 } : {}),
  ...(kind === 'vehicle' ? { downPaymentPct: 1, replacementEveryYears: 0 } : {}),
})

export default function LifeEventsPlanner({
  events, retirementDate, onChange, comparison, onRun, running, readonly,
}: {
  events: PlannedEvent[]
  retirementDate: string
  onChange: (events: PlannedEvent[]) => void
  comparison: { baseline: SimResult; withEvents: SimResult } | null
  onRun: () => void
  running: boolean
  readonly: boolean
}) {
  const [draft, setDraft] = useState<PlannedEvent>(() => blank('home', retirementDate))
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  function set<K extends keyof PlannedEvent>(key: K, value: PlannedEvent[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }
  const money = (key: 'amountM' | 'annualCostM' | 'saleOffsetM' | 'resaleValueM' | 'replacementCostM', label: string) => (
    <label className="flex flex-col gap-1 text-xs text-cs-text-2">
      {label} ($)
      <input type="number" min="0" step="1000" value={fromM(draft[key])}
        onChange={e => set(key, toM(e.target.value))}
        className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
    </label>
  )
  const save = () => {
    if (!draft.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
        !Number.isFinite(Date.parse(draft.date)) ||
        (draft.endDate && draft.endDate < draft.date) ||
        (draft.resaleDate && draft.resaleDate < draft.date)) {
      setError('Enter a title and valid dates. End and resale dates cannot precede the purchase.')
      return
    }
    if (events.length >= 20 && !editing) { setError('Maximum 20 planned events.'); return }
    const event = { ...draft, id: editing ?? 'event-' + Date.now().toString(36) }
    onChange(editing ? events.map(e => e.id === editing ? event : e) : [...events, event])
    setEditing(null); setDraft(blank(draft.kind, retirementDate)); setOpen(false); setError('')
  }
  return (
    <section className="rounded-xl border border-cs-border bg-cs-raised p-4 space-y-4" aria-label="Life events and major purchases">
      <div>
        <h2 className="font-serif text-lg font-semibold text-cs-text">Life events & major purchases</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Plan a house, car, wedding, college, vacation, caregiving or anything else.
          Every purchase and Epic sale here is hypothetical. Nothing is posted to your real equity or transaction records.
        </p>
      </div>
      {events.length > 0 && (
        <ul className="space-y-2">
          {events.map(event => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cs-border p-3">
              <div className="text-xs text-cs-text">
                <strong>{event.title}</strong> · {event.date} · {dollar(event.amountM * 1_000_000)}
                {event.annualCostM ? <span className="text-cs-muted"> + {dollar(event.annualCostM * 1_000_000)}/yr</span> : null}
                {event.loanYears ? <span className="text-cs-muted"> · financed over {event.loanYears} years</span> : null}
                {event.funding === 'epic' ? <span className="text-cs-muted"> · hypothetical Epic sale</span> : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-xs underline text-cs-text-2" onClick={() => { setDraft(event); setEditing(event.id); setOpen(true) }}>Edit</button>
                <button type="button" className="text-xs underline text-cs-text-2" onClick={() => onChange(events.filter(e => e.id !== event.id))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button type="button" className="rounded-lg border border-cs-border-strong px-3 py-2 text-sm font-semibold text-cs-text"
          onClick={() => { setDraft(blank('home', retirementDate)); setEditing(null); setOpen(true) }}>
          + Add planned expense
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-cs-border-strong p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-cs-text-2">Type
              <select value={draft.kind} onChange={e => setDraft(blank(e.target.value as PlannedEventKind, draft.date))}
                className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text">
                {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-cs-text-2">Name
              <input value={draft.title} maxLength={100} onChange={e => set('title', e.target.value)}
                className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-cs-text-2">Purchase / start date
              <input type="date" value={draft.date} onChange={e => set('date', e.target.value)}
                className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
            </label>
            {money('amountM', draft.kind === 'home' || draft.kind === 'vehicle' ? 'Purchase price' : 'One-time cost (0 if recurring only)')}
            {money('annualCostM', 'Additional annual costs (not in base spending)')}
            <label className="flex flex-col gap-1 text-xs text-cs-text-2">Stop recurring costs (optional)
              <input type="date" value={draft.endDate ?? ''} onChange={e => set('endDate', e.target.value || undefined)}
                className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-cs-text-2">Funding source (hypothetical)
              <select value={draft.funding ?? 'mixed'} onChange={e => set('funding', e.target.value as PlannedEvent['funding'])}
                className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text">
                <option value="mixed">Mixed / decide later</option><option value="epic">Epic stock sale plan</option>
                <option value="brokerage">Brokerage</option><option value="cash">Cash</option>
              </select>
            </label>
            {(draft.kind === 'home' || draft.kind === 'vehicle') && (
              <>
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Down payment (%)
                  <input type="number" min="0" max="100" value={(draft.downPaymentPct ?? 1) * 100}
                    onChange={e => set('downPaymentPct', Math.max(0, Math.min(1, Number(e.target.value) / 100)))}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Loan term (years; 0 = cash)
                  <input type="number" min="0" max="50" value={draft.loanYears ?? 0}
                    onChange={e => set('loanYears', Math.max(0, Math.floor(Number(e.target.value))))}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Loan interest rate (%)
                  <input type="number" min="0" max="100" step="0.1" value={(draft.loanRate ?? 0) * 100}
                    onChange={e => set('loanRate', Math.max(0, Number(e.target.value)) / 100)}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Assumed inflation (%)
                  <input type="number" min="0" max="100" step="0.1" value={(draft.inflationRate ?? 0.025) * 100}
                    onChange={e => set('inflationRate', Math.max(0, Number(e.target.value)) / 100)}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                {money('saleOffsetM', 'Net existing-home sale proceeds / trade-in')}
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Resale date (optional)
                  <input type="date" value={draft.resaleDate ?? ''} onChange={e => set('resaleDate', e.target.value || undefined)}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                {draft.resaleDate && money('resaleValueM', 'Future resale value before remaining debt')}
              </>
            )}
            {
              <>
                <label className="flex flex-col gap-1 text-xs text-cs-text-2">Repeat every N years (0 = once)
                  <input type="number" min="0" max="50" value={draft.replacementEveryYears ?? 0}
                    onChange={e => set('replacementEveryYears', Math.max(0, Number(e.target.value)))}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                {money('replacementCostM', 'Repeat cost each time (net of trade-in, if any)')}
              </>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-cs-text px-3 py-2 text-xs font-semibold text-cs-surface"
              onClick={save}>{editing ? 'Update event' : 'Add event'}</button>
            <button type="button" className="rounded-lg border border-cs-border px-3 py-2 text-xs text-cs-text"
              onClick={() => { setOpen(false); setError('') }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-cs-muted">
        Costs are in retirement-year purchasing power. The planner models loans, recurring costs,
        replacements and eventual home/vehicle resale. It excludes home equity from liquid retirement
        assets until sold. Before retirement, upfront costs reduce projected exit wealth; pre-retirement
        wages, investment returns and actual share-lot taxes are not simulated. A sale plan is not an executed sale.
      </p>
      {events.length > 0 && (
        <button type="button" disabled={running || readonly}
          className="rounded-lg bg-cs-text px-4 py-2 text-sm font-semibold text-cs-surface disabled:opacity-50"
          onClick={onRun}>{running ? 'Simulating…' : 'Compare retirement with these events'}</button>
      )}
      {comparison && (
        <div className="rounded-lg border border-cs-border p-3 space-y-2" role="status">
          <h3 className="text-sm font-semibold text-cs-text">Same-seed Monte Carlo comparison</h3>
          <div className="grid grid-cols-2 gap-3 text-xs text-cs-text">
            <div><p className="text-cs-muted">Without events</p>
              <p className="text-lg font-bold">{pct(1 - comparison.baseline.pctRuin)}</p>
              <p>Median ending: {dollar(comparison.baseline.medianFinalM * 1_000_000)}</p></div>
            <div><p className="text-cs-muted">With events</p>
              <p className="text-lg font-bold">{pct(1 - comparison.withEvents.pctRuin)}</p>
              <p>Median ending: {dollar(comparison.withEvents.medianFinalM * 1_000_000)}</p></div>
          </div>
          <p className="text-xs text-cs-muted">Illustrative projections, not a guarantee or a verified ability to finance a purchase.</p>
        </div>
      )}
    </section>
  )
}
