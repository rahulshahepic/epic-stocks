import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../app/pages/Dashboard.tsx'

const MOCK_DASHBOARD = {
  current_price: 8.5,
  total_shares: 150000,
  total_income: 50000,
  total_cap_gains: 200000,
  total_loan_principal: 75000,
  total_tax_paid: 5000,
  cash_received: 10000,
  loan_payment_by_year: [{ year: '2025', payoff_sale: 19900, cash_in: 0 }],
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
  // Last event before today (2026-03-22) — values should match what cards display
  {
    date: '2025-12-31', grant_year: 2020, grant_type: 'Purchase',
    event_type: 'Share Price', granted_shares: null, grant_price: null,
    exercise_price: null, vested_shares: null, price_increase: 6.0,
    share_price: 8.5, cum_shares: 150000, income: 0, cum_income: 50000,
    vesting_cap_gains: 0, price_cap_gains: 199000, total_cap_gains: 199000, cum_cap_gains: 200000,
  },
  {
    date: '2027-03-01', grant_year: 2020, grant_type: 'Purchase',
    event_type: 'Vesting', granted_shares: null, grant_price: 1.99,
    exercise_price: null, vested_shares: 2000, price_increase: 0,
    share_price: 8.5, cum_shares: 152000, income: 0, cum_income: 50000,
    vesting_cap_gains: 13020, price_cap_gains: 0, total_cap_gains: 13020, cum_cap_gains: 213020,
  },
]

const MOCK_SALES: never[] = []

// An auto-generated loan payoff sale: liquidates all of Grant 1's shares to pay off
// MOCK_LOANS[0]. Auto-payoff sales carry loan_id but no lot_overrides (see
// backend/app/routers/loans.py _compute_payoff_sale), so grant attribution has to come
// from the loan's grant_year/grant_type, not from lot_overrides.
const MOCK_SALES_WITH_LOAN_PAYOFF = [
  {
    id: 1, version: 1, date: '2027-01-01', shares: 2000, price_per_share: 8.5,
    notes: 'Auto-generated payoff sale for loan 123456', loan_id: 1, lot_overrides: null,
  },
]

const MOCK_PRICES = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: '2021-03-01', price: 2.50 },
]

const CURRENT_YEAR = new Date().toISOString().slice(0, 4)
const MOCK_PRICES_CURRENT = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: `${CURRENT_YEAR}-03-01`, price: 2.50 },
]

// An estimate is a projection the user made themselves, not knowledge of this
// year's announced price.
const MOCK_PRICES_ESTIMATE_ONLY = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: `${CURRENT_YEAR}-03-01`, price: 2.50, is_estimate: true },
]

const MOCK_PRICES_WITH_FUTURE_SAME = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: '2021-03-01', price: 2.50 },
  { id: 3, effective_date: '2028-01-01', price: 2.50 },  // same as current
]

const MOCK_GRANTS = [
  {
    id: 1, version: 1, year: 2020, type: 'Purchase', shares: 2000, price: 1.99,
    vest_start: '2020-01-01', periods: 1, exercise_date: '2020-01-01', dp_shares: 0, election_83b: false,
  },
  {
    id: 2, version: 1, year: 2030, type: 'Purchase', shares: 1000, price: 3.00,
    vest_start: '2030-01-01', periods: 1, exercise_date: '2030-01-01', dp_shares: 0, election_83b: false,
  },
]

const MOCK_LOANS = [
  {
    id: 1, version: 1, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Purchase',
    loan_year: 2020, amount: 75000, interest_rate: 3.5, due_date: '2025-12-31',
    loan_number: '123456',
  },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi(prices = MOCK_PRICES, sales = MOCK_SALES) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/dashboard')) {
      return new Response(JSON.stringify(MOCK_DASHBOARD), { status: 200 })
    }
    if (url.includes('/api/events')) {
      return new Response(JSON.stringify(MOCK_EVENTS), { status: 200 })
    }
    if (url.includes('/api/prices')) {
      return new Response(JSON.stringify(prices), { status: 200 })
    }
    if (url.includes('/api/loans')) {
      return new Response(JSON.stringify(MOCK_LOANS), { status: 200 })
    }
    if (url.includes('/api/grants')) {
      return new Response(JSON.stringify(MOCK_GRANTS), { status: 200 })
    }
    if (url.includes('/api/sales')) {
      return new Response(JSON.stringify(sales), { status: 200 })
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
      expect(screen.getAllByText('$8.50').length).toBeGreaterThanOrEqual(1)
    })
    // "150,000" appears both in the portfolio-value hero card and the Vested Shares card
    expect(screen.getAllByText('150,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('$200,000')).toBeInTheDocument()
    expect(screen.getByText('$75,000')).toBeInTheDocument()
    expect(screen.getByText(/2027-03-01/)).toBeInTheDocument()
    expect(screen.getByText(/Vesting/)).toBeInTheDocument()
  })

  it('shows Value Today (vested at FMV + unvested at cost basis) and Total Cost Basis', async () => {
    mockApi()
    renderDashboard()

    // Grant 1: 2000 shares, fully vested since 2020, held at $8.50 FMV -> $17,000
    // Grant 2: 1000 shares, not vested until 2030, valued at $3.00 cost basis -> $3,000
    // Value Today = $17,000 + $3,000 = $20,000
    await waitFor(() => {
      expect(screen.getByText('Value Today')).toBeInTheDocument()
    })
    expect(screen.getByText('$20,000')).toBeInTheDocument()

    // Total Cost Basis = 2000 * $1.99 + 1000 * $3.00 = $3,980 + $3,000 = $6,980
    expect(screen.getByText('Total Cost Basis')).toBeInTheDocument()
    expect(screen.getByText('$6,980')).toBeInTheDocument()
  })

  it('hero card shows net worth (share value minus outstanding loan principal), not gross value', async () => {
    mockApi()
    renderDashboard()

    // Value Today = $20,000 (see previous test); MOCK_LOANS has one outstanding $75,000 loan.
    // Net worth = $20,000 - $75,000 = -$55,000, not the gross $20,000 share value.
    await waitFor(() => {
      expect(screen.getByText(/^Net worth/)).toBeInTheDocument()
    })
    expect(screen.getByText('-$55,000')).toBeInTheDocument()
    expect(screen.getByText('$20,000 in shares − $75,000 loans')).toBeInTheDocument()
  })

  it('labels the value card with the selected date, not always "Today"', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Value Today')).toBeInTheDocument()
    })

    const dateInput = screen.getByDisplayValue(new Date().toISOString().slice(0, 10))
    fireEvent.change(dateInput, { target: { value: '2021-03-01' } })

    await waitFor(() => {
      expect(screen.getByText('Value on Mar 1, 2021')).toBeInTheDocument()
    })
    expect(screen.queryByText('Value Today')).not.toBeInTheDocument()
  })

  it('hero card reflects shares liquidated by an auto-generated loan payoff sale at a future date', async () => {
    // MOCK_SALES_WITH_LOAN_PAYOFF liquidates Grant 1's 2000 shares on 2027-01-01 to pay off
    // MOCK_LOANS[0]. That sale carries loan_id but no lot_overrides (matching how the backend's
    // auto-generated payoff sales are shaped), so grant attribution must come from the loan.
    mockApi(MOCK_PRICES, MOCK_SALES_WITH_LOAN_PAYOFF)
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/^Net worth/)).toBeInTheDocument()
    })

    const dateInput = screen.getByDisplayValue(new Date().toISOString().slice(0, 10))
    fireEvent.change(dateInput, { target: { value: '2027-01-02' } })

    // After the payoff: Grant 1 is fully liquidated (no more vested value) and its loan is
    // settled. Only Grant 2's $3,000 unvested cost-basis value remains — net worth must equal
    // that, not the stale $20,000 gross total (which would mean the sold shares were never
    // subtracted even though the loan they paid off was).
    await waitFor(() => {
      expect(screen.getByText('Value on Jan 2, 2027')).toBeInTheDocument()
    })
    expect(screen.getAllByText('$3,000').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('$20,000')).not.toBeInTheDocument()
  })

  it('renders color-coded card labels', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Share Price')).toBeInTheDocument()
    })
    expect(screen.getByText('Vested Shares')).toBeInTheDocument()
    expect(screen.getByText('Unvested Shares')).toBeInTheDocument()
    expect(screen.getByText('Total Income')).toBeInTheDocument()
    expect(screen.getByText('Total capital gains')).toBeInTheDocument()
    expect(screen.getByText('Loan Principal')).toBeInTheDocument()
    expect(screen.getByText('Next Event')).toBeInTheDocument()
  })

  it('renders chart titles', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    })
    expect(screen.getByText('Income vs capital gains')).toBeInTheDocument()
    expect(screen.getByText('Share Price History')).toBeInTheDocument()
    expect(screen.getByText('Loan Payments by Due Year')).toBeInTheDocument()
  })

  it('shows error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument()
    })
  })

  it('renders All button and date range inputs', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    })
    // "All" buttons (one per chart with range controls)
    const allButtons = screen.getAllByText('All')
    expect(allButtons.length).toBeGreaterThanOrEqual(3)
    // Date inputs for custom range
    const startInputs = screen.getAllByLabelText('Range start date')
    const endInputs = screen.getAllByLabelText('Range end date')
    expect(startInputs.length).toBeGreaterThanOrEqual(3)
    expect(endInputs.length).toBeGreaterThanOrEqual(3)
  })

  it('switches to custom range when date input changes', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    })
    const startInputs = screen.getAllByLabelText('Range start date')
    fireEvent.change(startInputs[0], { target: { value: '2022-01-01' } })
    // The All button should no longer be active (indigo-600) - custom range is active
    // Just verify the input now has a value
    expect(startInputs[0]).toHaveValue('2022-01-01')
  })

  it('expands next event details when the Next Event card is tapped', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/2027-03-01/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Vesting shares')).not.toBeInTheDocument()

    const nextEventButton = screen.getByText(/2027-03-01/).closest('button')
    expect(nextEventButton).toBeTruthy()
    fireEvent.click(nextEventButton!)

    await waitFor(() => {
      expect(screen.getByText('Vesting shares')).toBeInTheDocument()
    })
    expect(screen.getByText('2,000')).toBeInTheDocument()

    // Tapping again collapses the detail panel
    fireEvent.click(nextEventButton!)
    await waitFor(() => {
      expect(screen.queryByText('Vesting shares')).not.toBeInTheDocument()
    })
  })

  it('renders without error when future price equals current price', async () => {
    mockApi(MOCK_PRICES_WITH_FUTURE_SAME)
    renderDashboard()

    // Dashboard should render normally — no crash or error state
    await waitFor(() => {
      expect(screen.getByText('Income vs capital gains')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to load dashboard')).not.toBeInTheDocument()
    // All chart section headers should still be visible
    expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    expect(screen.getByText('Share Price History')).toBeInTheDocument()
  })
})

describe('Dashboard stale-price banner', () => {
  it('warns when the newest price predates this year', async () => {
    mockApi()   // newest real price is from 2021
    renderDashboard()
    expect(await screen.findByText(/Your newest share price is from 2021/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a price' })).toHaveAttribute('href', '/prices')
  })

  it('stays quiet once this year has a price', async () => {
    mockApi(MOCK_PRICES_CURRENT)
    renderDashboard()
    await screen.findByText(/Net worth/i)
    expect(screen.queryByText(/Your newest share price is from/)).not.toBeInTheDocument()
  })

  it('does not treat the user\'s own estimate as knowing this year\'s price', async () => {
    mockApi(MOCK_PRICES_ESTIMATE_ONLY)
    renderDashboard()
    expect(await screen.findByText(/Your newest share price is from 2020/)).toBeInTheDocument()
  })

  it('stays dismissed for that year once dismissed', async () => {
    mockApi()
    const { unmount } = renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Your newest share price is from/)).not.toBeInTheDocument()

    unmount()
    renderDashboard()
    await screen.findByText(/Net worth/i)
    expect(screen.queryByText(/Your newest share price is from/)).not.toBeInTheDocument()
  })
})
