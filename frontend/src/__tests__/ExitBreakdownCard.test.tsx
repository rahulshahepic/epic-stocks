import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ExitBreakdownCard from '../app/components/ExitBreakdownCard.tsx'
import type { ExitSummary } from '../api.ts'

const base: ExitSummary = {
  vested_shares: 10_000, share_price: 10, gross_vested: 100_000, unvested_cost_proceeds: 0,
  liquidation_tax: 10_000, outstanding_principal: 40_000, outstanding_accrued_interest: 5_000,
  prior_sales: [], prior_sales_net: 0, income_tax: 0, deduction_savings: 0,
  deduction_years: [], deduction_excluded_years: [], net_cash: 0,
}

describe('ExitBreakdownCard', () => {
  it('pays projected tax loans and earlier projected payoffs out of the liquidation', () => {
    render(<ExitBreakdownCard s={{ ...base, outstanding_projected_loans: 3_000, projected_payoffs_before_exit: 2_000 }} />)
    expect(screen.getByText('Tax loans (projected)')).toBeInTheDocument()
    expect(screen.getByText('Earlier projected payoffs')).toBeInTheDocument()
    // 100,000 - 10,000 - 40,000 - 5,000 - 3,000 - 2,000
    expect(screen.getByText('$40,000')).toBeInTheDocument()
  })

  it.each([
    ['cash', 'Interest counted when paid.'],
    ['accrual', 'Interest counted as it accrued.'],
  ] as const)('explains the deduction under the %s method', (method, label) => {
    render(<ExitBreakdownCard s={{ ...base, deduction_savings: 2_916, deduction_years: [2031],
      interest_deducted: 10_000, investment_interest_method: method }} />)
    expect(screen.getByText(/of interest offset realized gains/)).toHaveTextContent(label)
  })

  it('leaves the rows out when there is nothing projected', () => {
    render(<ExitBreakdownCard s={base} />)
    expect(screen.queryByText('Tax loans (projected)')).toBeNull()
  })
})
