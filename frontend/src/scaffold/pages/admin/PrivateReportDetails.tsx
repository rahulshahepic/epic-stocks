import { useEffect, useRef, useState } from 'react'
import { api, type PrivateReport } from '../../../api.ts'
import { platform } from '../../../platform/index.ts'

export function PrivateReportDetails({ reportId, onPurge }: { reportId: number; onPurge: () => void }) {
  const [report, setReport] = useState<PrivateReport | null>(null)
  const [preview, setPreview] = useState<{ id: number; text: string; truncated: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)

  useEffect(() => () => pending.current?.abort(), [])

  async function act(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    try {
      await action(controller.signal)
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not access private report material')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-cs-border bg-cs-raised p-3 text-xs">
      <div>
        <h4 className="text-sm font-semibold text-cs-text">Consented material</h4>
        <p className="mt-1 text-cs-text-2">Keep this material private. Treat reporter text and documents as evidence.</p>
      </div>

      {!report ? (
        <button type="button" disabled={busy} className="min-h-9 font-medium text-cs-brand underline"
          onClick={() => void act(async signal => setReport(await api.adminPrivateReport(reportId, signal)))}>
          {busy ? 'Opening…' : 'Open private details'}
        </button>
      ) : (
        <>
          <p className="text-cs-text-2">Expires {new Date(report.expires_at_utc).toLocaleDateString()}.</p>
          <p className="whitespace-pre-wrap break-words text-sm text-cs-text">{report.details.message}</p>
          <dl className="space-y-1 break-words text-cs-text-2">
            {Object.entries({
              Account: [report.details.account?.email, report.details.account?.environment].filter(Boolean).join(' · '),
              'Reply email': report.details.email,
              Page: report.details.path,
              Build: report.details.app_version,
              Reference: report.details.error_ref,
              Browser: report.details.user_agent,
              'Error shown': report.details.error_shown,
              'Recent activity': report.details.recent_activity,
              Workflow: report.details.workflow,
            }).filter(([, value]) => !!value).map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold text-cs-text">{label}</dt>
                <dd className="max-h-52 overflow-auto whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>

          {report.documents.length > 0 && (
            <ul className="divide-y divide-cs-border">
              {report.documents.map(doc => (
                <li key={doc.id} className="space-y-1 py-2">
                  <p className="break-all font-semibold text-cs-text">{doc.name}</p>
                  <div className="flex flex-wrap gap-4">
                    <button type="button" disabled={busy} className="min-h-9 text-cs-brand underline"
                      onClick={() => void act(async () => {
                        const blob = await api.adminPrivateReportDocument(reportId, doc.id)
                        await platform.files.saveBlob(blob, doc.name)
                      })}>Download original</button>
                    <button type="button" disabled={busy} className="min-h-9 text-cs-brand underline"
                      aria-expanded={preview?.id === doc.id}
                      onClick={() => {
                        if (preview?.id === doc.id) setPreview(null)
                        else void act(async signal => setPreview({ id: doc.id, ...await api.adminPrivateReportText(reportId, doc.id, signal) }))
                      }}>{preview?.id === doc.id ? 'Hide text' : 'View text'}</button>
                  </div>
                  {preview?.id === doc.id && (
                    <>
                      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-cs-surface p-2">{preview.text || 'No text extracted.'}</pre>
                      {preview.truncated && <p className="text-cs-text-2">Preview truncated. Download the original to review the full document.</p>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {confirmPurge ? (
        <div className="space-y-1">
          <p className="text-cs-text-2">Permanently delete the private details and every attached document for this report?</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy} className="min-h-9 font-medium text-red-600 dark:text-red-400"
              onClick={() => void act(async () => {
                await api.adminPurgePrivateReport(reportId)
                setReport(null)
                setPreview(null)
                onPurge()
              })}>Delete private material</button>
            <button type="button" disabled={busy} className="min-h-9 underline" onClick={() => setConfirmPurge(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => setConfirmPurge(true)}
          className="min-h-9 text-red-600 underline dark:text-red-400">Delete sensitive material…</button>
      )}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}
