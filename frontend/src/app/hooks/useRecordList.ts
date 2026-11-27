import { useState } from 'react'

export const sortOptions = ['Newest first', 'Oldest first', 'Largest first', 'Smallest first'] as const
export type RecordSort = typeof sortOptions[number]

export function useRecordList() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RecordSort>(sortOptions[0])

  function select<T>(
    rows: T[],
    date: (row: T) => string,
    size: (row: T) => number,
    searchValues: (row: T) => (string | number | null | undefined)[],
  ) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter(row => {
      const text = searchValues(row).join(' ').toLowerCase()
      return terms.every(term => text.includes(term))
    }).sort((a, b) => {
      switch (sort) {
        case 'Newest first': return date(b).localeCompare(date(a))
        case 'Oldest first': return date(a).localeCompare(date(b))
        case 'Largest first': return size(b) - size(a)
        case 'Smallest first': return size(a) - size(b)
      }
    })
  }

  return { query, setQuery, sort, setSort, select }
}
