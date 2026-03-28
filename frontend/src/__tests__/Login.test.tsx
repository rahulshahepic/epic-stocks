import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  )
}

describe('Login page', () => {
  it('renders the app title', () => {
    renderLogin()
    expect(screen.getByText('Equity Vesting Tracker')).toBeInTheDocument()
  })

  it('renders sign-in subtitle', () => {
    renderLogin()
    expect(screen.getByText(/sign in to manage/i)).toBeInTheDocument()
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
})
