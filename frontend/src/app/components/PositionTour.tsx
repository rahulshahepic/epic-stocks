import { useState } from 'react'
import { Link } from 'react-router-dom'

const STEPS = [
  {title: 'Your shares', target: '[data-equity-card="vesting"]', text: 'Vested shares are earned. Unvested shares depend on future vesting; the card separates them.'},
  {title: 'Your loans', target: '[data-equity-card="loan"]', text: 'Borrowed principal and accrued interest are separate obligations. Expand the card explanation for what each figure includes.'},
  {title: 'Estimated tax', target: '[data-equity-card="divest_tax"], [data-equity-card="tax"]', text: 'These estimates use your saved rates and tax lots. They are already included where the app shows cash after tax.'},
  {title: 'Cash if you leave', target: '#exit-details > details', text: 'The exit breakdown follows share value through loan repayment and tax to estimated cash. Expand the cash card to inspect the deductions.'},
  {title: 'What next?', target: '', text: 'Check the records behind your position, then explore retirement. You can open any dotted explanation whenever a term is unfamiliar.'},
]

export default function PositionTour({accountId}: {accountId: number}) {
  const key = `position-tour-dismissed-${accountId}`
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const [step, setStep] = useState<number | null>(null)
  function dismiss() { try { localStorage.setItem(key, '1') } catch { /* Still dismiss for this page. */ } setDismissed(true) }
  function show(index: number) {
    setStep(index)
    if (!STEPS[index].target) return
    const target = document.querySelector<HTMLElement>(STEPS[index].target)
    if (!target) return
    if (target instanceof HTMLDetailsElement) target.open = true
    for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true
    target.tabIndex = -1
    target.focus({preventScroll: true})
    target.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'})
  }
  if (dismissed) return null
  return <section aria-label="Your position tour" className="sticky top-20 z-30 rounded-xl border border-cs-border bg-cs-surface p-4 text-sm text-cs-text shadow-card">
    <div role="status" aria-live="polite"><h2 className="font-semibold">{step === null ? 'Want a quick tour of your position?' : `${step + 1} of 5 · ${STEPS[step].title}`}</h2>
      <p className="mt-2 text-cs-text-2">{step === null ? 'About a minute: shares, loans, tax, cash if you leave, and what to do next.' : STEPS[step].text}</p></div>
    <div className="mt-3 flex flex-wrap gap-3">
      {step === null ? <button onClick={() => show(0)} className="min-h-11 font-semibold text-cs-brand underline">Show me around</button> : step < 4 ? <button onClick={() => show(step + 1)} className="min-h-11 font-semibold text-cs-brand underline">Next: {STEPS[step + 1].title}</button> : <Link to="/retirement" onClick={dismiss} className="min-h-11 py-2 font-semibold text-cs-brand underline">Explore retirement</Link>}
      <button onClick={dismiss} className="min-h-11 text-cs-muted underline">{step === 4 ? 'Finish tour' : 'Dismiss tour'}</button>
    </div>
  </section>
}
