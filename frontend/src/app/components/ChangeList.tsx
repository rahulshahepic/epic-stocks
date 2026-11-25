import { claimMeasurement, measurementEvent, measurementToken } from '../../scaffold/onboarding.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Change, type ChangePosition, type ChangeResult } from '../../api.ts'
import { stockValueLabel } from '../format.ts'
import { ReportableError } from '../../scaffold/components/ReportProblem.tsx'

const NO_EXTRA: Change[] = []

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
export default function ChangeList({ changes, extra = NO_EXTRA, onApplied, onBusyChange, disabled = false }: {
  changes: Change[]
  /** Edits added on the page itself, such as sales the person dated and priced. */
  extra?: Change[]
  onApplied?: (result: ChangeResult) => void
  onBusyChange?: (busy: boolean) => void
  disabled?: boolean
}) {
  const [selections, setSelections] = useState<Record<string, boolean>>({})
  const rowKeys = useMemo(() => {
    const occurrences = new Map<string, number>()
    return changes.map(change => {
      const fingerprint = JSON.stringify([change.kind, change.action, change.id, change.version, change.values])
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1
      occurrences.set(fingerprint, occurrence)
      return `${fingerprint}:${occurrence}`
    })
  }, [changes])
  const [checked, setChecked] = useState<{ selection: Change[]; result: ChangeResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmation = useRef<HTMLHeadingElement>(null)
  const [done, setDone] = useState<{ source: Change[]; result: ChangeResult } | null>(null)

  const chosen = useMemo(() => [
    ...changes.filter((row, i) => selections[rowKeys[i]] ?? row.selected !== false),
    ...extra,
  ], [changes, selections, rowKeys, extra])

  // A confirmation token applies to the exact rows that were previewed.
  const preview = checked?.selection === chosen ? checked.result : null
  useEffect(() => { if (preview) confirmation.current?.focus() }, [preview])

  async function check() {
    onBusyChange?.(true)
    setBusy(true); setError('')
    try { setChecked({ selection: chosen, result: await api.previewChanges(chosen) }) }
    catch (e) { setError(e instanceof Error ? e.message : 'These changes could not be checked') }
    finally { setBusy(false); onBusyChange?.(false) }
  }

  async function apply() {
    if (!preview?.confirm) return
    onBusyChange?.(true)
    setBusy(true); setError('')
    try {
      await measurementEvent('save_intent')
      await claimMeasurement()
      const token = await measurementToken()
      const result = token ? await api.applyChanges(chosen, preview.confirm, token) : await api.applyChanges(chosen, preview.confirm)
      setDone({ source: changes, result })
      onApplied?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'These changes could not be saved')
      setChecked(null)
    } finally { setBusy(false); onBusyChange?.(false) }
  }

  if (done?.source === changes) {
    return (
      <p className="mt-3 rounded-md bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        Saved {done.result.changes.length} change{done.result.changes.length === 1 ? '' : 's'}.
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
      }).join(', ')}. Review the before-and-after position before saving.</p>
      {preview && <h3 ref={confirmation} tabIndex={-1} className="scroll-mt-28 text-sm font-semibold text-cs-text">Confirm import</h3>}
      {preview && (
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-cs-raised p-2.5 sm:grid-cols-3">
          <Position label={stockValueLabel} before={pos('total_stock_value')[0]} after={pos('total_stock_value')[1]} />
          <Position label="Loans outstanding" before={pos('outstanding_loan_balance')[0]} after={pos('outstanding_loan_balance')[1]} />
          <Position label="Stock equity before exit taxes" before={pos('net_equity')[0]} after={pos('net_equity')[1]} />
        </dl>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/30">
          <ReportableError message={error} source="import" className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!preview ? (
          <button type="button" onClick={check} disabled={disabled || busy || !chosen.length}
            className="min-h-11 rounded-lg bg-cs-brand px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
            {busy ? 'Checking…' : 'Review and save'}
          </button>
        ) : (
          <button type="button" onClick={apply} disabled={disabled || busy}
            className="min-h-11 rounded-lg bg-cs-brand px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
            {busy ? 'Saving…' : `Save ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {changes.length > 0 && <details className="space-y-2 rounded-md border border-cs-border p-2.5">
        <summary className="min-h-7 cursor-pointer text-xs font-semibold text-cs-text">Review individual records</summary>
        {GROUPS.map(({ key, title }) => {
          const rows = changes.map((c, i) => [c, i] as const).filter(([c]) => groupOf(c) === key)
          if (!rows.length) return null
          return (
            <fieldset key={key} className="rounded-md border border-cs-border p-2">
              <legend className="px-1 text-xs font-semibold text-cs-text">{title}</legend>
              {rows.map(([c, i]) => (
                <label key={rowKeys[i]} className="flex items-start gap-2 py-1.5 text-xs">
                  <input type="checkbox" checked={selections[rowKeys[i]] ?? c.selected !== false}
                    onChange={e => { const checked = e.target.checked; setSelections(previous => ({ ...previous, [rowKeys[i]]: checked })) }}
                    disabled={disabled || busy}
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
      </details>}

    </div>
  )
}
