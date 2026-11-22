import { useEffect, useState } from 'react'
import { api, type McpHost, type McpMatchType, type McpSettings, type McpUsageReport } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'

/**
 * Which AI assistants may connect, and whether any may.
 *
 * This was two environment variables, which made "stop accepting connections
 * from ChatGPT" a redeploy. It is policy rather than deployment configuration,
 * so it belongs here — and an admin toggle is the version of "just change it on
 * the server" that survives the next deploy.
 *
 * Redirect rules are grouped by label because Claude is two callbacks and an
 * admin should see one thing to switch off, not two. Refused redirect URIs are
 * listed so a new assistant can be allowed from what it actually sent.
 */

const MATCH_LABELS: Record<McpMatchType, string> = {
  exact: 'exact',
  prefix: 'prefix',
  host: 'any path on host',
  loopback: 'any port',
}
export function AiConnections({ onError }: { onError: (message: string) => void }) {
  const [settings, setSettings] = useState<McpSettings | null>(null)
  const [usage, setUsage] = useState<McpUsageReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [matchType, setMatchType] = useState<McpMatchType | ''>('')

  useEffect(() => {
    api.adminGetMcp().then(setSettings).catch(() => onError('Failed to load AI connection settings'))
    // Best-effort: usage is context, not a reason to lose the controls.
    api.adminGetMcpUsage()
      // Same defensiveness as the settings above: an unexpected shape should
      // cost this block, not the controls it sits under.
      .then((report) => setUsage(
        Array.isArray(report?.users) && Array.isArray(report?.tools) ? report : null,
      ))
      .catch(() => setUsage(null))
  }, [onError])

  async function run(action: () => Promise<McpSettings>, failure: string) {
    setBusy(true)
    try {
      setSettings(await action())
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : failure)
    } finally {
      setBusy(false)
    }
  }

  // Read defensively rather than trusting the shape: this panel sits in the
  // middle of the admin page, and an unexpected response should cost its own
  // card, not every card below it.
  const hosts = Array.isArray(settings?.hosts) ? settings.hosts : []
  const rejected = Array.isArray(settings?.rejected) ? settings.rejected : []
  const requests = Array.isArray(settings?.requests) ? settings.requests : []
  const history = Array.isArray(settings?.request_history) ? settings.request_history : []
  const groups = new Map<string, McpHost[]>()
  for (const entry of hosts) {
    groups.set(entry.label, [...(groups.get(entry.label) ?? []), entry])
  }

  return (
    <AdminSection title={<>AI Connections</>}>
      <p className="mt-1 text-xs text-cs-muted">
        Lets people connect Claude, ChatGPT, Gemini and other assistants to their account or site diagnostics.
        {typeof settings?.connections === 'number'
          ? ` ${settings.connections} connection${settings.connections === 1 ? '' : 's'} active.`
          : ''}
      </p>

      <div className="mt-3 rounded-md border border-cs-border bg-cs-raised p-3 text-xs">
        <p className="font-medium text-cs-text">Admin MCP</p>
        <p className="mt-1 text-cs-muted">Download for this site, upload the ZIP in ChatGPT or Claude, then sign in as an admin. It contains diagnostics only; the account-data plugin is separate in Settings.</p>
        <a href="/api/admin/ai/plugin"
          className="mt-3 inline-block rounded-md border border-cs-border-strong px-2.5 py-2 font-medium text-cs-text hover:bg-cs-base">
          Download admin MCP
        </a>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-cs-text">Allow AI connections</p>
          <p className="text-xs text-cs-muted">
            Off, nobody can connect and existing connections stop working. It is a
            pause, not a disconnect — turning it back on restores them.
          </p>
        </div>
        <button
          disabled={settings === null || busy}
          onClick={() => run(() => api.adminSetMcpEnabled(!settings!.enabled), 'Failed to change the setting')}
          className={`ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
            settings?.enabled ? 'bg-green-600 hover:bg-green-700' : 'bg-cs-brand hover:bg-cs-brand-hover'
          }`}
        >
          {settings === null ? 'Loading' : busy ? '…' : settings.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <hr className="my-4 border-cs-border" />

      <p className="text-xs font-medium text-cs-text">Providers</p>
      <p className="mt-0.5 text-xs text-cs-muted">
        The redirect addresses an assistant may register. Switching a provider&apos;s
        rules off blocks new connections and ends existing ones within the hour.
      </p>

      {settings && hosts.length === 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          No providers listed, so nobody can connect. Add one below.
        </p>
      )}

      <ul className="mt-2 divide-y divide-cs-border">
        {[...groups.entries()].map(([groupLabel, entries]) => (
          <li key={groupLabel} className="py-2">
            <p className="text-xs font-medium text-cs-text">{groupLabel}</p>
            {entries.map((entry) => (
              <div key={entry.id} className="mt-1 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <code className={`break-all font-mono text-xs ${entry.enabled ? 'text-cs-text-2' : 'text-cs-muted line-through'}`}>
                    {entry.pattern}
                  </code>
                  <span className="ml-1.5 text-[10px] text-cs-muted">{MATCH_LABELS[entry.match_type] ?? entry.match_type}</span>
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminToggleMcpHost(entry.id, !entry.enabled), 'Failed to change the provider')}
                    className="rounded-md border border-cs-border px-2 py-1 text-xs text-cs-text hover:bg-cs-raised disabled:opacity-50"
                  >
                    {entry.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminDeleteMcpHost(entry.id), 'Failed to remove the provider')}
                    className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/30"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!label.trim() || !host.trim()) return
          void run(async () => {
            const next = await api.adminAddMcpHost(label.trim(), host.trim(), matchType || undefined)
            setLabel('')
            setHost('')
            setMatchType('')
            return next
          }, 'Failed to add the provider')
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-cs-muted">Name</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Copilot"
            className="w-28 rounded-md border border-cs-border bg-cs-base px-2 py-1 text-xs text-cs-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-cs-muted">Callback URL or hostname</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="https://copilot.microsoft.com/oauth/callback"
            className="w-72 max-w-full rounded-md border border-cs-border bg-cs-base px-2 py-1 text-xs text-cs-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-cs-muted">Match</span>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as McpMatchType | '')}
            className="rounded-md border border-cs-border bg-cs-base px-2 py-1 text-xs text-cs-text"
          >
            <option value="">Auto (URL exact, else host)</option>
            <option value="exact">Exact URL</option>
            <option value="prefix">URL prefix</option>
            <option value="host">Any path on host</option>
            <option value="loopback">Loopback, any port</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !label.trim() || !host.trim()}
          className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {requests.length > 0 && (
        <>
          <hr className="my-4 border-cs-border" />
          <h4 className="text-xs font-medium text-cs-text">
            Requests from AI assistants <span className="text-cs-muted">({requests.length} waiting)</span>
          </h4>
          <p className="mt-0.5 text-xs text-cs-muted">
            Changes an admin&apos;s assistant asked for that widen access or change what everyone sees.
            Nothing changes until you approve here or give the assistant the code sent to your devices.
            Approve only what you asked for yourself.
          </p>
          <ul className="mt-2 space-y-2" aria-label="Pending requests from AI assistants">
            {requests.map((entry) => (
              <li key={entry.id} className="rounded-md border border-cs-border p-2.5">
                <p className="text-xs font-medium text-cs-text">
                  {REQUEST_TITLES[entry.action] ?? entry.description}
                </p>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                  {entry.label && (<><dt className="text-cs-muted">Name</dt><dd className="text-cs-text">{entry.label}</dd></>)}
                  {entry.match_type && (<><dt className="text-cs-muted">Match</dt><dd className="text-cs-text">{MATCH_LABELS[entry.match_type as McpMatchType] ?? entry.match_type}</dd></>)}
                  {entry.pattern && (<><dt className="text-cs-muted">Address</dt><dd><code className="break-all font-mono text-cs-text">{entry.pattern}</code></dd></>)}
                </dl>
                {entry.consequence && <p className="mt-1.5 text-xs text-cs-text-2">{entry.consequence}</p>}
                {entry.reason && (
                  <figure className="mt-1.5 rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-1 dark:border-amber-500/50 dark:bg-amber-500/10">
                    <figcaption className="text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      Assistant&apos;s note — unverified
                    </figcaption>
                    <blockquote className="break-words text-xs text-cs-text-2">{entry.reason}</blockquote>
                  </figure>
                )}
                <p className="mt-1.5 text-xs text-cs-muted">
                  From {entry.client_name ?? 'an assistant'}{entry.client_name ? ' (name chosen by the app)' : ''}
                  {entry.requested_at ? ` · ${new Date(entry.requested_at).toLocaleString()}` : ''}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminDecideMcpRequest(entry.id, true), 'Failed to approve')}
                    aria-label={`Approve: ${entry.description}`}
                    className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminDecideMcpRequest(entry.id, false), 'Failed to reject')}
                    aria-label={`Reject: ${entry.description}`}
                    className="rounded-md border border-cs-border px-3 py-1.5 text-xs text-cs-text hover:bg-cs-raised disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-cs-muted">Recent request decisions ({history.length})</summary>
          <ul className="mt-1 divide-y divide-cs-border">
            {history.map((entry) => (
              <li key={entry.id} className="py-1.5 text-xs">
                <p className="break-all text-cs-text-2">{entry.description}</p>
                <p className="text-cs-muted">
                  {entry.status}{entry.decided_by ? ` by ${entry.decided_by}` : ''}
                  {entry.decided_at ? ` · ${new Date(entry.decided_at).toLocaleString()}` : ''}
                  {entry.outcome ? ` — ${entry.outcome}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {rejected.length > 0 && (
        <>
          <hr className="my-4 border-cs-border" />
          <p className="text-xs font-medium text-cs-text">Refused redirect addresses</p>
          <p className="mt-0.5 text-xs text-cs-muted">
            Assistants that tried to register and were turned away. Allow one only
            if you recognise the provider — the address is where sign-in codes go.
          </p>
          <ul className="mt-2 divide-y divide-cs-border">
            {rejected.map((entry) => (
              <li key={entry.id} className="py-2">
                <code className="block break-all font-mono text-xs text-cs-text-2">{entry.redirect_uri}</code>
                <p className="mt-0.5 text-xs text-cs-muted">
                  {entry.client_name ?? 'Unnamed client'} · {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
                  {entry.last_seen ? ` · last ${new Date(entry.last_seen).toLocaleDateString()}` : ''}
                </p>
                <div className="mt-1 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => run(
                      // Labelled by its host, never by the client's self-chosen
                      // name: a registrant calling itself "Claude" must not land
                      // in Claude's group.
                      () => api.adminAddMcpHost(hostLabel(entry.redirect_uri), entry.redirect_uri, 'exact'),
                      'Failed to allow that address',
                    )}
                    className="rounded-md border border-cs-border px-2 py-1 text-xs text-cs-text hover:bg-cs-raised disabled:opacity-50"
                  >
                    Allow exactly
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => { setLabel(hostLabel(entry.redirect_uri)); setHost(entry.redirect_uri); setMatchType('prefix') }}
                    className="rounded-md border border-cs-border px-2 py-1 text-xs text-cs-text hover:bg-cs-raised disabled:opacity-50"
                  >
                    Edit as rule
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminDismissRejectedRedirect(entry.id), 'Failed to dismiss')}
                    className="rounded-md px-2 py-1 text-xs text-cs-muted hover:bg-cs-raised disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {usage && (
        <>
          <hr className="my-4 border-cs-border" />
          <p className="text-xs font-medium text-cs-text">Usage</p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Calls 24h" value={usage.calls_24h} />
            <Stat label="Calls 7d" value={usage.calls_7d} />
            <Stat label="Calls 30d" value={usage.calls_30d} />
            <Stat label="Audit rows" value={usage.audit_rows} />
          </div>
          {(usage.errors_7d > 0 || usage.denied_7d > 0) && (
            <p className="mt-1.5 text-xs text-cs-muted">
              Last 7 days: {usage.errors_7d} failed, {usage.denied_7d} refused for
              missing permission.
            </p>
          )}

          {usage.users.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-cs-muted">
                  <tr>
                    <th className="pb-1 pr-3 font-medium">Account</th>
                    <th className="pb-1 pr-3 font-medium">Assistants</th>
                    <th className="pb-1 pr-3 font-medium">Last used</th>
                    <th className="pb-1 pr-3 text-right font-medium">7d</th>
                    <th className="pb-1 text-right font-medium">30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cs-border">
                  {usage.users.map((person) => (
                    <tr key={person.user_id}>
                      <td className="py-1 pr-3 text-cs-text">{person.email}</td>
                      <td className="py-1 pr-3 text-cs-text-2">
                        {person.clients.length > 0 ? person.clients.join(', ') : '—'}
                        {person.connections === 0 && (
                          <span className="text-cs-muted"> (disconnected)</span>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-cs-muted">
                        {person.last_used_at
                          ? new Date(person.last_used_at).toLocaleDateString()
                          : 'never'}
                      </td>
                      <td className="py-1 pr-3 text-right text-cs-text-2">{person.calls_7d}</td>
                      <td className="py-1 text-right text-cs-text-2">{person.calls_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {usage.tools.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-cs-muted">Most used tools (30 days)</p>
              <ul className="mt-1 space-y-0.5">
                {usage.tools.slice(0, 8).map((tool) => (
                  <li key={tool.tool} className="flex justify-between text-xs">
                    <code className="font-mono text-cs-text-2">{tool.tool}</code>
                    <span className="text-cs-muted">{tool.calls_30d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </AdminSection>
  )
}

const REQUEST_TITLES: Record<string, string> = {
  add_redirect_rule: 'Allow a new redirect address',
  enable_redirect_rule: 'Switch a redirect rule back on',
  unblock_email: 'Unblock an address',
  unblock_invite_sending: 'Let an account send invitations again',
  end_maintenance: 'End maintenance mode',
  set_flexible_payoff: 'Change flexible loan payoff',
  grant_content_admin: 'Make an account a content admin',
}

function hostLabel(uri: string): string {
  try {
    return new URL(uri).hostname.slice(0, 60) || 'Unlabelled'
  } catch {
    return 'Unlabelled'
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-cs-raised px-2 py-1.5">
      <p className="text-xs text-cs-muted">{label}</p>
      <p className="text-sm font-semibold text-cs-text">{value.toLocaleString()}</p>
    </div>
  )
}
