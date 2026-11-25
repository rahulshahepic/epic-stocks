import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EquityTerms, { InlineTerm } from '../app/components/EquityTerms.tsx'
import { EQUITY_TERMS } from '../app/equityTerms.ts'
import { StatCard } from '../app/components/StatCard.tsx'
import PositionTour from '../app/components/PositionTour.tsx'

describe('plain financial explanations', () => {
  it('covers every shared dictionary term without an assistant', () => {
    render(<EquityTerms terms={Object.keys(EQUITY_TERMS) as (keyof typeof EQUITY_TERMS)[]} />)
    for (const term of Object.values(EQUITY_TERMS)) expect(screen.getByText(term.definition + ' ' + term.meaning)).toBeInTheDocument()
  })
  it('shows the exact supplied server figure alongside its meaning', () => {
    render(<InlineTerm term="accrued_interest" figure="$1,234" />)
    fireEvent.click(screen.getByText(/Accrued or unbooked interest · explain/))
    expect(screen.getByText('On this card: $1,234.')).toBeVisible()
  })
  it.each(['costbasis', 'loans', 'tax', 'cash', 'shares', 'gains'])('keeps %s explanations separate from the card action', variant => {
    render(<StatCard label="Test figure" value="$1,234" variant={variant} onClick={() => {}} />)
    expect(screen.getByText(/On this card/)).toBeInTheDocument()
    expect(screen.getByRole('button').querySelector('summary')).toBeNull()
  })
  it('persists tour dismissal for this account only', () => {
    localStorage.clear()
    const first = render(<MemoryRouter><PositionTour accountId={42} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss tour'}))
    first.unmount()
    const again = render(<MemoryRouter><PositionTour accountId={42} /></MemoryRouter>)
    expect(screen.queryByRole('region', {name: 'Your position tour'})).toBeNull()
    again.unmount()
    render(<MemoryRouter><PositionTour accountId={43} /></MemoryRouter>)
    expect(screen.getByRole('region', {name: 'Your position tour'})).toBeVisible()
  })
})
