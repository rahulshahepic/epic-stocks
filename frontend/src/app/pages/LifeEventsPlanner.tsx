import { useId, useState } from 'react'
import { localToday } from '../dateUtils.ts'
import PurchaseResults from './PurchaseResults.tsx'
import { planCashFlows, type PlannedEvent, type PlannedEventKind, type SimResult } from './Retirement.math.ts'

const KINDS: Array<[PlannedEventKind, string]> = [
  ['home', 'House'], ['vehicle', 'Car'], ['education', 'College / tuition'],
  ['wedding', 'Wedding'], ['travel', 'Vacation / travel'],
  ['childcare', 'Kids / childcare'], ['care', 'Eldercare / medical'],
  ['renovation', 'Renovation'], ['gift', 'Family gift'], ['other', 'Other'],
]
const dollar = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const toM = (n: string) => Math.max(0, Number(n) || 0) / 1_000_000
const MONEY_FIELDS = ['amountM', 'annualCostM', 'saleOffsetM', 'resaleValueM', 'replacementCostM'] as const
const convertMoney = (event: PlannedEvent, factor: number): PlannedEvent => ({ ...event, ...Object.fromEntries(MONEY_FIELDS.filter(key => event[key] != null).map(key => [key, event[key]! * factor])) })
const fromM = (n?: number) => String(Math.round((n ?? 0) * 1_000_000))

const blank = (kind: PlannedEventKind, date: string): PlannedEvent => ({
  id: '', title: KINDS.find(k => k[0] === kind)?.[1] ?? 'Expense',
  kind, date, amountM: 0, funding: 'mixed',
  ...(kind === 'home' ? { downPaymentPct: 1 } : {}),
  ...(kind === 'vehicle' ? { downPaymentPct: 1, replacementEveryYears: 0 } : {}),
})

// Keep the user's keystrokes intact; percentage round trips such as 14 / 100
// otherwise rewrite the input to 14.000000000000002 before 140 is complete.
function PercentInput({ value, onChange, ...props }: {
  value: number | undefined; onChange: (value: number | undefined) => void
  min?: string; max?: string; step?: string; className?: string
}) {
  const format = (n: number | undefined) => n == null ? '' : String(Number((n * 100).toFixed(8)))
  const [text, setText] = useState<string | null>(null)
  return <input {...props} type="number" value={text ?? format(value)} onFocus={() => setText(format(value))}
    onChange={e => { setText(e.target.value); onChange(e.target.value === '' ? undefined : Number(e.target.value) / 100) }}
    onBlur={() => setText(null)} />
}

export default function LifeEventsPlanner({
  events, retirementDate, onChange, comparison, onRun, running, phase = 'all', showRun = true,
}: {
  showRun?: boolean
  phase?: 'before' | 'retirement' | 'all'
  events: PlannedEvent[]
  retirementDate: string
  onChange: (events: PlannedEvent[]) => void
  comparison: { baseline: SimResult; withEvents: SimResult } | null
  onRun: () => void
  running: boolean
}) {
  const sectionName = useId()
  const [draft, setDraft] = useState<PlannedEvent>(() => blank('home', retirementDate))
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [todayPrice, setTodayPrice] = useState('')
  const [priceBasis, setPriceBasis] = useState<'today' | 'retirement'>('today')
  const visibleEvents = events.filter(event => phase === 'all' ||
    (phase === 'before' ? event.date.slice(0, 7) < retirementDate.slice(0, 7) : event.date.slice(0, 7) >= retirementDate.slice(0, 7)))
  const asset = draft.kind === 'home' || draft.kind === 'vehicle'
  const financed = !!draft.loanYears
  const defaultDate = phase === 'before' ? localToday() : retirementDate
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
  const priceFactor = priceBasis === 'today' ? Math.pow(1 + conversionRate, yearsToRetirement) : 1
  const amountYear = priceBasis === 'today' ? today.getFullYear() : retirementYear
  const money = (key: 'amountM' | 'annualCostM' | 'saleOffsetM' | 'resaleValueM' | 'replacementCostM', label: string) => (
    <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">
      {label} ({amountYear} $)
      <input type="number" min="0" step="1000" value={fromM(draft[key])}
        onChange={e => set(key, toM(e.target.value))}
        className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
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
    for (const key of ['amountM', 'annualCostM', 'saleOffsetM', 'resaleValueM', 'replacementCostM',
      'downPaymentPct', 'loanRate', 'inflationRate', 'depreciationRate'] as const) {
      const value = draft[key] == null ? undefined : draft[key]! * (key.endsWith('M') ? priceFactor : 1)
      const max = key.endsWith('M') ? 1000 : 1
      if (value != null && (!Number.isFinite(value) || value < 0 || value > max)) {
        setError('Enter valid nonnegative costs and percentages between 0% and 100%.'); return
      }
    }
    if (events.length >= 20 && !editing) { setError('Maximum 20 planned events.'); return }
    const event = { ...convertMoney(draft, priceFactor), id: editing ?? 'event-' + Date.now().toString(36) }
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
    if (!event.condition) { delete event.conditionFailure; delete event.deadlineDate }
    if (event.conditionFailure !== 'defer') delete event.deadlineDate
    if (event.deadlineDate && (!validDate(event.deadlineDate) || event.deadlineDate < event.date)) {
      setError('The waiting deadline cannot precede the earliest purchase date.'); return
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
    if (event.durationYears != null && (asset || !Number.isInteger(event.durationYears) || event.durationYears < 1 || event.durationYears > 50 || event.endDate)) {
      setError('Choose a duration of 1–50 whole years or a specific recurring end date.'); return
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
          Purchases and costs beyond your regular spending.
        </p>
      </div>
      {visibleEvents.length > 0 && (
        <ul className="space-y-2">
          {visibleEvents.map(event => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cs-border p-3">
              <div className="text-xs text-cs-text">
                <strong>{event.title}</strong> · {event.date} · {dollar(event.amountM * 1_000_000)} <span className="text-cs-muted">({retirementYear} dollars)</span>
                {event.annualCostM ? <span className="text-cs-muted"> + {dollar(event.annualCostM * 1_000_000)}/yr</span> : null}
                {event.loanYears ? <span className="text-cs-muted"> · financed over {event.loanYears} years</span> : null}
                {event.condition && <span className="block text-cs-text-2">Buy only if: {[
                  event.condition.requireFullSpending ? 'regular spending is not cut' : '',
                  event.condition.minPortfolioM != null ? `portfolio ≥ ${dollar(event.condition.minPortfolioM * 1_000_000)}` : '',
                  event.condition.minStartingWealthRatio != null ? `portfolio ≥ ${Math.round(event.condition.minStartingWealthRatio * 100)}% of starting wealth` : '',
                ].filter(Boolean).join(' and ')}. {event.conditionFailure === 'defer' ? `Otherwise wait and check monthly${event.deadlineDate ? ' until ' + event.deadlineDate : ''}.` : 'Otherwise skip.'}</span>}
                {event.lifetimeYears && <span className="block text-cs-text-2">Sell after {event.lifetimeYears} years · {((event.depreciationRate ?? 0) * 100).toFixed(1)}% annual nominal depreciation</span>}
                {event.funding === 'epic' ? <span className="text-cs-muted"> · hypothetical Epic sale</span> : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-xs underline text-cs-text-2" onClick={() => { setDraft(event); setPriceBasis('retirement'); setEditing(event.id); setOpen(true) }}>Edit</button>
                <button type="button" className="text-xs underline text-cs-text-2" onClick={() => onChange(events.filter(e => e.id !== event.id))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button type="button" className="rounded-lg border border-cs-border-strong px-3 py-2 text-sm font-semibold text-cs-text"
          onClick={() => { setDraft(blank('home', defaultDate)); setPriceBasis('today'); setEditing(null); setOpen(true) }}>
          + Add planned expense
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-cs-border-strong p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Type
              <select value={draft.kind} onChange={e => setDraft(blank(e.target.value as PlannedEventKind, draft.date))}
                className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text">
                {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Name
              <input value={draft.title} maxLength={100} onChange={e => set('title', e.target.value)}
                className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
            </label>
            <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Purchase / start date
              <input type="date" value={draft.date} onChange={e => set('date', e.target.value)}
                className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
            </label>

            {money('amountM', draft.kind === 'home' || draft.kind === 'vehicle' ? 'Purchase price' : 'One-time cost (0 if recurring only)')}
            <details name={sectionName} className="col-span-2 rounded-lg border border-cs-border p-3 text-xs text-cs-text-2">
              <summary className="cursor-pointer font-semibold">Price options · {priceBasis === 'today' ? "today’s dollars" : retirementYear + " dollars"}</summary>
              <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Prices entered in
                <select value={priceBasis} onChange={e => { const basis = e.target.value as 'today' | 'retirement'; setDraft(prev => convertMoney(prev, Math.pow(1 + conversionRate, yearsToRetirement) ** (basis === 'retirement' ? 1 : -1))); setPriceBasis(basis) }}
                  className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text">
                  <option value="today">Today's dollars</option><option value="retirement">{retirementYear} retirement-year dollars</option>
                </select>
              </label>
              <p className="font-semibold">Convert today's price to {retirementYear} purchasing power</p>
              <p className="mt-1 text-cs-muted">Use this for a current sticker price. Conversion assumes {(conversionRate * 100).toFixed(1)}% annual inflation; adjust inflation under ownership or recurring costs.</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex flex-col gap-1">Price in today's dollars ($)
                  <input type="number" min="0" step="1000" value={todayPrice}
                    onChange={e => setTodayPrice(e.target.value)}
                    className="w-40 max-w-full rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                </label>
                <button type="button" disabled={!Number(todayPrice) || Number(todayPrice) < 0}
                  className="rounded border border-cs-border-strong px-3 py-2 font-semibold text-cs-text disabled:opacity-50"
                  onClick={() => { setDraft(prev => ({ ...convertMoney(prev, priceFactor), amountM: convertedPrice / 1_000_000 })); setPriceBasis('retirement') }}>
                  Use {dollar(convertedPrice)} in {retirementYear} dollars
                </button>
              </div>
            </details>
            <details name={sectionName} className="col-span-2 rounded-lg border border-cs-border p-3 text-xs text-cs-text-2"><summary className="cursor-pointer font-semibold">Purchase rule · {draft.condition ? draft.conditionFailure === 'defer' ? 'Wait until eligible' : 'Skip if ineligible' : 'Required'}{draft.condition?.minStartingWealthRatio != null ? ` · ${Math.round(draft.condition.minStartingWealthRatio * 100)}%` : ''}</summary><fieldset className="mt-3 space-y-3">
              <legend className="sr-only">Purchase conditions</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!draft.condition} onChange={e => set('condition', e.target.checked ? { requireFullSpending: true } : undefined)} />
                Buy only when conditions hold
              </label>
              {draft.condition && <>
                <label className="min-w-0 flex flex-col gap-1">Minimum portfolio as % of starting retirement wealth (optional)
                  <PercentInput min="0" max="10000" step="5" value={draft.condition.minStartingWealthRatio}
                    onChange={value => set('condition', { ...draft.condition, minStartingWealthRatio: value })}
                    className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                </label>
                <label className="min-w-0 flex flex-col gap-1">If conditions are not met
                  <select value={draft.conditionFailure ?? 'skip'} onChange={e => set('conditionFailure', e.target.value as 'skip' | 'defer')}
                    className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text">
                    <option value="skip">Skip this purchase</option><option value="defer">Wait until eligible</option>
                  </select>
                </label>
                {draft.conditionFailure === 'defer' && <label className="min-w-0 flex flex-col gap-1">Stop waiting after (optional)
                  <input type="date" value={draft.deadlineDate ?? ''} onChange={e => set('deadlineDate', e.target.value || undefined)}
                    className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                </label>}
                <details className="rounded border border-cs-border p-2">
                  <summary className="cursor-pointer">More conditions{draft.condition.requireFullSpending ? ' · full spending required' : ''}{draft.condition.minPortfolioM != null ? ` · ${dollar(draft.condition.minPortfolioM * 1_000_000)} minimum` : ''}</summary>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={draft.condition.requireFullSpending ?? false}
                        onChange={e => set('condition', { ...draft.condition, requireFullSpending: e.target.checked })} />
                      Only if regular spending is not being cut
                    </label>
                    <label className="min-w-0 flex flex-col gap-1">Minimum portfolio before purchase ({retirementYear} $; optional)
                      <input type="number" min="0" max="1000000000" step="10000" value={draft.condition.minPortfolioM == null ? '' : fromM(draft.condition.minPortfolioM)}
                        onChange={e => set('condition', { ...draft.condition, minPortfolioM: e.target.value === '' ? undefined : Number(e.target.value) / 1_000_000 })}
                        className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                    </label>
                  </div>
                </details>
                <p>Thresholds use purchasing power after inflation. Waiting checks monthly and moves ownership dates with the purchase.</p>
              </>}
            </fieldset></details>
            <details name={sectionName} className="col-span-2 rounded-lg border border-cs-border p-3 text-xs text-cs-text-2">
              <summary className="cursor-pointer font-semibold">{asset ? 'Ownership and costs' : 'Recurring costs'} · {draft.lifetimeYears ? `sell after ${draft.lifetimeYears} years` : draft.durationYears ? `${draft.durationYears} years` : 'optional'}{draft.annualCostM ? ` · ${dollar(draft.annualCostM * 1_000_000)}/yr` : ''}</summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {draft.kind === 'vehicle' && <fieldset className="col-span-2 space-y-3 text-xs text-cs-text-2">
                  <legend className="sr-only">Ownership lifetime and sale</legend>
                  <label className="min-w-0 flex flex-col gap-1">Sell car after N years (optional)
                    <input type="number" min="1" max="50" step="1" value={draft.lifetimeYears ?? ''}
                      onChange={e => setDraft(prev => ({ ...prev, lifetimeYears: e.target.value === '' ? undefined : Number(e.target.value), resaleDate: undefined, resaleValueM: undefined }))}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>
                  {draft.lifetimeYears != null && <label className="min-w-0 flex flex-col gap-1">Annual depreciation (% nominal; 0 = flat price)
                    <PercentInput min="0" max="100" step="0.1" value={draft.depreciationRate ?? 0}
                      onChange={value => set('depreciationRate', value ?? 0)}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>}
                  <p>Sale pays remaining debt and stops ownership costs. Zero depreciation keeps the nominal price flat.</p>
                </fieldset>}
                {money('annualCostM', asset ? 'Annual ownership costs (stop at sale)' : 'Additional annual costs (not in base spending)')}
                {asset && <p className="text-xs text-cs-muted">Ownership costs stop automatically when sold. Enter only costs additional to regular spending.</p>}
                {!asset && <>
                  <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Duration (years; optional)
                    <input type="number" min="1" max="50" step="1" value={draft.durationYears ?? ''}
                      onChange={e => setDraft(prev => ({ ...prev, durationYears: e.target.value ? Number(e.target.value) : undefined, endDate: undefined }))}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>
                  {draft.endDate && <p className="text-xs text-cs-muted">Specific end date: {draft.endDate}. Set a duration above to keep the same number of years when moving the start.</p>}
                </>}

                {asset && <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Payment
                  <select value={financed ? 'finance' : 'cash'} onChange={e => setDraft(prev => ({ ...prev, loanYears: e.target.value === 'finance' ? 5 : undefined, downPaymentPct: e.target.value === 'finance' ? 0.2 : 1 }))}
                    className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text"><option value="cash">Cash</option><option value="finance">Finance</option></select>
                </label>}
                {asset && (
                  <>
                    {financed && <>
                      <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Down payment (%)
                        <PercentInput min="0" max="100" step="0.1" value={draft.downPaymentPct ?? 1}
                          onChange={value => set('downPaymentPct', value ?? 0)}
                          className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                      </label>
                      <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Loan term (years; 0 = cash)
                        <input type="number" min="0" max="50" value={draft.loanYears ?? 0}
                          onChange={e => set('loanYears', Math.max(0, Math.min(50, Math.floor(Number(e.target.value)))))}
                          className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                      </label>
                      <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Loan interest rate (%)
                        <PercentInput min="0" max="100" step="0.1" value={draft.loanRate ?? 0}
                          onChange={value => set('loanRate', value ?? 0)}
                          className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                      </label>

                    </>}
                    <details className="col-span-2 rounded-lg border border-cs-border p-3"><summary className="text-xs font-semibold text-cs-text">Trade-in and specific sale date</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {money('saleOffsetM', 'Net existing-home sale proceeds / trade-in')}
                      {!draft.lifetimeYears && <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Resale date (optional)
                        <input type="date" value={draft.resaleDate ?? ''} onChange={e => set('resaleDate', e.target.value || undefined)}
                          className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                      </label>}
                      {draft.resaleDate && money('resaleValueM', 'Future resale value before remaining debt')}
                    </div></details>
                  </>
                )}
                <>
                  <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Repeat every N years (0 = once)
                    <input type="number" min="0" max="50" value={draft.replacementEveryYears ?? 0}
                      onChange={e => set('replacementEveryYears', Math.max(0, Math.min(50, Math.floor(Number(e.target.value)))))}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>
                  {!!draft.replacementEveryYears && money('replacementCostM', 'Repeat cost (0 = same as first purchase)')}
                </>
                <details className="col-span-2 rounded-lg border border-cs-border p-3"><summary className="text-xs font-semibold text-cs-text">Advanced: funding and cost overrides</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Specific recurring cost end date (optional)
                    <input type="date" value={draft.endDate ?? ''} onChange={e => setDraft(prev => ({ ...prev, endDate: e.target.value || undefined, durationYears: undefined }))} className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>
                  <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Assumed inflation (%)
                    <PercentInput min="0" max="100" step="0.1" value={draft.inflationRate ?? 0.025}
                      onChange={value => set('inflationRate', value ?? 0)}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text" />
                  </label>
                  <label className="min-w-0 flex flex-col gap-1 text-xs text-cs-text-2">Funding source (hypothetical)
                    <select value={draft.funding ?? 'mixed'} onChange={e => set('funding', e.target.value as PlannedEvent['funding'])}
                      className="rounded border border-cs-border-strong bg-cs-surface px-3 py-2.5 min-h-11 w-full min-w-0 text-cs-text">
                      <option value="mixed">Mixed / decide later</option><option value="epic">Epic stock sale plan</option>
                      <option value="brokerage">Brokerage</option><option value="cash">Cash</option>
                    </select>
                  </label>
                </div></details>
              </div>
            </details>
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-lg bg-cs-text px-3 py-2 text-sm font-semibold text-cs-surface"
              onClick={save}>{editing ? 'Update event' : 'Add event'}</button>
            <button type="button" className="min-h-11 rounded-lg border border-cs-border px-3 py-2 text-sm text-cs-text"
              onClick={() => { setOpen(false); setError('') }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-cs-muted">Planning only. No stock sales or real transactions are created.</p>
      {hypotheticalEpicTargetM > 0 && (
        <p className="rounded-lg border border-cs-border p-3 text-xs text-cs-text" role="note">
          <strong>Hypothetical Epic sale cash target: {dollar(hypotheticalEpicTargetM * 1_000_000)} net.</strong>
          {' '}This includes modeled pre-retirement purchases, loan payments and recurring costs
          marked for Epic funding. It is not a share count or an executed sale. Confirm
          vesting, loan payoff, share price and taxes separately before making any real decision.
        </p>
      )}
      {showRun && events.length > 0 && (
        <button type="button" disabled={running}
          className="rounded-lg bg-cs-text px-4 py-2 text-sm font-semibold text-cs-surface disabled:opacity-50"
          onClick={onRun}>{running ? 'Simulating…' : 'Compare retirement with these events'}</button>
      )}
      {comparison && <PurchaseResults events={events} comparison={comparison} />}
    </section>
  )
}
