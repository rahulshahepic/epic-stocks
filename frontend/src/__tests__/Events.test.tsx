import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Events from '../pages/Events.tsx'

const MOCK_EVENTS = [
  {
    date: '2021-03-01', grant_year: 2020, grant_type: 'Purchase',
    event_type: 'Vesting', granted_shares: null, grant_price: 1.99,
    exercise_price: null, vested_shares: 2000, price_increase: 0,
    share_price: 2.5, cum_shares: 2000, income: 0, cum_income: 0,
    vesting_cap_gains: 1020, price_cap_gains: 0, total_cap_gains: 1020, cum_cap_gains: 1020,
  },
  {
    date: '2021-06-01', grant_year: 2020, grant_type: 'Purchase',
    event_type: 'Exercise', granted_shares: 10000, grant_price: 1.99,
    exercise_price: 1.99, vested_shares: null, price_increase: 0,
    share_price: 2.5, cum_shares: 12000, income: 5100, cum_income: 5100,
    vesting_cap_gains: 0, price_cap_gains: 0, total_cap_gains: 0, cum_cap_gains: 1020,
  },
]

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(MOCK_EVENTS), { status: 200 })
  )
}

function renderEvents() {
  return render(<MemoryRouter><Events /></MemoryRouter>)
}

describe('Events', () => {
  it('shows loading initially', () => {
    mockApi()
    renderEvents()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders event rows', async () => {
    mockApi()
    renderEvents()
    await waitFor(() => {
      expect(screen.getByText('2021-03-01')).toBeInTheDocument()
    })
    expect(screen.getByText('2021-06-01')).toBeInTheDocument()
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('renders event type badges', async () => {
    mockApi()
    renderEvents()
    await waitFor(() => {
      expect(screen.getByText('Vesting')).toBeInTheDocument()
    })
    expect(screen.getByText('Exercise')).toBeInTheDocument()
  })

  it('filters by event type', async () => {
    mockApi()
    renderEvents()
    await waitFor(() => {
      expect(screen.getByText('2 events')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, 'Vesting')

    expect(screen.getByText('1 events')).toBeInTheDocument()
    expect(screen.getByText('2021-03-01')).toBeInTheDocument()
    expect(screen.queryByText('2021-06-01')).not.toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'))
    renderEvents()
    await waitFor(() => {
      expect(screen.getByText('Failed to load events')).toBeInTheDocument()
    })
  })
})
