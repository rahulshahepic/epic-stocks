import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Sales from '../app/pages/Sales.tsx'

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

const MOCK_TAX_ST = {
  ...MOCK_TAX,
  lt_shares: 0,
  lt_gain: 0,
  lt_tax: 0,
  st_shares: 100,
  st_gain: 1550.0,
  st_rate: 0.4845,
  st_tax: 750.98,
  estimated_tax: 750.98,
  net_proceeds: 1799.02,
}

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockApi(opts: { failFetch?: boolean; stcg?: boolean } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (opts.failFetch) throw new Error('fail')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'

    if (url.endsWith('/api/sales/tax') && method === 'GET') {
      const tax = opts.stcg ? MOCK_TAX_ST : MOCK_TAX
      return new Response(JSON.stringify({ 1: tax, 2: tax }), { status: 200 })
    }
    if (url.match(/\/api\/sales\/\d+\/tax/) && method === 'GET') {
      return new Response(JSON.stringify(opts.stcg ? MOCK_TAX_ST : MOCK_TAX), { status: 200 })
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
    expect(screen.getAllByText('2023-06-01').length).toBeGreaterThan(0)
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
    // Form opens in Plan Sale mode (today's date = future or today)
    expect(screen.getByText('Plan Sale')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan sale' })).toBeInTheDocument()
  })

  it('opens edit form via pencil icon', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit sale' })).toHaveLength(4)) // 2 sales × 2 views (mobile + desktop)
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit sale' })[0])
    expect(screen.getByText('Edit Sale')).toBeInTheDocument()
  })

  it('edit form shows delete sale button', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit sale' })).toHaveLength(4)) // 2 sales × 2 views (mobile + desktop)
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit sale' })[0])
    expect(screen.getByText('Delete sale')).toBeInTheDocument()
  })

  it('cancel returns to list', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getByText('+ Sale')).toBeInTheDocument())
    await userEvent.click(screen.getByText('+ Sale'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('Sales')).toBeInTheDocument()
  })

  it('shows Tax column header', async () => {
    mockApi()
    renderSales()
    await waitFor(() => expect(screen.getByText('2 sales')).toBeInTheDocument())
    expect(screen.getByText('Tax')).toBeInTheDocument()
  })

  it('tax amounts load eagerly and clicking expands breakdown', async () => {
    mockApi()
    renderSales()
    // Tax amounts should appear without any click
    await waitFor(() => expect(screen.getAllByText('$451.98')).not.toHaveLength(0))
    // Click the first tax cell to expand the full breakdown
    const taxButtons = screen.getAllByRole('button').filter(b => b.textContent?.includes('$451.98'))
    await userEvent.click(taxButtons[0])
    await waitFor(() => {
      expect(screen.getAllByText('Estimated Tax Breakdown').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText(/Gross proceeds/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Estimated total tax/).length).toBeGreaterThan(0)
  })

  it('shows ST badge when sale has short-term gains', async () => {
    mockApi({ stcg: true })
    renderSales()
    await waitFor(() => {
      expect(screen.getAllByText('ST')).not.toHaveLength(0)
    })
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
      expect(screen.getAllByText('No sales recorded yet').length).toBeGreaterThan(0)
    })
  })
})
