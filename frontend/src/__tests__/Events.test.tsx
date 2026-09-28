import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Events from '../app/pages/Events.tsx'
import { localToday } from '../app/dateUtils.ts'

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

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(MOCK_EVENTS), { status: 200 })
  )
}

function renderEvents(initialPath = '/') {
  return render(<MemoryRouter initialEntries={[initialPath]}><Events /></MemoryRouter>)
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
    expect(screen.getByText(/^2 events/)).toBeInTheDocument()
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
      expect(screen.getByText(/^2 events/)).toBeInTheDocument()
    })

    // Open the multi-select dropdown
    await userEvent.click(screen.getByRole('button', { name: /All types/i }))

    // Click the Vesting checkbox
    const vestingCheckbox = screen.getByRole('checkbox', { name: /Vesting/i })
    await userEvent.click(vestingCheckbox)

    expect(screen.getByText(/^1 events/)).toBeInTheDocument()
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

  it('pre-filters by types URL param', async () => {
    mockApi()
    renderEvents('/?types=Vesting,Exercise')
    await waitFor(() => {
      expect(screen.getByText('2021-03-01')).toBeInTheDocument()
    })
    // Both types selected → filter button should show count of 2 types
    expect(screen.getByRole('button', { name: /2 types/i })).toBeInTheDocument()
  })

  it('pre-filters to single type from URL param', async () => {
    mockApi()
    renderEvents('/?types=Vesting')
    await waitFor(() => {
      expect(screen.getByText('2021-03-01')).toBeInTheDocument()
    })
    // Only Vesting selected — Exercise row should be hidden
    expect(screen.queryByText('2021-06-01')).not.toBeInTheDocument()
  })

  it('jumps to the next event, falls back to the last, and resets with Today', async () => {
    mockApi()
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    renderEvents()
    await screen.findByText('2021-03-01')
    const first = screen.getByText('2021-03-01').closest('tr')!
    const last = screen.getByText('2021-06-01').closest('tr')!
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2021-02-01' } })
    await waitFor(() => expect(first).toHaveClass('ring-blue-400'))
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2021-04-01' } })
    await waitFor(() => expect(last).toHaveClass('ring-blue-400'))
    expect(first).not.toHaveClass('ring-blue-400')
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2030-01-01' } })
    await waitFor(() => expect(last).toHaveClass('ring-blue-400'))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(3))
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByLabelText('Go to date')).toHaveValue(localToday())
    expect(last).toHaveClass('ring-blue-400')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(4))
  })

  it('does not revisit a URL date when the event-type filter changes, and cancels its timer on a jump', async () => {
    mockApi()
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const setTimer = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    renderEvents('/?date=2021-03-01')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    const urlTimer = setTimer.mock.calls.findIndex(([, delay]) => delay === 2000)
    expect(urlTimer).toBeGreaterThanOrEqual(0)

    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2021-04-01' } })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[urlTimer].value)

    await userEvent.click(screen.getByRole('button', { name: /All types/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Exercise/i }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('skips events hidden by the type filter when jumping', async () => {
    mockApi()
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    renderEvents('/?types=Exercise')
    await screen.findByText('2021-06-01')
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2021-02-01' } })
    await waitFor(() => expect(screen.getByText('2021-06-01').closest('tr')).toHaveClass('ring-blue-400'))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('2021-03-01')).not.toBeInTheDocument()
  })
})
