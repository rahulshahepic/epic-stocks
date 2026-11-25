import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isLoggedIn, submitReport } from '../../api.ts'
import { useScrollLock } from '../hooks/useScrollLock.ts'
import type { ReportSource } from '../../api.ts'
import { getClientLog, getFailedWorkflow, getLastErrorRef, logRoute, resetReportLog, scrubPath } from '../reportLog.ts'
import { ReportContext, useReportProblem, type ReportPrefill } from './reportContext.ts'

const GITHUB_ISSUES = 'https://github.com/rahulshahepic/epic-stocks/issues/new'
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 10 * 1024 * 1024

function encodeDocument(file: File): Promise<{ name: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',', 2)[1] })
    reader.onerror = () => reject(new Error('An attachment could not be read. Remove it and try again.'))
    reader.readAsDataURL(file)
  })
}

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
  const [includeDocuments, setIncludeDocuments] = useState(false)
  const [documents, setDocuments] = useState(() => [...new Set(prefill.documents?.filter((file): file is File => !!file))])
  const [showPayload, setShowPayload] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentRef, setSentRef] = useState<string | null | undefined>(undefined)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  const errorRef = prefill.errorRef ?? getLastErrorRef()
  const signedIn = isLoggedIn()
  const path = prefill.path ?? scrubPath(window.location.pathname)
  const workflow = [prefill.workflow, getFailedWorkflow(path)].filter(Boolean).join('\n\n')

  // Without this the page scrolls under the dialog on touch.
  useScrollLock()

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      )
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      const atStart = document.activeElement === first || document.activeElement === dialogRef.current
      if (event.shiftKey ? atStart : document.activeElement === last) {
        event.preventDefault()
        if (event.shiftKey) last.focus()
        else first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  async function send() {
    if (!message.trim()) {
      setError('Tell us what went wrong first.')
      return
    }
    const attachments = includeDocuments ? documents : []
    if (attachments.length > 3 || attachments.some(file => file.size > MAX_DOCUMENT_BYTES)
      || attachments.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
      setError('Choose up to three files, at most 5 MB each and 10 MB combined.')
      return
    }
    setSending(true)
    setError('')
    try {
      const resp = await submitReport({
        message: message.trim(),
        path,
        source: prefill.source ?? 'manual',
        error_ref: errorRef,
        error_message: includeDetails ? prefill.errorMessage ?? prefill.publicSafeSummary ?? null : prefill.publicSafeSummary ?? null,
        include_details: false,
        email: email.trim() || null,
        app_version: APP_VERSION,
        user_agent: includeDetails ? navigator.userAgent : null,
        client_log: includeDetails ? getClientLog() : null,
      }, includeDetails || attachments.length ? {
        share_diagnostics: includeDetails,
        attach_documents: attachments.length > 0,
        ...(includeDetails && workflow ? { workflow: workflow.slice(0, 24_000) } : {}),
        documents: await Promise.all(attachments.map(encodeDocument)),
      } : undefined)
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
      aria-label={prefill.title ?? 'Report a problem'}
    >
      <div
        ref={dialogRef} tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-cs-surface shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-2 sm:px-5">
          <h3 className="text-lg font-semibold text-cs-text">{prefill.title ?? 'Report a problem'}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="min-h-10 min-w-10 rounded-lg text-cs-text-2 hover:bg-cs-raised">✕</button>
        </div>

        {sentRef !== undefined ? (
          <div className="p-4 sm:px-5">
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
            <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-2 sm:px-5">
              <section className="mb-3 rounded-xl border border-cs-border p-3">
                <a
                  href={`${GITHUB_ISSUES}${prefill.source === 'request' ? '?template=feature_request.yml' : '/choose'}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm font-semibold text-cs-brand underline underline-offset-2"
                >
                  Open a public GitHub issue
                </a>
                <p className="mt-1 text-xs leading-relaxed text-cs-text-2">
                  Track general bugs and suggestions publicly. Keep Epic share prices, financial information, documents, and unredacted screenshots off GitHub.
                </p>
              </section>
              <h4 className="text-sm font-semibold text-cs-text">Send a private report</h4>
              <p className="mb-3 mt-1 text-xs text-cs-text-2">For account problems, confidential details, or reporting without GitHub.</p>
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
                <span className="text-xs text-cs-muted">{prefill.prompt ?? 'What went wrong?'}</span>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder={prefill.placeholder ?? 'What were you doing when it broke?'}
                  className="mt-1 w-full resize-y rounded-lg border border-cs-border bg-cs-surface px-3 py-2 text-sm text-cs-text"
                />
                {!includeDetails && !includeDocuments && (
                  <span className="mt-1 block text-xs text-cs-muted">Leave financial details out unless you choose to share them below.</span>
                )}
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
                    Include account and diagnostic details
                    <span className="mt-1 block text-cs-text-2">
                      Your signed-in account, browser, recent pages and requests, and available
                      inputs and financial details from this workflow.
                    </span>
                  </span>
                </label>

                <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-cs-border pt-2.5">
                  <span className="text-[11px] text-cs-muted">
                    {includeDetails && signedIn ? 'This report will identify you.'
                      : email.trim() ? 'Your reply email will be included.'
                        : includeDocuments || includeDetails ? 'Shared details may identify you.'
                          : 'This report is anonymous.'}
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
page: ${path}
source: ${prefill.source ?? 'manual'}
error ref: ${errorRef ?? '(none)'}
error shown: ${(includeDetails ? prefill.errorMessage : prefill.publicSafeSummary) ?? '(none)'}
app version: ${APP_VERSION}
email: ${email.trim() || '(none)'}
${includeDetails ? `account: ${signedIn ? 'your signed-in account' : '(not signed in)'}
browser: ${navigator.userAgent}
recent activity:
${getClientLog() || '(nothing recorded)'}
workflow:
${workflow || '(none)'}` : 'account, browser and recent activity: not included'}`}
                </pre>
              )}

              {documents.length > 0 && (
                <div className="mt-3 rounded-xl border border-cs-border bg-cs-raised p-3">
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs text-cs-text">
                    <input
                      type="checkbox" checked={includeDocuments}
                      onChange={e => setIncludeDocuments(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-cs-brand"
                    />
                    <span>
                      Attach the original import files
                      <span className="mt-1 block text-cs-text-2">These files can contain financial information. Choose which ones to send.</span>
                    </span>
                  </label>
                  {includeDocuments && (
                    <ul className="mt-2 divide-y divide-cs-border">
                      {documents.map((file, index) => (
                        <li key={index} className="flex items-center justify-between gap-2 py-1 text-xs">
                          <span className="min-w-0 break-all text-cs-text">{file.name}</span>
                          <button type="button" aria-label={`Remove ${file.name}`} className="min-h-8 shrink-0 px-2 text-cs-brand underline"
                            onClick={() => {
                              setDocuments(previous => previous.filter(item => item !== file))
                              if (documents.length === 1) setIncludeDocuments(false)
                            }}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-cs-border px-4 pb-3 pt-2 sm:px-5">
              {(includeDetails || includeDocuments) && (
                <p className="mb-2 text-xs leading-snug text-cs-text-2">
                  The administrator and their authorized AI assistants can access shared financial details and documents for 30 days.
                </p>
              )}
              {error && <p role="alert" className="mb-2 text-xs text-red-500">{error}</p>}
              <div className="flex gap-2">
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
  documents,
  workflow,
}: {
  message: string
  source?: ReportSource
  className?: string
  documents?: ReportPrefill['documents']
  workflow?: string
}) {
  const { openReport } = useReportProblem()
  if (!message) return null
  return (
    <p role="alert" className={className}>
      {message}{' '}
      <button
        type="button"
        onClick={() => openReport({ source, errorMessage: message, documents, workflow })}
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
