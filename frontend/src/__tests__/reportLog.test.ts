import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiFetch } from '../api.ts'
import {
  getClientLog, getLastErrorRef, logApiFailure, logReportEvent, logRoute,
  noteErrorRef, resetReportLog, scrubPath,
} from '../scaffold/reportLog.ts'

beforeEach(() => {
  resetReportLog()
  vi.restoreAllMocks()
})

describe('scrubPath', () => {
  it('drops the query string and fragment', () => {
    // /auth/callback?code=… would otherwise put an OIDC code in a report.
    expect(scrubPath('/auth/callback?code=secret&state=xyz')).toBe('/auth/callback')
    expect(scrubPath('/grants#loan-3')).toBe('/grants')
  })

  it('reduces an absolute URL to its path', () => {
    expect(scrubPath('https://example.com/api/events?as_of=2026-01-01')).toBe('/api/events')
  })
})

describe('the trail', () => {
  it('keeps only the last 12 entries', () => {
    for (let i = 0; i < 20; i++) logReportEvent(`event ${i}`)
    const lines = getClientLog().split('\n')
    expect(lines).toHaveLength(12)
    expect(lines[11]).toContain('event 19')
    expect(getClientLog()).not.toContain('event 7')
  })

  it('records routes and API failures as shape only', () => {
    logRoute('/grants?year=2024')
    logApiFailure('POST', '/api/grants?draft=1', 500, 'abc12345')
    const log = getClientLog()
    expect(log).toContain('route /grants')
    expect(log).toContain('POST /api/grants → 500 [ref abc12345]')
    expect(log).not.toContain('year=2024')
    expect(log).not.toContain('draft=1')
  })
})

describe('error refs', () => {
  it('remembers a well-formed ref', () => {
    noteErrorRef('deadbeef')
    expect(getLastErrorRef()).toBe('deadbeef')
  })

  it('ignores a malformed one', () => {
    noteErrorRef('<script>alert(1)</script>')
    expect(getLastErrorRef()).toBeNull()
  })

  it('is captured from a 500 body by apiFetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Internal server error', error_ref: 'a1b2c3d4' }), { status: 500 })
    )
    await expect(apiFetch('/api/events')).rejects.toThrow('Internal server error')
    expect(getLastErrorRef()).toBe('a1b2c3d4')
    expect(getClientLog()).toContain('/api/events → 500 [ref a1b2c3d4]')
  })

  it('leaves the ref unset when the server sends none', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
    )
    await expect(apiFetch('/api/nope')).rejects.toThrow('Not found')
    expect(getLastErrorRef()).toBeNull()
    expect(getClientLog()).toContain('/api/nope → 404')
  })
})
