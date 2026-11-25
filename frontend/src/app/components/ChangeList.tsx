import { claimMeasurement, measurementEvent, measurementToken } from '../../scaffold/onboarding.ts'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Change, type ChangePosition, type ChangeResult } from '../../api.ts'
import { ReportableError } from '../../scaffold/components/ReportProblem.tsx'

const GROUPS: { key: NonNullable<Change['group']>; title: string }[] = [
  { key: 'add', title: 'Add' },
  { key: 'update', title: 'Update' },
  { key: 'remove', title: 'Remove' },
]

const money = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function Position({ label, before, after }: { label: string; before?: number | null; after?: number | null }) {
  const moved = before !== after
  return (
    <div>
      <dt className="text-[11px] text-cs-muted">{label}</dt>
      <dd className={`text-sm ${moved ? 'font-semibold text-cs-text' : 'text-cs-text-2'}`}>
        {moved ? `${money(before)} → ${money(after)}` : money(after)}
      </dd>
    </div>
  )
}

function groupOf(c: Change): NonNullable<Change['group']> {
  return c.group ?? (c.action === 'create' ? 'add' : c.action === 'delete' ? 'remove' : 'update')
}

/**
 * Every edit an import implies, on one screen. Untick what you do not want;
 * Apply previews the rest exactly as the app would store it, then saves them
 * all together — or none, if any one is refused.
 */
export default function ChangeList({ changes, extra = [], onApplied }: {
  changes: Change[]
  /** Edits added on the page itself, such as sales the person dated and priced. */
  extra?: Change[]
  onApplied?: (result: ChangeResult) => void
}) {
  const [picked, setPicked] = useState<boolean[]>(() => changes.map(c => c.selected !== false))
  const [preview, setPreview] = useState<ChangeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<ChangeResult | null>(null)

  const chosen = useMemo(() => [...changes.filter((_, i) => picked[i]), ...extra], [changes, picked, extra])

  function toggle(i: number) {
    setPicked(p => p.map((v, j) => (j === i ? !v : v)))
    setPreview(null)
  }

  async function check() {
    setBusy(true); setError('')
    try { setPreview(await api.previewChanges(chosen)) }
    catch (e) { setError(e instanceof Error ? e.message : 'These changes could not be checked') }
    finally { setBusy(false) }
  }

  async function apply() {
    if (!preview?.confirm) return
    setBusy(true); setError('')
    try {
      await measurementEvent('save_intent')
      await claimMeasurement()
      const token = await measurementToken()
      const result = token ? await api.applyChanges(chosen, preview.confirm, token) : await api.applyChanges(chosen, preview.confirm)
      setDone(result)
      onApplied?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'These changes could not be saved')
      setPreview(null)
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <p className="mt-3 rounded-md bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        Saved {done.changes.length} change{done.changes.length === 1 ? '' : 's'}.
      </p>
    )
  }

  if (!changes.length && !extra.length) {
    return <div className="mt-3 space-y-2 text-xs text-cs-muted"><p>Nothing to change — your account already matches these files.</p><p>You’re up to date. <Link to="/" className="font-semibold text-cs-brand underline">Review your position</Link> or <Link to="/retirement" className="font-semibold text-cs-brand underline">explore retirement</Link>.</p></div>
  }

  const pos = (k: keyof ChangePosition) => [preview?.position_before[k] as number | null | undefined,
    preview?.position_after[k] as number | null | undefined] as const

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm font-semibold text-cs-text">What changed</p>
      <p className="text-xs text-cs-text-2">Compared with your saved records: {(['grant', 'loan', 'price', 'sale'] as const).flatMap(kind => {
        return (['create', 'update', 'delete'] as const).flatMap(action => {
          const n = changes.filter(c => c.kind === kind && c.action === action).length
          return n ? [`${n} ${action === 'create' ? 'new' : action === 'delete' ? 'removed' : 'updated'} ${kind}${n === 1 ? '' : 's'}`] : []
        })
      }).join(', ')}. Check the selected changes to see the before-and-after position before saving.</p>
      {GROUPS.map(({ key, title }) => {
        const rows = changes.map((c, i) => [c, i] as const).filter(([c]) => groupOf(c) === key)
        if (!rows.length) return null
        return (
          <fieldset key={key} className="rounded-md border border-cs-border p-2">
            <legend className="px-1 text-xs font-semibold text-cs-text">{title}</legend>
            {rows.map(([c, i]) => (
              <label key={i} className="flex items-start gap-2 py-1.5 text-xs">
                <input type="checkbox" checked={picked[i]} onChange={() => toggle(i)} disabled={busy}
                  className="mt-0.5 rounded border-cs-border-strong" />
                <span>
                  <span className="font-medium text-cs-text">{c.label}</span>
                  {c.detail && <span className="block text-cs-muted">{c.detail}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )
      })}

      {preview && (
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-cs-raised p-2.5 sm:grid-cols-3">
          <Position label="Stock value today" before={pos('total_stock_value')[0]} after={pos('total_stock_value')[1]} />
          <Position label="Loans outstanding" before={pos('outstanding_loan_balance')[0]} after={pos('outstanding_loan_balance')[1]} />
          <Position label="Net equity" before={pos('net_equity')[0]} after={pos('net_equity')[1]} />
        </dl>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/30">
          <ReportableError message={error} source="import" className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!preview ? (
          <button type="button" onClick={check} disabled={busy || !chosen.length}
            className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
            {busy ? 'Checking…' : `Check ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}
          </button>
        ) : (
          <button type="button" onClick={apply} disabled={busy}
            className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
            {busy ? 'Saving…' : `Save ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  )
}
