import { useState } from 'react'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import { fmtPrice } from './charts.tsx'

/**
 * Ask for today's share price when the files predate it.
 *
 * The documents only carry prices Epic has already announced, and a new one
 * lands each spring. Between announcements the newest price in the files can be
 * a year or more old — and a stale price silently understates the whole
 * position, with nothing on screen to say so. Rather than impute one, ask: the
 * answer is re-run through the same computation as any other price.
 */
export default function StalePriceNotice({ latestPrice, latestDate, onApply, busy }: {
  latestPrice: number; latestDate: string
  onApply: (price: number) => void; busy: boolean
}) {
  const [entry, setEntry] = useState('')
  const parsed = parseFloat(entry)
  const valid = Number.isFinite(parsed) && parsed > 0

  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        These figures use the {latestDate.slice(0, 4)} price of {fmtPrice(latestPrice)}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
        That is the newest price in your files, and it is not this year's. Your
        shares are almost certainly worth more than shown. Epic announces a new
        price each spring — enter the current one and everything here is
        recomputed against it.
      </p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={e => { e.preventDefault(); if (valid) onApply(parsed) }}
      >
        <label htmlFor="trial-current-price" className="sr-only">Current share price</label>
        <input
          id="trial-current-price" type="number" step="0.01" min="0" inputMode="decimal"
          value={entry} onChange={e => setEntry(e.target.value)} disabled={busy}
          placeholder="Current price"
          className="h-9 w-36 rounded-lg border border-amber-300 bg-cs-surface px-2.5 text-sm text-cs-text dark:border-amber-700"
        />
        <button
          type="submit" disabled={!valid || busy}
          className="h-9 rounded-lg bg-cs-brand px-3.5 text-sm font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-40"
        >
          {busy ? 'Recomputing…' : 'Use this price'}
        </button>
      </form>
    </Card>
  )
}

