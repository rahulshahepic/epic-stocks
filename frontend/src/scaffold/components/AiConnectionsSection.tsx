import { useCallback, useEffect, useState } from 'react'
import { api, type AiActivityEntry, type AiConnection } from '../../api.ts'
import { Card } from './ui/Card.tsx'

/**
 * Connecting your own AI assistant, and cutting it off again.
 *
 * The instructions are most of this component, deliberately. Connecting is a
 * two-minute job in Claude and a slightly odd one in ChatGPT — the switch that
 * allows it is called "Developer mode" and lives under "Security and login",
 * which reads like something you are not supposed to touch. Saying that plainly
 * is what makes the difference between a feature people use and one they open
 * once.
 */

const SCOPE_LABELS: Record<string, string> = {
  'equity:read': 'Equity — grants, vesting, prices, loans, sales, tax',
  'comp:read': 'Salary and retirement settings',
}

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

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cs-raised text-[10px] font-semibold text-cs-text-2">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

export function AiConnectionsSection() {
  const [connections, setConnections] = useState<AiConnection[] | null>(null)
  const [activity, setActivity] = useState<AiActivityEntry[]>([])
  const [showActivity, setShowActivity] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [guide, setGuide] = useState<'chatgpt' | 'claude'>('claude')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const serverUrl = `${window.location.origin}/mcp`

  const load = useCallback(() => {
    api.getAiConnections()
      .then(setConnections)
      .catch(() => setError('Could not load your AI connections'))
    // Best-effort: the activity list is useful context, not a reason to fail
    // the whole section if it cannot be fetched.
    api.getAiActivity().then(setActivity).catch(() => setActivity([]))
  }, [])

  useEffect(load, [load])

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(serverUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the address and copy it by hand')
    }
  }

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
    <Card as="section" pad="md">
      <h3 className="text-sm font-medium text-cs-text">AI Connections</h3>
      <p className="mt-1 text-xs text-cs-text-2">
        Let ChatGPT or Claude read your equity data, so you can ask about vesting
        and tax alongside the rest of your finances. Read-only — an assistant
        cannot change anything here — and you can disconnect at any time.
      </p>
      <p className="mt-1.5 text-xs text-cs-muted">
        Connecting means your figures are sent to OpenAI or Anthropic when the
        assistant asks for them. That is the same as pasting them into a chat,
        without the pasting.
      </p>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {/* The address to paste */}
      <div className="mt-3">
        <p className="text-xs font-medium text-cs-text">Your server address</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-cs-raised px-2 py-1.5 font-mono text-xs text-cs-text">
            {serverUrl}
          </code>
          <button
            onClick={copyUrl}
            className="shrink-0 rounded-md border border-cs-border-strong px-2.5 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Walkthroughs */}
      <div className="mt-4">
        <div className="flex gap-1.5" role="tablist">
          {(['claude', 'chatgpt'] as const).map((which) => (
            <button
              key={which}
              role="tab"
              aria-selected={guide === which}
              onClick={() => setGuide(which)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                guide === which
                  ? 'bg-cs-brand text-white'
                  : 'border border-cs-border-strong text-cs-text-2 hover:bg-cs-raised'
              }`}
            >
              {which === 'claude' ? 'Claude' : 'ChatGPT'}
            </button>
          ))}
        </div>

        {guide === 'claude' ? (
          <ol className="mt-2.5 space-y-1.5 text-xs text-cs-text-2">
            <Step n={1}>Open Claude → Settings → Connectors</Step>
            <Step n={2}>Click <strong className="font-medium text-cs-text">Add custom connector</strong></Step>
            <Step n={3}>Paste the address above</Step>
            <Step n={4}>Sign in here and approve</Step>
            <p className="pt-1 text-cs-muted">
              Needs a paid Claude plan. Works on web, desktop and mobile.
            </p>
          </ol>
        ) : (
          <ol className="mt-2.5 space-y-1.5 text-xs text-cs-text-2">
            <Step n={1}>
              Open ChatGPT <strong className="font-medium text-cs-text">on the web</strong> → Settings →{' '}
              <strong className="font-medium text-cs-text">Security and login</strong> → turn on{' '}
              <strong className="font-medium text-cs-text">Developer mode</strong>
            </Step>
            <Step n={2}>Go to Plugins and click <strong className="font-medium text-cs-text">+</strong></Step>
            <Step n={3}>Give it a name, then paste the address above as the endpoint</Step>
            <Step n={4}>Sign in here and approve</Step>
            <Step n={5}>Review the tools it found and create the connection</Step>
            <p className="pt-1 text-cs-muted">
              Developer mode sounds alarming and is not — it is just the switch
              that allows connectors outside OpenAI&apos;s own directory. Needs a
              paid plan, and the connector can only be <em>added</em> from a
              browser; it works everywhere once added. On a work account an
              admin may have to enable developer mode first.
            </p>
          </ol>
        )}

        <p className="mt-2 text-xs text-cs-muted">
          Once connected, name the assistant&apos;s connector when you ask a
          question — both do better when told which tool to use than when left to
          guess. Try &ldquo;what vests in the next six months?&rdquo;
        </p>
      </div>

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
                    <p className="text-xs font-medium text-cs-text">{connection.client_name}</p>
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
