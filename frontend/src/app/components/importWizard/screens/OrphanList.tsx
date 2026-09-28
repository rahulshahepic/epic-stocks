/**
 * Saved rows the schedule has no place for. The tick box reads "remove this".
 * Started by hand it starts ticked; reviewing an import it starts unticked,
 * because an import keeps what it does not mention.
 */
export function OrphanList<T extends { id: number }>({ title, rows, preserved, onToggle, children, hint }: {
  title: string
  hint?: string
  rows: T[]
  preserved: Set<number>
  onToggle: (id: number, remove: boolean) => void
  children: (row: T) => React.ReactNode
}) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
      <p className="text-xs font-medium text-red-700 dark:text-red-400">{title}</p>
      <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-500">{hint ?? 'Uncheck to keep.'}</p>
      <div className="mt-2 space-y-1">
        {rows.map(row => (
          <label key={row.id} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
            <input
              type="checkbox"
              checked={!preserved.has(row.id)}
              onChange={e => onToggle(row.id, e.target.checked)}
              className="rounded border-red-300"
            />
            {children(row)}
          </label>
        ))}
      </div>
    </div>
  )
}
