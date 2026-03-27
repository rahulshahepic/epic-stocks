import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from '../scaffold/pages/Login.tsx'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
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

  it('shows sign-in button', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows privacy policy link', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /privacy policy/i })).toBeInTheDocument()
  })

  it('shows data privacy blurb', () => {
    renderLogin()
    expect(screen.getByText(/we will never sell your data/i)).toBeInTheDocument()
  })

  it('shows secure sign-in explanation', () => {
    renderLogin()
    expect(screen.getByText(/secure sign-in/i)).toBeInTheDocument()
  })
})
