import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Change, type ChangeResult } from '../../api.ts'
import { useToday } from '../dateUtils.ts'
import { fmt$, stockValueLabel } from '../format.ts'
import StarterQuestions from './StarterQuestions.tsx'

/** A confirmed price uses the existing atomic preview/apply services. */
export default function AnnouncedPrice({ onSaved }: { onSaved?: () => void }) {
  const today = useToday()
  const applicable = `${today.slice(0, 4)}-01-01`
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ result: ChangeResult; changes: Change[] } | null>(null)
  const [saved, setSaved] = useState<ChangeResult | null>(null)
  const [story, setStory] = useState<string[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  async function check() {
    setBusy(true); setError('')
    try {
      const rows = await api.getPrices()
      const existing = rows.find(p => p.effective_date === applicable)
      const values = { effective_date: applicable, price: Number(price), is_estimate: false,
        expected_announcement_date: null, announced_date: existing && !existing.is_estimate ? existing.announced_date ?? null : null }
      const changes: Change[] = [{ kind: 'price', action: existing ? 'update' : 'create',
        ...(existing ? { id: existing.id, version: existing.version } : {}), values }]
      setPreview({ changes, result: await api.previewChanges(changes) })
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function save() {
    if (!preview?.result.confirm) return
    setBusy(true); setError('')
    try {
      const result = await api.applyChanges(preview.changes, preview.result.confirm)
      setSaved(result); setPreview(null); onSaved?.()
      try {
        const dash = await api.getDashboardSnapshot(today)
        setStory(dash.summary_sentences ?? []); setQuestions(dash.starter_questions ?? [])
      } catch { setError('Your price is saved. The refreshed position could not load; reload the dashboard to see it.') }
    } catch (e) { setError((e as Error).message); setPreview(null) }
    finally { setBusy(false) }
  }
  const position = saved ?? preview?.result
  return <section id="announced-price" aria-label="Record announced price" className="scroll-mt-28 space-y-3 rounded-2xl border border-cs-border bg-cs-surface p-4">
    <h2 className="text-base font-semibold text-cs-text">{saved ? 'Your position, updated' : 'Record this year’s announced price'}</h2>
    {!saved && <>
      <p className="text-xs text-cs-text-2">Use the figure Epic announced, applicable from {applicable}. It will be confirmed, replacing any price already recorded for that date. An announcement date already on record is preserved; otherwise it stays unknown until you add it in price history.</p>
      <form onSubmit={e => { e.preventDefault(); void check() }} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm text-cs-text">Announced price
          <input type="number" disabled={busy} required min="0.01" step="0.01" value={price} onChange={e => { setPrice(e.target.value); setPreview(null) }} className="mt-1 block min-h-11 w-full rounded-lg border border-cs-border-strong bg-cs-surface px-3 text-cs-text" />
        </label>
        <button disabled={busy} className="min-h-11 rounded-lg bg-cs-brand px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Checking…' : 'See what changes'}</button>
      </form>
    </>}
    {position && <div className="text-sm text-cs-text" aria-live="polite"><p className="font-semibold">{saved ? 'Saved confirmed price.' : 'Before you save'}</p>
      <p>Confirmed price: ${Number(price).toFixed(2)} per share, applicable {applicable}.</p>
      <p>{stockValueLabel}: {position.position_before.total_stock_value == null ? 'Not priced' : fmt$(position.position_before.total_stock_value)} → {position.position_after.total_stock_value == null ? 'Not priced' : fmt$(position.position_after.total_stock_value)}</p>
      <p className="mt-1 text-xs text-cs-text-2">The same shares valued before and after this price update.</p>
    </div>}
    {preview && <button disabled={busy} onClick={() => void save()} className="min-h-11 rounded-lg bg-cs-brand px-4 text-sm font-semibold text-white disabled:opacity-50">Save confirmed price</button>}
    {saved && <><ul className="space-y-2 text-sm text-cs-text-2">{story.map(s => <li key={s}>{s}</li>)}</ul><Link to="/retirement" className="inline-block min-h-11 py-2 text-sm font-semibold text-cs-brand">See what this means for retirement →</Link><StarterQuestions questions={questions} /></>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </section>
}
