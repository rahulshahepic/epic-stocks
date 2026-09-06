import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportWizard from '../app/components/ImportWizard.tsx'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mockNavigate,
}))
import { resetContentCache, setContentCacheForTesting } from '../app/hooks/useContent.ts'
import { MOCK_CONTENT } from './fixtures/content.ts'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  resetContentCache()
  setContentCacheForTesting(MOCK_CONTENT)
  mockNavigate.mockClear()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/api/wizard/parse-file') && method === 'POST') {
      return new Response(JSON.stringify({
        grants: [
          { year: 2021, type: 'Purchase', periods: 4, vest_start: '2022-03-01', exercise_date: '2021-12-31', price: 2.50 },
        ],
        prices: [
          { effective_date: '2021-12-31', price: 2.50 },
        ],
      }), { status: 200 })
    }
    if (url.includes('/api/wizard/submit') && method === 'POST') {
      return new Response(JSON.stringify({ grants: 1, loans: 0, prices: 1, payoff_sales: 0 }), { status: 201 })
    }
    if (url.includes('/api/prices') && method === 'GET') {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/api/grants') && method === 'GET') {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/api/loans') && method === 'GET') {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/api/config')) {
      return new Response(JSON.stringify({ epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
    }
    if (url.includes('/api/content')) {
      return new Response(JSON.stringify(MOCK_CONTENT), { status: 200 })
    }
    if (url.includes('/api/tax-settings')) {
      return new Response(JSON.stringify({
        federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
        niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
        lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
        flexible_payoff_enabled: false, prefer_stock_dp: false,
        deduct_investment_interest: false,
      }), { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderWizard(onComplete = vi.fn()) {
  return render(
    <MemoryRouter>
      <ImportWizard onComplete={onComplete} />
    </MemoryRouter>
  )
}

/** Render the wizard over an imported draft, the way EpicFileImport hands one over. */
function renderWizardWithPrefill(
  loan: { interest_rate: number; due_date: string },
  dp_shares = 0,
) {
  const prefill = {
    grants: [{
      id: -1, version: 1, year: 2018, type: 'Purchase', shares: 1000, price: 2.00,
      vest_start: '2020-06-15', periods: 6, exercise_date: '2018-12-31',
      dp_shares, election_83b: false,
    }],
    loans: [{
      id: -1001, version: 1, grant_year: 2018, grant_type: 'Purchase',
      loan_type: 'Purchase', loan_year: 2018, amount: 100000,
      interest_rate: loan.interest_rate, due_date: loan.due_date,
      loan_number: '001468', refinances_loan_id: null,
    }],
    prices: [{ id: -1, version: 1, effective_date: '2018-01-01', price: 2.00 }],
  }
  return render(
    <MemoryRouter>
      <ImportWizard onComplete={vi.fn()} prefill={prefill} />
    </MemoryRouter>
  )
}

/** Walk an imported draft through to the refinance-chain screen. */
async function gotoRefiScreen(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
  await user.click(screen.getByRole('button', { name: /Let's go/i }))
  await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
  await user.click(screen.getByRole('button', { name: /Next: Review loans/i }))
  await waitFor(() => expect(screen.getByRole('heading', { name: /Tax loans/i })).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /Next: Refinances/i }))
  await waitFor(() => expect(screen.getByRole('heading', { name: /Refinance chains/i })).toBeInTheDocument())
}

/** Fill the manual-entry Purchase grant with values that pass Review-screen validation. */
async function fillValidPurchaseGrant(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Grant year/i) as HTMLInputElement, '2024')
  await user.type(screen.getByLabelText(/^Shares$/i) as HTMLInputElement, '100')
  await user.type(screen.getByLabelText(/Cost basis/i) as HTMLInputElement, '1.50')
  await user.type(screen.getByLabelText(/Vest start/i) as HTMLInputElement, '2025-09-30')
  await user.type(screen.getByLabelText(/Exercise date/i) as HTMLInputElement, '2024-12-31')
}

describe('ImportWizard', () => {
  it('leads with the Shareworks import and keeps the slower paths available', () => {
    mockApi()
    renderWizard()
    expect(screen.getByText("Let's set up your equity tracker.")).toBeInTheDocument()
    // The fastest path is offered first and is the only one badged.
    expect(screen.getByRole('button', { name: /Import from Shareworks/i })).toBeInTheDocument()
    expect(screen.getByText('Fastest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enter it myself/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import a Vesting.xlsx/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Manual entry/i })).toBeInTheDocument()
  })

  it('sends someone choosing the Shareworks path to the import page', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Import from Shareworks/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/import')
  })

  it('Manual entry goes to prices screen', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    expect(screen.getByText('Share price history')).toBeInTheDocument()
  })

  it('prices screen has add price button', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    expect(screen.getByRole('button', { name: /\+ Add price/i })).toBeInTheDocument()
  })

  it('can add and remove price rows', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))

    // Initially one row (no remove button)
    expect(screen.queryByText('✕')).not.toBeInTheDocument()

    // Add second row
    await user.click(screen.getByRole('button', { name: /\+ Add price/i }))
    // Now two remove buttons appear
    expect(screen.getAllByText('✕')).toHaveLength(2)

    // Remove one
    await user.click(screen.getAllByText('✕')[0])
    expect(screen.queryByText('✕')).not.toBeInTheDocument()
  })

  it('navigates to grant entry after prices', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    expect(screen.getByText('Add a grant')).toBeInTheDocument()
  })

  it('grant entry shows all grant types', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    expect(screen.getByRole('button', { name: 'Purchase' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Catch-Up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bonus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Free' })).toBeInTheDocument()
  })

  it('Purchase grant leads to loan question', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    // Purchase is default — click Next
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => {
      expect(screen.getByText(/Did you take out a loan/i)).toBeInTheDocument()
    })
  })

  it('Catch-Up grant (no vest_start) skips loan question and shows more_grants', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))

    // Switch to Catch-Up
    await user.click(screen.getByRole('button', { name: 'Catch-Up' }))

    // Without vest_start/periods, tax_loans is skipped and we go straight to more_grants
    await user.click(screen.getByRole('button', { name: /Next →/i }))

    await waitFor(() => {
      expect(screen.getByText(/Add another grant/i)).toBeInTheDocument()
    })
  })

  it('no loan answer on Purchase skips to more_grants', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await user.click(screen.getByRole('button', { name: /Next →/i }))

    // No loan
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))

    await waitFor(() => {
      expect(screen.getByText(/Add another grant/i)).toBeInTheDocument()
    })
  })

  it('no more grants leads to review screen', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => {
      expect(screen.getByText('Review')).toBeInTheDocument()
    })
  })

  it('review shows submit button and calls API on submit', async () => {
    mockApi()
    const onComplete = vi.fn()
    const user = userEvent.setup()
    renderWizard(onComplete)

    // Navigate to review
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await fillValidPurchaseGrant(user)
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))

    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => {
      expect(screen.getByText('Setup complete!')).toBeInTheDocument()
    })
  })

  it('done screen shows View dashboard button and calls onComplete', async () => {
    mockApi()
    const onComplete = vi.fn()
    const user = userEvent.setup()
    renderWizard(onComplete)

    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await fillValidPurchaseGrant(user)
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))
    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))

    await user.click(screen.getByRole('button', { name: /View dashboard/i }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('the enter-it-myself path shows the what-you-need screen', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    expect(screen.getByText("What you'll need")).toBeInTheDocument()
    expect(screen.getByText(/Epic stocks SharePoint/i)).toBeInTheDocument()
    expect(screen.getAllByText(/DocuSign or Shareworks/i).length).toBeGreaterThanOrEqual(1)
  })

  it('schedule intro goes to prices then grants table', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    // Now on prices screen
    expect(screen.getByText(/Annual share prices/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // Now on grants screen
    expect(screen.getByText(/Your grants/i)).toBeInTheDocument()
    expect(screen.getByText('Purchase grants')).toBeInTheDocument()
  })

  it('schedule grants table shows pre-filled purchase years', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // 2018–2025 purchase years should be present
    expect(screen.getByText('2018')).toBeInTheDocument()
    expect(screen.getByText('2020')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
  })

  it('schedule grants table shows 2020 bonus with A/B/C selector', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    expect(screen.getByText('Bonus, Free & Developer Bonus grants')).toBeInTheDocument()
    // The vesting schedule label text is split across elements
    expect(screen.getByText(/Vesting schedule/i)).toBeInTheDocument()
    // A, B, C schedule buttons
    const scheduleButtons = screen.getAllByRole('button', { name: /^[ABC]$/ })
    expect(scheduleButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('schedule path navigates prices → grants → tax → refi → interest → preferences', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    expect(screen.getByText(/Annual share prices/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    expect(screen.getByText(/Your grants/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next: Review loans/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /Tax loans/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Next: Refinances/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /Refinance chains/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Next: Interest loans/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /Interest loans/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Next: Preferences/i }))
    expect(screen.getByText(/A couple quick questions/i)).toBeInTheDocument()
  })

  it('schedule path submits and shows done screen', async () => {
    mockApi()
    const onComplete = vi.fn()
    const user = userEvent.setup()
    renderWizard(onComplete)
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    await user.click(screen.getByRole('button', { name: /Next: Review loans/i }))
    await user.click(screen.getByRole('button', { name: /Next: Refinances/i }))
    await user.click(screen.getByRole('button', { name: /Next: Interest loans/i }))
    await user.click(screen.getByRole('button', { name: /Next: Preferences/i }))
    await user.click(screen.getByRole('button', { name: /Skip/i }))
    // Schedule path goes to review before done
    await waitFor(() => screen.getByText('Review'))
    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))
    await user.click(screen.getByRole('button', { name: /View dashboard/i }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('the workbook path shows a file input', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Import a Vesting.xlsx/i }))
    expect(screen.getByRole('heading', { name: /Import a Vesting.xlsx/i })).toBeInTheDocument()
    expect(screen.getByText(/Skip — enter manually/i)).toBeInTheDocument()
  })

  it('back navigation works from prices screen', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    expect(screen.getByText('Share price history')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /← Back/i }))
    expect(screen.getByText("Let's set up your equity tracker.")).toBeInTheDocument()
  })

  it('schedule grants table shows 2022 Bonus in the bonus section', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // 2022 Bonus should appear in the Bonus & Free section (not the purchase section)
    const bonusSection = screen.getByText('Bonus, Free & Developer Bonus grants').closest('div')!
    // Look for a "2022 Bonus" badge within that section
    expect(bonusSection.querySelector('.bg-emerald-700')).not.toBeNull()
  })

  it('2022 Free grant is NOT shown in the Bonus & Free section', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // The Bonus & Free section should not contain a standalone "2022 Free" badge
    const bonusSection = screen.getByText('Bonus, Free & Developer Bonus grants').closest('div')!
    const amberBadges = Array.from(bonusSection.querySelectorAll('.bg-amber-600'))
    // None of the amber badges in the bonus section should contain "2022 Free"
    expect(amberBadges.some(el => el.textContent === '2022 Free')).toBe(false)
  })

  it('2022 Free grant appears inline when 2022 Purchase is checked', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // Find the 2022 purchase checkbox and check it
    // The checkboxes correspond to purchase years in order (2018, 2019, ..., 2022, ...)
    // Find by label text context
    const purchaseSection = screen.getByText('Purchase grants').closest('div')!
    const yearLabels = purchaseSection.querySelectorAll('label span.text-sm')
    const idx2022 = Array.from(yearLabels).findIndex(el => el.textContent === '2022')
    expect(idx2022).toBeGreaterThanOrEqual(0)
    const checkbox2022 = purchaseSection.querySelectorAll('input[type="checkbox"]')[idx2022]
    await user.click(checkbox2022 as HTMLElement)
    // Now "2022 Free grant" label should be visible
    expect(screen.getByText('2022 Free grant')).toBeInTheDocument()
  })

  it('catch-up grants from DB are not shown as orphans when re-running wizard', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/prices') && method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/api/grants') && method === 'GET') {
        return new Response(JSON.stringify([
          { id: 1, year: 2020, type: 'Catch-Up', shares: 100, price: 0, vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', dp_shares: 0, election_83b: false },
          { id: 2, year: 2021, type: 'Catch-Up', shares: 200, price: 0, vest_start: '2021-09-30', periods: 5, exercise_date: '2021-12-31', dp_shares: 0, election_83b: false },
        ]), { status: 200 })
      }
      if (url.includes('/api/loans') && method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/api/config')) {
        return new Response(JSON.stringify({ epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
      }
      if (url.includes('/api/tax-settings')) {
        return new Response(JSON.stringify({
          federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
          niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
          lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
          flexible_payoff_enabled: false, prefer_stock_dp: false,
          deduct_investment_interest: false,
        }), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter it myself/i }))
    // Should load without showing catch-up grants as orphans to be deleted
    await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // No red "will be removed" warning should appear for catch-up grants
    expect(screen.queryByText(/Existing grants not in Epic's schedule/i)).not.toBeInTheDocument()
  })

  it('Review surfaces a warning when a price row has a date but no value', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    // Type a date but leave price empty
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement
    await user.type(dateInput, '2024-12-31')
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await fillValidPurchaseGrant(user)
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))

    // The dropped-rows warning should mention the empty price
    expect(screen.getByText(/Empty rows will be skipped/i)).toBeInTheDocument()
    expect(screen.getByText(/no price entered/i)).toBeInTheDocument()
    // No price should appear in the submitted-prices list
    expect(screen.getByText(/Prices \(0\)/)).toBeInTheDocument()
  })

  it('Review excludes empty-price rows from the submit payload', async () => {
    let submitted: { prices: { effective_date: string; price: number }[] } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/wizard/submit') && method === 'POST') {
        submitted = JSON.parse(init!.body as string)
        return new Response(JSON.stringify({ grants: 1, loans: 0, prices: 0, payoff_sales: 0 }), { status: 201 })
      }
      if (url.includes('/api/prices') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/grants') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/loans') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/config')) return new Response(JSON.stringify({ epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
      if (url.includes('/api/content')) return new Response(JSON.stringify(MOCK_CONTENT), { status: 200 })
      if (url.includes('/api/tax-settings')) return new Response(JSON.stringify({
        federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
        niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
        lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
        flexible_payoff_enabled: false, prefer_stock_dp: false,
        deduct_investment_interest: false,
      }), { status: 200 })
      return new Response('Not found', { status: 404 })
    })
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement
    await user.type(dateInput, '2024-12-31')
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await fillValidPurchaseGrant(user)
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))
    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))

    expect(submitted).not.toBeNull()
    expect(submitted!.prices).toEqual([])
  })

  it('Review surfaces a warning and excludes a $0 loan from the submit payload', async () => {
    let submitted: {
      grants: { loans: { amount: number }[] }[]
    } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/wizard/submit') && method === 'POST') {
        submitted = JSON.parse(init!.body as string)
        return new Response(JSON.stringify({ grants: 1, loans: 0, prices: 0, payoff_sales: 0 }), { status: 201 })
      }
      if (url.includes('/api/prices') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/grants') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/loans') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/config')) return new Response(JSON.stringify({ epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
      if (url.includes('/api/content')) return new Response(JSON.stringify(MOCK_CONTENT), { status: 200 })
      if (url.includes('/api/tax-settings')) return new Response(JSON.stringify({
        federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
        niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
        lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
        flexible_payoff_enabled: false, prefer_stock_dp: false,
        deduct_investment_interest: false,
      }), { status: 200 })
      return new Response('Not found', { status: 404 })
    })
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))
    await fillValidPurchaseGrant(user)
    await user.click(screen.getByRole('button', { name: /Next →/i }))
    await waitFor(() => screen.getByText(/Did you take out a loan/i))
    // Yes — opens the loan form
    await user.click(screen.getByRole('button', { name: /^Yes$/i }))
    // Don't fill in any fields, just save the loan — amount stays at 0
    await user.click(screen.getByRole('button', { name: /Save loan/i }))
    // No refinance
    await waitFor(() => screen.getByText(/ever refinanced/i))
    await user.click(screen.getByRole('button', { name: /^No$/i }))
    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))

    // Warning should mention the dropped loan
    expect(screen.getByText(/Empty rows will be skipped/i)).toBeInTheDocument()
    expect(screen.getByText(/has \$0 amount/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))

    expect(submitted).not.toBeNull()
    // The grant was submitted without the $0 loan
    expect(submitted!.grants).toHaveLength(1)
    expect(submitted!.grants[0].loans).toEqual([])
  })

  it('carries a tax loan the user ticked into the submit payload', async () => {
    let submitted: { grants: { loans: { loan_type: string; amount: number }[] }[] } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/wizard/submit') && method === 'POST') {
        submitted = JSON.parse(init!.body as string)
        return new Response(JSON.stringify({ grants: 1, loans: 1, prices: 0, payoff_sales: 0 }), { status: 201 })
      }
      if (url.includes('/api/prices') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/grants') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/loans') && method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes('/api/config')) return new Response(JSON.stringify({ epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
      if (url.includes('/api/content')) return new Response(JSON.stringify(MOCK_CONTENT), { status: 200 })
      if (url.includes('/api/tax-settings')) return new Response(JSON.stringify({
        federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
        niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
        lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
        flexible_payoff_enabled: false, prefer_stock_dp: false,
        deduct_investment_interest: false,
      }), { status: 200 })
      return new Response('Not found', { status: 404 })
    })
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: /Manual entry/i }))
    await user.click(screen.getByRole('button', { name: /Next: Add grants/i }))

    // A zero-basis Bonus grant vests as income, so the wizard asks about tax loans.
    await user.click(screen.getByRole('button', { name: 'Bonus' }))
    await user.type(screen.getByLabelText(/Grant year/i) as HTMLInputElement, '2024')
    await user.type(screen.getByLabelText(/^Shares$/i) as HTMLInputElement, '100')
    await user.type(screen.getByLabelText(/Vest start/i) as HTMLInputElement, '2025-09-30')
    await user.type(screen.getByLabelText(/Exercise date/i) as HTMLInputElement, '2024-12-31')
    await user.click(screen.getByRole('button', { name: /Next →/i }))

    await waitFor(() => screen.getByRole('heading', { name: /Tax loans for 2024 Bonus/i }))
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.type(screen.getAllByLabelText(/Amount/i)[0] as HTMLInputElement, '5000')
    await user.type(screen.getAllByLabelText(/Due date/i)[0] as HTMLInputElement, '2033-06-30')
    await user.click(screen.getByRole('button', { name: /Done with tax loans/i }))

    await waitFor(() => screen.getByText(/Add another grant/i))
    await user.click(screen.getByRole('button', { name: /No, review/i }))
    await waitFor(() => screen.getByText('Review'))
    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))

    expect(submitted).not.toBeNull()
    expect(submitted!.grants[0].loans).toEqual([
      expect.objectContaining({ loan_type: 'Tax', amount: 5000, loan_year: 2025 }),
    ])
  })

  // ── Refinance chains inferred from the rate on the statement ──────────────
  // Epic's documents never say when a loan was refinanced, so the rate the loan
  // carries is what says how far down the company chain it went.

  it('builds the whole 2018 chain when the loan carries the last refinance rate', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizardWithPrefill({ interest_rate: 0.0086, due_date: '2027-07-15' })
    await gotoRefiScreen(user)
    expect(screen.getByText('2018 Purchase')).toBeInTheDocument()
    // original 3.07% → 1.69% → 0.43% → 0.86%
    for (const rate of ['3.07%', '1.69%', '0.43%', '0.86%']) {
      expect(screen.getByText(rate)).toBeInTheDocument()
    }
    expect(screen.queryByText(/Read from your loan rates/i)).not.toBeInTheDocument()
  })

  it('builds no chain when the loan is still on the original rate', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizardWithPrefill({ interest_rate: 0.0307, due_date: '2025-07-15' })
    await gotoRefiScreen(user)
    expect(screen.queryByText('2018 Purchase')).not.toBeInTheDocument()
    expect(screen.getByText(/Read from your loan rates/i)).toBeInTheDocument()
    expect(screen.getByText(/3.07% is the original rate/i)).toBeInTheDocument()
  })

  it('stops the chain at the refinance whose rate the loan carries', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizardWithPrefill({ interest_rate: 0.0043, due_date: '2025-07-15' })
    await gotoRefiScreen(user)
    expect(screen.getByText('2018 Purchase')).toBeInTheDocument()
    expect(screen.getByText('3.07%')).toBeInTheDocument()
    expect(screen.getByText('1.69%')).toBeInTheDocument()
    expect(screen.getByText('0.43%')).toBeInTheDocument()
    // The Nov 2021 refinance is not this loan's — it never happened to them.
    expect(screen.queryByText('0.86%')).not.toBeInTheDocument()
    expect(screen.getByText(/1 later step on record was not applied/i)).toBeInTheDocument()
  })

  it('flags a rate that matches no refinance on record and applies none', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizardWithPrefill({ interest_rate: 0.0123, due_date: '2027-07-15' })
    await gotoRefiScreen(user)
    expect(screen.queryByText('2018 Purchase')).not.toBeInTheDocument()
    expect(screen.getByText(/matches none of the 3 refinances on record/i)).toBeInTheDocument()
  })


  it('offers the DP shares field on a year the schedule does not flag when the import found one', async () => {
    mockApi()
    const user = userEvent.setup()
    // 2018 predates the stock-exchange option, so the schedule has it switched
    // off — but an import that read one off the loan must still show it.
    renderWizardWithPrefill({ interest_rate: 0.0086, due_date: '2027-07-15' }, -260)
    await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    const fields = screen.getAllByLabelText(/DP shares/i) as HTMLInputElement[]
    const filled = fields.filter(f => f.value === '260')
    expect(filled).toHaveLength(1)
    expect(filled[0].disabled).toBe(false)
  })

})
