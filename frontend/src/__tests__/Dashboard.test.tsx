import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard.tsx'

const MOCK_DASHBOARD = {
  current_price: 8.5,
  total_shares: 150000,
  total_income: 50000,
  total_cap_gains: 200000,
  total_loan_principal: 75000,
  next_event: { date: '2026-03-01', event_type: 'Vesting' },
}

const MOCK_EVENTS = [
  {
    date: '2021-03-01', grant_year: 2020, grant_type: 'Purchase',
    event_type: 'Vesting', granted_shares: null, grant_price: 1.99,
    exercise_price: null, vested_shares: 2000, price_increase: 0,
    share_price: 2.5, cum_shares: 2000, income: 0, cum_income: 0,
    vesting_cap_gains: 1020, price_cap_gains: 0, total_cap_gains: 1020, cum_cap_gains: 1020,
  },
]

const MOCK_PRICES = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: '2021-03-01', price: 2.50 },
]

const MOCK_LOANS = [
  {
    id: 1, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Purchase',
    loan_year: 2020, amount: 19900, interest_rate: 3.5, due_date: '2025-12-31',
    loan_number: '123456',
  },
]

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/dashboard')) {
      return new Response(JSON.stringify(MOCK_DASHBOARD), { status: 200 })
    }
    if (url.includes('/api/events')) {
      return new Response(JSON.stringify(MOCK_EVENTS), { status: 200 })
    }
    if (url.includes('/api/prices')) {
      return new Response(JSON.stringify(MOCK_PRICES), { status: 200 })
    }
    if (url.includes('/api/loans')) {
      return new Response(JSON.stringify(MOCK_LOANS), { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('Dashboard', () => {
  it('shows loading initially', () => {
    mockApi()
    renderDashboard()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders summary cards with data', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('$9')).toBeInTheDocument() // $8.50 rounded to $9
    })
    expect(screen.getByText('150,000')).toBeInTheDocument()
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('$200,000')).toBeInTheDocument()
    expect(screen.getByText('$75,000')).toBeInTheDocument()
    expect(screen.getByText(/2026-03-01/)).toBeInTheDocument()
    expect(screen.getByText(/Vesting/)).toBeInTheDocument()
  })

  it('renders color-coded card labels', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Share Price')).toBeInTheDocument()
    })
    expect(screen.getByText('Total Shares')).toBeInTheDocument()
    expect(screen.getByText('Total Income')).toBeInTheDocument()
    expect(screen.getByText('Total Cap Gains')).toBeInTheDocument()
    expect(screen.getByText('Loan Principal')).toBeInTheDocument()
    expect(screen.getByText('Next Event')).toBeInTheDocument()
  })

  it('renders chart titles', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    })
    expect(screen.getByText('Income vs Cap Gains')).toBeInTheDocument()
    expect(screen.getByText('Share Price History')).toBeInTheDocument()
    expect(screen.getByText('Loan Principal by Due Year')).toBeInTheDocument()
  })

  it('shows error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument()
    })
  })
})
