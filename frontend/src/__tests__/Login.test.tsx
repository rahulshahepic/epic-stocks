import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import { resetConfigCache } from '../scaffold/hooks/useConfig.ts'
import Login from '../scaffold/pages/Login.tsx'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  resetConfigCache()
  // Default: fetch returns empty providers list
  mockJson([])
})

/**
 * Serve every fetch the same body, building a fresh Response each time — the
 * page makes more than one request, and a single Response instance can only be
 * read once.
 */
function mockJson(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  )
}

/** Serve /api/config with AI connections on or off, providers empty. */
function mockConfig(aiConnections: boolean) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/config')) {
      return new Response(JSON.stringify({ ai_connections: aiConnections }), { status: 200 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function renderLogin() {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </AppProvider>
  )
}

describe('Login page', () => {
  it('renders the app title', () => {
    renderLogin()
    expect(screen.getByText('Epic Stocks')).toBeInTheDocument()
  })

  it('says who the app is for', () => {
    renderLogin()
    expect(screen.getByText(/for Epic employees tracking their own equity/i)).toBeInTheDocument()
  })

  it('badges the name as unofficial, so it never appears bare', () => {
    renderLogin()
    expect(screen.getByText('Unofficial')).toBeInTheDocument()
  })

  it('states that this is not an Epic site before sign-in', () => {
    renderLogin()
    expect(screen.getByText(/this is not an Epic site/i)).toBeInTheDocument()
    expect(
      screen.getByText(/not built, endorsed, or supported by Epic Systems Corporation/i)
    ).toBeInTheDocument()
  })

  it('says the figures are estimates, not official Epic records', () => {
    renderLogin()
    expect(screen.getByText(/official grant, loan, and share-price records are the ones Epic gives/i))
      .toBeInTheDocument()
  })

  it('shows provider buttons when providers are loaded', async () => {
    mockJson([{ name: 'google', label: 'Google' }])
    renderLogin()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    })
  })

  it('shows multiple provider buttons', async () => {
    mockJson([
      { name: 'google', label: 'Google' },
      { name: 'azure', label: 'Azure AD' },
    ])
    renderLogin()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in with azure ad/i })).toBeInTheDocument()
    })
  })

  it('shows no-providers message when list is empty', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText(/no sign-in providers configured/i)).toBeInTheDocument()
    })
  })

  it('shows privacy policy link', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /privacy policy/i })).toBeInTheDocument()
  })

  it('shows data privacy blurb', () => {
    renderLogin()
    expect(screen.getByText(/we will never sell your data/i)).toBeInTheDocument()
  })

  it('offers a no-account trial to people not ready to sign up', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /see it first, without an account/i }))
      .toHaveAttribute('href', '/try')
  })

  it('says what an account is for before asking for one', () => {
    renderLogin()
    expect(screen.getByText(/what you get with an account/i)).toBeInTheDocument()
  })

  it('advertises connecting an assistant before sign-up', async () => {
    mockConfig(true)
    renderLogin()
    expect(await screen.findByText(/ask chatgpt or claude/i)).toBeInTheDocument()
  })

  it('stays quiet about assistants when the server has them switched off', async () => {
    mockConfig(false)
    renderLogin()
    // Waited for, so this cannot pass just by checking before config arrives.
    expect(await screen.findByText(/what you get with an account/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/ask chatgpt or claude/i)).not.toBeInTheDocument()
    })
  })
})
