/**
 * A short in-memory trail of what the app just did, so a problem report can say
 * more than "it broke".
 *
 * Rules this module exists to enforce:
 *  - memory only. Nothing is persisted, and nothing leaves the tab unless the
 *    person ticks "include details" and presses Send.
 *  - shape only, never content. Routes and API calls are recorded as
 *    method + path + status. Query strings and fragments are stripped before
 *    anything is stored — they carry OIDC codes and tokens — and request or
 *    response bodies are never touched, which is what keeps financial data out.
 */

const MAX_ENTRIES = 12

let entries: string[] = []
let lastErrorRef: string | null = null

/** Drop the query string and fragment from a URL or path. */
export function scrubPath(raw: string): string {
  if (!raw) return ''
  let path = raw
  try {
    // Absolute URLs arrive from Response.url; keep only the path.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) path = new URL(path).pathname
  } catch { /* fall through with the raw value */ }
  return path.split('?')[0].split('#')[0].slice(0, 120)
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19)
}

export function logReportEvent(text: string): void {
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), `${stamp()} ${text.slice(0, 200)}`]
}

export function logRoute(path: string): void {
  logReportEvent(`route ${scrubPath(path)}`)
}

export function logApiFailure(method: string, path: string, status: number, errorRef?: string | null): void {
  logReportEvent(`${method} ${scrubPath(path)} → ${status}${errorRef ? ` [ref ${errorRef}]` : ''}`)
}

/**
 * Remember the correlation id the server put in a 500 body. The next report
 * submitted carries it, which is what ties the report to a stored traceback.
 */
export function noteErrorRef(ref: string | null | undefined): void {
  if (ref && /^[A-Za-z0-9-]{1,32}$/.test(ref)) {
    lastErrorRef = ref
    logReportEvent(`server error ref ${ref}`)
  }
}

export function getLastErrorRef(): string | null {
  return lastErrorRef
}

export function getClientLog(): string {
  return entries.join('\n')
}

/** Test seam, and used when a report is sent so the next one starts clean. */
export function resetReportLog(): void {
  entries = []
  lastErrorRef = null
}

/**
 * Catch errors that never pass through a component: unhandled promise
 * rejections and script errors. Messages only — no stacks from third-party
 * frames, no event payloads.
 */
export function installGlobalErrorCapture(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    logReportEvent(`js error: ${e.message ?? 'unknown'}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'unknown')
    logReportEvent(`unhandled rejection: ${msg}`)
  })
}
