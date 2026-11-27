import { sortOptions, type RecordSort, type useRecordList } from '../hooks/useRecordList.ts'

export function RecordListControls({ name, controls }: {
  name: string
  controls: ReturnType<typeof useRecordList>
}) {
  const field = 'min-h-11 min-w-0 rounded-lg border border-cs-border-strong bg-cs-surface px-3 text-sm text-cs-text'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:max-w-lg">
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-cs-text-2">
        Filter {name}
        <input className={field} type="search" value={controls.query} onChange={event => controls.setQuery(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-cs-text-2">
        Sort {name}
        <select className={field} value={controls.sort} onChange={event => controls.setSort(event.target.value as RecordSort)}>
          {sortOptions.map(option => <option key={option}>{option}</option>)}
        </select>
      </label>
    </div>
  )
}
