import { useEffect, useId, useRef, useState } from 'react'
import { api, type ExpenseFundingOptions, type ExpenseFundingPlan } from '../../api.ts'
import { fmt$, fmtFullDate, fmtNum, fmtPrice } from '../format.ts'

const action = 'min-h-11 rounded-lg border border-cs-border-strong px-3 py-2 text-sm font-semibold text-cs-text disabled:opacity-60'

function savingsText(amount: number, months: number) {
  if (amount <= 0) return 'The first bill is already covered.'
  if (months === 0) return `Set aside ${fmt$(Math.ceil(amount))} now.`
  return `Set aside about ${fmt$(Math.ceil(amount / months))} per month for ${months} ${months === 1 ? 'month' : 'months'}.`
}

export default function ExpenseFunding({ expenseId, title, ready, canReview, initiallyOpen, plan, onPlan }: {
  expenseId: string
  title: string
  ready: boolean
  canReview: boolean
  initiallyOpen: boolean
  plan?: ExpenseFundingPlan
  onPlan: (expenseId: string, plan?: ExpenseFundingPlan) => void
}) {
  const panelId = useId()
  const toggleButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(initiallyOpen)
  const [options, setOptions] = useState<ExpenseFundingOptions | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [savedNotice, setSavedNotice] = useState('')

  useEffect(() => {
    if (!open || !ready || !canReview) return
    const request = new AbortController()
    api.getExpenseFundingOptions(expenseId, request.signal).then(result => {
      if (!request.signal.aborted) setOptions(result)
    }).catch((err: unknown) => {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Funding options could not load.')
    })
    return () => request.abort()
  }, [expenseId, open, ready, canReview, attempt])

  function toggle() {
    setOptions(null)
    setError('')
    setOpen(value => !value)
  }

  async function save(method: ExpenseFundingPlan['method']) {
    if (!options || busy) return
    setBusy(true)
    setError('')
    try {
      onPlan(expenseId, await api.confirmExpenseFunding(expenseId, method, options.confirmation))
      setSavedNotice(method === 'epic' ? 'Tentative sale added to Sales.' : 'Savings plan saved.')
      setOpen(false)
      requestAnimationFrame(() => toggleButton.current?.focus())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The funding plan could not be saved.')
      setOptions(null)
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    setError('')
    try {
      await api.clearExpenseFunding(expenseId)
      onPlan(expenseId)
      setSavedNotice('Funding choice cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The funding plan could not be cleared.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="w-full space-y-2 border-t border-cs-border pt-2 text-sm text-cs-text">
    <p aria-live="polite" className="sr-only">{savedNotice}</p>
    {plan && <p className="text-xs text-cs-text-2">
      {plan.sale ? `Tentative Epic sale · ${fmtNum(plan.sale.shares)} shares · ${fmt$(plan.sale.net_proceeds)} estimated after tax`
        : `Savings plan · ${fmt$(plan.initial_cash)} by ${fmtFullDate(plan.due_date)}`}
      {plan.sale && plan.sale.net_proceeds < plan.initial_cash &&
        ` · ${fmt$(Math.ceil(plan.initial_cash - plan.sale.net_proceeds))} to save`}
    </p>}
    <div className="flex flex-wrap gap-x-3">
      {canReview && <button type="button" aria-controls={panelId} aria-expanded={open} ref={toggleButton} disabled={busy} onClick={toggle}
        aria-label={`Funding options for ${title}`} className="min-h-11 text-sm font-semibold underline">
        {open ? 'Hide funding options' : plan ? 'Review funding options' : 'See funding options'}
      </button>}
      {plan && <button type="button" className="min-h-11 text-xs text-cs-text-2 underline" disabled={busy} onClick={clear}>Clear funding choice</button>}
    </div>
    {error && <p role="alert" className="text-sm text-cs-text">{error}</p>}
    <div id={panelId} hidden={!open || !canReview} className="space-y-3">
      {error && !options && <button type="button" className={action} onClick={() => {
        setError('')
        setAttempt(value => value + 1)
      }}>Refresh estimate</button>}
      {!error && (!ready || !options) && <p role="status" className="text-xs text-cs-text-2">{ready ? 'Estimating funding options…' : 'Waiting for the expense to save…'}</p>}
      {ready && options && <>
        <div>
          <p className="font-semibold">{fmt$(options.initial_cash)} {options.first_month_only ? 'for the first month' : 'upfront'}</p>
          {options.monthly_cost > 0 && <p className="mt-1 text-xs text-cs-text-2">Budget {fmt$(options.monthly_cost)}/month at the start for payments and ongoing costs.</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg bg-cs-surface p-3">
            <h3 className="font-semibold">Save from pay or use cash</h3>
            <p className="text-xs leading-relaxed text-cs-text-2">{savingsText(options.initial_cash, options.months_to_save)}</p>
            <button type="button" className={action} disabled={busy} onClick={() => save('savings')}>Use savings plan</button>
          </div>
          <div className="space-y-2 rounded-lg bg-cs-surface p-3">
            <h3 className="font-semibold">Sell Epic stock{options.sale && options.sale.net_proceeds < options.initial_cash ? ' + save' : ''}</h3>
            {options.sale ? <>
              <p className="text-xs leading-relaxed text-cs-text-2">
                {fmtNum(options.sale.shares)} shares at {fmtPrice(options.sale.price_per_share)} for about <strong>{fmt$(options.sale.net_proceeds)} after tax</strong>.
                {' '}Uses the {fmtFullDate(options.sale.price_date)} {options.sale.price_is_estimate ? 'estimated' : 'saved'} price.
              </p>
              {options.sale.net_proceeds < options.initial_cash && <p className="text-xs text-cs-text-2">
                Savings would cover the remaining {fmt$(Math.ceil(options.initial_cash - options.sale.net_proceeds))}. {savingsText(options.initial_cash - options.sale.net_proceeds, options.months_to_save)}
              </p>}
              <p className="text-xs text-cs-text-2">Check with Epic that you can sell by this date.</p>
              <button type="button" className={action} disabled={busy} onClick={() => save('epic')}>Add tentative sale</button>
            </> : <p className="text-xs text-cs-text-2">{options.sale_unavailable}</p>}
          </div>
        </div>
        <button type="button" disabled={busy} className="min-h-11 px-1 text-xs text-cs-text-2 underline" onClick={() => {
          toggle()
          toggleButton.current?.focus()
        }}>Keep as a tip</button>
      </>}
    </div>
  </div>
}
