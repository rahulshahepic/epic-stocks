import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AiActivityEntry, type AiConnection } from '../../api.ts'
import { Card } from './ui/Card.tsx'

/** Connecting your own AI assistant, and cutting it off again. */

// Mirrors scaffold/oauth/scopes.py:SCOPE_LABELS. A scope with no entry falls
// back to its raw id, which is readable but not English.
const SCOPE_LABELS: Record<string, string> = {
  'equity:read': 'Equity — grants, vesting, prices, loans, sales, tax',
  'comp:read': 'Salary and retirement settings',
  'comp:write': 'Update salary, bonuses and retirement balances',
  'import:propose': 'Prepare an import (no longer used)',
  'equity:write': 'Create, correct or remove grants, prices, loans and sales',
  'admin:read': 'Site deployment, metrics and redacted application errors',
  'admin:write': 'Change site settings; widening access waits for your approval in Admin',
}

// The scopes that let an assistant leave something behind, so the summary
// above can stop promising read-only for a connection that holds one.
const WRITING_SCOPES = ['comp:write', 'import:propose', 'equity:write', 'admin:write']

function formatWhen(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function describe(entry: AiActivityEntry): string {
  if (entry.event === 'connected') return 'connected'
  if (entry.event === 'disconnected') return 'disconnected'
  if (entry.outcome === 'denied') return `${entry.tool} — not permitted`
  if (entry.outcome === 'error') return `${entry.tool} — failed`
  return entry.tool ?? 'read'
}

function formatDate(value: string | null): string {
  if (!value) return 'never'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'unknown'
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AiConnectionsSection({ showGuideLink = true }: { showGuideLink?: boolean }) {
  const [connections, setConnections] = useState<AiConnection[] | null>(null)
  const [activity, setActivity] = useState<AiActivityEntry[]>([])
  const [showActivity, setShowActivity] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const load = useCallback(() => {
    api.getAiConnections()
      .then(setConnections)
      .catch(() => setError('Could not load your AI connections'))
    // Best-effort: the activity list is useful context, not a reason to fail
    // the whole section if it cannot be fetched.
    api.getAiActivity().then(setActivity).catch(() => setActivity([]))
  }, [])

  useEffect(load, [load])

  // The Import page links here to connect an assistant before chatting.
  useEffect(() => {
    if (window.location.hash === '#ai-connections') {
      document.getElementById('ai-connections')?.scrollIntoView({ block: 'start' })
    }
  }, [])

  async function disconnect(id: number) {
    setConfirmId(null)
    try {
      await api.disconnectAi(id)
      setConnections((current) => (current ?? []).filter((c) => c.id !== id))
    } catch {
      setError('Could not disconnect')
    }
  }

  return (
    <Card as="section" pad="md" id="ai-connections">
      <h3 className="text-sm font-medium text-cs-text">AI Connections</h3>
      <p className="mt-1 text-xs text-cs-text-2">
        Let Claude, ChatGPT, Gemini or another assistant read your equity data,
        and — if you allow it — add or correct your grants, prices, loans,
        sales, salary and retirement balances when you ask. Ask it to show you
        the exact changes first. If anything goes wrong, fix the row or
        re-import. You can disconnect at any time.
      </p>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {showGuideLink && (
        <Link
          to="/connect-ai"
          className="mt-3 inline-block rounded-md bg-cs-brand px-3 py-2 text-xs font-semibold text-white hover:bg-cs-brand-hover"
        >
          Connect an assistant
        </Link>
      )}

      {/* What is connected */}
      <div className="mt-4 border-t border-cs-border pt-3">
        <p className="text-xs font-medium text-cs-text">Connected assistants</p>
        {connections === null ? (
          <p className="mt-1 text-xs text-cs-muted">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="mt-1 text-xs text-cs-muted">Nothing connected yet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-cs-border">
            {connections.map((connection) => (
              <li key={connection.id} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-cs-text">
                      {connection.client_name}
                      {connection.scopes.some(s => WRITING_SCOPES.includes(s)) && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          can make changes
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-cs-muted">
                      Connected {formatDate(connection.created_at)} · last used {formatDate(connection.last_used_at)}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {connection.scopes.map((scope) => (
                        <li key={scope} className="text-xs text-cs-text-2">
                          {SCOPE_LABELS[scope] ?? scope}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {confirmId === connection.id ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => disconnect(connection.id)}
                        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="rounded-md border border-cs-border-strong px-2.5 py-1 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(connection.id)}
                      className="shrink-0 rounded-md border border-cs-border-strong px-2.5 py-1 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {connections !== null && connections.length > 0 && (
          <p className="mt-2 text-xs text-cs-muted">
            Disconnecting takes effect on the assistant&apos;s next request.
            Signing out everywhere disconnects all of them too.
          </p>
        )}
      </div>

      {/* What they actually read. Tool names and times only — nothing here
          records your figures, so this cannot show them. */}
      {activity.length > 0 && (
        <div className="mt-4 border-t border-cs-border pt-3">
          <button
            onClick={() => setShowActivity((open) => !open)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-xs font-medium text-cs-text">Recent activity</span>
            <span className="text-xs text-cs-muted">{showActivity ? 'Hide' : 'Show'}</span>
          </button>
          {showActivity && (
            <>
              <p className="mt-1 text-xs text-cs-muted">
                What each assistant asked for, and when. The times and the names
                of what was read — never your figures, which are not recorded.
              </p>
              <ul className="mt-1.5 space-y-1">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-cs-text-2">
                      <span className="text-cs-muted">{entry.client_name}</span>{' '}
                      {describe(entry)}
                    </span>
                    <span className="shrink-0 text-cs-muted">{formatWhen(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
