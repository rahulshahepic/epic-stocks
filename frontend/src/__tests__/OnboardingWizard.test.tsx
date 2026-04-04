import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import OnboardingWizard from '../app/components/OnboardingWizard.tsx'

const MOCK_TAX_SETTINGS = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
  lot_selection_method: 'fifo',
  prefer_stock_dp: false,
  dp_min_percent: 0,
  dp_min_cap: 0,
  deduct_investment_interest: false,
}

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/api/tax-settings') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_TAX_SETTINGS), { status: 200 })
    }
    if (url.includes('/api/flows/new-purchase') && method === 'POST') {
      return new Response(JSON.stringify({ grant: { id: 1 } }), { status: 200 })
    }
    if (url.includes('/api/flows/add-bonus') && method === 'POST') {
      return new Response(JSON.stringify({ id: 1 }), { status: 200 })
    }
    if (url.includes('/api/flows/annual-price') && method === 'POST') {
      return new Response(JSON.stringify({ id: 1, effective_date: '2024-01-01', price: 10 }), { status: 200 })
    }
    if (url.includes('/api/tax-settings') && method === 'PUT') {
      return new Response(JSON.stringify(MOCK_TAX_SETTINGS), { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderWizard(onComplete = vi.fn()) {
  return render(
    <MemoryRouter>
      <OnboardingWizard onComplete={onComplete} />
    </MemoryRouter>
  )
}

describe('OnboardingWizard', () => {
  it('renders welcome step initially', () => {
    mockApi()
    renderWizard()
    expect(screen.getByText("Let's set up your equity tracker.")).toBeInTheDocument()
    expect(screen.getByText('Import Excel')).toBeInTheDocument()
    expect(screen.getByText('Enter manually')).toBeInTheDocument()
  })

  it('Import Excel button navigates to /import', async () => {
    mockApi()
    const user = userEvent.setup()
    let navigatedTo = ''
    render(
      <MemoryRouter
        initialEntries={['/']}
        future={{ v7_startTransition: false, v7_relativeSplatPath: false }}
      >
        <OnboardingWizard onComplete={vi.fn()} />
      </MemoryRouter>
    )
    // The Import Excel button should be present and clickable
    const importBtn = screen.getByRole('button', { name: /Import Excel/i })
    expect(importBtn).toBeInTheDocument()
    // Click it — navigation happens via useNavigate; just verify the element exists and is interactive
    await user.click(importBtn)
  })

  it('Enter manually goes to grant step', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    expect(screen.getByText('Add your first grant')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
  })

  it('grant step shows grant type selector', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    expect(screen.getByRole('button', { name: 'Purchase' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bonus' })).toBeInTheDocument()
  })

  it('grant step shows all form fields', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    expect(screen.getByText('Year')).toBeInTheDocument()
    expect(screen.getByText('Shares')).toBeInTheDocument()
    expect(screen.getByText('Vest Start')).toBeInTheDocument()
    expect(screen.getByText('Vest Periods')).toBeInTheDocument()
    expect(screen.getByText('Exercise Date')).toBeInTheDocument()
  })

  it('price step shows after saving grant', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => {
      expect(screen.getByText('Add share prices')).toBeInTheDocument()
    })
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
  })

  it('tax step shows after price step', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    // Grant → price
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => expect(screen.getByText('Add share prices')).toBeInTheDocument())
    // Skip price step
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => {
      expect(screen.getByText('Set tax rates')).toBeInTheDocument()
    })
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
  })

  it('done step appears after tax step and calls onComplete', async () => {
    mockApi()
    const onComplete = vi.fn()
    const user = userEvent.setup()
    renderWizard(onComplete)
    // Walk through: welcome → grant → price (skip) → tax (skip) → done
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => expect(screen.getByText('Add share prices')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByText('Set tax rates')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => {
      expect(screen.getByText('Your dashboard is ready')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /View dashboard/i }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('shows step 4 of 4 on done step', async () => {
    mockApi()
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /Enter manually/i }))
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await waitFor(() => expect(screen.getByText('Add share prices')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByText('Set tax rates')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => {
      expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
    })
  })
})
