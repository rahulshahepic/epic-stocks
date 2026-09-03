import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import Login from '../scaffold/pages/Login.tsx'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  // Default: fetch returns empty providers list
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
})

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
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ name: 'google', label: 'Google' }]), { status: 200 })
    )
    renderLogin()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    })
  })

  it('shows multiple provider buttons', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { name: 'google', label: 'Google' },
        { name: 'azure', label: 'Azure AD' },
      ]), { status: 200 })
    )
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
    expect(screen.getByRole('link', { name: /try it with your own files/i })).toHaveAttribute('href', '/try')
  })
})
