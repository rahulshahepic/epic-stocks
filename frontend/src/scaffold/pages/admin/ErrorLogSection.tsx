import { AdminSection } from './AdminSection.tsx'
import { useState } from 'react'
import { api } from '../../../api.ts'
import type { ErrorLogEntry } from '../../../api.ts'

/** Recent 500s, newest first. Which row is expanded is this panel's business. */
export function ErrorLogSection({ errorLogs, onCleared }: {
  errorLogs: ErrorLogEntry[]
  onCleared: (logs: ErrorLogEntry[]) => void
}) {
  const [expandedError, setExpandedError] = useState<number | null>(null)
  return (
    <AdminSection
      title={(
        <>
          Error Logs ({errorLogs.length})
        </>
      )}
      action={errorLogs.length > 0 && (
        <button
          onClick={async () => { await api.adminClearErrors(); onCleared([]) }}
          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
        >
          Clear all
        </button>
      )}
    >
      {errorLogs.length === 0 && (
        <p className="mt-3 text-xs text-cs-text-2">No errors logged.</p>
      )}
      <div className="mt-3 space-y-2">
        {errorLogs.map(e => (
          <div key={e.id} className="rounded-md border border-cs-border p-2 text-xs ">
            <div
              className="flex cursor-pointer items-start justify-between"
              onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono font-medium text-red-600 dark:text-red-400">
                  {e.error_type}
                </span>
                <span className="ml-2 text-cs-muted">
                  {e.method} {e.path}
                </span>
                {e.user_id && (
                  <span className="ml-2 text-cs-text-2">uid:{e.user_id}</span>
                )}
                <p className="mt-0.5 truncate text-cs-text-2">{e.error_message}</p>
              </div>
              <span className="ml-2 shrink-0 text-cs-text-2">
                {new Date(e.timestamp).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC
              </span>
            </div>
            {expandedError === e.id && e.traceback && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-cs-raised p-2 font-mono text-[10px] text-cs-text-2 ">
                {e.traceback}
              </pre>
            )}
          </div>
        ))}
      </div>
    </AdminSection>
  )
}
