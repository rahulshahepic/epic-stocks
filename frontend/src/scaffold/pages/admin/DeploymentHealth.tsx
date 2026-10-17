import { useCallback, useEffect, useState } from 'react'
import { api, type DeploymentStatus } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'

const LABELS: Record<DeploymentStatus['state'], string> = {
  healthy: 'Jobs current',
  running: 'Job run in progress',
  pending: 'Jobs due; waiting for completion',
  failed: 'Job failed; retrying',
  stale: 'No recent job check',
}

const JOB_NAMES: Record<string, string> = {
  maintenance: 'Maintenance',
  notifications: 'Notifications',
  admin_digest: 'Admin digest',
}

function localTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never'
}

export function DeploymentHealth() {
  const [status, setStatus] = useState<DeploymentStatus | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.adminDeploymentStatus())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const webBuild = import.meta.env.VITE_COMMIT_SHA
  const mismatch = status?.build && webBuild && webBuild !== 'dev' && status.build !== 'dev'
    && status.build !== webBuild
  const healthy = status?.state === 'healthy' && !mismatch
  const urgent = mismatch || status?.state === 'failed' || status?.state === 'stale'
  const todayUtc = new Date().toISOString().slice(0, 10)

  return (
    <AdminSection title={<>Deployment</>} action={
      <button type="button" onClick={() => { void refresh() }}
        className="rounded px-2 py-1 text-xs font-medium text-cs-brand hover:underline"
        aria-label="Refresh deployment status">Refresh</button>
    }>
      {loading && <p className="mt-3 text-sm text-cs-muted">Checking deployment…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
        Deployment status is unavailable. Try Refresh.
      </p>}
      {status && !error && <div className="mt-3 space-y-3 text-sm">
        <p role="status" className={`rounded-md px-3 py-2 font-medium ${healthy
          ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
          : urgent ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
            : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
          {mismatch ? 'Web and API builds differ' : LABELS[status.state]}
        </p>
        <div className="grid grid-cols-1 gap-1 text-xs text-cs-text-2 sm:grid-cols-2">
          <p>Web build: <span className="font-mono">{webBuild?.slice(0, 7) || 'dev'}</span></p>
          <p>API build: <span className="font-mono">{status.build?.slice(0, 7) || 'unknown'}</span></p>
          <p>Environment: {status.environment}</p>
          <p>Last job check: {localTime(status.last_checked_at)}</p>
        </div>
        <ul className="divide-y divide-cs-border text-xs">
          {status.jobs.map(job => <li key={job.name} className="flex justify-between gap-3 py-2">
            <span className="font-medium text-cs-text">{JOB_NAMES[job.name] ?? job.name}
              <small className="block font-normal text-cs-muted">{job.due_utc} UTC</small>
            </span>
            <span className="text-right text-cs-text-2">
              {job.last_completed_day === todayUtc ? 'Done today' :
                job.last_completed_day ? `Last done ${job.last_completed_day}` : 'No completed run'}
              {job.last_result === 'failed' && <strong className="block text-red-700 dark:text-red-300">Failed last check</strong>}
            </span>
          </li>)}
        </ul>
        <p className="text-xs text-cs-muted">Jobs are checked every 15 minutes. Times shown in your timezone; job days use UTC.</p>
      </div>}
    </AdminSection>
  )
}
