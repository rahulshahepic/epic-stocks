import { useState } from 'react'
import { apiFetchRaw } from '../../api.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import { logApiFailure, noteErrorRef } from '../../scaffold/reportLog.ts'

const profiles = [
  ['early', 'Early career', '3 years'],
  ['established', 'Established', '10 years'],
  ['exit', 'Planning an exit', '20 years']
] as const

export default function StagingSeedPanel({
  onSeeded = () => window.location.assign('/'),
  currentScenario
}: {
  onSeeded?: () => void
  currentScenario?: string | null
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pendingReset, setPendingReset] = useState<{ profile: string; confirm: string } | null>(null)
  async function seed(profile: string, confirm?: string, reset = false) {
    setBusy(profile)
    setError('')
    setPendingReset(null)
    try {
      const response = await apiFetchRaw('/api/demo/seed', {
        method: 'POST',
        body: JSON.stringify({ profile, ...(confirm ? { confirm } : {}), ...(reset ? { reset: true } : {}) })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        if (data?.detail?.code === 'reset_required' && typeof data.detail.confirm === 'string') {
          setPendingReset({ profile, confirm: data.detail.confirm })
          setBusy(null)
          return
        }
        const errorRef = response.headers.get('X-Error-Ref') ?? data?.error_ref
        logApiFailure('POST', '/api/demo/seed', response.status, errorRef)
        noteErrorRef(errorRef)
        throw new Error(
          typeof data?.detail === 'string'
            ? data.detail
            : 'The fictional profile could not load. Please retry.'
        )
      }
      onSeeded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The profile could not load.')
      setBusy(null)
    }
  }
  return (
    <Card as="section" pad="md">
      <h2 className="text-lg font-semibold text-cs-text">
        {currentScenario ? 'Fictional staging workspace' : 'Set up a fictional staging account'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-cs-text-2">
        Open a separate account with invented grants, prices, loans, age and
        retirement assumptions. Your existing records, birthday and saved plans
        stay untouched. Reopening the same profile keeps your testing edits.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {profiles.map(([key, label, tenure]) => (
          <button
            type="button"
            key={key}
            disabled={busy !== null}
            onClick={() => seed(key)}
            className="min-h-14 rounded-xl border border-cs-border-strong bg-cs-raised px-3 py-3 text-left text-sm font-semibold text-cs-text disabled:opacity-50"
          >
            <span className="block">
              {busy === key ? 'Loading…' : `Load ${label}`}
            </span>
            <span className="mt-1 block text-xs font-normal text-cs-text-2">
              {tenure} of fictional grants
            </span>
          </button>
        ))}
      </div>
      {currentScenario && <button type="button" disabled={busy !== null} onClick={() => seed(currentScenario, undefined, true)} className="mt-3 min-h-11 rounded-lg border border-cs-border-strong px-3 py-2 text-sm font-semibold text-cs-text disabled:opacity-50">Reset current fictional profile</button>}
      {pendingReset && (
        <div role="alert" className="mt-4 rounded-xl border border-cs-border-strong bg-cs-raised p-3">
          <p className="text-sm text-cs-text">Reset the fictional workspace to {profiles.find(([key]) => key === pendingReset.profile)?.[1]}? This discards its testing edits. Your original account stays untouched.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => seed(pendingReset.profile, pendingReset.confirm, true)} className="min-h-11 rounded-lg bg-cs-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Reset fictional workspace</button>
            <button type="button" disabled={busy !== null} onClick={() => setPendingReset(null)} className="min-h-11 rounded-lg border border-cs-border-strong px-3 py-2 text-sm font-semibold text-cs-text">Keep testing edits</button>
          </div>
        </div>
      )}
      {busy && (
        <p role="status" className="mt-3 text-xs text-cs-text-2">
          Creating the fictional profile…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-cs-text">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-cs-muted">
        Staging test data only. It must never be used as a source for personal
        finances or production records.
      </p>
      <a
        href="/mcp-setup"
        className="mt-3 inline-block text-sm font-semibold text-cs-brand dark:text-rose-300 underline"
      >
        Staging MCP setup guide
      </a>
    </Card>
  )
}
