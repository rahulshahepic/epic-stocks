import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { webPlatform } from '../platform/web.ts'

describe('web platform — auth', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('reports logged in from the auth_hint cookie', () => {
    Object.defineProperty(document, 'cookie', { value: 'auth_hint=1', configurable: true })
    expect(webPlatform.auth.isLoggedIn()).toBe(true)

    Object.defineProperty(document, 'cookie', { value: 'other=1', configurable: true })
    expect(webPlatform.auth.isLoggedIn()).toBe(false)
  })

  it('sends cookies and adds no auth headers', () => {
    expect(webPlatform.auth.credentials).toBe('include')
    expect(webPlatform.auth.authHeaders()).toEqual({})
  })

  it('builds the redirect URI from the page origin', () => {
    expect(webPlatform.auth.redirectUri()).toBe(window.location.origin + '/auth/callback')
  })

  it('has nothing to store or clear — the session is an HttpOnly cookie', async () => {
    await expect(webPlatform.auth.onSessionEstablished('ignored')).resolves.toBeUndefined()
    await expect(webPlatform.auth.clearSession()).resolves.toBeUndefined()
  })
})

describe('web platform — storage', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('round-trips values through sessionStorage', async () => {
    await webPlatform.storage.set('k', 'v')
    expect(await webPlatform.storage.get('k')).toBe('v')
    await webPlatform.storage.remove('k')
    expect(await webPlatform.storage.get('k')).toBeNull()
  })

  it('returns null for a missing key', async () => {
    expect(await webPlatform.storage.get('nope')).toBeNull()
  })

  it('survives storage being unavailable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    await expect(webPlatform.storage.set('k', 'v')).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

describe('web platform — files', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('saves a blob via an object URL and revokes it', async () => {
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await webPlatform.files.saveBlob(new Blob(['x']), 'report.xlsx')

    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('saves text with the requested MIME type', async () => {
    const createObjectURL = vi.fn(() => 'blob:test')
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await webPlatform.files.saveText('# hi', 'prompt.md', 'text/markdown')

    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob
    expect(blob.type).toBe('text/markdown')
  })

  it('reports clipboard success and failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await webPlatform.files.copyText('hi')).toBe(true)

    writeText.mockRejectedValue(new Error('denied'))
    expect(await webPlatform.files.copyText('hi')).toBe(false)
  })
})

describe('web platform — push', () => {
  afterEach(() => {
    // @ts-expect-error restoring the global between cases
    delete window.Notification
  })

  it('is unsupported when the browser lacks PushManager', () => {
    // jsdom provides neither serviceWorker nor PushManager.
    expect(webPlatform.push.supported).toBe(false)
  })

  it('reports unsupported permission when there is no Notification API', () => {
    // This is iOS Safari in a tab, where push cannot work at all.
    expect(webPlatform.push.permission()).toBe('unsupported')
  })

  it.each(['default', 'granted', 'denied'] as const)('reads %s permission without prompting', p => {
    const requestPermission = vi.fn()
    Object.defineProperty(window, 'Notification', {
      value: Object.assign(class {}, { permission: p, requestPermission }),
      writable: true,
      configurable: true,
    })

    expect(webPlatform.push.permission()).toBe(p)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('detects an installed app from navigator.standalone', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, writable: true, configurable: true })
    expect(webPlatform.push.isInstalled()).toBe(true)

    Object.defineProperty(navigator, 'standalone', { value: false, writable: true, configurable: true })
    expect(webPlatform.push.isInstalled()).toBe(false)
  })
})
