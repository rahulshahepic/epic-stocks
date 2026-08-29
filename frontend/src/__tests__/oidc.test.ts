import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startLogin, readPendingLogin, clearPendingLogin, completeLogin } from '../scaffold/oidc.ts'
import { platform } from '../platform/index.ts'
import { api } from '../api.ts'

describe('OIDC PKCE flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('stashes PKCE material and hands the IdP URL to the platform', async () => {
    const getLoginUrl = vi.spyOn(api, 'getLoginUrl')
      .mockResolvedValue({ authorization_url: 'https://idp.example.com/authorize?x=1' })
    const open = vi.spyOn(platform.auth, 'openAuthorizationUrl').mockResolvedValue()

    await startLogin('google')

    const pending = await readPendingLogin()
    expect(pending.provider).toBe('google')
    expect(pending.verifier).toBeTruthy()
    expect(pending.state).toBeTruthy()

    // The verifier is sent as a SHA-256 challenge, never in the clear.
    const [provider, challenge, redirectUri, state] = getLoginUrl.mock.calls[0]
    expect(provider).toBe('google')
    expect(challenge).not.toBe(pending.verifier)
    expect(redirectUri).toBe(platform.auth.redirectUri())
    expect(state).toBe(pending.state)

    expect(open).toHaveBeenCalledWith('https://idp.example.com/authorize?x=1')
  })

  it('generates base64url material with no padding', async () => {
    vi.spyOn(api, 'getLoginUrl').mockResolvedValue({ authorization_url: 'https://idp/x' })
    vi.spyOn(platform.auth, 'openAuthorizationUrl').mockResolvedValue()

    await startLogin('google')

    const { verifier } = await readPendingLogin()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('uses a fresh verifier and state on each attempt', async () => {
    vi.spyOn(api, 'getLoginUrl').mockResolvedValue({ authorization_url: 'https://idp/x' })
    vi.spyOn(platform.auth, 'openAuthorizationUrl').mockResolvedValue()

    await startLogin('google')
    const first = await readPendingLogin()
    await startLogin('google')
    const second = await readPendingLogin()

    expect(second.verifier).not.toBe(first.verifier)
    expect(second.state).not.toBe(first.state)
  })

  it('clears every stashed key', async () => {
    vi.spyOn(api, 'getLoginUrl').mockResolvedValue({ authorization_url: 'https://idp/x' })
    vi.spyOn(platform.auth, 'openAuthorizationUrl').mockResolvedValue()

    await startLogin('google')
    await clearPendingLogin()

    expect(await readPendingLogin()).toEqual({ provider: null, verifier: null, state: null })
  })

  it('does not stash anything when the login URL request fails', async () => {
    vi.spyOn(api, 'getLoginUrl').mockRejectedValue(new Error('offline'))
    const open = vi.spyOn(platform.auth, 'openAuthorizationUrl').mockResolvedValue()

    await expect(startLogin('google')).rejects.toThrow('offline')
    expect(open).not.toHaveBeenCalled()
  })

  it('hands any returned token to the platform after exchange', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true, access_token: 'tok' })
    const established = vi.spyOn(platform.auth, 'onSessionEstablished').mockResolvedValue()

    await completeLogin('google', 'code-123', 'verifier-123')

    expect(established).toHaveBeenCalledWith('tok')
  })

  it('completes when the server returns only a cookie', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    const established = vi.spyOn(platform.auth, 'onSessionEstablished').mockResolvedValue()

    await completeLogin('google', 'code-123', 'verifier-123')

    expect(established).toHaveBeenCalledWith(undefined)
  })
})
