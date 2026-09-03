import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import Try from '../app/pages/Try.tsx'
import { platform } from '../platform/index.ts'

const CLEAN = {
  wizard_payload: {
    grants: [{ year: 2022, type: 'Bonus', shares: 100, price: 0, vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', dp_shares: 0, election_83b: false, loans: [] }],
    prices: [{ effective_date: '2024-01-01', price: 12.5 }],
  },
  timeline: [
    { date: '2022-12-31', grant_year: 2022, grant_type: 'Bonus', event_type: 'Exercise', granted_shares: 100, grant_price: 0, exercise_price: 0, vested_shares: null, price_increase: 0, share_price: 0, cum_shares: 0, income: 0, cum_income: 0, vesting_cap_gains: 0, price_cap_gains: 0, total_cap_gains: 0, cum_cap_gains: 0 },
    { date: '2023-09-30', grant_year: 2022, grant_type: 'Bonus', event_type: 'Vesting', granted_shares: null, grant_price: 0, exercise_price: null, vested_shares: 34, price_increase: 0, share_price: 12.5, cum_shares: 34, income: 425, cum_income: 425, vesting_cap_gains: 0, price_cap_gains: 0, total_cap_gains: 0, cum_cap_gains: 0 },
  ],
  summary: { grants: 1, loans: 0, prices: 1, total_shares: 100, total_loan_balance: 0, grant_years: [2022] },
  findings: [],
  blocked: false,
  reconciles: true,
}

const BLOCKED = {
  ...CLEAN,
  timeline: [],
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

async function readFiles() {
  await userEvent.upload(screen.getByLabelText(/Data for Stock Workbook/i), csv())
  await userEvent.click(screen.getByRole('button', { name: 'See my numbers' }))
}

describe('Try page (no-account preview)', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('will not read until a file is chosen', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByRole('button', { name: 'See my numbers' })).toBeDisabled()
  })

  it('says no account or upload is required, up front', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByText(/No account needed/i)).toBeInTheDocument()
  })

  it('shows the computed timeline and summary without ever logging in', async () => {
    mockFetch(CLEAN)
    renderTry()
    await readFiles()

    expect(await screen.findByText('Vesting')).toBeInTheDocument()
    expect(screen.getByText('$425')).toBeInTheDocument() // cum_income
    expect(screen.getByText('Everything reconciles against the totals in your own paperwork.')).toBeInTheDocument()
  })

  it('tells the person plainly that a blocked read needs signup to fix', async () => {
    mockFetch(BLOCKED)
    renderTry()
    await readFiles()

    expect(await screen.findByText(/doesn't add up to its own totals/)).toBeInTheDocument()
    expect(screen.getByText(/Sign up to finish this in the full import wizard/)).toBeInTheDocument()
  })

  it('sells the reasons to save, not just the numbers', async () => {
    mockFetch(CLEAN)
    renderTry()
    await readFiles()

    expect(await screen.findByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Retirement planning')).toBeInTheDocument()
    expect(screen.getByText('Comp calculation')).toBeInTheDocument()
  })

  it('stashes the wizard payload and sends the user to sign in on save', async () => {
    mockFetch(CLEAN)
    renderTry()
    await readFiles()

    await userEvent.click(await screen.findByRole('button', { name: /Save my numbers/i }))

    const stashed = await platform.storage.get('trial_wizard_payload')
    expect(stashed).not.toBeNull()
    expect(JSON.parse(stashed as string)).toEqual(CLEAN.wizard_payload)
  })

  it('lets someone start over with different files', async () => {
    mockFetch(CLEAN)
    renderTry()
    await readFiles()

    await userEvent.click(await screen.findByRole('button', { name: 'Start over with different files' }))
    expect(screen.getByRole('button', { name: 'See my numbers' })).toBeDisabled()
  })

  it('surfaces a server error instead of a blank panel', async () => {
    mockFetch(new Response(JSON.stringify({ detail: 'Upload your share summary CSV' }), { status: 400 }))
    renderTry()
    await readFiles()
    expect(await screen.findByText('Upload your share summary CSV')).toBeInTheDocument()
  })

  it('links back to sign-in for anyone who already has an account', () => {
    mockFetch(CLEAN)
    renderTry()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})
