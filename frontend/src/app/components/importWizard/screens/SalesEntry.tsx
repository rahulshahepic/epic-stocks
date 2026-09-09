import { BackBtn, NextBtn, SkipBtn } from '../fields.tsx'
import type { SaleDraft } from '../types.ts'

const INPUT = 'w-full rounded-md border border-cs-border bg-cs-surface px-2 py-1 text-xs text-cs-text placeholder:text-cs-muted'

/**
 * The shares Epic says left your grants that no down payment accounts for.
 *
 * The workbook gives the count and nothing else — it carries no sale date and no
 * price — so this screen exists to ask for the two figures only the user has.
 * It is the no-assistant path to the same answer the repair prompt collects by
 * asking; either way the wizard is what writes the sale.
 *
 * Skipping is allowed. A sale left blank is simply not imported, which is where
 * the import stood before this screen existed — better than a guessed price
 * landing in a capital-gains figure the user cannot tell from a real one.
 */
export function SalesEntryScreen({
  sales, onChange, onBack, onNext, onSkip,
}: {
  sales: SaleDraft[]
  onChange: (index: number, updated: SaleDraft) => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  const answered = sales.filter(s => s.date && parseFloat(s.price_per_share) > 0).length
  const partial = sales.filter(
    s => (s.date === '') !== (!(parseFloat(s.price_per_share) > 0)),
  ).length

  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Shares that were sold</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Your workbook reports these shares gone from your grants, and none of them
          match a down payment paid in stock — so they were sold. It records how many,
          but never when or for how much, so those two are yours to fill in.
        </p>
        <p className="mt-1 text-xs text-cs-muted">
          Leave a row blank to skip it. Nothing is guessed: a made-up price would show
          up as a real capital gain.
        </p>
      </div>

      <div className="space-y-3">
        {sales.map((sale, i) => (
          <div key={i} className="rounded-md border border-cs-border bg-cs-raised p-3">
            <p className="text-xs font-medium text-cs-text">
              {sale.shares.toLocaleString()} shares
            </p>
            {sale.notes && (
              <p className="mt-0.5 text-[11px] text-cs-muted">{sale.notes}</p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`sale-date-${i}`} className="text-[10px] font-medium text-cs-text-2">
                  Date sold
                </label>
                <input
                  id={`sale-date-${i}`}
                  type="date"
                  value={sale.date}
                  onChange={e => onChange(i, { ...sale, date: e.target.value })}
                  className={`mt-0.5 ${INPUT}`}
                />
              </div>
              <div>
                <label htmlFor={`sale-price-${i}`} className="text-[10px] font-medium text-cs-text-2">
                  Price per share
                </label>
                <input
                  id={`sale-price-${i}`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={sale.price_per_share}
                  onChange={e => onChange(i, { ...sale, price_per_share: e.target.value })}
                  placeholder="0.00"
                  className={`mt-0.5 ${INPUT}`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {partial > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {partial === 1 ? 'One sale has' : `${partial} sales have`} only one of the two
          figures filled in, so {partial === 1 ? 'it' : 'they'} will not be imported.
        </p>
      )}

      <div className="flex gap-2">
        <NextBtn
          label={answered > 0 ? `Next: import ${answered} sale${answered === 1 ? '' : 's'} →` : 'Next →'}
          onClick={onNext}
        />
        <SkipBtn onClick={onSkip} label="Skip — I'll add these later" />
      </div>
    </div>
  )
}
