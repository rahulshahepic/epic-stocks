import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getToken, setToken, clearToken, apiFetch } from '../api.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('token management', () => {
  it('returns null when no token stored', () => {
    expect(getToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('clears token', () => {
    setToken('abc123')
    clearToken()
    expect(getToken()).toBeNull()
  })
})

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends auth header when token exists', async () => {
    setToken('mytoken')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    await apiFetch('/api/test')

    expect(spy).toHaveBeenCalledOnce()
    const [, init] = spy.mock.calls[0]
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer mytoken')
  })

  it('does not send auth header when no token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )

    await apiFetch('/api/test')

    const [, init] = spy.mock.calls[0]
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined()
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

  it('clears token and redirects on 401', async () => {
    setToken('expired')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )

    // Mock window.location
    const locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: '',
    })

    await expect(apiFetch('/api/test')).rejects.toThrow('Unauthorized')
    expect(getToken()).toBeNull()

    locationSpy.mockRestore()
  })

  it('throws on non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 })
    )

    await expect(apiFetch('/api/test')).rejects.toThrow('Error 404')
  })
})
