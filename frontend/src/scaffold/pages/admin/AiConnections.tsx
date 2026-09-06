import { useEffect, useState } from 'react'
import { api, type McpHost, type McpSettings } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'

/**
 * Which AI assistants may connect, and whether any may.
 *
 * This was two environment variables, which made "stop accepting connections
 * from ChatGPT" a redeploy. It is policy rather than deployment configuration,
 * so it belongs here — and an admin toggle is the version of "just change it on
 * the server" that survives the next deploy.
 *
 * Hosts are grouped by label because Claude is two hostnames and an admin
 * should see one thing to switch off, not two.
 */
export function AiConnections({ onError }: { onError: (message: string) => void }) {
  const [settings, setSettings] = useState<McpSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')

  useEffect(() => {
    api.adminGetMcp().then(setSettings).catch(() => onError('Failed to load AI connection settings'))
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
  const groups = new Map<string, McpHost[]>()
  for (const entry of hosts) {
    groups.set(entry.label, [...(groups.get(entry.label) ?? []), entry])
  }

  return (
    <AdminSection title={<>AI Connections</>}>
      <p className="mt-1 text-xs text-cs-muted">
        Lets people connect ChatGPT or Claude to their own account, read-only.
        {typeof settings?.connections === 'number'
          ? ` ${settings.connections} connection${settings.connections === 1 ? '' : 's'} active.`
          : ''}
      </p>

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

      <hr className="my-4 border-cs-line" />

      <p className="text-xs font-medium text-cs-text">Providers</p>
      <p className="mt-0.5 text-xs text-cs-muted">
        Only these can be authorized. Switching one off blocks new connections and
        ends existing ones within the hour.
      </p>

      {settings && hosts.length === 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          No providers listed, so nobody can connect. Add one below.
        </p>
      )}

      <ul className="mt-2 divide-y divide-cs-line">
        {[...groups.entries()].map(([groupLabel, entries]) => (
          <li key={groupLabel} className="py-2">
            <p className="text-xs font-medium text-cs-text">{groupLabel}</p>
            {entries.map((entry) => (
              <div key={entry.id} className="mt-1 flex items-center justify-between gap-3">
                <code className={`font-mono text-xs ${entry.enabled ? 'text-cs-text-2' : 'text-cs-muted line-through'}`}>
                  {entry.host}
                </code>
                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.adminToggleMcpHost(entry.id, !entry.enabled), 'Failed to change the provider')}
                    className="rounded-md border border-cs-line px-2 py-1 text-xs text-cs-text hover:bg-cs-hover disabled:opacity-50"
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
            const next = await api.adminAddMcpHost(label.trim(), host.trim())
            setLabel('')
            setHost('')
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
            className="w-28 rounded-md border border-cs-line bg-cs-base px-2 py-1 text-xs text-cs-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-cs-muted">Hostname</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="copilot.microsoft.com"
            className="w-52 rounded-md border border-cs-line bg-cs-base px-2 py-1 text-xs text-cs-text"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !label.trim() || !host.trim()}
          className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </AdminSection>
  )
}
