import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

const MOCK_SALES: typeof MOCK_SALES_WITH_LOAN_PAYOFF = []
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
    vest_start: '2030-01-01', periods: 1, exercise_date: '2025-12-31', dp_shares: 0, election_83b: false,
  },
]

const MOCK_LOANS = [
  {
    id: 1, version: 1, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Purchase',
    loan_year: 2020, amount: 75000, interest_rate: 3.5, due_date: '2025-12-31',
    loan_number: '123456',
  },
]

// Left unmocked, /api/tax-settings (and /api/tips, see mockApi below) 404 and
// useApiData's error path resolves a beat later than the other endpoints (a different
// promise chain: throw -> catch -> toast -> finally, vs. the happy-path .then() the
// rest take). That extra, later render is what made the loan-payoff test flaky:
// occasionally it lands in the same tick as the test's fireEvent.change on the date
// input, and React resets the controlled input back to its old value before the change
// handler reads e.target.value — so the date "change" is silently dropped. Mocking
// every endpoint the page touches on mount keeps them all on the same settle timing.
const MOCK_TAX_SETTINGS = {
  federal_income_rate: 0.32, federal_lt_cg_rate: 0.15, federal_st_cg_rate: 0.32,
  niit_rate: 0.038, state_income_rate: 0.093, state_lt_cg_rate: 0.093, state_st_cg_rate: 0.093,
  lt_holding_days: 365, lot_selection_method: 'fifo', loan_payoff_method: 'fifo',
  flexible_payoff_enabled: false, prefer_stock_dp: false, deduct_investment_interest: false,
  deduction_excluded_years: null, taxable_years: [2020, 2021, 2025, 2026, 2027],
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  MOCK_DASHBOARD_NEXT_OVERRIDE.value = null
})

const MOCK_DASHBOARD_NEXT_OVERRIDE: {value: Record<string, unknown> | null} = {value: null}

function snapshotFor(asOf: string, sales = MOCK_SALES) {
  const sold = sales.some(sale => sale.date <= asOf)
  return {
    ...MOCK_DASHBOARD, as_of: asOf,
    cards: {
      ...MOCK_DASHBOARD, total_shares: sold ? 0 : 150000,
      total_loan_principal: sold ? 0 : 75000, total_interest: 1234,
      interest_deduction_total: 0, tax_savings_from_deduction: 0,
      next_event: {date: '2027-03-01', event_type: 'Vesting'}, next_event_detail: MOCK_EVENTS[2],
      total_stock_value: sold ? 3000 : 20000, vested_stock_value: sold ? 0 : 17000,
      purchased_unvested_stock_value: 3000, net_equity: sold ? 3000 : -55000,
      accrued_unbooked_interest: 0, interest_status: 'Reconciled through 2026-03-01; estimated afterward', total_cost_basis: sold ? 3000 : 6980,
      unvested_shares: 1000, price_is_estimate: false,
      ...MOCK_DASHBOARD_NEXT_OVERRIDE.value,
    },
    grant_holdings: [
      {year: 2020, type: 'Purchase', exerciseDate: '2020-01-01', costBasis: 1.99,
        vestedShares: sold ? 0 : 2000, unvestedShares: 0, vestedValue: sold ? 0 : 17000,
        unvestedValue: 0, totalValue: sold ? 0 : 17000, totalTax: 0, totalLoan: sold ? 0 : 75000},
      {year: 2030, type: 'Purchase', exerciseDate: '2025-12-31', costBasis: 3,
        vestedShares: 0, unvestedShares: 1000, vestedValue: 0,
        unvestedValue: 3000, totalValue: 3000, totalTax: 0, totalLoan: 0},
    ],
    charts: {tax: [{date: '2025-01-01', estimated: 1000, paid: 1000, projected: false}], interest: []},
    active_loans: sold ? [] : [{id: 1, grantYear: 2020, grantType: 'Purchase', loanType: 'Purchase',
      loanYear: 2020, dueDate: '2030-12-31', balance: 75000, interestRate: 0.05}],
    breakdowns: {
      cash: {sales: [], totals: {proceeds: 10000, tax: 0, loanPayoff: 0, net: 10000}},
      income: {groups: [], total: 50000},
      capGains: {vestingGroups: [], vestingTotal: 0, priceTotal: 200000, total: 200000},
      interest: {rows: [{id: 'interest:1', label: 'Server projected interest', amount: 1234}], total: 1234, booked: 800},
      tax: {taxLoans: 5000, vestingIncomeTax: 0, cgTaxFromSales: 0, deductionSavings: 0, total: 5000},
    },
  }
}

function mockApi(prices = MOCK_PRICES, sales = MOCK_SALES, exitSavings = 0) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/dashboard')) {
      const asOf = new URL(url, 'http://localhost').searchParams.get('as_of') ?? ''
      return new Response(JSON.stringify(snapshotFor(asOf, sales)), { status: 200 })
    }
    if (url.includes('/api/preview-exit')) {
      const date = new URL(url, 'http://localhost').searchParams.get('date') ?? ''
      const sold = sales.some(sale => sale.date <= date)
      return new Response(JSON.stringify({
        date, liquidation_net_cash: sold ? 3000 : 0, liquidation_shortfall: sold ? 0 : 55000,
        net_cash: sold ? 3000 : 0, gross_vested: sold ? 0 : 17000, unvested_cost_proceeds: 3000,
        outstanding_principal: sold ? 0 : 75000, outstanding_accrued_interest: 0,
        liquidation_tax: 0, prior_sales: [], prior_sales_net: 0, deduction_savings: exitSavings,
        deduction_years: [], deduction_excluded_years: [],
      }), {status: 200})
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
    if (url.includes('/api/tax-settings')) {
      return new Response(JSON.stringify({ ...MOCK_TAX_SETTINGS, deduct_investment_interest: exitSavings > 0 }), { status: 200 })
    }
    // TipCarousel (rendered whenever !readOnly) fetches this on mount too — same
    // stray-404 race as tax-settings above if left unhandled.
    if (url.includes('/api/tips')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/api/sales/holdings')) {
      const asOf = new URL(url, 'http://localhost').searchParams.get('as_of') ?? ''
      const payoffOccurred = sales.some(sale => sale.date <= asOf)
      return new Response(JSON.stringify([
        { grant_year: 2020, grant_type: 'Purchase', vested_shares: payoffOccurred ? 0 : 2000 },
        { grant_year: 2030, grant_type: 'Purchase', vested_shares: 0 },
      ]), { status: 200 })
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
  it('shows booked interest and exit savings when recorded tax savings are zero', async () => {
    mockApi(MOCK_PRICES, [], 321)
    renderDashboard()

    expect(await screen.findByRole('link', { name: 'See total compensation' })).toHaveAttribute('href', '/comp-calculator')
    await userEvent.click(await screen.findByText('Earnings and borrowing costs', {exact: true}))
    expect(await screen.findByText('Estimated tax savings through exit')).toBeVisible()
    expect(await screen.findByText('$321')).toBeInTheDocument()
    expect(screen.getByText('Interest booked on statements $800')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Investment interest deduction' })).toBeChecked()
  })

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
    expect(screen.getAllByText('$75,000').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', {name: 'Open next event'})).toHaveTextContent('Mar 1, 2027')
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

  it('hero leads with canonical exit cash and explicitly shows a settlement shortfall', async () => {
    mockApi()
    renderDashboard()

    // Value Today = $20,000 (see previous test); MOCK_LOANS has one outstanding $75,000 loan.
    // Net worth = $20,000 - $75,000 = -$55,000, not the gross $20,000 share value.
    await waitFor(() => {
      expect(screen.getByText(/Estimated cash if you left/)).toBeInTheDocument()
    })
    expect(await screen.findByText('Additional cash needed to settle: $55,000')).toBeInTheDocument()
    expect(screen.getByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')).toBeInTheDocument()
  })

  it('labels the value card with the selected date, not always "Today"', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Value Today')).toBeInTheDocument()
    })

    // Other mocked fetches (sales/taxSettings) can still resolve after "Value Today"
    // first appears. If one settles in the same tick as fireEvent.change below, the
    // resulting re-render can land between the DOM's value being set and React's
    // onChange reading it, so the controlled input gets reset to its old value first
    // and the date change is silently dropped (observed flaky in CI: cardDate stays
    // at TODAY). Flush any still-pending fetches/effects first — see the payoff-sale
    // test below, which hit the same race.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

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
      expect(screen.getByText(/Estimated cash if you left/)).toBeInTheDocument()
    })

    // grantHoldings (and so the hero card) only requires grantsData/events/loans to
    // have resolved — sales and taxSettings are optional inputs it tolerates being
    // null (see computeGrantHoldings) — so "Net worth" can appear while one of those
    // two is still in flight. If either settles in the same tick as fireEvent.change
    // below, the resulting re-render can land between the DOM's value being set and
    // React's onChange reading it, so the controlled input gets reset to its old
    // value first and the date change is silently dropped (observed flaky in CI:
    // cardDate stays at TODAY). Flush any still-pending fetches/effects first.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    const dateInput = screen.getByDisplayValue(new Date().toISOString().slice(0, 10))
    fireEvent.change(dateInput, { target: { value: '2027-01-02' } })

    // After the payoff: Grant 1 is fully liquidated (no more vested value) and its loan is
    // settled. Only Grant 2's $3,000 unvested cost-basis value remains — net worth must equal
    // that, not the stale $20,000 gross total (which would mean the sold shares were never
    // subtracted even though the loan they paid off was).
    await waitFor(() => {
      expect(screen.getByText('Value on Jan 2, 2027')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('$3,000').length).toBeGreaterThanOrEqual(2)
      expect(screen.queryByText('$20,000')).not.toBeInTheDocument()
    })
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
    expect(screen.getByText('Next stop')).toBeInTheDocument()
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
    const startInputs = screen.getAllByLabelText('From')
    const endInputs = screen.getAllByLabelText('To')
    expect(startInputs.length).toBeGreaterThanOrEqual(3)
    expect(endInputs.length).toBeGreaterThanOrEqual(3)
  })

  it('switches to custom range when date input changes', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Shares Over Time')).toBeInTheDocument()
    })
    const startInputs = screen.getAllByLabelText('From')
    fireEvent.change(startInputs[0], { target: { value: '2022-01-01' } })
    // The All button should no longer be active (indigo-600) - custom range is active
    // Just verify the input now has a value
    expect(startInputs[0]).toHaveValue('2022-01-01')
  })

  it('opens the next event directly from the hero without revealing a distant panel', async () => {
    mockApi()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByRole('link', {name: 'Open next event'})).toHaveTextContent('Mar 1, 2027')
    })
    expect(screen.queryByText('Vesting shares')).not.toBeInTheDocument()

    expect(screen.getByRole('link', {name: 'Open next event'})).toHaveAttribute('href', '/events?date=2027-03-01')
  })

  it('marks an estimated price change as the next event', async () => {
    mockApi()
    const estimate = {...MOCK_EVENTS[1], date: '2027-01-01', price_is_estimate: true,
      expected_announcement_date: '2027-03-01'}
    const original = MOCK_DASHBOARD_NEXT_OVERRIDE.value
    MOCK_DASHBOARD_NEXT_OVERRIDE.value = {next_event: {date: '2027-01-01', event_type: 'Share Price'}, next_event_detail: estimate}
    try {
      renderDashboard()
      await waitFor(() => {
        expect(screen.getByRole('link', {name: 'Open next event'})).toHaveTextContent('Jan 1, 2027')
      })
      expect(screen.getByText(/estimated price change/i)).toBeInTheDocument()
    } finally {
      MOCK_DASHBOARD_NEXT_OVERRIDE.value = original
    }
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
    expect(await screen.findByText(/Your last recorded share price is from 2021/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add a price' }))
    expect(screen.getByLabelText('Announced price', {exact: true})).toHaveFocus()
  })

  it('stays quiet once this year has a price', async () => {
    mockApi(MOCK_PRICES_CURRENT)
    renderDashboard()
    await screen.findByText(/Estimated cash if you left/i)
    expect(screen.queryByText(/Your last recorded share price is from/)).not.toBeInTheDocument()
  })

  it('does not treat the user\'s own estimate as knowing this year\'s price', async () => {
    mockApi(MOCK_PRICES_ESTIMATE_ONLY)
    renderDashboard()
    expect(await screen.findByText(/Your last recorded share price is from 2020/)).toBeInTheDocument()
  })

  it('stays dismissed for that year once dismissed', async () => {
    mockApi()
    const { unmount } = renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Your last recorded share price is from/)).not.toBeInTheDocument()

    unmount()
    renderDashboard()
    await screen.findByText(/Estimated cash if you left/i)
    expect(screen.queryByText(/Your last recorded share price is from/)).not.toBeInTheDocument()
  })
})

describe('server dashboard snapshots', () => {
  it('uses server-calculated interest instead of deriving it from raw loans', async () => {
    mockApi()
    renderDashboard()
    expect(await screen.findByText('$1,234')).toBeInTheDocument()
    expect(screen.getByText('Interest: Reconciled through 2026-03-01; estimated afterward')).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/dashboard?as_of='), expect.anything())
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/sales/holdings'), expect.anything())
  })

  it('hides previous totals while the chosen date loads and ignores late responses', async () => {
    mockApi()
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!
    const pending = new Map<string, (value: Response) => void>()
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input)
      const when = new URL(url, 'http://localhost').searchParams.get('as_of')
      if (url.includes('/api/dashboard?') && when?.startsWith('2028')) {
        return new Promise(resolve => pending.set(when, resolve))
      }
      return original(input, init)
    })
    renderDashboard()
    await screen.findByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')
    const input = document.querySelector('input[type=date]')!
    fireEvent.change(input, {target: {value: '2028-01-01'}})
    expect(screen.queryByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')).not.toBeInTheDocument()
    await waitFor(() => expect(pending.has('2028-01-01')).toBe(true))
    fireEvent.change(input, {target: {value: '2028-02-01'}})
    await waitFor(() => expect(pending.has('2028-02-01')).toBe(true))
    await act(async () => pending.get('2028-02-01')!(new Response(JSON.stringify({
      ...snapshotFor('2028-02-01'), cards: {...snapshotFor('2028-02-01').cards, total_stock_value: 123456},
    }))))
    await screen.findByText('$123,456')
    await act(async () => pending.get('2028-01-01')!(new Response(JSON.stringify(snapshotFor('2028-01-01')))))
    expect(screen.getByText('$123,456')).toBeInTheDocument()
    expect(input).toHaveValue('2028-02-01')
  })

  it('shows a retry instead of old totals after a dated request fails', async () => {
    mockApi()
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!
    let fail = true
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      if (String(input).includes('/api/dashboard?as_of=2028') && fail) return Promise.reject(new Error('Snapshot failed'))
      return original(input, init)
    })
    renderDashboard()
    await screen.findByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')
    fireEvent.change(document.querySelector('input[type=date]')!, {target: {value: '2028-01-01'}})
    await screen.findByRole('button', {name: 'Retry'})
    expect(screen.queryByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}))
    await screen.findByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')
  })
})

it('retries an initial failed snapshot request', async () => {
  mockApi()
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!
  let fail = true
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    if (String(input).includes('/api/dashboard?') && fail) return Promise.reject(new Error('First snapshot failed'))
    return original(input, init)
  })
  renderDashboard()
  await screen.findByText('Failed to load dashboard')
  fail = false
  fireEvent.click(screen.getByRole('button', {name: 'Retry'}))
  await screen.findByText('$17,000 vested shares + $3,000 unvested at cost − $75,000 loans − $0 est. tax')
})

it('keeps charts mounted and does not refetch them when the card date changes', async () => {
  mockApi()
  renderDashboard()
  const chart = await screen.findByText('Loan Payments by Due Year')
  const chartFetchCount = () => vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).includes('/api/dashboard/charts')).length
  expect(chartFetchCount()).toBe(1)
  fireEvent.change(document.querySelector('input[type=date]')!, {target: {value: '2026-11-30'}})
  expect(screen.getByText('Loan Payments by Due Year')).toBe(chart)
  await waitFor(() => expect(screen.getByText('Value on Nov 30, 2026')).toBeInTheDocument())
  expect(screen.getByText('Loan Payments by Due Year')).toBe(chart)
  expect(chartFetchCount()).toBe(1)
})


it('refreshes the primary exit amount after applying a tax or lot-selection tip', async () => {
  mockApi()
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!
  let changed = false
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/api/tips') && !changed) return new Response(JSON.stringify([{
      type: 'method', title: 'Change lot selection', description: 'Synthetic tip', savings: 100,
      apply: { lot_selection_method: 'lifo' },
    }]), {status: 200})
    if (url.includes('/api/tax-settings') && init?.method === 'PUT') {
      changed = true
      return new Response(JSON.stringify({...MOCK_TAX_SETTINGS, lot_selection_method: 'lifo'}), {status: 200})
    }
    const response = await original(input, init)
    if (url.includes('/api/preview-exit') && changed) return new Response(JSON.stringify({
      ...await response.json(), liquidation_net_cash: 4321, liquidation_shortfall: 0,
    }), {status: 200})
    return response
  })
  renderDashboard()
  await screen.findByText('Additional cash needed to settle: $55,000')
  await userEvent.click(screen.getByRole('button', {name: 'Apply'}))
  await waitFor(() => expect(screen.getByText('Estimated cash if you left today').parentElement).toHaveTextContent('$4,321'))
})

it('opens an inline price editor for unpriced holdings', async () => {
  MOCK_DASHBOARD_NEXT_OVERRIDE.value = {current_price: null, total_stock_value: null, vested_stock_value: null, net_equity: null}
  mockApi([])
  renderDashboard()
  expect(await screen.findByText(/Price not entered for this date/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', {name: 'Add a price'}))
  expect(screen.getByLabelText('Announced price', {exact: true})).toHaveFocus()
  expect(screen.getByRole('link', {name: /vested shares/})).toHaveAttribute('href', '/grants')
  expect(screen.getByText(/· Price not entered$/)).toBeVisible()
  expect(screen.queryByText('Value Today')).not.toBeInTheDocument()
  expect(screen.queryByText('If you exited on this date')).not.toBeInTheDocument()
  expect(screen.queryByText(/Exit estimate unavailable/)).not.toBeInTheDocument()
})

it('offers eligibility information instead of directly applying a deduction tip', async () => {
  mockApi()
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => String(input).includes('/api/tips')
    ? new Response(JSON.stringify([{type: 'deduction', title: 'Investment interest', description: 'Tip', savings: 100, apply: {deduct_investment_interest: true}}]))
    : original(input, init))
  renderDashboard()
  expect(await screen.findByRole('link', {name: 'Learn more'})).toHaveAttribute('href', '/settings#tax')
  expect(screen.queryByRole('button', {name: 'Apply'})).not.toBeInTheDocument()
  expect(screen.getByText(/You may be able to deduct/)).toBeInTheDocument()
})
