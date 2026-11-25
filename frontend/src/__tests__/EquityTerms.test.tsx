import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EquityTerms from '../app/components/EquityTerms.tsx'
import ImportEvidence from '../app/components/ImportEvidence.tsx'

describe('Equity explanations', () => {
  it('can be expanded and distinguishes estimates from records', async () => {
    render(<EquityTerms terms={['vesting', 'price', 'tax']} />)
    await userEvent.click(screen.getByText('What do these terms mean?'))
    expect(screen.getByText(/A price estimate that has not been confirmed/)).toBeVisible()
    expect(screen.getByText(/This is not a tax bill/)).toBeVisible()
  })

  it('shows absent evidence explicitly without financial calculations', () => {
    render(<ImportEvidence evidence={[{
      label: 'Accrued interest', status: 'not_available', detail: 'A cutoff is needed.', rule_ids: ['C4'],
    }]} />)
    expect(screen.getByText('Not available')).toBeVisible()
    expect(screen.getByText('Checks: C4')).toBeVisible()
    expect(screen.queryByText('Matched')).not.toBeInTheDocument()
  })
})
