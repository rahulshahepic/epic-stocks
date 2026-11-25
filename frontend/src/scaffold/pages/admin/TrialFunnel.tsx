import { useState } from 'react'
import { AdminSection } from './AdminSection.tsx'
import { api, type TrialFunnelReport } from '../../../api.ts'

const STAGES = [
  ['starts', 'Import attempts'], ['valid_files', 'Valid file results'],
  ['reconciled', 'No discrepancies'], ['usable_position', 'Usable previews shown'],
  ['source_checked_5min', 'Source-checked within five minutes'],
  ['save_intent', 'Chose to save'], ['authenticated', 'Signed in'],
  ['new_account', 'New accounts'], ['carryover', 'Confirmed saves'], ['reminder_enabled', 'Reminders enabled'],
] as const

export function TrialFunnel({ funnel }: { funnel: TrialFunnelReport }) {
  const [report, setReport] = useState(funnel.activation)
  const [pending, setPending] = useState<'pause' | 'resume' | 'cleanup' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function apply() {
    if (!pending) return
    setBusy(true); setError('')
    try {
      await api.adminOnboardingAction(pending)
      setReport(await api.adminOnboardingFunnel(report?.window_days ?? 30))
      setPending(null)
    } catch { setError('The measurement action failed. Refresh the report and try again.') }
    finally { setBusy(false) }
  }
  return <AdminSection title={<>Onboarding attempts</>}>
    {report ? <div className="space-y-3">
      <p className="text-xs text-cs-muted">Opted-in attempts over {report.window_days} days, grouped by UTC import-start day. Includes failures and abandonment. These are attempts, not unique people; recent cohorts can change for 24 hours.</p>
      <p className="text-xs font-medium text-cs-text">Collection {report.collection_paused ? 'paused' : 'available to users who opt in'} · {report.active_attempts.toLocaleString()} temporary keys · {report.expired_attempts.toLocaleString()} expired keys awaiting cleanup</p>
      <div className="space-y-2">
        {STAGES.map(([key, label]) => <div key={key}>
          <dl className="flex items-center justify-between gap-3 text-xs"><dt className="text-cs-text-2">{label}</dt><dd className="shrink-0 tabular-nums text-cs-text">{(report.totals[key] ?? 0).toLocaleString()}{key !== 'starts' && report.rates_per_attempt[key] != null ? ` · ${(report.rates_per_attempt[key]! * 100).toFixed(1)}% of attempts` : ''}</dd></dl>
          <div aria-hidden="true" className="mt-1 h-1.5 rounded bg-cs-raised"><div className="h-full rounded bg-rose-700" style={{width: `${Math.min(100, (key === 'starts' ? report.totals.starts ? 1 : 0 : report.rates_per_attempt[key] ?? 0) * 100)}%`}} /></div>
        </div>)}
      </div>
      <p className="text-xs text-cs-muted">Source-checked means matching supplied stock/loan totals without warnings or stale prices. It does not independently verify today’s holdings or accrued interest. A rendered preview alone never counts as source-checked. Confirmed saves require an actual successful write; sign-in alone does not count.</p>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {([
          ['retries', 'Analysis retries'], ['format_errors', 'File refusals'], ['reconciliation_errors', 'Reconciliation failures'],
          ['processing_errors', 'Processing failures'], ['carryover_errors', 'Save failures'],
          ['usable_le_60s', 'Usable within one minute'], ['usable_le_300s', 'Usable in one–five minutes'], ['usable_gt_300s', 'Usable after five minutes'],
        ] as const).map(([key, label]) => <div key={key}><dt className="text-cs-muted">{label}</dt><dd className="font-semibold text-cs-text">{(report.totals[key] ?? 0).toLocaleString()}</dd></div>)}
      </dl>
      <p className="text-xs text-cs-muted">Times start at the import click and use the server clock; document discovery is excluded. Retries keep the same denominator. Temporary linkage expires after {report.attempt_ttl_hours} hours and is removed on the next scheduled cleanup (normally within 15 minutes); aggregate cohorts expire after {report.aggregate_retention_days} days. {report.cleanup_last_at ? `Last cleanup: ${report.cleanup_last_at}.` : 'No scheduled cleanup recorded yet.'}</p>
      {report.last_measurement_failure_at && <p role="status" className="text-xs text-cs-text">Measurement writes failed at {report.last_measurement_failure_at}. Counts may be incomplete; investigate the measurement service.</p>}
      {report.actions.length > 0 && <ul className="list-inside list-disc text-xs text-cs-text-2">{report.actions.map(a => <li key={a.action}>{a.action.replaceAll('_', ' ')}{a.requires_approval ? ' — human approval required in the admin MCP' : ''}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => setPending(report.collection_paused ? 'resume' : 'pause')} className="rounded border border-cs-border-strong px-3 py-2 text-xs text-cs-text">{report.collection_paused ? 'Resume collection' : 'Pause collection'}</button>
        <button type="button" disabled={busy} onClick={() => setPending('cleanup')} className="rounded border border-cs-border-strong px-3 py-2 text-xs text-cs-text">Clean expired measurement state</button>
      </div>
      {pending && <div className="rounded border border-cs-border p-3 text-xs text-cs-text-2"><p>{pending === 'pause' ? 'Pause optional collection and remove temporary attempt keys? Existing aggregate counts stay.' : pending === 'resume' ? 'Resume collection for users who explicitly opt in? Individual opt-out and Do Not Track still apply.' : 'Remove expired attempt keys and aggregate rows past retention? Current cohorts stay.'}</p><div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => void apply()} className="rounded bg-rose-700 px-3 py-2 text-white">Confirm {pending}</button><button disabled={busy} onClick={() => setPending(null)} className="rounded border border-cs-border px-3 py-2">Cancel</button></div></div>}
      {error && <p role="alert" className="text-xs text-cs-text">{error}</p>}
      <details><summary className="cursor-pointer py-2 text-xs text-cs-text">Daily cohorts</summary><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead><tr>{['UTC start day', 'Path', 'Attempts', 'Usable', 'Source-checked ≤5m', 'Saved', 'Reminders'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{report.cohorts.map(c => <tr key={`${c.day}-${c.entrypoint}`} className="border-t border-cs-border"><td className="p-2">{c.day}{c.provisional ? ' (provisional)' : ''}</td><td>{c.entrypoint}</td>{['starts', 'usable_position', 'source_checked_5min', 'carryover', 'reminder_enabled'].map(k => <td key={k}>{c.counts[k] ?? 0}</td>)}</tr>)}</tbody></table></div></details>
    </div> : <p className="text-xs text-cs-muted">Attempt-based measurement is unavailable on this server.</p>}
    <details className="mt-3 text-xs text-cs-muted"><summary className="cursor-pointer py-2">Legacy request totals</summary><p>Computed previews: {(funnel.previews ?? 0).toLocaleString()} · Save clicks: {(funnel.save_clicked ?? 0).toLocaleString()} · Carryover reports: {(funnel.signups_from_trial ?? 0).toLocaleString()}. Retries can count again; these unlinked historical totals are not cohort conversion rates.</p></details>
  </AdminSection>
}
