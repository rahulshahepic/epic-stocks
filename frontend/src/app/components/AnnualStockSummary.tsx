import { useCallback, useEffect, useRef, useState } from 'react'
import { useApiData } from '../hooks/useApiData.ts'
import { apiFetch } from '../../api.ts'
import { fmt$, fmtNum } from '../format.ts'

interface Summary {
  year: number
  note: string
  price_is_estimate: boolean
  rows: { label: string; before: number | null; after: number | null; change: number | null; unit: 'dollars' | 'shares' }[]
}

export default function AnnualStockSummary({ openFromLink = false }: { openFromLink?: boolean }) {
  const [open, setOpen] = useState(openFromLink)
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!openFromLink) return
    details.current?.scrollIntoView?.({ block: 'start' })
  }, [openFromLink])
  const fetcher = useCallback(() => open ? apiFetch<Summary>('/api/annual-stock-summary') : Promise.resolve(null), [open])
  const { data, error, loading, reload } = useApiData<Summary | null>(fetcher)
  const year = data?.year ?? new Date().getFullYear() - 1
  return (
    <details ref={details} id="annual-summary" open={open} onToggle={e => setOpen(e.currentTarget.open)} className="scroll-mt-28 rounded-xl border border-cs-border bg-cs-surface p-4">
      <summary className="cursor-pointer py-1 text-sm font-semibold text-cs-text">Your {year} stock summary</summary>
      {open && (error ? <p role="alert" className="mt-3 text-xs text-cs-text-2">Could not load the annual summary. <button type="button" onClick={reload} className="underline">Retry summary</button></p> : loading || !data ? <p role="status" className="mt-3 text-xs text-cs-muted">Loading summary…</p> : <>
        <p className="mt-3 text-xs leading-relaxed text-cs-text-2">{data.note}{data.price_is_estimate && ' At least one endpoint uses a tentative share price.'}</p>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Annual stock changes">
          <table className="w-full min-w-80 text-left text-xs text-cs-text-2">
            <thead><tr><th className="p-2">Measure</th><th className="p-2">Prior Dec 31</th><th className="p-2">Dec 31</th><th className="p-2">Net change</th></tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.label} className="border-t border-cs-border"><th className="p-2 font-medium">{row.label}</th>{[row.before, row.after, row.change].map((value, i) => <td key={i} className="p-2 tabular-nums">{value == null ? 'Unavailable' : row.unit === 'shares' ? fmtNum(value) : fmt$(value)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </>)}
    </details>
  )
}
