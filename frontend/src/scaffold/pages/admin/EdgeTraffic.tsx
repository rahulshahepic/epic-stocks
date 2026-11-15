import { useCallback, useEffect, useState } from 'react'
import { api, type EdgeSummary } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'
import { formatLocalTime } from './deploymentTime.ts'

const REASONS: Record<NonNullable<EdgeSummary['reason']>, string> = {
  not_configured: 'Not configured. Set DIAGNOSTICS_CF_ZONE_ID (variable) and DIAGNOSTICS_CF_API_TOKEN (secret) for this environment, then redeploy.',
  denied: 'Cloudflare refused the token. Check it is an Analytics Read token for this zone.',
  rejected: 'Cloudflare rejected the query. Check the zone ID, the token’s zone access and that the plan includes firewall analytics.',
  provider_error: 'Cloudflare could not be reached. Try Refresh in a few minutes.',
}

const ACTIONS: Record<string, string> = {
  block: 'Blocked',
  managed_challenge: 'Managed challenge',
  managedChallenge: 'Managed challenge',
  challenge: 'Challenge',
  jschallenge: 'JS challenge',
  skip: 'Skipped',
  allow: 'Allowed',
  log: 'Logged',
  bypass: 'Bypassed',
}

export function EdgeTraffic() {
  const [summary, setSummary] = useState<EdgeSummary | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await api.adminEdgeSummary())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const records = summary?.records ?? []
  const total = records.reduce((sum, row) => sum + row.count, 0)

  return (
    <AdminSection title={<>Cloudflare edge</>} action={
      <button type="button" onClick={() => { void refresh() }}
        className="rounded px-2 py-1 text-xs font-medium text-cs-brand hover:underline"
        aria-label="Refresh Cloudflare edge summary">Refresh</button>
    }>
      {loading && !summary && <p className="mt-3 text-sm text-cs-muted">Checking Cloudflare…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
        Edge summary could not be loaded. Try Refresh.
      </p>}
      {summary && !error && summary.state !== 'available' && <p
        className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {REASONS[summary.reason ?? 'provider_error']}
      </p>}
      {summary && !error && summary.state === 'available' && <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs text-cs-text-2">
          Firewall actions, {summary.window_start_utc && formatLocalTime(summary.window_start_utc)} – {summary.window_end_utc && formatLocalTime(summary.window_end_utc)}
        </p>
        {records.length === 0
          ? <p className="text-cs-text-2">No firewall actions in the last 30 minutes.</p>
          : <ul className="divide-y divide-cs-border text-xs">
            {records.map(row => <li key={row.action} className="flex justify-between py-2">
              <span className="text-cs-text">{ACTIONS[row.action] ?? row.action}</span>
              <span className="font-mono text-cs-text-2">{row.count.toLocaleString()}</span>
            </li>)}
            <li className="flex justify-between py-2 font-medium">
              <span className="text-cs-text">Total</span>
              <span className="font-mono text-cs-text">{total.toLocaleString()}</span>
            </li>
          </ul>}
        {summary.record_limit_reached && <p className="text-xs text-amber-800 dark:text-amber-200">Showing the first 20 action groups.</p>}
      </div>}
      {summary && !error && <p className="mt-3 text-xs text-cs-muted">
        Sampled counts for this hostname over 30 minutes, ending two minutes ago; refreshed at most every two minutes. No IPs or URLs are read. Low counts don’t prove the site is up.
      </p>}
    </AdminSection>
  )
}
