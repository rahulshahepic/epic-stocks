import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportWizard from '../app/components/ImportWizard.tsx'
import { resetContentCache, setContentCacheForTesting } from '../app/hooks/useContent.ts'
import type { ContentBlob } from '../api.ts'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  resetContentCache()
  setContentCacheForTesting(MOCK_CONTENT as ContentBlob)
})

// Matches the seeded Epic values in backend/app/content_service.py.
const MOCK_CONTENT = {
  grant_templates: [
    { year: 2018, type: 'Purchase', vest_start: '2020-06-15', periods: 6, exercise_date: '2018-12-31', default_catch_up: true,  show_dp_shares: false, default_tax_due_date: null },
    { year: 2019, type: 'Purchase', vest_start: '2021-06-15', periods: 6, exercise_date: '2019-12-31', default_catch_up: true,  show_dp_shares: false, default_tax_due_date: null },
    { year: 2020, type: 'Purchase', vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', default_catch_up: true,  show_dp_shares: false, default_tax_due_date: null },
    { year: 2020, type: 'Bonus',    vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2025-07-15' },
    { year: 2021, type: 'Purchase', vest_start: '2022-09-30', periods: 5, exercise_date: '2021-12-31', default_catch_up: true,  show_dp_shares: false, default_tax_due_date: null },
    { year: 2021, type: 'Bonus',    vest_start: '2022-09-30', periods: 3, exercise_date: '2021-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2030-07-15' },
    { year: 2022, type: 'Purchase', vest_start: '2023-09-30', periods: 4, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: null },
    { year: 2022, type: 'Bonus',    vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2031-06-30' },
    { year: 2022, type: 'Free',     vest_start: '2027-09-30', periods: 1, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2031-06-30' },
    { year: 2023, type: 'Purchase', vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: true,  default_tax_due_date: null },
    { year: 2023, type: 'Bonus',    vest_start: '2024-09-30', periods: 3, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2032-06-30' },
    { year: 2024, type: 'Purchase', vest_start: '2025-09-30', periods: 4, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: true,  default_tax_due_date: null },
    { year: 2024, type: 'Bonus',    vest_start: '2025-09-30', periods: 3, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2033-06-30' },
    { year: 2025, type: 'Purchase', vest_start: '2026-09-30', periods: 4, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: true,  default_tax_due_date: null },
    { year: 2025, type: 'Bonus',    vest_start: '2026-09-30', periods: 3, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: false, default_tax_due_date: '2034-06-30' },
  ],
  bonus_schedule_variants: [
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'A', periods: 2, label: 'A (2 years)', is_default: false },
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'B', periods: 3, label: 'B (3 years)', is_default: false },
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'C', periods: 4, label: 'C (4 years)', is_default: true  },
  ],
  loan_rates: {
    interest: { '2020': 0.0086, '2021': 0.0091, '2022': 0.0328, '2023': 0.0437, '2024': 0.037, '2025': 0.0379 },
    tax: {
      'Catch-Up': { '2021': 0.0086, '2022': 0.0187, '2023': 0.0356, '2024': 0.043, '2025': 0.0407 },
      'Bonus':    { '2021': 0.0086, '2022': 0.0293, '2023': 0.0385, '2024': 0.037 },
    },
    purchase_original: {
      '2018': { rate: 0.0307, due_date: '2025-07-15' },
      '2019': { rate: 0.0307, due_date: '2026-07-15' },
      '2020': { rate: 0.0038, due_date: '2025-07-15' },
      '2021': { rate: 0.0086, due_date: '2030-07-15' },
      '2022': { rate: 0.0187, due_date: '2031-06-30' },
      '2023': { rate: 0.0356, due_date: '2032-06-30' },
      '2024': { rate: 0.037,  due_date: '2033-06-30' },
      '2025': { rate: 0.0406, due_date: '2034-06-30' },
    },
  },
  loan_refinances: {
    purchase: {
      '2018': [
        { date: '2020-01-01', rate: 0.0169, loan_year: 2020, due_date: '2025-07-15' },
        { date: '2020-06-01', rate: 0.0043, loan_year: 2020, due_date: '2025-07-15' },
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2027-07-15' },
      ],
      '2019': [
        { date: '2020-06-01', rate: 0.0043, loan_year: 2020, due_date: '2026-07-15' },
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2028-07-15' },
      ],
      '2020': [
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2029-07-15' },
      ],
    },
    tax: {
      '2020-Bonus-2021': [
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2029-07-15', orig_due_date: '2024-07-15' },
      ],
    },
  },
  grant_program_settings: {
    tax_fallback_federal: 0.37,
    tax_fallback_state: 0.0765,
    dp_min_percent: 0.10,
    dp_min_cap: 20000,
    price_years_start: 2018,
    price_years_end: 2026,
  },
}

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

  it('schedule path navigates prices → grants → tax → refi → interest → preferences', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
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
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
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

  it('schedule grants table shows 2022 Bonus in the bonus section', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // 2022 Bonus should appear in the Bonus & Free section (not the purchase section)
    const bonusSection = screen.getByText('Bonus & Free grants').closest('div')!
    // Look for a "2022 Bonus" badge within that section
    expect(bonusSection.querySelector('.bg-emerald-700')).not.toBeNull()
  })

  it('2022 Free grant is NOT shown in the Bonus & Free section', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // The Bonus & Free section should not contain a standalone "2022 Free" badge
    const bonusSection = screen.getByText('Bonus & Free grants').closest('div')!
    const amberBadges = Array.from(bonusSection.querySelectorAll('.bg-amber-600'))
    // None of the amber badges in the bonus section should contain "2022 Free"
    expect(amberBadges.some(el => el.textContent === '2022 Free')).toBe(false)
  })

  it('2022 Free grant appears inline when 2022 Purchase is checked', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // Find the 2022 purchase checkbox and check it
    const checkboxes = screen.getAllByRole('checkbox')
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
    await user.click(screen.getByRole('button', { name: /Setup Wizard/i }))
    // Should load without showing catch-up grants as orphans to be deleted
    await waitFor(() => screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Let's go/i }))
    await user.click(screen.getByRole('button', { name: /Next: Enter grants/i }))
    // No red "will be removed" warning should appear for catch-up grants
    expect(screen.queryByText(/Existing grants not in Epic's schedule/i)).not.toBeInTheDocument()
  })
})
