import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, apiFetch, apiFetchBlob, apiFetchRaw, isLoggedIn } from '../api.ts'
import { platform } from '../platform/index.ts'

describe('isLoggedIn', () => {
  it('returns false when no auth_hint cookie', () => {
    Object.defineProperty(document, 'cookie', { value: '', configurable: true })
    expect(isLoggedIn()).toBe(false)
  })

  it('returns true when auth_hint cookie is present', () => {
    Object.defineProperty(document, 'cookie', { value: 'auth_hint=1', configurable: true })
    expect(isLoggedIn()).toBe(true)
  })
})

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends credentials: include', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    await apiFetch('/api/test')

    expect(spy).toHaveBeenCalledOnce()
    const [, init] = spy.mock.calls[0]
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('does not send Authorization header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    await apiFetch('/api/test')

    const [, init] = spy.mock.calls[0]
    expect((init?.headers as Record<string, string> | undefined)?.['Authorization']).toBeUndefined()
  })

  it('returns parsed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: 42 }), { status: 200 })
    )

    const result = await apiFetch<{ data: number }>('/api/test')
    expect(result.data).toBe(42)
  })

  it('returns undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    )

    const result = await apiFetch('/api/test')
    expect(result).toBeUndefined()
  })

  it('throws on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )

    await expect(apiFetch('/api/test')).rejects.toThrow('Unauthorized')
  })

  it('throws on non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 })
    )

    await expect(apiFetch('/api/test')).rejects.toThrow('Error 404')
  })
})

describe('apiFetchRaw', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('resolves paths against API_BASE (same origin by default)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await apiFetchRaw('/api/test')

    expect(spy.mock.calls[0][0]).toBe('/api/test')
  })

  it('applies the platform auth headers', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    vi.spyOn(platform.auth, 'authHeaders').mockReturnValue({ Authorization: 'Bearer tok' })

    await apiFetchRaw('/api/test')

    const [, init] = spy.mock.calls[0]
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('sets JSON content-type only for string bodies', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await apiFetchRaw('/api/test', { method: 'POST', body: new FormData() })

    const [, init] = spy.mock.calls[0]
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('does no status handling', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))

    const resp = await apiFetchRaw('/api/test')
    expect(resp.status).toBe(500)
  })
})

describe('apiFetch 401 handling', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('routes unauthorized through the platform, not window.location', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const onUnauthorized = vi.spyOn(platform.auth, 'onUnauthorized').mockImplementation(() => {})

    await expect(apiFetch('/api/test')).rejects.toThrow('Unauthorized')
    expect(onUnauthorized).toHaveBeenCalled()
  })
})

describe('apiFetchBlob', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns the response body as a blob', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('xlsx-bytes', { status: 200 })
    )

    const blob = await apiFetchBlob('/api/export/excel')
    expect(await blob.text()).toBe('xlsx-bytes')
  })

  it('uses the fallback label when the server sends no detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 })
    )

    await expect(apiFetchBlob('/api/export/excel', 'Export failed'))
      .rejects.toThrow('Export failed (500)')
  })

  it('prefers a server-supplied detail over the fallback label', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'No data to export' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(apiFetchBlob('/api/export/excel', 'Export failed'))
      .rejects.toThrow('No data to export')
  })

  it('falls back to a bare status with no label', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }))

    await expect(apiFetchBlob('/api/export/excel')).rejects.toThrow('Error 503')
  })
})

describe('transient account contention', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('retries a refused form save with the same body when the server supplies a busy hint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 409, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response('{"saved":true}', { status: 200 }))
    const body = '{"params":{"defaultSpend":77}}'
    const result = await apiFetch<{ saved: boolean }>('/api/retirement/params', { method: 'PUT', body })
    expect(result.saved).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([, init]) => init?.body)).toEqual([body, body])
  })
  it('never retries a version conflict', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"current_version":2}', { status: 409 }))
    await expect(apiFetch('/api/grants/1', { method: 'PUT', body: '{}' })).rejects.toThrow('modified_elsewhere')
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('stops after bounded busy retries and preserves the useful refusal message', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"detail":"Synthetic account is busy"}', { status: 409, headers: { 'Retry-After': '1' } }))
    await expect(apiFetch('/api/retirement/params', { method: 'PUT', body: '{}' })).rejects.toThrow('Synthetic account is busy')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

it('cancels an older busy autosave so it cannot overwrite a newer value', async () => {
  vi.restoreAllMocks()
  let saved = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const value = JSON.parse(String(init?.body)).params.defaultSpend
    if (value === 60 && saved === 0) return new Response('{}', { status: 409, headers: { 'Retry-After': '1' } })
    saved = value
    return new Response('{}', { status: 200 })
  })
  const controller = new AbortController()
  const old = api.saveRetirementParams({ defaultSpend: 60 }, controller.signal).catch(error => error)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  controller.abort()
  await api.saveRetirementParams({ defaultSpend: 77 })
  expect((await old).name).toBe('AbortError')
  expect(saved).toBe(77)
  expect(fetch).toHaveBeenCalledTimes(2)
})
