import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Retirement from '../app/pages/Retirement.tsx'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  // recharts ResponsiveContainer measures the parent; jsdom needs a stub.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

function mockExitPreview(netCash: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/preview-exit')) {
      const body = netCash == null
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
            net_cash: netCash,
          }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
}

describe('Retirement page', () => {
  it('renders the parameter form with defaults', async () => {
    mockExitPreview(null)
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /retirement simulator/i })).toBeInTheDocument()
    expect(screen.getByText(/total starting wealth/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run.*paths.*years/i })).toBeInTheDocument()
  })

  it('pre-fills Epic exit value from the exit preview ($M)', async () => {
    mockExitPreview(4_500_000)
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const epicInput = await screen.findByDisplayValue('4.5')
    expect(epicInput).toBeInTheDocument()
  })

  it('lets the user override the equity allocation and scenario', async () => {
    mockExitPreview(null)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )

    const allocInput = screen.getByLabelText(/Equity allocation/i) as HTMLInputElement
    await user.clear(allocInput)
    await user.type(allocInput, '60')
    expect(allocInput.value).toBe('60')

    await user.click(screen.getByRole('button', { name: /Cautious/i }))
    expect(screen.getByText(/Equity 3.5%/)).toBeInTheDocument()
  })

  it('shows SS adjustment factor changing with claim age', async () => {
    mockExitPreview(null)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )

    // FRA = 67, so default factor is 100%
    expect(screen.getByText('100.0%')).toBeInTheDocument()

    const claimInput = screen.getByLabelText(/Claim age/i) as HTMLInputElement
    await user.clear(claimInput)
    await user.type(claimInput, '70')
    // 8% × 3 years = 124%
    expect(screen.getByText('124.0%')).toBeInTheDocument()
  })
})
