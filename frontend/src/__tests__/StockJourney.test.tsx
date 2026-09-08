import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StockJourney } from '../app/components/StockJourney.tsx'
import type { TimelineEvent } from '../api.ts'

function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    date: '2027-03-01',
    grant_year: 2024,
    grant_type: 'Purchase',
    event_type: 'Vesting',
    granted_shares: null,
    grant_price: null,
    exercise_price: null,
    vested_shares: 500,
    price_increase: 0,
    share_price: 10,
    cum_shares: 500,
    income: 0,
    cum_income: 0,
    vesting_cap_gains: 0,
    price_cap_gains: 0,
    total_cap_gains: 0,
    cum_cap_gains: 0,
    ...overrides,
  }
}

describe('StockJourney', () => {
  it('shows upcoming milestones, excludes past events, and limits the path to five stops', () => {
    const events = [
      event({ date: '2025-03-01' }),
      ...Array.from({ length: 7 }, (_, index) => event({
        date: `2027-0${index + 1}-01`,
        vested_shares: 100 + index,
      })),
    ]

    render(<StockJourney events={events} asOf="2026-09-07" />)

    expect(screen.getByRole('heading', { name: 'Your stock journey' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByText('Mar 1, 2025')).not.toBeInTheDocument()
    expect(screen.getByText('100 shares vest')).toBeInTheDocument()
  })
})
