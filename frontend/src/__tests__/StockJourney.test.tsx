import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { StockJourney } from '../app/components/StockJourney.tsx'
import type { TimelineEvent } from '../api.ts'

function event(date: string, event_type: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    date, event_type, grant_year: 2021, grant_type: 'Purchase',
    granted_shares: null, grant_price: 3, exercise_price: null, vested_shares: null,
    price_increase: 0, share_price: 10, cum_shares: 0, income: 0, cum_income: 0,
    vesting_cap_gains: 0, price_cap_gains: 0, total_cap_gains: 0, cum_cap_gains: 0,
    ...extra,
  }
}

describe('StockJourney', () => {
  it('excludes past events and limits the path to five stops', () => {
    const events = [
      event('2025-03-01', 'Vesting', { vested_shares: 100 }),
      ...Array.from({ length: 7 }, (_, index) =>
        event(`2027-0${index + 1}-01`, 'Vesting', { vested_shares: 100 + index })),
    ]
    render(<StockJourney events={events} asOf="2026-09-07" />)
    expect(screen.getByRole('heading', { name: 'Your stock journey' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByText('Mar 1, 2025')).not.toBeInTheDocument()
    expect(screen.getByText('100 shares vest')).toBeInTheDocument()
  })

  it('sums each vesting tranche at its own market value and gain before choosing five milestones', () => {
    const events = [
      event('2026-09-30', 'Vesting', { vested_shares: 20, share_price: 10, vesting_cap_gains: 140 }),
      event('2026-09-30', 'Vesting', { vested_shares: 30, share_price: 12, vesting_cap_gains: 240 }),
      event('2026-09-30', 'Vesting', { vested_shares: 5, share_price: 12, income: 60, grant_type: 'Bonus' }),
      event('2027-01-01', 'Share Price'),
      event('2027-07-15', 'Loan Payoff', { cash_due: 100 }),
      event('2027-07-15', 'Loan Payoff', { cash_due: 250 }),
      event('2027-07-15', 'Sale', { gross_proceeds: 500 }),
      event('2027-09-30', 'Vesting', { vested_shares: 1 }),
    ]
    render(<StockJourney events={events} asOf="2026-09-27" />)
    const milestones = screen.getAllByRole('listitem')
    expect(milestones).toHaveLength(5)
    expect(within(milestones[0]).getByText('55 shares vest')).toBeInTheDocument()
    expect(within(milestones[0]).getByText('$620 market value · $440 value added · 3 tranches')).toBeInTheDocument()
    expect(within(milestones[2]).getByText('2 loan payoffs')).toBeInTheDocument()
    expect(within(milestones[2]).getByText('$350 due')).toBeInTheDocument()
    expect(within(milestones[3]).getByText('$500 gross proceeds')).toBeInTheDocument()
  })
})
