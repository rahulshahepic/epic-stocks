import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Grants from '../pages/Grants.tsx'

const MOCK_GRANTS = [
  {
    id: 1, year: 2020, type: 'Purchase', shares: 10000, price: 1.99,
    vest_start: '2020-03-01', periods: 4, exercise_date: '2021-06-01', dp_shares: 500,
  },
  {
    id: 2, year: 2022, type: 'Bonus', shares: 5000, price: 3.5,
    vest_start: '2022-01-01', periods: 4, exercise_date: '2023-01-01', dp_shares: 0,
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
    if (url.includes('/api/grants') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_GRANTS), { status: 200 })
    }
    if (url.includes('/api/flows/new-purchase') && method === 'POST') {
      return new Response(JSON.stringify({ grant: { id: 3, ...JSON.parse(init?.body as string) } }), { status: 200 })
    }
    if (url.includes('/api/flows/add-bonus') && method === 'POST') {
      return new Response(JSON.stringify({ id: 4, ...JSON.parse(init?.body as string) }), { status: 200 })
    }
    if (url.match(/\/api\/grants\/\d+/) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderGrants() {
  return render(<MemoryRouter><Grants /></MemoryRouter>)
}

describe('Grants', () => {
  it('shows loading initially', () => {
    mockApi()
    renderGrants()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders grant list', async () => {
    mockApi()
    renderGrants()
    await waitFor(() => {
      expect(screen.getByText('2 grants')).toBeInTheDocument()
    })
    expect(screen.getByText('Purchase')).toBeInTheDocument()
    expect(screen.getByText('Bonus')).toBeInTheDocument()
    expect(screen.getByText('10,000')).toBeInTheDocument()
  })

  it('opens new purchase form', async () => {
    mockApi()
    renderGrants()
    await waitFor(() => {
      expect(screen.getByText('+ Purchase')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Purchase'))
    expect(screen.getByText('New Purchase Grant')).toBeInTheDocument()
    expect(screen.getByText('Optional Loan')).toBeInTheDocument()
  })

  it('opens new bonus form', async () => {
    mockApi()
    renderGrants()
    await waitFor(() => {
      expect(screen.getByText('+ Bonus')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Bonus'))
    expect(screen.getByText('New Bonus Grant')).toBeInTheDocument()
    expect(screen.queryByText('Optional Loan')).not.toBeInTheDocument()
  })

  it('opens edit form', async () => {
    mockApi()
    renderGrants()
    await waitFor(() => {
      expect(screen.getAllByText('Edit')).toHaveLength(2)
    })
    await userEvent.click(screen.getAllByText('Edit')[0])
    expect(screen.getByText('Edit Grant')).toBeInTheDocument()
    expect(screen.queryByText('Save & Add Another')).not.toBeInTheDocument()
  })

  it('cancel returns to list', async () => {
    mockApi()
    renderGrants()
    await waitFor(() => {
      expect(screen.getByText('+ Purchase')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Purchase'))
    expect(screen.getByText('New Purchase Grant')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Grants')).toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'))
    renderGrants()
    await waitFor(() => {
      expect(screen.getByText('Failed to load grants')).toBeInTheDocument()
    })
  })
})
