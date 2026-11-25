/**
 * A short in-memory trail of what the app just did, so a problem report can say
 * more than "it broke".
 *
 * Rules this module exists to enforce:
 *  - memory only. Nothing is persisted, and nothing leaves the tab unless the
 *    person ticks "include details" and presses Send.
 *  - the activity trail is shape only. Routes and API calls are recorded as
 *    method + path + status. Query strings and fragments are stripped before
 *    anything is stored — they carry OIDC codes and tokens — and request or
 *    response bodies are never logged. A separate in-memory slot holds selected
 *    inputs from a failed financial request for the consented diagnostics preview.
 */

const MAX_ENTRIES = 12

let entries: string[] = []
let lastErrorRef: string | null = null
let failureContext: { page: string; text: string } | null = null

const REPLAYABLE = /^\/api\/(?:grants|loans|prices|sales|loan-payments|loan-interest-checkpoints)(?:\/\d+)?(?:\/(?:with-payoff|execute-payoff))?$/
const REPLAY_FIELDS = [
  'year', 'type', 'shares', 'price', 'effective_date', 'is_estimate', 'expected_announcement_date',
  'announced_date', 'vest_start', 'periods', 'exercise_date', 'dp_shares', 'election_83b',
  'grant_year', 'grant_type', 'loan_type', 'amount', 'interest_rate', 'date', 'disbursed_on',
  'due_date', 'loan_id', 'price_per_share', 'accrued_through', 'accrued_interest', 'payoff_date',
]

/** Keep one failed operation on this screen. Never read auth, sharing, or support requests. */
export function recordFailedWorkflow(path: string, init: RequestInit | undefined, status: number): void {
  const route = scrubPath(path)
  if (route.startsWith('/api/report') || route.startsWith('/api/admin')) return
  failureContext = null
  const request = new URL(path, window.location.href)
  const fields: Record<string, string | boolean | number | null> = {}
  if (REPLAYABLE.test(route) && typeof init?.body === 'string' && init.body.length <= 24_000) {
    try {
      const input = JSON.parse(init.body)
      for (const field of REPLAY_FIELDS) {
        const value = input?.[field]
        if (value === null || typeof value === 'boolean' || typeof value === 'number') fields[field] = value
        if (typeof value === 'string' && value.length <= 80) fields[field] = value
      }
    } catch { /* the request can be described without its inputs */ }
  }
  if (route === '/api/dashboard' || route === '/api/preview-exit') {
    for (const field of ['as_of', 'date']) {
      const value = request.searchParams.get(field)
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) fields[field] = value
    }
  }
  if (!Object.keys(fields).length) return
  failureContext = {
    page: scrubPath(window.location.pathname),
    text: `${init?.method ?? 'GET'} ${route} failed (${status})\n${JSON.stringify(fields, null, 2)}`,
  }
}

export function getFailedWorkflow(path: string) {
  return failureContext?.page === path ? failureContext.text : null
}

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
  failureContext = null
}

/**
 * Catch errors that never pass through a component: unhandled promise
 * rejections and script errors. Messages only — no stacks from third-party
 * frames, no event payloads.
 */
export function installGlobalErrorCapture(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', () => logReportEvent('JavaScript error'))
  window.addEventListener('unhandledrejection', () => logReportEvent('Unhandled request error'))
}
