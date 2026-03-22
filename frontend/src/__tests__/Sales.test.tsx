import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Sales from '../pages/Sales.tsx'

const MOCK_SALES = [
  {
    id: 1, version: 1,
    date: '2023-06-01', shares: 100, price_per_share: 25.50, notes: 'Q2 sale',
  },
  {
    id: 2, version: 1,
    date: '2023-12-01', shares: 50, price_per_share: 30.00, notes: '',
  },
]

const MOCK_TAX = {
  gross_proceeds: 2550.0,
  cost_basis: 1000.0,
  net_gain: 1550.0,
  lt_shares: 100,
  lt_gain: 1550.0,
  lt_rate: 0.2916,
  lt_tax: 451.98,
  st_shares: 0,
  st_gain: 0.0,
  st_rate: 0.4845,
  st_tax: 0.0,
  unvested_shares: 0,
  unvested_proceeds: 0.0,
  unvested_rate: 0.4465,
  unvested_tax: 0.0,
  estimated_tax: 451.98,
  net_proceeds: 2098.02,
}

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi(opts: { failFetch?: boolean } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (opts.failFetch) throw new Error('fail')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'

    if (url.match(/\/api\/sales\/\d+\/tax/) && method === 'GET') {
      return new Response(JSON.stringify(MOCK_TAX), { status: 200 })
    }
    if (url.endsWith('/api/sales') && method === 'GET') {
      return new Response(JSON.stringify(MOCK_SALES), { status: 200 })
    }
    if (url.endsWith('/api/sales') && method === 'POST') {
      const body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ id: 3, version: 1, ...body }), { status: 201 })
    }
    if (url.match(/\/api\/sales\/\d+/) && method === 'PUT') {
      const body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ id: 1, version: 2, ...body }), { status: 200 })
    }
    if (url.match(/\/api\/sales\/\d+/) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  })
}

function renderSales() {
  return render(<MemoryRouter><Sales /></MemoryRouter>)
}

describe('Sales', () => {
  it('shows loading initially', () => {
    mockApi()
    renderSales()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders sales list', async () => {
    mockApi()
    renderSales()
    await waitFor(() => {
      expect(screen.getByText('2 sales')).toBeInTheDocument()
    })
    expect(screen.getByText('Q2 sale')).toBeInTheDocument()
    expect(screen.getByText('2023-06-01')).toBeInTheDocument()
  })

  it('shows gross proceeds', async () => {
    mockApi()
    renderSales()
    await waitFor(() => {
      // 100 * 25.50 = $2,550.00
      expect(screen.getByText('$2,550.00')).toBeInTheDocument()
    })
  })

  it('opens add sale form', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getByText('+ Sale')).toBeInTheDocument())
    await userEvent.click(screen.getByText('+ Sale'))
    expect(screen.getByText('Record Sale')).toBeInTheDocument()
    expect(screen.getByText('Save & Show Tax')).toBeInTheDocument()
  })

  it('opens edit form', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getAllByText('Edit')).toHaveLength(2))
    await userEvent.click(screen.getAllByText('Edit')[0])
    expect(screen.getByText('Edit Sale')).toBeInTheDocument()
  })

  it('cancel returns to list', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getByText('+ Sale')).toBeInTheDocument())
    await userEvent.click(screen.getByText('+ Sale'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Sales')).toBeInTheDocument()
  })

  it('shows tax breakdown when Tax button clicked', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getAllByText('Tax')).toHaveLength(2))
    await userEvent.click(screen.getAllByText('Tax')[0])
    await waitFor(() => {
      expect(screen.getByText('Estimated Tax Breakdown')).toBeInTheDocument()
    })
    expect(screen.getByText(/Gross proceeds/)).toBeInTheDocument()
    expect(screen.getByText(/Estimated total tax/)).toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    mockApi({ failFetch: true })
    renderSales()
    await waitFor(() => {
      expect(screen.getByText('Failed to load sales')).toBeInTheDocument()
    })
  })

  it('shows empty state when no sales', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    )
    renderSales()
    await waitFor(() => {
      expect(screen.getByText('No sales recorded yet')).toBeInTheDocument()
    })
  })
})
