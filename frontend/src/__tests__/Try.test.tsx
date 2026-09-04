import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import Try from '../app/pages/Try.tsx'
import { platform } from '../platform/index.ts'

// Dates are deliberately far from "today" in both directions so the as-of
// control has something to move between whenever this suite runs.
const PAST = '2020-06-30'
const FUTURE = '2099-06-30'

function event(over: Record<string, unknown>) {
  return {
    date: PAST, grant_year: 2020, grant_type: 'Bonus', event_type: 'Vesting',
    granted_shares: null, grant_price: 0, exercise_price: null, vested_shares: 100,
    price_increase: 0, share_price: 10, cum_shares: 100, income: 1000, cum_income: 1000,
    vesting_cap_gains: 0, price_cap_gains: 0, total_cap_gains: 0, cum_cap_gains: 0,
    ...over,
  }
}

const CLEAN = {
  wizard_payload: {
    grants: [{ year: 2020, type: 'Bonus', shares: 400, price: 0, vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', dp_shares: 0, election_83b: false, loans: [] }],
    prices: [{ effective_date: PAST, price: 10 }],
  },
  grants: [
    // Fully vested by any plausible "today": 4 yearly periods from 2021.
    { id: -1, year: 2020, type: 'Bonus', shares: 400, price: 5, vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', dp_shares: 0, election_83b: false, version: 1 },
    // Never vested within the dates this suite uses — its 200 shares must still
    // be valued, at their $8 cost basis, or net worth understates by $1,600.
    { id: -2, year: 2024, type: 'Purchase', shares: 200, price: 8, vest_start: '2199-09-30', periods: 2, exercise_date: '2024-12-31', dp_shares: 0, election_83b: false, version: 1 },
  ],
  loans: [{ id: -1001, grant_year: 2020, grant_type: 'Bonus', loan_type: 'Purchase', loan_year: 2020, amount: 700, interest_rate: 0.01, due_date: '2029-07-15', loan_number: 'L-1', refinances_loan_id: null, version: 1 }],
  prices: [
    { id: -1, effective_date: PAST, price: 10, is_estimate: false, version: 1 },
    { id: -2, effective_date: FUTURE, price: 25, is_estimate: false, version: 1 },
  ],
  timeline: [
    event({}),
    event({ date: FUTURE, share_price: 25, vested_shares: 100, cum_shares: 200, income: 2500, cum_income: 3500 }),
  ],
  summary: { grants: 1, loans: 1, prices: 2, total_shares: 400, total_loan_balance: 700, grant_years: [2020] },
  price_is_stale: false,
  tax_defaults: {
    federal_income_rate: 0.37, federal_lt_cg_rate: 0.2, federal_st_cg_rate: 0.37,
    niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0536,
    state_st_cg_rate: 0.0765, lt_holding_days: 365, lot_selection_method: 'lifo',
    loan_payoff_method: 'epic_lifo', flexible_payoff_enabled: false, prefer_stock_dp: false,
    deduct_investment_interest: false, deduction_excluded_years: null, taxable_years: [],
  },
  findings: [],
  blocked: false,
  reconciles: true,
}

const BLOCKED = {
  ...CLEAN,
  blocked: true,
  reconciles: false,
  findings: [
    { code: 'C1', severity: 'error', subject: '2031',
      message: "The statement's own subtotal for 2031 is 2,032,000.00." },
  ],
}

function mockFetch(...responses: unknown[]) {
  const calls: Array<{ url: string; body: FormData | null }> = []
  let i = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push({ url, body: (init?.body as FormData) ?? null })
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return calls
}

const csv = () => new File(['a,b'], 'shares.csv', { type: 'text/csv' })

function renderTry() {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={['/try']}>
        <Try />
      </MemoryRouter>
    </AppProvider>
  )
}

async function upload() {
  await userEvent.upload(screen.getByLabelText(/Data for Stock Workbook/i), csv())
  await userEvent.click(screen.getByRole('button', { name: 'See my numbers' }))
}

describe('Try — upload stage', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('will not read until a file is chosen', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByRole('button', { name: 'See my numbers' })).toBeDisabled()
  })

  it('says no account is needed, up front', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByText(/No account needed/i)).toBeInTheDocument()
  })

  it('surfaces a server error instead of a blank panel', async () => {
    mockFetch(new Response(JSON.stringify({ detail: 'Upload your share summary CSV' }), { status: 400 }))
    renderTry()
    await upload()
    expect(await screen.findByText('Upload your share summary CSV')).toBeInTheDocument()
  })

  it('links to sign-in for anyone who already has an account', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('Try — preview', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows a dashboard, not a table dump, and never logs in to do it', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    // Vested 400 × $10 = $4,000, plus unvested 200 at their $8 cost = $1,600,
    // less $700 of loans.
    expect(await screen.findByText('Net worth · as of', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('$4,900')).toBeInTheDocument()
    expect(screen.getByText('Vested shares')).toBeInTheDocument()
    expect(screen.getByText('Loan balance')).toBeInTheDocument()
  })

  it('values unvested shares at cost, not at zero', async () => {
    // The regression this pins: valuing only vested shares while still
    // subtracting every loan reported a *negative* net worth to a real user
    // whose position was millions in the black.
    mockFetch(CLEAN)
    renderTry()
    await upload()

    expect(await screen.findByText('Unvested shares')).toBeInTheDocument()
    // The count shows in both the hero line and its own card.
    expect(screen.getAllByText('200').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('$1,600')).toBeInTheDocument()       // 200 × $8 cost
    expect(screen.getByText('$5,600')).toBeInTheDocument()       // 4,000 + 1,600
    expect(screen.getByText('Vested at FMV + unvested at cost basis')).toBeInTheDocument()
  })

  it('asks for the current price when the files only carry older ones', async () => {
    mockFetch({ ...CLEAN, price_is_stale: true })
    renderTry()
    await upload()

    expect(await screen.findByText(/newest price in your files/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Current share price')).toBeInTheDocument()
  })

  it('does not ask for a price when the files are already current', async () => {
    mockFetch(CLEAN)   // price_is_stale: false
    renderTry()
    await upload()

    await screen.findByText('Net worth · as of', { exact: false })
    expect(screen.queryByLabelText('Current share price')).not.toBeInTheDocument()
  })

  it('re-reads the files with the entered price rather than guessing one', async () => {
    const calls = mockFetch({ ...CLEAN, price_is_stale: true })
    renderTry()
    await upload()

    await userEvent.type(await screen.findByLabelText('Current share price'), '12.50')
    await userEvent.click(screen.getByRole('button', { name: 'Use this price' }))

    // A second analyze call, carrying the price — the server recomputes the whole
    // timeline from it, so the charts and the cards cannot disagree.
    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].body?.get('current_price')).toBe('12.5')
    expect(await screen.findByText(/Valued at the .* you entered for today/)).toBeInTheDocument()
  })

  it('says plainly that nothing has been saved', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()
    expect(await screen.findByText(/Preview · nothing saved/)).toBeInTheDocument()
  })

  it('moves the whole position when the as-of date moves', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    // Today, at the $10 price: 4,000 vested + 1,600 unvested − 700 loans.
    expect(await screen.findByText('$4,900')).toBeInTheDocument()

    // Past the future price event, at $25: 10,000 vested + 1,600 − 700.
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2099-12-31' } })
    expect(await screen.findByText('$10,900')).toBeInTheDocument()
  })

  it('jumps to the last event with the shortcut', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: 'Last event' }))
    expect(await screen.findByText('$10,900')).toBeInTheDocument()
  })

  it('has a Today shortcut on the date control', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()
    expect(await screen.findByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last event' })).toBeInTheDocument()
  })

  it('switches to the events timeline on the Events tab', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: 'Events' }))
    expect(await screen.findByText('2 computed events')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Vesting').length).toBe(2)
  })

  it('sells what an account adds, not just the numbers', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    expect(await screen.findByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Retirement simulator')).toBeInTheDocument()
    expect(screen.getByText('Total comp calculator')).toBeInTheDocument()
    expect(screen.getByText('Sales you have already made')).toBeInTheDocument()
  })

  it('stashes the computed data and sends the user to sign in on save', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: /Save my numbers/i }))

    const stashed = await platform.storage.get('trial_wizard_payload')
    expect(stashed).not.toBeNull()
    expect(JSON.parse(stashed as string)).toEqual(CLEAN.wizard_payload)
  })

  it('counts the save press, carrying no payload with it', async () => {
    const calls = mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: /Save my numbers/i }))

    const ping = calls.find(c => c.url.includes('/api/trial/save-intent'))
    expect(ping).toBeDefined()
    expect(ping?.body).toBeNull()   // a bare POST — nothing about the visitor
  })

  it('still navigates when the funnel count fails', async () => {
    // Analyze succeeds, the ping 500s. Counting must never block the person.
    mockFetch(CLEAN, new Response('nope', { status: 500 }))
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: /Save my numbers/i }))
    expect(await platform.storage.get('trial_wizard_payload')).not.toBeNull()
  })

  it('offers the same save from the sticky header', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: 'Save & sign up' }))
    expect(await platform.storage.get('trial_wizard_payload')).not.toBeNull()
  })

  it('lets someone start over with different files', async () => {
    mockFetch(CLEAN)
    renderTry()
    await upload()

    await userEvent.click(await screen.findByRole('button', { name: 'New files' }))
    expect(screen.getByRole('button', { name: 'See my numbers' })).toBeDisabled()
  })

  it('says a blocked read needs signup to repair, and still shows what it got', async () => {
    mockFetch(BLOCKED)
    renderTry()
    await upload()

    expect(await screen.findByText(/doesn't add up to its own totals/)).toBeInTheDocument()
    expect(screen.getByText('C1')).toBeInTheDocument()
    expect(screen.getByText(/Sign up to finish this in the full import wizard/)).toBeInTheDocument()
  })
})
