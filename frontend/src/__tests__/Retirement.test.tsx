import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Retirement from '../app/pages/Retirement.tsx'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  resetMeCache()
  // recharts ResponsiveContainer measures the parent; jsdom needs a stub.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const TAX_SETTINGS = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0985,
  state_lt_cg_rate: 0.0985,
  state_st_cg_rate: 0.0985,
  lt_holding_days: 366,
  lot_selection_method: 'epic_lifo',
  loan_payoff_method: 'same_tranche',
  flexible_payoff_enabled: true,
  prefer_stock_dp: false,
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

function mockApi(opts: { netCash?: number | null; dob?: string | null; savedParams?: Record<string, unknown> | null } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/preview-exit')) {
      const nc = opts.netCash
      const body = nc == null
        ? null
        : {
            date: '2026-05-07',
            vested_shares: 1000,
            share_price: 100,
            gross_vested: 100000,
            unvested_cost_proceeds: 0,
            liquidation_tax: 0,
            outstanding_principal: 0,
            prior_sales: [],
            prior_sales_net: 0,
            income_tax: 0,
            deduction_savings: 0,
            deduction_years: [],
            deduction_excluded_years: [],
            net_cash: nc,
          }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    if (url.includes('/api/tax-settings')) {
      return new Response(JSON.stringify(TAX_SETTINGS), { status: 200 })
    }
    if (url.includes('/api/retirement/params')) {
      return new Response(JSON.stringify({ params: opts.savedParams ?? null }), { status: 200 })
    }
    if (url.endsWith('/api/me') || url.includes('/api/me?')) {
      return new Response(JSON.stringify({
        id: 1, email: 't@t.com', name: 'Test',
        is_admin: false, is_content_admin: false,
        shared_accounts: [],
        date_of_birth: opts.dob ?? null,
      }), { status: 200 })
    }
    if (url.includes('/api/me/profile')) {
      return new Response(JSON.stringify({ date_of_birth: opts.dob ?? null }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
}

describe('Retirement page', () => {
  it('renders the parameter form with defaults', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /retirement simulator/i })).toBeInTheDocument()
    expect(screen.getByText(/total portfolio:/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run.*paths.*years/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Retirement date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Date of birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Health insurance/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Simulate until age/i)).toBeInTheDocument()
  })

  it('pre-fills Epic exit value from the exit preview at the chosen date', async () => {
    mockApi({ netCash: 4_500_000 })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(await screen.findByDisplayValue('4.5')).toBeInTheDocument()
  })

  it('pre-fills refill tax drag from blended LT cap-gains rate', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // 0.20 + 0.0985 + 0.038 = 0.3365 → 33.65 → rounded to 33.7
    expect(await screen.findByDisplayValue('33.7')).toBeInTheDocument()
  })

  it('shows cash = 100 − stocks − bonds', async () => {
    mockApi({ netCash: null })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // Default 70% stocks + 20% bonds → 10% cash
    await waitFor(() => expect(screen.getByText('10%')).toBeInTheDocument())
    const stocksInput = screen.getByLabelText(/^Stocks/) as HTMLInputElement
    await user.clear(stocksInput)
    await user.type(stocksInput, '50')
    // 50% stocks + 20% bonds → 30% cash
    await waitFor(() => expect(screen.getByText('30%')).toBeInTheDocument())
  })

  it('flags allocation overflow when stocks + bonds > 100%', async () => {
    mockApi({ netCash: null })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const bondsInput = screen.getByLabelText(/^Bonds/) as HTMLInputElement
    await user.clear(bondsInput)
    await user.type(bondsInput, '50')
    expect(screen.getByText(/Stocks \+ Bonds > 100%/i)).toBeInTheDocument()
  })

  it('shows SS adjustment factor and adjusted monthly amount', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // FRA = 67, default claim 67 → 100%
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    expect(screen.getByText(/\$2500\/mo/)).toBeInTheDocument()
  })

  it('updates SS adjustment when the claim-age slider changes', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const slider = screen.getByLabelText(/Claim age/i) as HTMLInputElement
    slider.focus()
    // fireEvent simulating slider drag
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(slider, { target: { value: '70' } })
    // 8% × 3 = 124% of FRA
    await waitFor(() => expect(screen.getByText('124.0%')).toBeInTheDocument())
  })

  it('toggles the post-65 health-insurance zero-out checkbox', async () => {
    mockApi({ netCash: null })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Zero out health insurance after age 65/ }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    await user.click(checkbox)
    expect(checkbox.checked).toBe(false)
  })

  it('updates horizon when end age slider changes', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // Default 50 → 95 = 45-year horizon
    expect(screen.getByText(/45-year horizon/)).toBeInTheDocument()
    const { fireEvent } = await import('@testing-library/react')
    const endSlider = screen.getByLabelText(/Simulate until age/i) as HTMLInputElement
    fireEvent.change(endSlider, { target: { value: '90' } })
    await waitFor(() => expect(screen.getByText(/40-year horizon/)).toBeInTheDocument())
  })

  it('derives current age from the saved DOB', async () => {
    // DOB 1980-04-15 with TODAY = current real date in test env. We just check
    // the input picks up the value and the derived hint is rendered.
    mockApi({ netCash: null, dob: '1980-04-15' })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const dobInput = await screen.findByLabelText(/Date of birth/i) as HTMLInputElement
    await waitFor(() => expect(dobInput.value).toBe('1980-04-15'))
    // Hint references "Saved · current age" and the derived integer.
    await waitFor(() => expect(screen.getByText(/Saved · current age/)).toBeInTheDocument())
  })

  it('shows missing-DOB warning when no DOB is set', async () => {
    mockApi({ netCash: null, dob: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Set date of birth above/)).toBeInTheDocument()
  })
})
