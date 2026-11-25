import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import AuthCallback from '../scaffold/pages/AuthCallback.tsx'
import { api } from '../api.ts'
import { platform } from '../platform/index.ts'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

function setCallbackUrl(query: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: query, origin: 'https://app.example.com' },
    configurable: true,
  })
}

async function seedPendingLogin(state: string) {
  await platform.storage.set('auth_state', state)
  await platform.storage.set('pkce_verifier', 'verifier-abc')
  await platform.storage.set('auth_provider', 'google')
}

function renderCallback(strict = false) {
  const tree = <MemoryRouter><AuthCallback /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

describe('AuthCallback', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.removeItem('onboarding_counts_v1')
    navigate.mockClear()
    vi.restoreAllMocks()
  })

  it('reports when a preview expires during sign-in', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ok: true})
    const apply = vi.spyOn(api, 'applyChanges')
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('trial_draft', JSON.stringify({grants: []}))
    await platform.storage.set('trial_saved_at', String(Date.now() - 31 * 60000))
    renderCallback()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', {replace: true}))
    expect(await platform.storage.get('trial_carryover_result')).toBe('expired')
    expect(apply).not.toHaveBeenCalled()
  })

  it('exchanges the code and lands on the dashboard', async () => {
    const exchange = vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(exchange).toHaveBeenCalledWith('google', 'abc123', 'verifier-abc', 'https://app.example.com/auth/callback')
  })

  it('exchanges the single-use code exactly once under StrictMode', async () => {
    const exchange = vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')

    renderCallback(true)

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('clears the PKCE material after use', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(await platform.storage.get('pkce_verifier')).toBeNull()
    expect(await platform.storage.get('auth_state')).toBeNull()
    expect(await platform.storage.get('auth_provider')).toBeNull()
  })

  it('rejects a mismatched state without exchanging', async () => {
    const exchange = vi.spyOn(api, 'exchangeCode')
    setCallbackUrl('?code=abc123&state=attacker')
    await seedPendingLogin('st-1')

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent(/CSRF/)
    expect(exchange).not.toHaveBeenCalled()
  })

  it('reports missing session data', async () => {
    setCallbackUrl('?code=abc123&state=st-1')
    await platform.storage.set('auth_state', 'st-1')

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Session data missing/)
  })

  it('surfaces an IdP error without exchanging', async () => {
    const exchange = vi.spyOn(api, 'exchangeCode')
    setCallbackUrl('?error=access_denied&error_description=User+declined')

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent('User declined')
    expect(exchange).not.toHaveBeenCalled()
  })

  it('surfaces an exchange failure', async () => {
    vi.spyOn(api, 'exchangeCode').mockRejectedValue(new Error('Authentication failed'))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication failed')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('accepts a pending invitation before navigating home', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    const accept = vi.spyOn(api, 'acceptInvite').mockResolvedValue({ ok: true } as never)
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('invite_token', 'inv-9')

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(accept).toHaveBeenCalledWith({ token: 'inv-9', code: undefined })
    expect(await platform.storage.get('invite_token')).toBeNull()
  })

  it('still navigates home when invitation acceptance fails', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    vi.spyOn(api, 'acceptInvite').mockRejectedValue(new Error('already used'))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('invite_code', 'ABC123')

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  const ADD_GRANT = { kind: 'grant' as const, action: 'create' as const, values: { year: 2022 } }
  const KEEP_GRANT = { kind: 'grant' as const, action: 'update' as const, id: 7, version: 2, values: { shares: 1 } }
  const RESULT = { applied: true, changes: [], position_before: {}, position_after: {} }

  it('adds a stashed /try import before navigating home, so signup skips the re-upload', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    const draftChanges = vi.spyOn(api, 'draftChanges').mockResolvedValue(
      { changes: [ADD_GRANT, KEEP_GRANT], findings: [], blocked: false })
    const preview = vi.spyOn(api, 'previewChanges').mockResolvedValue({ ...RESULT, applied: false, confirm: 'tok' })
    const apply = vi.spyOn(api, 'applyChanges').mockResolvedValue(RESULT)
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    const draft = { grants: [{ year: 2022, type: 'Bonus', shares: 100 }], prices: [] }
    await platform.storage.set('trial_draft', JSON.stringify(draft))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(draftChanges).toHaveBeenCalledWith(draft)
    // Only additions: an account that already had data keeps every row it had.
    expect(preview).toHaveBeenCalledWith([ADD_GRANT])
    expect(apply).toHaveBeenCalledWith([ADD_GRANT], 'tok')
    expect(await platform.storage.get('trial_draft')).toBeNull()
  })

  it('counts the conversion once the trial data is actually saved', async () => {
    localStorage.setItem('onboarding_counts_v1', 'on')
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    vi.spyOn(api, 'draftChanges').mockResolvedValue({ changes: [ADD_GRANT], findings: [], blocked: false })
    vi.spyOn(api, 'previewChanges').mockResolvedValue({ ...RESULT, applied: false, confirm: 'tok' })
    vi.spyOn(api, 'applyChanges').mockResolvedValue(RESULT)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('trial_draft', JSON.stringify({ grants: [], prices: [] }))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    await waitFor(() => expect(fetchSpy.mock.calls.some(
      ([input]) => String(input).includes('/api/trial/converted'))).toBe(true))
  })

  it('does not count a conversion when saving the trial data failed', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    vi.spyOn(api, 'draftChanges').mockRejectedValue(new Error('save failed'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('trial_draft', JSON.stringify({ grants: [], prices: [] }))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(fetchSpy.mock.calls.some(
      ([input]) => String(input).includes('/api/trial/converted'))).toBe(false)
  })

  it('still navigates home when saving the stashed /try import fails', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    vi.spyOn(api, 'draftChanges').mockRejectedValue(new Error('save failed'))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('trial_draft', JSON.stringify({ grants: [], prices: [] }))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
