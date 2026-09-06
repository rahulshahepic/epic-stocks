import { AdminSection } from './AdminSection.tsx'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../../api.ts'
import type { UserReportEntry } from '../../../api.ts'

/** What people told us went wrong. Never carries their figures — rule ids only. */
export function ReportsSection({ reports, onReportsChanged }: {
  reports: UserReportEntry[]
  onReportsChanged: Dispatch<SetStateAction<UserReportEntry[]>>
}) {
  const [expandedReport, setExpandedReport] = useState<number | null>(null)
  const [showResolvedReports, setShowResolvedReports] = useState(false)
  const newReportCount = reports.filter(r => r.status === 'new').length
  const visibleReports = showResolvedReports ? reports : reports.filter(r => r.status === 'new')

  return (
    <AdminSection
      title={(
        <>
          Problem Reports ({visibleReports.length})
          {newReportCount > 0 && (
            <span className="ml-2 rounded-full bg-cs-brand px-2 py-0.5 text-[10px] font-semibold text-white">
              {newReportCount} new
            </span>
          )}
        </>
      )}
      action={(
        <button
          onClick={() => setShowResolvedReports(v => !v)}
          className="text-xs text-cs-text-2 underline hover:text-cs-text"
        >
          {showResolvedReports ? 'Hide resolved' : 'Show resolved'}
        </button>
      )}
    >
      {visibleReports.length === 0 && (
        <p className="mt-3 text-xs text-cs-text-2">Nothing reported.</p>
      )}
      <div className="mt-3 space-y-2">
        {visibleReports.map(r => (
          <div
            key={r.id}
            className={`rounded-md border p-2 text-xs ${
              r.status === 'resolved' ? 'border-cs-border opacity-60' : 'border-cs-border-strong'}`}
          >
            <div
              className="flex cursor-pointer items-start justify-between gap-2"
              onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono font-medium text-cs-brand">{r.source}</span>
                {r.path && <span className="ml-2 text-cs-muted">{r.path}</span>}
                {r.error_ref && (
                  <span className="ml-2 font-mono text-cs-text-2">ref:{r.error_ref}</span>
                )}
                {!r.include_details && (
                  <span className="ml-2 text-cs-muted">anonymous</span>
                )}
                <p className="mt-0.5 whitespace-pre-wrap text-cs-text">{r.message}</p>
              </div>
              <span className="shrink-0 text-cs-text-2">
                {new Date(r.timestamp).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC
              </span>
            </div>

            {expandedReport === r.id && (
              <div className="mt-2 space-y-2">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-cs-text-2">
                  {r.email && (<><dt className="font-medium">Email</dt><dd>{r.email}</dd></>)}
                  {r.user_id != null && (<><dt className="font-medium">User</dt><dd>uid:{r.user_id}</dd></>)}
                  {r.app_version && (<><dt className="font-medium">Build</dt><dd className="font-mono">{r.app_version}</dd></>)}
                  {r.error_message && (<><dt className="font-medium">Shown</dt><dd>{r.error_message}</dd></>)}
                  {r.user_agent && (<><dt className="font-medium">Browser</dt><dd className="break-all">{r.user_agent}</dd></>)}
                </dl>
                {r.client_log && (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-cs-raised p-2 font-mono text-[10px] text-cs-text-2">
                    {r.client_log}
                  </pre>
                )}
                {r.error_traceback && (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-cs-raised p-2 font-mono text-[10px] text-cs-text-2">
                    {r.error_traceback}
                  </pre>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      const next = r.status === 'resolved' ? 'new' : 'resolved'
                      await api.adminSetReportStatus(r.id, next)
                      onReportsChanged(prev => prev.map(x => x.id === r.id ? { ...x, status: next } : x))
                    }}
                    className="text-xs text-cs-brand hover:underline"
                  >
                    {r.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
                  </button>
                  <button
                    onClick={async () => {
                      await api.adminDeleteReport(r.id)
                      onReportsChanged(prev => prev.filter(x => x.id !== r.id))
                    }}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </AdminSection>
  )
}
