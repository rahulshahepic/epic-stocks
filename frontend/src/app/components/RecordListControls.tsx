import { useId, useRef } from 'react'
import { sortOptions, type RecordSort, type useRecordList } from '../hooks/useRecordList.ts'

const hints = { grants: 'Year or type', loans: 'Year or type', sales: 'Date, type or notes' }

export function RecordListControls({ name, controls, count, total }: {
  name: keyof typeof hints
  controls: ReturnType<typeof useRecordList>
  count: number
  total: number
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const active = !!controls.query.trim()
  const field = 'h-11 min-h-11 min-w-0 rounded-lg border border-cs-border-strong bg-cs-surface px-3 text-base text-cs-text'
  return (
    <div className="space-y-2 sm:max-w-lg">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium text-cs-text-2">Filter {name}</label>
          <div className="relative flex">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="pointer-events-none absolute top-3.5 left-2.5 size-4 text-cs-text-2">
              <circle cx="8.5" cy="8.5" r="5" /><path d="m12 12 4.5 4.5" />
            </svg>
            <input id={id} ref={input} className={`${field} w-full pl-8 [&::-webkit-search-cancel-button]:hidden ${controls.query ? 'pr-11' : ''}`} type="search" placeholder={hints[name]} value={controls.query} onChange={event => controls.setQuery(event.target.value)} />
            {controls.query && <button type="button" aria-label="Clear filter" className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-lg text-cs-text-2" onClick={() => { controls.setQuery(''); input.current?.focus() }}>×</button>}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-cs-text-2">
          Sort {name}
          <select className={field} value={controls.sort} onChange={event => controls.setSort(event.target.value as RecordSort)}>
            {sortOptions.map(option => <option key={option}>{option}</option>)}
          </select>
        </label>
      </div>
      <p role="status" className="text-xs text-cs-text-2">
        {active && count === 0 ? `No ${name} match “${controls.query.trim()}”.` : active ? `${count} of ${total} ${name}` : ''}
      </p>
    </div>
  )
}
