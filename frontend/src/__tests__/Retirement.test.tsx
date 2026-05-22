import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Retirement from '../app/pages/Retirement.tsx'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'
import { ViewingProvider } from '../scaffold/contexts/ViewingContext.tsx'

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

function mockApi(opts: {
  netCash?: number | null
  dob?: string | null
  savedParams?: Record<string, unknown> | null
  // Viewer-mode mocks (when vid is set on viewing context)
  sharedDob?: string | null
  sharedName?: string | null
  sharedParams?: Record<string, unknown> | null
} = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/sharing/view/') && url.includes('/retirement-params')) {
      return new Response(JSON.stringify({ params: opts.sharedParams ?? null }), { status: 200 })
    }
    if (url.includes('/api/sharing/view/') && url.includes('/profile')) {
      return new Response(JSON.stringify({
        date_of_birth: opts.sharedDob ?? null,
        name: opts.sharedName ?? 'Owner',
      }), { status: 200 })
    }
    if (url.includes('/api/sharing/view/') && url.includes('/preview-exit')) {
      return new Response(JSON.stringify(null), { status: 200 })
    }
    if (url.includes('/api/sharing/view/') && url.includes('/tax-settings')) {
      return new Response(JSON.stringify(TAX_SETTINGS), { status: 200 })
    }
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
            outstanding_accrued_interest: 0,
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
    expect(screen.getByRole('button', { name: /Simulate.*retirements.*years/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Retirement date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Date of birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Health insurance/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Plan until you're/i)).toBeInTheDocument()
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

  it('mentions Wisconsin brackets and the user state LTCG rate in the spending notes', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // The brackets line renders immediately (static text). The LTCG rate
    // ("9.85%") arrives from the async TaxSettings prefill — wait for it.
    // JSX puts the formatted percent and the surrounding text in separate
    // text nodes, so we match against the parent <p>'s combined textContent
    // rather than a regex that has to span the JSX boundary.
    await waitFor(() => expect(screen.getByText(/Wisconsin-specific/)).toBeInTheDocument())
    await waitFor(() => {
      const found = screen.getByText((_content, element) => {
        const txt = element?.textContent ?? ''
        return element?.tagName === 'P' && txt.includes('9.85%') && txt.includes('capital gains rate')
      })
      expect(found).toBeInTheDocument()
    })
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
    expect(screen.getByText(/Over 100%/i)).toBeInTheDocument()
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
    const slider = screen.getByLabelText(/When you claim/i) as HTMLInputElement
    slider.focus()
    // fireEvent simulating slider drag
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(slider, { target: { value: '70' } })
    // 8% × 3 = 124% of FRA
    await waitFor(() => expect(screen.getByText('124.0%')).toBeInTheDocument())
  })

  it('toggles the post-65 Medicare model checkbox', async () => {
    mockApi({ netCash: null })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Switch to Medicare costs at age 65/ }) as HTMLInputElement
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
    // Default 50 → 95 = 45 years of retirement
    expect(screen.getByText(/plan 45 years of retirement/)).toBeInTheDocument()
    const { fireEvent } = await import('@testing-library/react')
    const endSlider = screen.getByLabelText(/Plan until you're/i) as HTMLInputElement
    fireEvent.change(endSlider, { target: { value: '90' } })
    await waitFor(() => expect(screen.getByText(/plan 40 years of retirement/)).toBeInTheDocument())
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
    // Hint shows both today's age and the age-at-retirement-date.
    await waitFor(() => expect(screen.getByText(/Age \d+ today, \d+ at retirement/)).toBeInTheDocument())
  })

  it('shows missing-DOB warning when no DOB is set', async () => {
    mockApi({ netCash: null, dob: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Set your date of birth above/)).toBeInTheDocument()
  })

  it('does not render the standalone "Current age" tile (derived from DOB only)', async () => {
    mockApi({ netCash: null, dob: '1980-04-15' })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    await screen.findByLabelText(/Date of birth/i)
    // The old "Current age" read-only chip + its "Today − date of birth" hint
    // are gone; only the DOB hint should mention age now.
    expect(screen.queryByText(/Today\s*−\s*date of birth/)).not.toBeInTheDocument()
  })

  it('auto-fills default spend = 3% and min spend = 2% of total portfolio', async () => {
    // Exit preview = $8M; default spend → $240K, min spend → $160K.
    mockApi({ netCash: 8_000_000 })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const defaultSpend = await screen.findByLabelText(/^Default spend/) as HTMLInputElement
    await waitFor(() => expect(defaultSpend.value).toBe('240'))
    const minSpend = screen.getByLabelText(/^Minimum spend \(floor\)/) as HTMLInputElement
    expect(minSpend.tagName).toBe('INPUT')
    expect(minSpend.value).toBe('160')
  })

  it('respects user edits to spend (does not re-auto-fill after override)', async () => {
    mockApi({ netCash: 8_000_000 })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const defaultSpend = await screen.findByLabelText(/^Default spend/) as HTMLInputElement
    await waitFor(() => expect(defaultSpend.value).toBe('240'))
    await user.clear(defaultSpend)
    await user.type(defaultSpend, '500')
    expect(defaultSpend.value).toBe('500')
    // Now bump additional portfolio: total grows but defaultSpend should stick.
    const additional = screen.getByLabelText(/^Additional portfolio/) as HTMLInputElement
    await user.clear(additional)
    await user.type(additional, '4')
    expect(defaultSpend.value).toBe('500')
  })

  it('keeps the leading-zero typing flow stable (no "025" / "010" stuck)', async () => {
    mockApi({ netCash: 8_000_000 })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const additional = await screen.findByLabelText(/^Additional portfolio/) as HTMLInputElement
    // Stage: type a value, then position-cursor-at-start scenario via clear+retype.
    await user.clear(additional)
    await user.type(additional, '02')
    // While typing the field reflects the raw "02" — that's fine — but on blur
    // it normalizes to "2" (leading zero gone, parsed numeric value).
    additional.blur()
    await waitFor(() => expect(additional.value).toBe('2'))
  })

  it('reveals the Minimum-spend explainer when its info button is clicked', async () => {
    mockApi({ netCash: 8_000_000 })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    await screen.findByLabelText(/^Minimum spend/)
    const btn = screen.getByRole('button', { name: /Minimum spend.*explanation/i })
    expect(screen.queryByText(/Want to assume you'd never cut back/)).not.toBeInTheDocument()
    await user.click(btn)
    expect(screen.getByText(/Want to assume you'd never cut back/)).toBeInTheDocument()
  })

  it('reveals the σ scenario explainer when its info button is clicked', async () => {
    mockApi({ netCash: null })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: /Market outlook explanation/i })
    expect(screen.queryByText(/replay actual stretches of U\.S\. market history/i)).not.toBeInTheDocument()
    await user.click(btn)
    expect(screen.getByText(/replay actual stretches of U\.S\. market history/i)).toBeInTheDocument()
  })

  it('restores a saved retirement date on mount instead of resetting to today', async () => {
    mockApi({ netCash: null, savedParams: { retirementDate: '2030-06-15' } })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const dateInput = await screen.findByLabelText(/Retirement date/i) as HTMLInputElement
    await waitFor(() => expect(dateInput.value).toBe('2030-06-15'))
  })

  it('auto-persists the retirement date after a change (PUT to /api/retirement/params)', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const dateInput = await screen.findByLabelText(/^Retirement date/i) as HTMLInputElement
    const { fireEvent } = await import('@testing-library/react')
    // user.type doesn't reliably drive type="date" inputs in jsdom — fireEvent
    // is the supported way to set a value on them.
    fireEvent.change(dateInput, { target: { value: '2031-04-15' } })
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const matches = calls.filter(([input, init]: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? String(input)
        return url.includes('/api/retirement/params') && (init?.method ?? '').toUpperCase() === 'PUT'
      })
      const withDate = matches
        .map(c => JSON.parse((c[1] as { body: string }).body))
        // saveRetirementParams sends { params: {...} } — field lives one level in.
        .find(b => b?.params?.retirementDate === '2031-04-15')
      expect(withDate).toBeTruthy()
    }, { timeout: 2000 })
  })

  it('uses age at the retirement date (not today) as the simulation start age', async () => {
    // DOB 1980-04-15, default endAge=95. Pick retirement date 2036-04-15 →
    // age-at-retirement = 56 → horizon = 95 − 56 = 39 years (not the
    // "age today" horizon, which would be ~49).
    mockApi({ netCash: null, dob: '1980-04-15' })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const dateInput = await screen.findByLabelText(/^Retirement date/i) as HTMLInputElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(dateInput, { target: { value: '2036-04-15' } })
    await waitFor(() => expect(screen.getByText(/plan 39 years of retirement/)).toBeInTheDocument())
    expect(screen.getByText(/Retire at 56/)).toBeInTheDocument()
  })

  it('renders the owner-saved spouse data when viewing as a guest', async () => {
    // Owner has saved a scenario with spouse turned on. As a viewer, we should
    // see the toggle enabled, the spouse DOB pre-filled (read-only), and the
    // spouse SS section populated with the owner's values.
    sessionStorage.setItem('viewing_context', JSON.stringify({ invitationId: 7, name: 'Alice' }))
    mockApi({
      sharedDob: '1980-04-15',
      sharedName: 'Alice',
      sharedParams: {
        epicExit: 5,
        additional: 0,
        stockPct: 0.7,
        bondPct: 0.2,
        ssMonthly: 2500,
        claimAge: 67,
        currentAge: 46,
        endAge: 95,
        retirementDate: '2030-01-01',
        includeSpouse: true,
        spouseDOB: '1985-03-15',
        spouseSsMonthly: 1800,
        spouseClaimAge: 68,
        spouseCurrentAge: 41,
      },
    })
    render(
      <MemoryRouter>
        <ViewingProvider>
          <Retirement />
        </ViewingProvider>
      </MemoryRouter>,
    )
    const toggle = await screen.findByRole('checkbox', { name: /Include spouse/i }) as HTMLInputElement
    await waitFor(() => expect(toggle.checked).toBe(true))
    expect(toggle.disabled).toBe(true)
    const spouseDob = screen.getByLabelText(/Spouse date of birth/i) as HTMLInputElement
    await waitFor(() => expect(spouseDob.value).toBe('1985-03-15'))
    expect(spouseDob.disabled).toBe(true)
    const spouseFRA = screen.getByLabelText(/Spouse.s monthly benefit at age 67/i) as HTMLInputElement
    await waitFor(() => expect(spouseFRA.value).toBe('1800'))
    const spouseClaim = screen.getByLabelText(/When spouse claims/i) as HTMLInputElement
    await waitFor(() => expect(spouseClaim.value).toBe('68'))
  })

  it('toggles spouse fields on/off', async () => {
    mockApi({ netCash: null, dob: '1980-04-15' })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    // Spouse fields hidden by default.
    expect(screen.queryByLabelText(/Spouse date of birth/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Spouse.s monthly benefit at age 67/i)).not.toBeInTheDocument()
    const toggle = await screen.findByRole('checkbox', { name: /Include spouse/i })
    await user.click(toggle)
    expect(screen.getByLabelText(/Spouse date of birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Spouse.s monthly benefit at age 67/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/When spouse claims/i)).toBeInTheDocument()
  })

  it('renders the retirement date input as enabled for the data owner (not a shared viewer)', async () => {
    mockApi({ netCash: null })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    const dateInput = await screen.findByLabelText(/^Retirement date/i) as HTMLInputElement
    expect(dateInput.disabled).toBe(false)
  })
})
