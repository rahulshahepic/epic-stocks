import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isLoggedIn, submitReport } from '../../api.ts'
import { useScrollLock } from '../hooks/useScrollLock.ts'
import type { ReportSource } from '../../api.ts'
import { getClientLog, getLastErrorRef, logRoute, resetReportLog, scrubPath } from '../reportLog.ts'
import { ReportContext, useReportProblem, type ReportPrefill } from './reportContext.ts'

const APP_VERSION = (import.meta.env.VITE_COMMIT_SHA as string | undefined) ?? 'dev'

/**
 * The report form. A plain component, not bound to the provider, so the crash
 * screen can render it after the app around it has already fallen over.
 */
export function ReportDialog({
  prefill = {},
  onClose,
}: {
  prefill?: ReportPrefill
  onClose: () => void
}) {
  const [message, setMessage] = useState(prefill.message ?? '')
  const [email, setEmail] = useState('')
  const [includeDetails, setIncludeDetails] = useState(false)
  const [showPayload, setShowPayload] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentRef, setSentRef] = useState<string | null | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const errorRef = prefill.errorRef ?? getLastErrorRef()
  const signedIn = isLoggedIn()

  // Without this the page scrolls under the dialog on touch.
  useScrollLock()

  useEffect(() => {
    textareaRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send() {
    if (!message.trim()) {
      setError('Tell us what went wrong first.')
      return
    }
    setSending(true)
    setError('')
    try {
      const resp = await submitReport({
        message: message.trim(),
        path: prefill.path ?? scrubPath(window.location.pathname),
        source: prefill.source ?? 'manual',
        error_ref: errorRef,
        error_message: prefill.errorMessage ?? null,
        include_details: includeDetails,
        email: email.trim() || null,
        app_version: APP_VERSION,
        // Only gathered when the box is ticked — the server drops these anyway,
        // but they should not leave the device in the first place.
        user_agent: includeDetails ? navigator.userAgent : null,
        client_log: includeDetails ? getClientLog() : null,
      })
      resetReportLog()
      setSentRef(resp.error_ref)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that report')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Report a problem"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-cs-surface p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cs-text">Report a problem</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-cs-text-2 hover:text-cs-text">✕</button>
        </div>

        {sentRef !== undefined ? (
          <div>
            <p className="text-sm text-cs-text">Thanks — that went straight to the maintainer.</p>
            {(sentRef ?? errorRef) && (
              <p className="mt-2 text-xs text-cs-text-2">
                Reference <span className="font-mono font-semibold">{sentRef ?? errorRef}</span>
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-cs-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-cs-brand-hover"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {(prefill.errorMessage || errorRef) && (
              <div className="mb-3 rounded-lg border border-cs-border bg-cs-raised p-2.5 text-xs">
                {prefill.errorMessage && (
                  <p className="text-cs-text-2">
                    <span className="font-medium text-cs-text">The app said:</span> {prefill.errorMessage}
                  </p>
                )}
                {errorRef && (
                  <p className="mt-1 text-cs-muted">
                    Reference <span className="font-mono font-semibold">{errorRef}</span> — attached automatically.
                  </p>
                )}
              </div>
            )}

            <label className="block">
              <span className="text-xs text-cs-muted">What went wrong?</span>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What were you doing when it broke?"
                className="mt-1 w-full resize-y rounded-lg border border-cs-border bg-cs-surface px-3 py-2 text-sm text-cs-text"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-xs text-cs-muted">Your email · optional</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-cs-border bg-cs-surface px-3 py-2 text-sm text-cs-text"
              />
            </label>

            <div className="mt-4 rounded-xl border border-cs-border bg-cs-raised p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={includeDetails}
                  onChange={e => setIncludeDetails(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cs-brand"
                />
                <span className="text-xs leading-snug text-cs-text">
                  Include details that identify me
                  <span className="mt-1 block text-cs-text-2">
                    Your account, browser, and the last few pages and failed requests. Never
                    your financial data.
                  </span>
                </span>
              </label>

              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-cs-border pt-2.5">
                <span className="text-[11px] text-cs-muted">
                  {includeDetails ? 'This report will identify you.' : 'This report is anonymous.'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowPayload(v => !v)}
                  className="shrink-0 text-[11px] font-medium text-cs-brand underline underline-offset-2"
                >
                  {showPayload ? 'Hide' : 'Show'} what gets sent
                </button>
              </div>
            </div>
            {showPayload && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-cs-raised p-2 font-mono text-[11px] leading-relaxed text-cs-text-2">
                {`message: ${message.trim() || '(empty)'}
page: ${prefill.path ?? scrubPath(window.location.pathname)}
source: ${prefill.source ?? 'manual'}
error ref: ${errorRef ?? '(none)'}
error shown: ${prefill.errorMessage ?? '(none)'}
app version: ${APP_VERSION}
email: ${email.trim() || '(none)'}
${includeDetails ? `account: ${signedIn ? 'your signed-in account' : '(not signed in)'}
browser: ${navigator.userAgent}
recent activity:
${getClientLog() || '(nothing recorded)'}` : 'account, browser and recent activity: not included'}`}
              </pre>
            )}

            {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-cs-border px-4 py-2.5 text-sm font-medium text-cs-text-2 hover:bg-cs-raised"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="flex-1 rounded-xl bg-cs-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Makes the report dialog reachable from anywhere — a footer link, a failed
 * toast, an import that came back with errors.
 */
export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [prefill, setPrefill] = useState<ReportPrefill | null>(null)
  const location = useLocation()

  // The route trail is the cheapest useful thing a report can carry.
  useEffect(() => { logRoute(location.pathname) }, [location.pathname])

  const openReport = useCallback((next: ReportPrefill = {}) => setPrefill(next), [])

  return (
    <ReportContext.Provider value={{ openReport }}>
      {children}
      {prefill && <ReportDialog prefill={prefill} onClose={() => setPrefill(null)} />}
    </ReportContext.Provider>
  )
}

/**
 * A failure message with the report action attached to it. Used wherever the UI
 * already shows an error inline — asking at the moment it happens gets a report;
 * expecting someone to find the footer link afterwards does not.
 */
export function ReportableError({
  message,
  source = 'manual',
  className = 'text-xs text-red-500',
}: {
  message: string
  source?: ReportSource
  className?: string
}) {
  const { openReport } = useReportProblem()
  if (!message) return null
  return (
    <p role="alert" className={className}>
      {message}{' '}
      <button
        type="button"
        onClick={() => openReport({ source, errorMessage: message })}
        className="font-medium underline underline-offset-2"
      >
        Report this
      </button>
    </p>
  )
}

/** The standard entry point: a quiet link that opens the dialog. */
export function ReportProblemLink({ className = '' }: { className?: string }) {
  const { openReport } = useReportProblem()
  return (
    <button
      type="button"
      onClick={() => openReport()}
      className={`underline hover:text-cs-text ${className}`}
    >
      Report a problem
    </button>
  )
}
