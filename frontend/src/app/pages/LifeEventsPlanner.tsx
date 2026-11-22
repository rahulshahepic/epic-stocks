import { useState } from 'react'
import { planCashFlows, type PlannedEvent, type PlannedEventKind, type SimResult } from './Retirement.math.ts'

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
  events, retirementDate, onChange, comparison, onRun, running,
}: {
  events: PlannedEvent[]
  retirementDate: string
  onChange: (events: PlannedEvent[]) => void
  comparison: { baseline: SimResult; withEvents: SimResult } | null
  onRun: () => void
  running: boolean
}) {
  const [draft, setDraft] = useState<PlannedEvent>(() => blank('home', retirementDate))
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [todayPrice, setTodayPrice] = useState('')
  const retirementYear = retirementDate.slice(0, 4)
  const today = new Date()
  const yearsToRetirement = (Number(retirementYear) - today.getFullYear()) +
    (Number(retirementDate.slice(5, 7)) - today.getMonth() - 1) / 12
  const conversionRate = draft.inflationRate ?? 0.025
  const convertedPrice = Math.round((Number(todayPrice) || 0) * Math.pow(1 + conversionRate, yearsToRetirement))
  const hypotheticalEpicTargetM = planCashFlows(events.filter(event => !event.condition), retirementDate, 1).preRetirementEpicNeedM
  function set<K extends keyof PlannedEvent>(key: K, value: PlannedEvent[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }
  const money = (key: 'amountM' | 'annualCostM' | 'saleOffsetM' | 'resaleValueM' | 'replacementCostM', label: string) => (
    <label className="flex flex-col gap-1 text-xs text-cs-text-2">
      {label} ({retirementYear} $)
      <input type="number" min="0" step="1000" value={fromM(draft[key])}
        onChange={e => set(key, toM(e.target.value))}
        className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
    </label>
  )
  const save = () => {
    // Match the MCP validator before sending events into the autosaved plan.
    const validDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(value + 'T00:00:00Z')
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
        Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2100
    }
    if (!draft.title.trim() || !validDate(draft.date) ||
        (draft.endDate && (!validDate(draft.endDate) || draft.endDate < draft.date)) ||
        (draft.resaleDate && (!validDate(draft.resaleDate) || draft.resaleDate < draft.date))) {
      setError('Enter a title and valid dates. End and resale dates cannot precede the purchase.')
      return
    }
    if (events.length >= 20 && !editing) { setError('Maximum 20 planned events.'); return }
    const event = { ...draft, id: editing ?? 'event-' + Date.now().toString(36) }
    event.replacementEveryYears = Math.min(50, Math.max(0, Math.floor(event.replacementEveryYears ?? 0)))
    if (event.kind === 'home' || event.kind === 'vehicle') {
      event.loanYears = Math.min(50, Math.max(0, Math.floor(event.loanYears ?? 0)))
      if (!event.loanYears || (event.downPaymentPct ?? 1) >= 1 || !event.amountM) {
        delete event.loanYears
        delete event.loanRate
        if (!event.lifetimeYears) delete event.inflationRate
        event.downPaymentPct = 1
      }
    }
    if (event.condition) {
      event.condition = Object.fromEntries(Object.entries(event.condition).filter(([, value]) => value !== undefined))
      if (event.date.slice(0, 7) < retirementDate.slice(0, 7)) {
        setError('Conditional purchases must start at or after retirement.'); return
      }
      if (Object.entries(event.condition).some(([key, value]) => key !== 'requireFullSpending' &&
          (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'minPortfolioM' ? 1000 : 100)))) {
        setError('Enter valid nonnegative purchase thresholds.'); return
      }
    }
    if (event.lifetimeYears != null) {
      if (!Number.isInteger(event.lifetimeYears) || event.lifetimeYears < 1 || event.lifetimeYears > 50 ||
          (event.replacementEveryYears && event.replacementEveryYears < event.lifetimeYears)) {
        setError('Vehicle lifetime must be 1–50 whole years, no longer than the replacement interval.'); return
      }
      delete event.resaleDate; delete event.resaleValueM
      event.depreciationRate = event.depreciationRate ?? 0
      event.inflationRate = draft.inflationRate ?? 0.025
    } else delete event.depreciationRate
    if (event.resaleDate) event.resaleValueM = event.resaleValueM ?? 0
    else delete event.resaleValueM
    if (event.replacementEveryYears && !(event.replacementCostM || event.amountM)) {
      setError('Enter a cost for repeating expenses.')
      return
    }
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
                {event.condition && <span className="block text-cs-text-2">Buy only if: {[
                  event.condition.requireFullSpending ? 'regular spending is not cut' : '',
                  event.condition.minPortfolioM != null ? `portfolio ≥ ${dollar(event.condition.minPortfolioM * 1_000_000)}` : '',
                  event.condition.minStartingWealthRatio != null ? `portfolio ≥ ${Math.round(event.condition.minStartingWealthRatio * 100)}% of starting wealth` : '',
                ].filter(Boolean).join(' and ')}. Otherwise skip.</span>}
                {event.lifetimeYears && <span className="block text-cs-text-2">Sell after {event.lifetimeYears} years · {((event.depreciationRate ?? 0) * 100).toFixed(1)}% annual nominal depreciation</span>}
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
            <div className="sm:col-span-2 rounded-lg border border-cs-border p-3 text-xs text-cs-text-2">
              <p className="font-semibold">Convert today's price to {retirementYear} purchasing power</p>
              <p className="mt-1 text-cs-muted">Use this for a current sticker price. Conversion assumes {(conversionRate * 100).toFixed(1)}% annual inflation; adjust the assumption below for financed purchases.</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">Price in today's dollars ($)
                  <input type="number" min="0" step="1000" value={todayPrice}
                    onChange={e => setTodayPrice(e.target.value)}
                    className="w-40 max-w-full rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <button type="button" disabled={!Number(todayPrice) || Number(todayPrice) < 0}
                  className="rounded border border-cs-border-strong px-3 py-2 font-semibold text-cs-text disabled:opacity-50"
                  onClick={() => set('amountM', convertedPrice / 1_000_000)}>
                  Use {dollar(convertedPrice)} in {retirementYear} dollars
                </button>
              </div>
            </div>
            <fieldset className="sm:col-span-2 rounded-lg border border-cs-border p-3 space-y-3 text-xs text-cs-text-2">
              <legend className="px-1 font-semibold">Purchase conditions</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!draft.condition} onChange={e => set('condition', e.target.checked ? { requireFullSpending: true } : undefined)} />
                Buy only when conditions hold
              </label>
              {draft.condition && <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.condition.requireFullSpending ?? false}
                    onChange={e => set('condition', { ...draft.condition, requireFullSpending: e.target.checked })} />
                  Only if regular spending is not being cut
                </label>
                <label className="flex flex-col gap-1">Minimum portfolio before purchase ({retirementYear} $; optional)
                  <input type="number" min="0" max="1000000000" step="10000" value={draft.condition.minPortfolioM == null ? '' : fromM(draft.condition.minPortfolioM)}
                    onChange={e => set('condition', { ...draft.condition, minPortfolioM: e.target.value === '' ? undefined : Number(e.target.value) / 1_000_000 })}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <label className="flex flex-col gap-1">Minimum portfolio as % of starting retirement wealth (optional)
                  <input type="number" min="0" max="10000" step="5" value={draft.condition.minStartingWealthRatio == null ? '' : draft.condition.minStartingWealthRatio * 100}
                    onChange={e => set('condition', { ...draft.condition, minStartingWealthRatio: e.target.value === '' ? undefined : Number(e.target.value) / 100 })}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>
                <p>All selected rules must hold on the purchase date. 120% means 20% above starting wealth after inflation. Otherwise skip, without retrying. Replacements get a fresh decision; existing bills continue. Future returns are never used.</p>
              </>}
            </fieldset>
            {draft.kind === 'vehicle' && <fieldset className="sm:col-span-2 rounded-lg border border-cs-border p-3 space-y-3 text-xs text-cs-text-2">
              <legend className="px-1 font-semibold">Ownership lifetime and sale</legend>
              <label className="flex flex-col gap-1">Sell car after N years (optional)
                <input type="number" min="1" max="50" step="1" value={draft.lifetimeYears ?? ''}
                  onChange={e => setDraft(prev => ({ ...prev, lifetimeYears: e.target.value === '' ? undefined : Number(e.target.value), resaleDate: undefined, resaleValueM: undefined }))}
                  className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
              </label>
              {draft.lifetimeYears != null && <label className="flex flex-col gap-1">Annual depreciation (% nominal; 0 = flat price)
                <input type="number" min="0" max="100" step="0.5" value={(draft.depreciationRate ?? 0) * 100}
                  onChange={e => set('depreciationRate', Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
                  className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
              </label>}
              <p>Sale proceeds pay off remaining modeled debt and stop ownership costs. Zero depreciation keeps the nominal sale price flat; inflation reduces its real value. Include selling fees in the depreciation assumption.</p>
            </fieldset>}
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
                    onChange={e => set('loanYears', Math.max(0, Math.min(50, Math.floor(Number(e.target.value)))))}
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
                {!draft.lifetimeYears && <label className="flex flex-col gap-1 text-xs text-cs-text-2">Resale date (optional)
                  <input type="date" value={draft.resaleDate ?? ''} onChange={e => set('resaleDate', e.target.value || undefined)}
                    className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
                </label>}
                {draft.resaleDate && money('resaleValueM', 'Future resale value before remaining debt')}
              </>
            )}
            <>
              <label className="flex flex-col gap-1 text-xs text-cs-text-2">Repeat every N years (0 = once)
                <input type="number" min="0" max="50" value={draft.replacementEveryYears ?? 0}
                  onChange={e => set('replacementEveryYears', Math.max(0, Math.min(50, Math.floor(Number(e.target.value)))))}
                  className="rounded border border-cs-border-strong bg-cs-surface p-2 text-cs-text" />
              </label>
              {money('replacementCostM', 'Repeat cost (0 = same as first purchase)')}
            </>
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
        Enter costs in {retirementYear} purchasing-power dollars, not today's sticker prices. The planner models loans, recurring costs,
        replacements and eventual home/vehicle resale. It excludes home equity from liquid retirement
        assets until sold. Before retirement, upfront, mortgage and recurring costs reduce projected exit wealth;
        wages, investment returns and actual share-lot taxes are not simulated. A sale plan is not an executed sale.
      </p>
      {hypotheticalEpicTargetM > 0 && (
        <p className="rounded-lg border border-cs-border p-3 text-xs text-cs-text" role="note">
          <strong>Hypothetical Epic sale cash target: {dollar(hypotheticalEpicTargetM * 1_000_000)} net.</strong>
          {' '}This includes modeled pre-retirement purchases, loan payments and recurring costs
          marked for Epic funding. It is not a share count or an executed sale. Confirm
          vesting, loan payoff, share price and taxes separately before making any real decision.
        </p>
      )}
      {events.length > 0 && (
        <button type="button" disabled={running}
          className="rounded-lg bg-cs-text px-4 py-2 text-sm font-semibold text-cs-surface disabled:opacity-50"
          onClick={onRun}>{running ? 'Simulating…' : 'Compare retirement with these events'}</button>
      )}
      {comparison && (
        <div className="rounded-lg border border-cs-border p-3 space-y-2" role="status">
          <h3 className="text-sm font-semibold text-cs-text">Same-seed Monte Carlo comparison</h3>
          {(comparison.baseline.preRetirementFundingGapM > 1e-9 ||
            comparison.withEvents.preRetirementFundingGapM > 1e-9) && (
            <p role="alert" className="text-sm text-cs-text">
              This plan needs {dollar(comparison.withEvents.preRetirementFundingGapM * 1_000_000)} more
              pre-retirement cash than the modeled taxable funds can cover. Retirement-account withdrawals,
              wages and financing before retirement are not simulated. No affordability odds or ending-wealth
              comparison is valid until you fund this gap.
            </p>
          )}
          {comparison.baseline.preRetirementFundingGapM <= 1e-9 &&
            comparison.withEvents.preRetirementFundingGapM <= 1e-9 && (
            <div className="grid grid-cols-2 gap-3 text-xs text-cs-text">
              <div><p className="text-cs-muted">Without events</p>
                <p className="text-lg font-bold">{pct(1 - comparison.baseline.pctRuin)}</p>
                <p>Median ending: {dollar(comparison.baseline.medianFinalM * 1_000_000)}</p></div>
              <div><p className="text-cs-muted">With events</p>
                <p className="text-lg font-bold">{pct(1 - comparison.withEvents.pctRuin)}</p>
                <p>Median ending: {dollar(comparison.withEvents.medianFinalM * 1_000_000)}</p></div>
            </div>
          )}
          {(comparison.withEvents.eventOutcomes ?? []).map(outcome => <p key={outcome.eventId} className="text-xs text-cs-text">
            <strong>{outcome.title}:</strong> bought at least once in {pct(outcome.purchaseProbability)} of paths; never bought in {pct(outcome.skippedProbability)}.
            {' '}Average purchases per path: {outcome.meanPurchases.toFixed(2)}.
          </p>)}
          <p className="text-xs text-cs-muted">Illustrative projections, not a guarantee or a verified ability to finance a purchase.</p>
        </div>
      )}
    </section>
  )
}
