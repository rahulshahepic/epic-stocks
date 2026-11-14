import { useCallback, useEffect, useState } from 'react'
import { api, type BackupSettings, type BackupStatus } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'
import { formatLocalTime } from './deploymentTime.ts'

const LABELS: Record<BackupStatus['state'], string> = {
  disabled: 'Backups are turned off', unconfigured: 'Backup setup is incomplete',
  unavailable: 'No recent backup status from the host', invalid_settings: 'Backup settings need repair',
  pending: 'Settings saved; waiting for the host', running: 'Backup in progress',
  failed: 'The last backup attempt failed', succeeded: 'Last backup uploaded successfully',
  overdue: 'Backup overdue — no successful upload in 26 hours',
}
const INPUT = 'min-h-11 w-full rounded-md border border-cs-border-strong bg-cs-base px-3 py-2 text-sm text-cs-text'
const BUTTON = 'min-h-11 rounded-md border border-cs-border-strong px-3 py-2 text-sm font-medium text-cs-text hover:bg-cs-raised disabled:opacity-50'

function time(value: string | null | undefined) {
  return value ? formatLocalTime(value) : 'Not available'
}

function bytes(value: number | null | undefined) {
  if (value == null) return 'Not available'
  return value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`
}

function age(value: string | null | undefined) {
  if (!value) return 'No successful upload recorded'
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000))
  return minutes < 60 ? `${minutes} minutes ago` : `${(minutes / 60).toFixed(1)} hours ago`
}

export function Backups() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<BackupSettings | null>(null)
  const [editRevision, setEditRevision] = useState<string | null>(null)
  const [restoreRun, setRestoreRun] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.adminBackupStatus()
      if (!next?.settings || typeof next.controls_available !== 'boolean' || !(next.state in LABELS)) {
        throw new Error('Backup status is unavailable')
      }
      setStatus(next)
      setError('')
    } catch {
      setStatus(null)
      setError('Backup status could not be refreshed. Try again; an old result is not evidence of a current backup.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup action failed')
    } finally {
      setBusy(false)
    }
  }

  const backup = status?.backup
  const run = backup?.last_success_run
  const success = status?.state === 'succeeded'
  const urgent = status?.state === 'failed' || status?.state === 'overdue' || status?.state === 'invalid_settings'

  return (
    <AdminSection title={<>Backups</>} action={
      <button type="button" className={BUTTON} disabled={busy} onClick={() => { void refresh() }} aria-label="Refresh backup status">Refresh</button>
    }>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-cs-text">{notice}</p>}
      {!status && !error && <p className="mt-3 text-sm text-cs-muted">Checking backups…</p>}
      {status && <div className="mt-3 space-y-4 text-sm">
        <p role="status" className={`rounded-md px-3 py-2 font-medium ${success
          ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
          : urgent ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
            : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
          {LABELS[status.state]}
        </p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ['Last attempt', time(backup?.last_attempt_utc)],
            ['Last successful upload', time(backup?.last_success_utc)],
            ['Age of last successful backup', age(backup?.last_success_utc)],
            ['Encrypted database size', bytes(backup?.database_encrypted_bytes)],
            ['Encrypted secrets archive size', bytes(backup?.secrets_encrypted_bytes)],
            ['Last successful duration', backup?.last_success_duration_seconds == null ? 'Not available' : `${backup.last_success_duration_seconds.toFixed(1)} seconds`],
            ['R2 credentials', backup?.credentials_configured === true ? 'Configured on the host' : backup?.credentials_configured === false ? 'Missing on the host' : 'Host has not reported credentials yet'],
            ['Host status collected', time(status.collected_at_utc)],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-cs-muted">{label}</dt><dd className="mt-0.5 break-words text-cs-text">{value}</dd></div>)}
        </dl>
        {backup?.error && <p role="alert" className="text-red-700 dark:text-red-300">{backup.error}</p>}
        {backup?.prune_error && <p role="alert" className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Retention cleanup failed: {backup.prune_error} The uploaded backup remains valid, but old backups may be accumulating.
        </p>}
        <div className="rounded-md border border-cs-border p-3">
          <p className="font-medium text-cs-text">Destination and schedule</p>
          <p className="mt-1 break-all text-cs-text-2">{status.settings.bucket || 'No bucket configured'} · {status.environment}</p>
          <p className="mt-1 text-xs text-cs-muted">Nightly at 03:17–03:37 UTC. Keep {status.settings.retention_days} days, with at least 7 complete backups.</p>
          <p className="mt-1 text-xs text-cs-muted">Settings source: {status.settings_source === 'admin' ? 'Admin; changes apply without redeploying' : 'Deployment defaults; saving here takes precedence'}.</p>
          {!status.controls_available && <p className="mt-2 text-amber-800 dark:text-amber-200">Host backup controls are unavailable. Deploy the backup handoff before changing settings.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={busy || !status.controls_available}
              onClick={() => { setDraft({ ...status.settings }); setEditRevision(status.revision); setNotice('') }}>Configure backups</button>
            <button type="button" className={BUTTON}
              disabled={busy || !status.controls_available || !status.settings.enabled || backup?.credentials_configured !== true || status.state === 'running' || status.state === 'pending'}
              onClick={() => { void perform(async () => { await api.adminRunBackup(); setNotice('Backup requested. Refresh to see the host result; a request is not a completed backup.'); await refresh() }) }}>Back up now</button>
          </div>
        </div>
        {draft && <form className="space-y-3 rounded-md border border-cs-border p-3" onSubmit={e => {
          e.preventDefault()
          void perform(async () => {
            const next = await api.adminSaveBackupSettings({ ...draft, account_id: draft.account_id.trim().toLowerCase(), bucket: draft.bucket.trim(), recipient: draft.recipient.trim() }, editRevision)
            setStatus(next)
            setDraft(null)
            setNotice('Settings saved. The host will apply them and report its result shortly. An active backup may finish first.')
          })
        }}>
          <h3 className="font-medium text-cs-text">Backup settings</h3>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Enable nightly backups</label>
          <label className="block space-y-1"><span>Cloudflare account ID</span><input className={INPUT} autoComplete="off" spellCheck={false} maxLength={32} required={draft.enabled} value={draft.account_id} onChange={e => setDraft({ ...draft, account_id: e.target.value })} /></label>
          <label className="block space-y-1"><span>R2 bucket</span><input className={INPUT} autoComplete="off" spellCheck={false} maxLength={63} required={draft.enabled} value={draft.bucket} onChange={e => setDraft({ ...draft, bucket: e.target.value })} /></label>
          <label className="block space-y-1"><span>Public encryption key</span><input className={INPUT} autoComplete="off" spellCheck={false} maxLength={62} required={draft.enabled} placeholder="age1…" value={draft.recipient} onChange={e => setDraft({ ...draft, recipient: e.target.value })} /></label>
          <label className="block space-y-1"><span>Retention in days</span><input className={INPUT} type="number" min={1} max={3650} required value={draft.retention_days} onChange={e => setDraft({ ...draft, retention_days: Number(e.target.value) })} /></label>
          <p className="text-xs text-cs-muted">R2 credentials stay in the environment’s GitHub secrets: BACKUP_ACCESS_KEY_ID and BACKUP_SECRET_ACCESS_KEY. Add or replace them there, then redeploy. Keep the private decryption key in your password manager.</p>
          <div className="flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} type="submit">{busy ? 'Saving…' : 'Save backup settings'}</button><button className={BUTTON} disabled={busy} type="button" onClick={() => setDraft(null)}>Cancel</button></div>
        </form>}
        <div className="rounded-md border border-cs-border p-3">
          <p className="font-medium text-cs-text">Restore testing</p>
          <p className="mt-1 text-cs-text-2">{status.restore_test
            ? `Successful test restore recorded by an admin on ${time(status.restore_test.tested_at_utc)} for ${status.restore_test.run_id}.`
            : 'No successful test restore recorded for this destination and encryption key.'}</p>
          <p className="mt-1 text-xs text-cs-muted">Upload success does not prove a backup can be restored. Follow the test-restore instructions in the operations guide, then record the result here.</p>
          {run && status.controls_available && <details className="mt-3">
            <summary className="cursor-pointer py-2 font-medium text-cs-text">Record a successful test restore</summary>
            <label className="mt-2 flex items-start gap-2 break-words text-xs"><input className="mt-1 shrink-0" type="checkbox" checked={restoreRun === run} onChange={e => setRestoreRun(e.target.checked ? run : null)} /><span>I successfully decrypted and restored backup {run} into a separate test database.</span></label>
            <button type="button" className={`${BUTTON} mt-3`} disabled={busy || restoreRun !== run || status.state === 'pending'}
              onClick={() => { void perform(async () => { setStatus(await api.adminRecordRestoreTest(run)); setRestoreRun(null); setNotice('Test restore recorded as an admin confirmation.') }) }}>Record test restore</button>
          </details>}
        </div>
      </div>}
    </AdminSection>
  )
}
