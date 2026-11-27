import { DateInput } from '../../scaffold/components/ui/DateInput.tsx'
import type { VestingDate } from '../../api.ts'
import { addCalendarYears } from '../dateUtils.ts'
import { equalParts, scheduleProblem } from '../vesting.ts'
import { FIELD_INPUT_CLASS } from '../../scaffold/components/ui/Field.tsx'

/**
 * A grant's vesting dates, one row each. A leave of absence moves a date;
 * nothing recomputes it afterwards.
 */
export default function VestingEditor({ rows, shares, onChange }: {
  rows: VestingDate[]
  shares: number
  onChange: (rows: VestingDate[]) => void
}) {
  const problem = scheduleProblem(rows, shares)
  const set = (i: number, patch: Partial<VestingDate>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <fieldset className="col-span-2 rounded-md border border-cs-border p-2">
      <legend className="px-1 text-xs font-medium text-cs-text-2">Vesting dates</legend>
      {rows.map((r, i) => (
        <div key={i} className="mb-1.5 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <label className="sr-only" htmlFor={`vest-date-${i}`}>Vesting date {i + 1}</label>
          <DateInput id={`vest-date-${i}`} value={r.date}
            onChange={e => set(i, { date: e.target.value })} className={FIELD_INPUT_CLASS} />
          <label className="sr-only" htmlFor={`vest-shares-${i}`}>Shares on vesting date {i + 1}</label>
          <input id={`vest-shares-${i}`} type="number" min="0" value={r.shares}
            onChange={e => set(i, { shares: Math.max(0, Math.trunc(+e.target.value)) })}
            className={FIELD_INPUT_CLASS} />
          <button type="button" aria-label={`Remove vesting date ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="px-1 text-xs text-cs-muted hover:text-red-600">✕</button>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        <button type="button" className="font-medium text-cs-brand hover:underline"
          onClick={() => onChange([...rows, {
            date: rows.length ? addCalendarYears(rows[rows.length - 1].date, 1) : '', shares: 0 }])}>
          Add a date
        </button>
        {rows.length > 0 && (
          <button type="button" className="font-medium text-cs-text-2 hover:underline"
            onClick={() => onChange(equalParts(shares, rows[0].date, rows.length))}>
            Split evenly across these dates' years
          </button>
        )}
      </div>
      <p className={`mt-1 text-[11px] ${problem ? 'text-amber-700 dark:text-amber-400' : 'text-cs-muted'}`}>
        {problem ?? 'Move a date for a leave of absence, or change any split.'}
      </p>
    </fieldset>
  )
}
