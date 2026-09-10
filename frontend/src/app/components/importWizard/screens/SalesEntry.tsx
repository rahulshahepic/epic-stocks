import type { WizardSale } from '../../../../api.ts'
import { BackBtn, NextBtn, SkipBtn } from '../fields.tsx'
import { saleReview } from '../sales.ts'
import type { SaleDraft } from '../types.ts'

const INPUT = 'w-full rounded-md border border-cs-border bg-cs-surface px-3 py-2 text-sm text-cs-text placeholder:text-cs-muted min-h-11'

export function SalesEntryScreen({
  sales, existingSales = [], availableShares = null, onChange, onBack, onNext, onSkip, onAdd, onRemove,
}: {
  sales: SaleDraft[]
  existingSales?: WizardSale[]
  availableShares?: number | null
  onChange: (index: number, updated: SaleDraft) => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onAdd?: () => void
  onRemove?: (index: number) => void
}) {
  const review = saleReview(sales, existingSales, availableShares)
  return (
    <div className="space-y-4">
      <BackBtn onClick={onBack} />
      <div>
        <h2 className="text-base font-semibold text-cs-text">Account for shares that left</h2>
        <p className="mt-1 text-sm text-cs-muted">
          These may be exchanges, sales, or both. Enter down-payment exchanges on the
          grants screen, then list each actual sale here.
        </p>
        {availableShares != null && (
          <p className="mt-2 text-sm font-medium text-cs-text">
            {availableShares.toLocaleString()} shares remain after the exchanges entered on your grants.
          </p>
        )}
        <p className="mt-1 text-sm text-cs-muted">
          Select a saved sale to avoid duplicates. Leave unknown details blank.
        </p>
      </div>
      <div className="space-y-3">
        {sales.map((sale, i) => (
          <div key={i} className="rounded-md border border-cs-border bg-cs-raised p-3 space-y-3">
            <p className="text-sm font-medium text-cs-text">Sale {i + 1} · {sale.shares.toLocaleString()} shares</p>
            {sale.notes && <p className="text-xs text-cs-muted">{sale.notes}</p>}
            {existingSales.length > 0 && (
              <div>
                <label htmlFor={`sale-existing-${i}`} className="text-xs text-cs-text-2">Use a saved sale</label>
                <select id={`sale-existing-${i}`} className={INPUT} value="" onChange={e => {
                  if (!e.target.value) return
                  const saved = existingSales[Number(e.target.value)]
                  if (saved) onChange(i, { ...sale, ...saved, notes: saved.notes || '',
                    price_per_share: String(saved.price_per_share) })
                }}>
                  <option value="">Select a transaction…</option>
                  {existingSales.map((s, j) => <option key={j} value={j}>
                    {s.date} · {s.shares.toLocaleString()} shares @ {s.price_per_share}
                  </option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor={`sale-shares-${i}`} className="text-xs text-cs-text-2">Shares sold</label>
              <input id={`sale-shares-${i}`} type="number" inputMode="numeric" min="0" max="10000000" step="1"
                value={sale.shares || ''} className={INPUT}
                onChange={e => onChange(i, { ...sale, shares: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
              <div className="min-w-0">
                <label htmlFor={`sale-date-${i}`} className="text-xs text-cs-text-2">Date sold</label>
                <input id={`sale-date-${i}`} type="date" value={sale.date} className={INPUT}
                  onChange={e => onChange(i, { ...sale, date: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label htmlFor={`sale-price-${i}`} className="text-xs text-cs-text-2">Price per share</label>
                <input id={`sale-price-${i}`} type="number" inputMode="decimal" step="any" min="0" max="1000000"
                  value={sale.price_per_share} placeholder="0.00" className={INPUT}
                  onChange={e => onChange(i, { ...sale, price_per_share: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-cs-muted">
              {review.rows[i].status === 'existing' ? 'Already recorded — no copy will be added.'
                : review.rows[i].status === 'new' ? 'Ready to import.'
                  : 'Not importing this row until its quantity, date and positive price are valid.'}
            </p>
            {onRemove && <button type="button" className="min-h-11 text-sm text-cs-text underline"
              onClick={() => onRemove(i)} aria-label={`Remove sale ${i + 1}`}>Remove sale</button>}
          </div>
        ))}
      </div>
      {onAdd && <button type="button" className="min-h-11 text-sm text-cs-text underline" onClick={onAdd}>Add another sale</button>}
      {review.issues.map(issue => <p role="alert" key={issue} className="text-sm text-red-700 dark:text-red-300">{issue}</p>)}
      {review.skippedShares > 0 && <p className="text-sm text-cs-muted">
        {review.skippedShares.toLocaleString()} shares will remain unimported. Add their details later on the Sales page.
      </p>}
      <div className="flex flex-wrap gap-2">
        <NextBtn label={`Next: review ${review.newCount} new sale${review.newCount === 1 ? '' : 's'} →`}
          disabled={review.issues.length > 0} onClick={onNext} />
        <SkipBtn onClick={onSkip} label="Skip — I'll add these later" />
      </div>
    </div>
  )
}
