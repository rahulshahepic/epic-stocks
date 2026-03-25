import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from '../pages/Login.tsx'
import { resetConfigCache } from '../hooks/useConfig.ts'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  resetConfigCache()
})

function mockConfig(clientId: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ google_client_id: clientId }), { status: 200 })
  )
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  )
}

describe('Login page', () => {
  it('renders the app title', () => {
    mockConfig('')
    renderLogin()
    expect(screen.getByText('Equity Vesting Tracker')).toBeInTheDocument()
  })

  it('renders sign-in subtitle', () => {
    mockConfig('')
    renderLogin()
    expect(screen.getByText(/sign in to manage/i)).toBeInTheDocument()
  })

  it('shows loading while fetching config', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    renderLogin()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows missing client ID message when not configured', async () => {
    mockConfig('')
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText(/GOOGLE_CLIENT_ID/)).toBeInTheDocument()
    })
  })

  it('shows privacy policy link', () => {
    mockConfig('')
    renderLogin()
    expect(screen.getByRole('link', { name: /privacy policy/i })).toBeInTheDocument()
  })

  it('shows data privacy blurb', () => {
    mockConfig('')
    renderLogin()
    expect(screen.getByText(/we will never sell your data/i)).toBeInTheDocument()
  })

  it('shows why google sign-in explanation', () => {
    mockConfig('')
    renderLogin()
    expect(screen.getByText(/why google sign-in/i)).toBeInTheDocument()
  })
})
