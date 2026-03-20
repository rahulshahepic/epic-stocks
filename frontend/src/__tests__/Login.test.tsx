import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from '../pages/Login.tsx'

beforeEach(() => {
  localStorage.clear()
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

  it('shows missing client ID message when not configured', () => {
    renderLogin()
    expect(screen.getByText(/google client id not configured/i)).toBeInTheDocument()
  })
})
