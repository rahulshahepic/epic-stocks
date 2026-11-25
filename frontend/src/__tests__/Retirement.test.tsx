import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Retirement from '../app/pages/Retirement.tsx'
import * as retirementMath from '../app/pages/Retirement.math.ts'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'
import { ViewingProvider } from '../scaffold/contexts/ViewingContext.tsx'
import { useViewing } from '../scaffold/contexts/viewing.ts'

function ReturnToOwner() {
  const { clearViewing } = useViewing()
  return <button onClick={clearViewing}>Return to owner</button>
}

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

it.each([
  ['Epic cash in retirement plan', 'epicExit'],
  ['Taxable brokerage', 'taxableAdditional'],
  ['What you originally paid (basis)', 'additionalBasis'],
  ['401(k) / Traditional IRA', 'traditional'],
  ['Roth IRA / Roth 401(k)', 'roth'],
] as const)('enters %s in dollars, saves millions, and refuses values above the shared ceiling', async (label, key) => {
  mockApi({savedParams: {epicExitMode: 'manual', epicExit: 1, advanced: true, defaultSpend: 100, minSpend: 80}})
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await screen.findByLabelText(/^Default spend/)
  fireEvent.click(screen.getByRole('button', {name: 'Show advanced assumptions'}))
  const field = screen.getAllByLabelText(label, {exact: false}).find(el => el.tagName === 'INPUT') as HTMLInputElement
  fireEvent.change(field, {target: {value: '400000'}})
  fireEvent.blur(field)
  expect(field).toHaveValue(400000)
  expect(field.parentElement).toHaveTextContent('= $400,000')
  await waitFor(() => {
    const saved = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)).params)
    expect(saved.some(params => params?.[key] === 0.4)).toBe(true)
  })
  fireEvent.change(field, {target: {value: '1000000001'}})
  fireEvent.blur(field)
  expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(field.parentElement).toHaveAttribute('data-money-pending', 'true')
  fireEvent.click(screen.getByRole('button', {name: /Simulate.*retirements/}))
  expect(await screen.findByText('Check the highlighted dollar amounts before simulating.')).toBeVisible()
  await userEvent.clear(field)
  await userEvent.type(field, '400000')
  fireEvent.blur(field)
  expect(field).toHaveValue(400000)
  expect(field).toHaveAttribute('aria-invalid', 'false')
})

it('accepts plain-dollar spending and preserves thousands in saved parameters', async () => {
  mockApi({savedParams: {epicExitMode: 'manual', epicExit: 1, defaultSpend: 100, minSpend: 80}})
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  const field = await screen.findByLabelText(/^Default spend/)
  fireEvent.change(field, {target: {value: '140000'}})
  expect(field.parentElement).toHaveTextContent('= $140,000 per year')
  await waitFor(() => {
    const saved = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)).params)
    expect(saved.some(params => params?.defaultSpend === 140)).toBe(true)
  })
  fireEvent.change(field, {target: {value: '10000001'}})
  expect(field).toHaveAttribute('aria-invalid', 'true')
})

it('compares on paired paths and advances both ages without changing the saved date', async () => {
  mockApi({savedParams: {retirementDate: '2032-01-01', epicExitMode: 'manual', epicExit: 2, paths: 10,
    currentAge: 55, includeSpouse: true, spouseDOB: '1968-01-01', defaultSpend: 65, minSpend: 50}})
  const run = vi.spyOn(retirementMath, 'simulate')
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', {name: /Simulate 10 retirements/}))
  await userEvent.click(await screen.findByRole('button', {name: 'Compare one year later'}))
  expect(await screen.findByRole('columnheader', {name: 'Jan 1, 2033'})).toBeVisible()
  expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
    currentAge: 55, spouseCurrentAge: 64, simulationStartDate: '2032-01-01',
  }), expect.any(Number))
  expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
    currentAge: 56, spouseCurrentAge: 65, simulationStartDate: '2033-01-01', epicExit: 2,
  }), run.mock.calls[0][1])
  expect(vi.mocked(fetch).mock.calls.some(([, init]) =>
    init?.method === 'PUT' && JSON.parse(String(init.body)).params.retirementDate === '2033-01-01')).toBe(false)
})

it('warns about an invalid legacy amount while saving edits to other fields', async () => {
  mockApi({savedParams: {epicExitMode: 'manual', epicExit: 1, defaultSpend: 100, minSpend: null}})
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  expect(await screen.findByText(/This saved plan has a blank or out-of-range dollar amount/)).toBeVisible()
  fireEvent.change(screen.getByLabelText(/^Default spend/), {target: {value: '130000'}})
  await waitFor(() => {
    const saved = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)).params)
    expect(saved.some(params => params.defaultSpend === 130 && params.minSpend === null)).toBe(true)
  })
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
  emptyGrants?: boolean
  noPrices?: boolean
  netCash?: number | null
  dob?: string | null
  savedParams?: Record<string, unknown> | null
  /** Fail the saved-params read this many times, then succeed. */
  paramsFailures?: number
  // Viewer-mode mocks (when vid is set on viewing context)
  sharedDob?: string | null
  sharedName?: string | null
  sharedParams?: Record<string, unknown> | null
} = {}) {
  let paramsFailuresLeft = opts.paramsFailures ?? 0
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
    if (url === '/api/prices') return new Response(JSON.stringify(opts.noPrices ? [] : [{effective_date: '2020-01-01', price: 100}]), {status: 200})
    if (url === '/api/grants') return new Response(JSON.stringify(opts.emptyGrants ? [] : [{id: 1}]), {status: 200})
    if (url.includes('/api/preview-exit')) {
      const nc = opts.netCash
      const body = nc == null
        ? null
        : {
          date: new URL(url, 'http://localhost').searchParams.get('date'),
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
      if (paramsFailuresLeft > 0) {
        paramsFailuresLeft -= 1
        return new Response('{"detail":"boom"}', { status: 500 })
      }
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
    expect(screen.getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
    expect(screen.getByText(/total portfolio:/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simulate.*retirements.*years/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Retirement date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Date of birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Health insurance/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Plan until you're/i)).toBeInTheDocument()
  })

  it('pre-fills Epic cash in retirement plan from the exit preview at the chosen date', async () => {
    mockApi({ netCash: 4_500_000 })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )
    expect(await screen.findByDisplayValue('4500000')).toBeInTheDocument()
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
    await waitFor(() => expect(defaultSpend.value).toBe('240000'))
    const minSpend = screen.getByLabelText(/^Minimum spend \(floor\)/) as HTMLInputElement
    expect(minSpend.tagName).toBe('INPUT')
    expect(minSpend.value).toBe('160000')
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
    await waitFor(() => expect(defaultSpend.value).toBe('240000'))
    await user.clear(defaultSpend)
    await user.type(defaultSpend, '500')
    expect(defaultSpend.value).toBe('500')
    // Now bump additional portfolio: total grows but defaultSpend should stick.
    const additional = screen.getByLabelText(/^Taxable brokerage at retirement/) as HTMLInputElement
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
    const additional = await screen.findByLabelText(/^Taxable brokerage at retirement/) as HTMLInputElement
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
    await userEvent.click(screen.getByRole('button', { name: 'Show advanced assumptions' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Show advanced assumptions' }))
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
    mockApi({ netCash: 0 })
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
      const calls = (globalThis.fetch as unknown as {
        mock: { calls: [RequestInfo | URL, RequestInit | undefined][] }
      }).mock.calls
      const matches = calls.filter(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
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
    await userEvent.click(screen.getByRole('button', { name: 'Show advanced assumptions' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Show advanced assumptions' }))
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

  it('runs with a warning when retirement moves beyond a conditional purchase', async () => {
    mockApi({ savedParams: { retirementDate: '2030-06-15', epicExit: 5, epicExitMode: 'manual', paths: 10,
      plannedEvents: [{ id: 'car', title: 'Car', kind: 'vehicle', date: '2037-01-01',
        amountM: 0.2, condition: { requireFullSpending: true } }] } })
    render(<MemoryRouter><Retirement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText(/^Retirement date/)).toHaveValue('2030-06-15'))
    fireEvent.change(screen.getByLabelText(/^Retirement date/), { target: { value: '2040-06-15' } })
    const run = screen.getByRole('button', { name: /Simulate.*retirements/ })
    await waitFor(() => expect(run).toBeEnabled())
    fireEvent.click(run)
    expect(await screen.findByText(/Car: conditional ownership periods before retirement are skipped/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(run).toBeEnabled()
  })

  it('keeps result ages and purchasing-power year tied to the run until rerun', async () => {
    mockApi({ savedParams: {
      retirementDate: '2030-06-15', epicExit: 5, epicExitMode: 'manual', paths: 10, seed: 42,
      currentAge: 50, endAge: 95, defaultSpend: 100, minSpend: 80,
    } })
    render(<MemoryRouter><Retirement /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText(/^Retirement date/)).toHaveValue('2030-06-15'))
    const run = screen.getByRole('button', { name: /Simulate.*retirements/ })
    await waitFor(() => expect(run).toBeEnabled())
    fireEvent.click(run)
    expect(await screen.findByText(/Through age 95/)).toBeInTheDocument()
    expect(screen.getByText(/Through age 95.*2030 dollars/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Plan until you're/), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText(/^Retirement date/), { target: { value: '2032-06-15' } })
    expect(await screen.findByText(/Inputs changed.*Re-run/)).toBeInTheDocument()
    expect(screen.getByText(/Through age 95/)).toBeInTheDocument()
    expect(screen.queryByText(/Through age 90/)).not.toBeInTheDocument()
    expect(screen.getByText(/Through age 95.*2030 dollars/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan assumptions' }))
    const rerun = screen.getByRole('button', { name: 'Re-run simulation' })
    await waitFor(() => expect(rerun).toBeEnabled())
    fireEvent.click(rerun)
    expect(await screen.findByText(/Through age 90/)).toBeInTheDocument()
    expect(screen.getByText(/Through age 90.*2032 dollars/)).toBeInTheDocument()
    expect(screen.queryByText(/Inputs changed.*Re-run/)).not.toBeInTheDocument()
  })

  it('ignores a delayed shared-account response after returning to the owner', async () => {
    sessionStorage.setItem('viewing_context', JSON.stringify({ invitationId: 7, name: 'Alice' }))
    mockApi({ savedParams: { retirementDate: '2040-01-01' } })
    const fallback = vi.mocked(globalThis.fetch).getMockImplementation()!
    let resolveShared!: (response: Response) => void
    const delayedShared = new Promise<Response>(resolve => { resolveShared = resolve })
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('/api/sharing/view/7/retirement-params')) return delayedShared
      return fallback(input, init)
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ViewingProvider>
          <ReturnToOwner />
          <Retirement />
        </ViewingProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Return to owner' }))
    const dateInput = await screen.findByLabelText(/^Retirement date/i) as HTMLInputElement
    await waitFor(() => expect(dateInput.value).toBe('2040-01-01'))
    resolveShared(new Response(JSON.stringify({ params: { retirementDate: '2030-01-01' } }), { status: 200 }))
    await Promise.resolve()
    expect(dateInput.value).toBe('2040-01-01')
    expect(dateInput.disabled).toBe(false)
  })
})

describe('Retirement saved-params load failure', () => {
  it('says so and offers a retry instead of leaving the page inert', async () => {
    // The autosave refuses to write until the saved params have been read, so
    // running on defaults would overwrite them. Silently disabling the button
    // just moved the damage onto the user: no message, no retry, no way back
    // short of reloading.
    mockApi({ netCash: 0, paramsFailures: 1, savedParams: { minSpend: 90 } })
    render(
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn.t load your saved settings/i)
    expect(screen.getByRole('button', { name: /Simulate.*retirements/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Simulate.*retirements/i })).toBeDisabled()
      expect(screen.getByText(/Add your stock or savings to see a result/)).toBeVisible()
    })
  })
})

it('shows both working-life and retirement expenses in one list', async () => {
  mockApi({ savedParams: { retirementDate: '2032-01-01', epicExit: 5, paths: 10,
    plannedEvents: [
      { id: 'pre', title: 'First car', kind: 'vehicle', date: '2030-01-01', amountM: 0.1 },
      { id: 'post', title: 'Later car', kind: 'vehicle', date: '2035-01-01', amountM: 0.05 },
    ] } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await waitFor(() => expect(screen.getByLabelText(/^Retirement date/)).toHaveValue('2032-01-01'))
  expect(screen.queryByText('First car')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Planned Expenses' }))
  expect(screen.getByRole('region', { name: 'Before retirement funding schedule' })).toHaveTextContent('$100,000')
  const expenses = screen.getByRole('region', { name: 'Planned expenses' })
  expect(expenses).toHaveTextContent('First car')
  expect(expenses).toHaveTextContent('Later car')
  expect(expenses).toHaveTextContent('Starts before retirement')
  expect(expenses).toHaveTextContent('Starts during retirement')
})

it('saves the displayed retirement date when someone edits a retirement plan without changing its date', async () => {
  mockApi({ savedParams: { epicExitMode: 'manual', epicExit: 1, defaultSpend: 60 } })
  render(<MemoryRouter initialEntries={['/planning']}><Retirement /></MemoryRouter>)
  const spending = await screen.findByDisplayValue('60000')
  const date = (screen.getByLabelText(/^Retirement date/) as HTMLInputElement).value
  fireEvent.change(spending, { target: { value: '70000' } })
  await waitFor(() => {
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
    const saved = writes.map(([, init]) => JSON.parse(String(init?.body)).params).find(params => params.defaultSpend === 70)
    expect(saved).toMatchObject({ retirementDate: date })
  })
})

it('saves only the new expense when there is no retirement date', async () => {
  mockApi({ savedParams: {} })
  render(<MemoryRouter initialEntries={['/planning?view=expenses']}><Retirement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Add planned expense/ }))
  const date = screen.getByLabelText('Purchase / start date')
  expect(screen.getByLabelText(/^Retirement date/)).not.toBeVisible()
  fireEvent.change(date, { target: { value: '2029-02-01' } })
  fireEvent.change(screen.getByLabelText(/Purchase price/), { target: { value: '33000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  await waitFor(() => {
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')
    const saved = writes.map(([, init]) => JSON.parse(String(init?.body)))[0]
    expect(saved).toEqual({ plannedEvents: [expect.objectContaining({ date: '2029-02-01', amountM: 0.033, priceBasisDate: expect.any(String) })] })
  })
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/retirement/params' && init?.method === 'PUT')).toBe(false)
})

it('updates only expenses when a sparse retirement plan already has a date', async () => {
  mockApi({ savedParams: { retirementDate: '2033-01-01' } })
  render(<MemoryRouter initialEntries={['/planning?view=expenses']}><Retirement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Add planned expense/ }))
  fireEvent.change(screen.getByLabelText(/Purchase price/), { target: { value: '33000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(await screen.findByText('Expenses saved')).toBeVisible()
  const writes = vi.mocked(fetch).mock.calls.filter(([url, init]) => url === '/api/retirement/params' && init?.method)
  expect(writes.map(([, init]) => init?.method)).toEqual(['PATCH'])
})

it('shows a failed expense save and supports retry after a background tax refresh', async () => {
  mockApi({ savedParams: {} })
  const fetchOtherEndpoints = vi.mocked(fetch).getMockImplementation()!
  let releaseTaxRefresh = () => {}
  let releaseExpenseSave = () => {}
  const taxRefresh = new Promise<void>(resolve => { releaseTaxRefresh = resolve })
  const expenseSave = new Promise<void>(resolve => { releaseExpenseSave = resolve })
  let writes = 0
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (input === '/api/tax-settings') await taxRefresh
    if (input === '/api/retirement/params' && init?.method === 'PATCH' && ++writes === 1) {
      await expenseSave
      return new Response(JSON.stringify({ detail: 'Temporary save failure' }), { status: 500 })
    }
    return fetchOtherEndpoints(input, init)
  })

  render(<MemoryRouter initialEntries={['/planning?view=expenses']}><Retirement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Add planned expense/ }))
  fireEvent.change(screen.getByLabelText(/Purchase price/), { target: { value: '33000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(await screen.findByText('Saving expenses…')).toBeVisible()
  releaseTaxRefresh()
  releaseExpenseSave()
  fireEvent.click(await screen.findByRole('button', { name: 'Try saving again' }))
  expect(await screen.findByText('Expenses saved')).toBeVisible()
  expect(writes).toBe(2)
})

it('waits for an expense save when reopening Planning during the write', async () => {
  mockApi({ savedParams: {} })
  const fetchOtherEndpoints = vi.mocked(fetch).getMockImplementation()!
  let saved = {}
  let writeStarted = false
  let releaseWrite = () => {}
  const canFinish = new Promise<void>(resolve => { releaseWrite = resolve })
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (input !== '/api/retirement/params') return fetchOtherEndpoints(input, init)
    if (init?.method === 'PATCH') {
      writeStarted = true
      await canFinish
      saved = JSON.parse(String(init.body))
    }
    return new Response(JSON.stringify({ params: saved }))
  })
  const page = <MemoryRouter initialEntries={['/planning?view=expenses']}><Retirement /></MemoryRouter>
  const first = render(page)
  fireEvent.click(await screen.findByRole('button', { name: /Add planned expense/ }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekend cabin' } })
  fireEvent.change(screen.getByLabelText(/Purchase price/), { target: { value: '33000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  await waitFor(() => expect(writeStarted).toBe(true))
  first.unmount()
  render(page)
  expect(screen.getByText('Loading your planned expenses…')).toBeVisible()
  releaseWrite()
  expect(await screen.findByText('Weekend cabin')).toBeVisible()
})

it('keeps account balances and basis when hiding the breakdown or switching views', async () => {
  mockApi({ savedParams: { epicExit: 5, taxableAdditional: 3, additionalBasis: 1.2,
    traditional: 1, roth: 0.5, advanced: true, defaultSpend: 150, minSpend: 90 } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await screen.findByDisplayValue('1200000')
  await userEvent.click(screen.getByRole('button', { name: 'Show advanced assumptions' }))
  await userEvent.click(screen.getByRole('button', { name: /Hide account breakdown/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Show basic view' }))
  fireEvent.change(screen.getByLabelText(/^Taxable brokerage at retirement/), {target: {value: '4000000'}})
  await waitFor(() => {
    const saved = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body)).params).filter(Boolean)
    expect(saved.some(p => p.traditional === 1 && p.roth === 0.5 && p.additionalBasis === 1.2 && p.taxableAdditional === 4)).toBe(true)
  })
})

it('keeps a legacy amount initially and automatically projects when its date changes', async () => {
  mockApi({ netCash: 6_000_000, savedParams: { epicExit: 5, retirementDate: '2032-01-01' } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await screen.findByDisplayValue('5000000')
  expect(screen.getByText(/Saved exit amount kept for this date/)).toBeVisible()
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes('/api/preview-exit'))).toBe(false)
  fireEvent.change(screen.getByLabelText(/^Retirement date/), { target: { value: '2035-01-01' } })
  expect(await screen.findByDisplayValue('6000000')).toBeVisible()
  expect(screen.getByText(/Epic cash is projected for the retirement date/)).toBeVisible()
})

it('preserves an explicitly manual amount when the retirement date changes', async () => {
  mockApi({ savedParams: { epicExit: 5, epicExitMode: 'manual', retirementDate: '2032-01-01' } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await screen.findByDisplayValue('5000000')
  fireEvent.change(screen.getByLabelText(/^Retirement date/), { target: { value: '2035-01-01' } })
  expect(screen.getByText(/Changing the date keeps it/)).toBeVisible()
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes('/api/preview-exit'))).toBe(false)
  expect(screen.getByLabelText(/^Epic cash in retirement plan/)).toHaveValue(5000000)
})

it.each([
  { saved: { epicExitMode: 'manual' }, action: 'Use automatic exit projection' },
  { saved: {}, action: 'Refresh exit projection now' },
])('saves the updated exit after clicking $action', async ({ saved, action }) => {
  mockApi({ netCash: 2000000, savedParams: { ...saved, retirementDate: '2033-01-01', epicExit: 1 } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: action }))
  await waitFor(() => {
    const writes = vi.mocked(fetch).mock.calls.filter(([url, init]) => url === '/api/retirement/params' && init?.method === 'PUT')
    expect(writes.some(([, init]) => {
      const params = JSON.parse(String(init?.body)).params
      return params.epicExitMode === 'auto' && params.epicExit === 2 && params.retirementDate === '2033-01-01'
    })).toBe(true)
  })
})

it('pauses an automatic plan when projection fails and allows an explicit manual fallback', async () => {
  mockApi({ netCash: null, savedParams: { epicExit: 5, epicExitMode: 'auto', retirementDate: '2032-01-01' } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  expect(await screen.findByText(/No exit projection is available/)).toBeVisible()
  expect(screen.getByRole('button', { name: /Simulate.*retirements/ })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Enter a manual exit amount' }))
  expect(screen.getByRole('button', { name: /Simulate.*retirements/ })).toBeEnabled()
  expect(screen.getByLabelText(/^Epic cash in retirement plan/)).toHaveValue(5000000)
})

it('aborts the previous autosave when a newer spending edit supersedes it', async () => {
  mockApi({ netCash: 0, savedParams: { defaultSpend: 40, epicExitMode: 'manual', epicExit: 1 } })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  const spending = await screen.findByLabelText(/^Default spend/)
  fireEvent.change(spending, { target: { value: '60000' } })
  let signal: AbortSignal | undefined
  await waitFor(() => {
    const calls = vi.mocked(globalThis.fetch).mock.calls
    const first = calls.find(([, init]) => init?.method === 'PUT' && String(init.body).includes('"defaultSpend":60'))
    expect(first).toBeTruthy()
    signal = first?.[1]?.signal ?? undefined
    expect(signal?.aborted).toBe(false)
  }, { timeout: 2500 })
  fireEvent.change(spending, { target: { value: '77000' } })
  await waitFor(() => expect(signal?.aborted).toBe(true))
})


it('saves an empty-account plan with zero exit and preserves spending on reload', async () => {
  mockApi({ emptyGrants: true, netCash: null, savedParams: null })
  const first = render(<MemoryRouter><Retirement /></MemoryRouter>)
  expect(await screen.findByText(/No stock imported yet/)).toBeVisible()
  expect(screen.getByRole('button', {name: /Simulate.*retirements/})).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/^Default spend/), {target: {value: '77000'}})
  let saved: Record<string, unknown> | undefined
  await waitFor(() => {
    saved = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body)).params).find(p => p?.defaultSpend === 77)
    expect(saved).toMatchObject({epicExit: 0, epicExitMode: 'auto'})
  })
  first.unmount()
  mockApi({ emptyGrants: true, netCash: null, savedParams: saved })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  expect(await screen.findByText(/No stock imported yet/)).toBeVisible()
  expect(screen.getByLabelText(/^Default spend/)).toHaveValue(77000)
})

for (const noPrices of [true, false]) {
  it(`saves spending when an automatic exit is ${noPrices ? 'missing a price' : 'unavailable'}`, async () => {
    mockApi({ noPrices, netCash: null, savedParams: {defaultSpend: 70, epicExit: 5, epicExitMode: 'auto', retirementDate: '2032-01-01'} })
    const first = render(<MemoryRouter><Retirement /></MemoryRouter>)
    await screen.findByText(noPrices ? /Add a share price to project your exit/ : /No exit projection is available/)
    if (noPrices) expect(screen.getByRole('link', {name: 'Add a price'})).toHaveAttribute('href', '/prices')
    fireEvent.change(screen.getByLabelText(/^Default spend/), {target: {value: '80000'}})
    let saved: Record<string, unknown> | undefined
    await waitFor(() => {
      saved = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
        .map(([, init]) => JSON.parse(String(init?.body)).params).find(p => p?.defaultSpend === 80)
      expect(saved).toMatchObject({defaultSpend: 80, epicExitMode: 'auto'})
      if (noPrices) expect(saved?.epicExit).toBe(0)
      else expect(saved).not.toHaveProperty('epicExit')
    })
    first.unmount()
    mockApi({ noPrices, netCash: null, savedParams: saved })
    render(<MemoryRouter><Retirement /></MemoryRouter>)
    await screen.findByText(noPrices ? /Add a share price to project your exit/ : /No exit projection is available/)
    expect(screen.getByLabelText(/^Default spend/)).toHaveValue(80000)
  })
}

it('saves other inputs while an automatic preview is still pending, then saves the resolved exit', async () => {
  mockApi({netCash: 4_000_000, savedParams: {defaultSpend: 70, epicExit: 5, epicExitMode: 'auto', retirementDate: '2032-01-01'}})
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!
  let resolvePreview!: () => void
  const pending = new Promise<void>(resolve => { resolvePreview = resolve })
  vi.mocked(globalThis.fetch).mockImplementation(async (...args) => {
    if (String(args[0]).includes('/api/preview-exit')) await pending
    return original(...args)
  })
  render(<MemoryRouter><Retirement /></MemoryRouter>)
  await screen.findByText(/exit projection pending/)
  fireEvent.change(screen.getByLabelText(/^Default spend/), {target: {value: '80000'}})
  await waitFor(() => {
    const saved = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body)).params).find(p => p?.defaultSpend === 80)
    expect(saved).toMatchObject({epicExitMode: 'auto', retirementDate: '2032-01-01'})
    expect(saved).not.toHaveProperty('epicExit')
  })
  resolvePreview()
  await waitFor(() => {
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => init?.method === 'PUT'
      && JSON.parse(String(init.body)).params?.epicExit === 4)).toBe(true)
  })
})
