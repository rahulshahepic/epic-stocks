import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Loans from '../app/pages/Loans.tsx'

const MOCK_LOANS = [
  {
    id: 1, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Interest',
    loan_year: 2021, amount: 5000, interest_rate: 3.5, due_date: '2025-12-31',
    loan_number: 'L-001',
  },
  {
    id: 2, grant_year: 2020, grant_type: 'Purchase', loan_type: 'Tax',
    loan_year: 2022, amount: 3000, interest_rate: 4.0, due_date: '2026-12-31',
    loan_number: null,
  },
]

const MOCK_SALES = [
  {
    id: 10, loan_id: 1, date: '2025-06-01', shares: 1000,
    price_per_share: 5.0, notes: null,
  },
]

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/api/sales') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_SALES), { status: 200 })
    }
    if (url.includes('/api/loans') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_LOANS), { status: 200 })
    }
    if (url.includes('/api/loans') && method === 'POST') {
      return new Response(JSON.stringify({ id: 3, ...JSON.parse(init?.body as string) }), { status: 200 })
    }
    if (url.match(/\/api\/loans\/\d+/) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderLoans() {
  return render(<MemoryRouter><Loans /></MemoryRouter>)
}

describe('Loans', () => {
  it('shows loading initially', () => {
    mockApi()
    renderLoans()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders loan list', async () => {
    mockApi()
    renderLoans()
    await waitFor(() => {
      expect(screen.getByText('2 loans')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Interest').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tax').length).toBeGreaterThan(0)
    // L-001 is now in the drill-in card, not the main table
    expect(screen.queryByText('L-001')).not.toBeInTheDocument()
  })

  it('expands drill-in card showing loan number and sale details', async () => {
    mockApi()
    renderLoans()
    await waitFor(() => {
      // Mobile card button has arrow suffix, desktop button is plain text
      expect(screen.getAllByText(/✓ linked/).length).toBeGreaterThan(0)
    })
    // Click the desktop button (exact match without arrow)
    const linkedButtons = screen.getAllByText(/✓ linked/)
    await userEvent.click(linkedButtons[0])
    expect(screen.getAllByText('L-001').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2025-06-01').length).toBeGreaterThan(0)
    // clicking again collapses
    await userEvent.click(screen.getAllByText(/✓ linked/)[0])
    expect(screen.queryByText('L-001')).not.toBeInTheDocument()
  })

  it('opens add loan form', async () => {
    mockApi()
    renderLoans()
    await waitFor(() => {
      expect(screen.getByText('+ Loan')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Loan'))
    expect(screen.getByText('Add Loan')).toBeInTheDocument()
    expect(screen.getByText('Save & Add Another')).toBeInTheDocument()
  })

  it('opens edit form without Add Another', async () => {
    mockApi()
    renderLoans()
    await waitFor(() => {
      expect(screen.getAllByText('Edit')).toHaveLength(4) // 2 loans × 2 views (mobile + desktop)
    })
    await userEvent.click(screen.getAllByText('Edit')[0])
    expect(screen.getByText('Edit Loan')).toBeInTheDocument()
    expect(screen.queryByText('Save & Add Another')).not.toBeInTheDocument()
  })

  it('cancel returns to list', async () => {
    mockApi()
    renderLoans()
    await waitFor(() => {
      expect(screen.getByText('+ Loan')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Loan'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Loans')).toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'))
    renderLoans()
    await waitFor(() => {
      expect(screen.getByText('Failed to load loans')).toBeInTheDocument()
    })
  })
})
