import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiFetch, isLoggedIn } from '../api.ts'

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
