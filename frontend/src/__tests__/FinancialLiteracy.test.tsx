import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EquityTerms, { InlineTerm } from '../app/components/EquityTerms.tsx'
import { EQUITY_TERMS } from '../app/equityTerms.ts'
import { StatCard } from '../app/components/StatCard.tsx'
import { CostCards } from '../app/pages/dashboard/CostCards.tsx'
import type { CardValues, ActiveLoan } from '../app/pages/Dashboard.types.ts'
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
  it('explains gross principal separately from the balance after a repayment', () => {
    // A $100 loan with a $40 payment still reports $100 on the borrowing card.
    const cv: CardValues = {total_loan_principal: 100, total_interest: 0, total_tax_paid: 0, current_price: 1, total_shares: 100, total_income: 0, total_cap_gains: 0, cash_received: 0, interest_deduction_total: 0, tax_savings_from_deduction: 0, price_is_estimate: false, next_event: null, next_event_detail: null, total_stock_value: 100, vested_stock_value: 100, purchased_unvested_stock_value: 0, net_equity: 40, accrued_unbooked_interest: 0, total_cost_basis: 100, unvested_shares: 0}
    const loans = [{id: 1, grantYear: 2020, grantType: 'Purchase', loanType: 'Purchase', loanYear: 2020, balance: 60, interestRate: 0, dueDate: '2030-01-01'}] as ActiveLoan[]
    render(<CostCards cv={cv} activeLoans={loans} breakdowns={null} hasInterestDeduction={false} openBreakdowns={new Set(['activeLoans'])} toggleBreakdown={() => {}} />)
    expect(screen.getByText('$100')).toBeInTheDocument()
    expect(screen.getByText('Recorded loan principal · explain')).toBeInTheDocument()
    expect(screen.getAllByText('Repayments do not reduce this borrowing total. Open the active-loan breakdown for remaining balances.')).toHaveLength(2)
    expect(screen.queryByText('Loan principal · explain')).toBeNull()
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
