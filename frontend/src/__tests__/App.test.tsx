import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.tsx'

beforeEach(() => {
  localStorage.clear()
})

describe('App routing', () => {
  it('redirects to login when not authenticated', () => {
    render(<App />)
    expect(screen.getByText('Epic Stocks')).toBeInTheDocument()
  })

  it('shows login page tagline', () => {
    render(<App />)
    expect(screen.getByText(/for Epic employees tracking their own equity/i)).toBeInTheDocument()
  })
})
