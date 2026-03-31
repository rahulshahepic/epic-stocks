import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Prices from '../app/pages/Prices.tsx'

const MOCK_PRICES = [
  { id: 1, effective_date: '2020-12-31', price: 1.99 },
  { id: 2, effective_date: '2021-12-31', price: 3.50 },
  { id: 3, effective_date: '2022-12-31', price: 5.25 },
]

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/api/prices') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_PRICES), { status: 200 })
    }
    if (url.includes('/api/flows/annual-price') && method === 'POST') {
      return new Response(JSON.stringify({ id: 4, ...JSON.parse(init?.body as string) }), { status: 200 })
    }
    if (url.includes('/api/flows/growth-estimate') && method === 'POST') {
      return new Response(JSON.stringify([
        { id: 10, version: 1, effective_date: '2027-01-01', price: 10.0 },
        { id: 11, version: 1, effective_date: '2028-01-01', price: 11.0 },
      ]), { status: 201 })
    }
    if (url.match(/\/api\/prices\/\d+/) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderPrices() {
  return render(<MemoryRouter><Prices /></MemoryRouter>)
}

describe('Prices', () => {
  it('shows loading initially', () => {
    mockApi()
    renderPrices()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders price list', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('3 price entries')).toBeInTheDocument()
    })
    expect(screen.getByText('2020-12-31')).toBeInTheDocument()
    expect(screen.getByText('$1.99')).toBeInTheDocument()
    expect(screen.getByText('$3.50')).toBeInTheDocument()
    expect(screen.getByText('$5.25')).toBeInTheDocument()
  })

  it('opens add price form', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('+ Price')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Price'))
    expect(screen.getByText('Add Price')).toBeInTheDocument()
    expect(screen.getByText('Save & Add Another')).toBeInTheDocument()
  })

  it('opens edit form without Add Another', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getAllByText('Edit')).toHaveLength(3)
    })
    await userEvent.click(screen.getAllByText('Edit')[0])
    expect(screen.getByText('Edit Price')).toBeInTheDocument()
    expect(screen.queryByText('Save & Add Another')).not.toBeInTheDocument()
  })

  it('cancel returns to list', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('+ Price')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('+ Price'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Share Prices')).toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'))
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('Failed to load prices')).toBeInTheDocument()
    })
  })

  it('shows % Growth button in list view', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('% Growth')).toBeInTheDocument()
    })
  })

  it('opens growth estimator and shows form', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => {
      expect(screen.getByText('% Growth')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('% Growth'))
    expect(screen.getByText('Growth Estimator')).toBeInTheDocument()
    expect(screen.getByText('Annual Growth %')).toBeInTheDocument()
    expect(screen.getByText('Base Price')).toBeInTheDocument()
    expect(screen.getByText('Frequency')).toBeInTheDocument()
  })

  it('shows live preview when estimate form is valid', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => expect(screen.getByText('% Growth')).toBeInTheDocument())
    await userEvent.click(screen.getByText('% Growth'))
    // The form pre-fills with defaults — preview should be visible
    await waitFor(() => {
      expect(screen.getByText(/prices? to generate/)).toBeInTheDocument()
    })
  })

  it('cancel from estimator returns to list', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => expect(screen.getByText('% Growth')).toBeInTheDocument())
    await userEvent.click(screen.getByText('% Growth'))
    expect(screen.getByText('Growth Estimator')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Share Prices')).toBeInTheDocument()
  })

  it('generate button calls growthEstimate and returns to list', async () => {
    mockApi()
    renderPrices()
    await waitFor(() => expect(screen.getByText('% Growth')).toBeInTheDocument())
    await userEvent.click(screen.getByText('% Growth'))
    await waitFor(() => expect(screen.getByText(/Generate \d+ Price/)).toBeInTheDocument())
    await userEvent.click(screen.getByText(/Generate \d+ Price/))
    await waitFor(() => expect(screen.getByText('Share Prices')).toBeInTheDocument())
  })
})
