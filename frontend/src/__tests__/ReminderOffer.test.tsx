import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ReminderOffer from '../app/components/ReminderOffer.tsx'
import AnnualStockSummary from '../app/components/AnnualStockSummary.tsx'
import type { TimelineEvent } from '../api.ts'

vi.mock('../scaffold/hooks/useConfig.ts', () => ({ useConfig: () => ({ email_notifications_available: true }) }))
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
const event = { date: '2030-01-01', event_type: 'Vesting' } as TimelineEvent

describe('Contextual reminders', () => {
  it('offers settings for a real event and never enables a channel itself', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({enabled: false}), {status: 200}))
    render(<MemoryRouter><ReminderOffer event={event} /></MemoryRouter>)
    expect(await screen.findByRole('link', {name: 'Choose reminders'})).toHaveAttribute('href', '/settings#notifications')
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
    await userEvent.click(screen.getByRole('button', {name: /Don't offer again/}))
    expect(localStorage.getItem('reminder_offer_dismissed')).toBe('1')
  })

  it('does not offer reminders when email is already enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({enabled: true}), {status: 200}))
    render(<MemoryRouter><ReminderOffer event={event} /></MemoryRouter>)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('link', {name: 'Choose reminders'})).not.toBeInTheDocument()
  })

  it('respects the account-wide Stop offering preference', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({enabled: false, offers_dismissed: true}), {status: 200}))
    render(<MemoryRouter><ReminderOffer event={event} /></MemoryRouter>)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('link', {name: 'Choose reminders'})).not.toBeInTheDocument()
  })

  it('loads an annual summary only when expanded', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      year: 2025, note: 'Estimated changes from saved records.', price_is_estimate: true,
      rows: [{label: 'Vested holdings', before: 100, after: 150, change: 50, unit: 'shares'}],
    }), {status: 200}))
    render(<AnnualStockSummary />)
    expect(fetcher).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText(/stock summary/))
    expect(await screen.findByText('Vested holdings')).toBeVisible()
    expect(screen.getByText(/tentative share price/)).toBeVisible()
  })
})
