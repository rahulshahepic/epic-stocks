import { useCallback, useState } from 'react'
import { useApiData } from '../hooks/useApiData.ts'
import { apiFetch } from '../../api.ts'
import { fmt$, fmtFullDate, fmtPrice } from '../format.ts'

interface Comparison {
  date: string; later_date: string; cash_change: number
  first_price: number; later_price: number; note: string
}

export default function ExitDateComparison({ date, invitationId }: { date: string; invitationId?: number }) {
  const [open, setOpen] = useState(false)
  const requestKey = `${invitationId ?? 'me'}:${date}`
  const fetcher = useCallback(async () => {
    if (!open) return null
    const route = invitationId ? `/api/sharing/view/${invitationId}/compare-exit-year` : '/api/compare-exit-year'
    const value = await apiFetch<Comparison | null>(`${route}?date=${encodeURIComponent(date)}`)
    if (!value) throw new Error('Comparison unavailable')
    return { ...value, requestKey }
  }, [open, date, invitationId, requestKey])
  const { data: result, error, loading, reload } = useApiData<(Comparison & {requestKey: string}) | null>(fetcher)
  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-lg border border-cs-border bg-cs-surface p-3">
      <summary className="cursor-pointer py-1 text-xs font-medium text-cs-text">What changes if I stay one more year?</summary>
      {open && (error ? <p role="alert" className="mt-2 text-xs text-cs-text-2">Comparison unavailable. <button type="button" onClick={reload} className="underline">Retry comparison</button></p> : loading || !result || result.requestKey !== requestKey ? <p role="status" className="mt-2 text-xs text-cs-muted">Comparing exit dates…</p> : <div className="mt-2 space-y-2 text-xs text-cs-text-2">
        <p><strong className="text-cs-text">{fmt$(result.cash_change)}</strong> change in modeled total cash through exit on {fmtFullDate(result.later_date)} versus {fmtFullDate(result.date)}.</p>
        <p>Applicable saved prices: {fmtPrice(result.first_price)} → {fmtPrice(result.later_price)}.</p>
        <p className="leading-relaxed">{result.note}</p>
      </div>)}
    </details>
  )
}
