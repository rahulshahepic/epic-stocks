import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportWizard from '../app/components/ImportWizard.tsx'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
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
      return new Response(JSON.stringify({ epic_onboarding_url: '', epic_mode: false, email_notifications_available: false, vapid_public_key: '', resend_from: '' }), { status: 200 })
    }
    if (url.includes('/api/tax-settings')) {
      return new Response(JSON.stringify({
        federal_income_rate: 0.37, federal_lt_cg_rate: 0.20, federal_st_cg_rate: 0.37,
        niit_rate: 0.038, state_income_rate: 0.0765, state_lt_cg_rate: 0.0765, state_st_cg_rate: 0.0765,
        lt_holding_days: 365, lot_selection_method: 'epic_lifo', loan_payoff_method: 'epic_lifo',
        flexible_payoff_enabled: false, prefer_stock_dp: false, dp_min_percent: 0, dp_min_cap: 0,
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

describe('ImportWizard', () => {
  it('renders welcome screen with three path options', () => {
    mockApi()
    renderWizard()
    expect(screen.getByText("Let's set up your equity tracker.")).toBeInTheDocument()
    expect(screen.getByText(/Setup Wizard/i)).toBeInTheDocument()
    expect(screen.getByText(/Import from file/i)).toBeInTheDocument()
    expect(screen.getByText(/Manual entry/i)).toBeInTheDocument()
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

  it('Setup Wizard shows what-you-need screen', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    expect(screen.getByText("What you'll need")).toBeInTheDocument()
    expect(screen.getByText(/Epic stocks SharePoint/i)).toBeInTheDocument()
    expect(screen.getAllByText(/DocuSign or Shareworks/i).length).toBeGreaterThanOrEqual(1)
  })

  it('schedule intro goes to prices then grants table', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
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
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
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
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    expect(screen.getByText('Bonus & Free grants')).toBeInTheDocument()
    // The vesting schedule label text is split across elements
    expect(screen.getByText(/Vesting schedule/i)).toBeInTheDocument()
    // A, B, C schedule buttons
    const scheduleButtons = screen.getAllByRole('button', { name: /^[ABC]$/ })
    expect(scheduleButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('schedule path navigates prices → grants → preferences', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    expect(screen.getByText(/Annual share prices/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    expect(screen.getByText(/Your grants/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next: Preferences/i }))
    expect(screen.getByText(/A couple quick questions/i)).toBeInTheDocument()
  })

  it('schedule path submits and shows done screen', async () => {
    mockApi()
    const onComplete = vi.fn()
    const user = userEvent.setup()
    renderWizard(onComplete)
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    await user.click(screen.getByRole('button', { name: /Next: Preferences/i }))
    await user.click(screen.getByRole('button', { name: /Skip/i }))
    // Schedule path goes to review before done
    await waitFor(() => screen.getByText('Review'))
    await user.click(screen.getByRole('button', { name: /Submit →/i }))
    await waitFor(() => screen.getByText('Setup complete!'))
    await user.click(screen.getByRole('button', { name: /View dashboard/i }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('Import from file path shows file input', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Import from file/i }))
    expect(screen.getByText('Import from file')).toBeInTheDocument()
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
})
