import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Loans from '../pages/Loans.tsx'

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

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'
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
    expect(screen.getByText('Interest')).toBeInTheDocument()
    expect(screen.getByText('Tax')).toBeInTheDocument()
    expect(screen.getByText('L-001')).toBeInTheDocument()
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
      expect(screen.getAllByText('Edit')).toHaveLength(2)
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
