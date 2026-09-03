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
    navigate.mockClear()
    vi.restoreAllMocks()
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

  it('saves a stashed /try import before navigating home, so signup skips the re-upload', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    const submit = vi.spyOn(api, 'wizardSubmit').mockResolvedValue({ grants: 1, loans: 0, prices: 1, payoff_sales: 0 })
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    const payload = { grants: [{ year: 2022, type: 'Bonus', shares: 100, price: 0, vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', dp_shares: 0, election_83b: false, loans: [] }], prices: [{ effective_date: '2024-01-01', price: 12.5 }] }
    await platform.storage.set('trial_wizard_payload', JSON.stringify(payload))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(submit).toHaveBeenCalledWith({ ...payload, clear_existing: true })
    expect(await platform.storage.get('trial_wizard_payload')).toBeNull()
  })

  it('still navigates home when saving the stashed /try import fails', async () => {
    vi.spyOn(api, 'exchangeCode').mockResolvedValue({ ok: true })
    vi.spyOn(api, 'wizardSubmit').mockRejectedValue(new Error('save failed'))
    setCallbackUrl('?code=abc123&state=st-1')
    await seedPendingLogin('st-1')
    await platform.storage.set('trial_wizard_payload', JSON.stringify({ grants: [], prices: [] }))

    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
