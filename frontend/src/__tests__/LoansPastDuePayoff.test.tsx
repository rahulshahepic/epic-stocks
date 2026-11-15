import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Loans from '../app/pages/Loans.tsx'
import { resetConfigCache } from '../scaffold/hooks/useConfig.ts'

const PAST_DUE = {
  id: 7, version: 1, grant_year: 2012, grant_type: 'Purchase', loan_type: 'Purchase',
  loan_year: 2012, amount: 100000, interest_rate: 0.05, due_date: '2021-07-15',
  loan_number: null, refinances_loan_id: null,
}

const calls: string[] = []

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  resetConfigCache()
  calls.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.includes('/api/config')) return json({ epic_mode: true })
    if (url.includes('/payoff-sale-suggestion')) {
      const d = new URL(url, 'http://x').searchParams.get('payoff_date')
      return json({ date: d, shares: 100, price_per_share: 10, loan_id: 7, notes: '', cash_due: 1000 })
    }
    if (url.includes('/execute-payoff')) return json({ id: 1, date: '2021-07-15' }, 201)
    if (url.includes('/api/sales/tranche-allocation')) return json({ lines: [] })
    if (url.includes('/api/sales') && method === 'GET') return json([])
    if (url.includes('/api/loans') && method === 'GET') return json([PAST_DUE])
    return json([])
  })
})

describe('Recording a past-due payoff', () => {
  it('defaults to the due date, and the date can be changed', async () => {
    render(<MemoryRouter><Loans /></MemoryRouter>)
    const buttons = await screen.findAllByText('Calculate repayment')
    await userEvent.click(buttons[0])
    expect(await screen.findByText("Record this loan's payoff")).toBeInTheDocument()
    const input = screen.getByLabelText(/Paid on/) as HTMLInputElement
    expect(input.value).toBe('2021-07-15')
    await waitFor(() => expect(calls.some(c => c.includes('payoff-sale-suggestion?payoff_date=2021-07-15'))).toBe(true))
    await userEvent.click(await screen.findByText('Confirm Payoff'))
    await waitFor(() => expect(calls.some(c => c.startsWith('POST') && c.includes('execute-payoff?payoff_date=2021-07-15'))).toBe(true))
  })
})
