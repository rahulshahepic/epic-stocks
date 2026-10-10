import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Prices from '../app/pages/Prices.tsx'
import { api } from '../api.ts'

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
  it('chains the growth preview from the latest tentative price', async () => {
    mockApi()
    vi.spyOn(api, 'getPrices').mockResolvedValue([
      {id: 1, version: 1, effective_date: '2025-01-01', price: 100, is_estimate: false},
      {id: 2, version: 1, effective_date: '2026-01-01', price: 110, is_estimate: true},
    ])
    renderPrices()
    await userEvent.click(await screen.findByText('+ Estimate'))
    await userEvent.clear(screen.getByLabelText('Annual Growth %'))
    await userEvent.type(screen.getByLabelText('Annual Growth %'), '10')
    expect(screen.getByText('($110.00)', {exact: false})).toBeInTheDocument()
    expect(screen.getByText('$121.00')).toBeInTheDocument()
  })

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
})


it('saves a backdated guess with explicit tentative status and expected announcement', async () => {
  mockApi()
  const save = vi.spyOn(api, 'annualPrice').mockResolvedValue({id: 4, version: 1, effective_date: '2020-01-01', price: 110, is_estimate: true})
  renderPrices()
  await userEvent.click(await screen.findByText('+ Price'))
  await userEvent.type(screen.getByLabelText('Applicable Date'), '2020-01-01')
  await userEvent.clear(screen.getByLabelText('Price per Share'))
  await userEvent.type(screen.getByLabelText('Price per Share'), '110')
  await userEvent.click(screen.getByLabelText('Tentative estimate'))
  expect(screen.getByLabelText('Expected Announcement Date')).toHaveValue('2020-03-01')
  await userEvent.click(screen.getByRole('button', {name: /^Save$/}))
  await waitFor(() => expect(save).toHaveBeenCalledWith({effective_date: '2020-01-01', price: 110,
    is_estimate: true, expected_announcement_date: '2020-03-01', announced_date: null}))
})

it('records an announcement through the same row with its version', async () => {
  mockApi()
  vi.spyOn(api, 'getPrices').mockResolvedValue([{id: 4, version: 3, effective_date: '2020-01-01', price: 110,
    is_estimate: true, expected_announcement_date: '2020-03-01'}])
  const save = vi.spyOn(api, 'updatePrice').mockResolvedValue({id: 4, version: 4, effective_date: '2020-01-01', price: 112})
  renderPrices()
  await userEvent.click(await screen.findByText('Edit'))
  await userEvent.click(screen.getByLabelText('Tentative estimate'))
  await userEvent.clear(screen.getByLabelText('Actual Announcement Date'))
  await userEvent.type(screen.getByLabelText('Actual Announcement Date'), '2020-02-27')
  await userEvent.clear(screen.getByLabelText('Price per Share'))
  await userEvent.type(screen.getByLabelText('Price per Share'), '112')
  await userEvent.click(screen.getByRole('button', {name: /^Save$/}))
  await waitFor(() => expect(save).toHaveBeenCalledWith(4, expect.objectContaining({version: 3,
    effective_date: '2020-01-01', announced_date: '2020-02-27', is_estimate: false, price: 112})))
})
