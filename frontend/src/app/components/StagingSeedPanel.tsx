import { useState } from 'react'
import { apiFetchRaw } from '../../api.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'

const profiles = [
  ['early', 'Early career', '3 years'],
  ['established', 'Established', '10 years'],
  ['exit', 'Planning an exit', '20 years']
] as const

export default function StagingSeedPanel({
  onSeeded = () => window.location.assign('/')
}: {
  onSeeded?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function seed(profile: string) {
    setBusy(profile)
    setError('')
    try {
      const response = await apiFetchRaw('/api/demo/seed', {
        method: 'POST',
        body: JSON.stringify({ profile })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
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
        Set up a fictional staging account
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-cs-text-2">
        Load invented grants, prices, loans, age and retirement assumptions into
        this empty account. This lets you test the full app and connect an
        assistant through OAuth. Use an empty account with no saved birthday or plan; existing records will not be replaced.
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
