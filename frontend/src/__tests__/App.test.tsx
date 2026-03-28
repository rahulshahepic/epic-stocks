import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.tsx'

beforeEach(() => {
  localStorage.clear()
})

describe('App routing', () => {
  it('redirects to login when not authenticated', () => {
    render(<App />)
    expect(screen.getByText('Equity Vesting Tracker')).toBeInTheDocument()
  })

  it('shows login page title', () => {
    render(<App />)
    expect(screen.getByText(/sign in to manage/i)).toBeInTheDocument()
  })
})
