import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LifeEventsPlanner from '../app/pages/LifeEventsPlanner.tsx'
import type { PlannedEvent, SimResult } from '../app/pages/Retirement.math.ts'

function mount() {
  const onChange = vi.fn<(events: PlannedEvent[]) => void>()
  render(<LifeEventsPlanner events={[]} retirementDate="2032-01-01"
    onChange={onChange} comparison={null} onRun={vi.fn()}
    running={false} />)
  fireEvent.click(screen.getByRole('button', { name: /Add planned expense/ }))
  return onChange
}

describe('life event editor saves backend-compatible shapes', () => {
  it('converts a current sticker price into retirement-year purchasing power', () => {
    const onChange = mount()
    fireEvent.change(screen.getByLabelText("Price in today's dollars ($)"), { target: { value: '100000' } })
    const button = screen.getByRole('button', { name: /Use \$.* in 2032 dollars/ })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const event = onChange.mock.calls[0][0][0]
    const today = new Date()
    const years = (2032 - today.getFullYear()) + (1 - today.getMonth() - 1) / 12
    expect(event.amountM).toBeCloseTo(Math.round(100000 * Math.pow(1.025, years)) / 1_000_000, 6)
    expect(event.amountM).toBeGreaterThan(0.1)
  })

  it('shows an explicitly hypothetical Epic sale target without posting a transaction', () => {
    const event: PlannedEvent = {
      id: 'car', title: 'Future car', kind: 'vehicle', date: '2030-01-01',
      amountM: 0.08, funding: 'epic',
    }
    render(<LifeEventsPlanner events={[event]} retirementDate="2032-01-01"
      onChange={vi.fn()} comparison={null} onRun={vi.fn()} running={false} />)
    expect(screen.getByRole('note').textContent).toContain('$80,000')
    expect(screen.getByRole('note').textContent).toContain('not a share count or an executed sale')
  })

  it('does not present Monte Carlo affordability odds when pre-retirement cash is missing', () => {
    const baseline = { preRetirementFundingGapM: 0, pctRuin: 0.01, medianFinalM: 8 } as SimResult
    const withEvents = { preRetirementFundingGapM: 2, pctRuin: 1, medianFinalM: 5 } as SimResult
    const event: PlannedEvent = {
      id: 'house', title: 'House', kind: 'home', date: '2030-01-01', amountM: 3,
    }
    render(<LifeEventsPlanner events={[event]} retirementDate="2032-01-01"
      onChange={vi.fn()} comparison={{ baseline, withEvents }}
      onRun={vi.fn()} running={false} />)
    expect(screen.getByRole('alert').textContent).toContain('$2,000,000')
    expect(screen.queryByText('99.00%')).toBeNull()
    expect(screen.queryByText('0.00%')).toBeNull()
  })

  it('normalizes a cash house with a stale interest rate', () => {
    const onChange = mount()
    fireEvent.change(screen.getByLabelText('Purchase price (2032 $)'), { target: { value: '1200000' } })
    fireEvent.change(screen.getByLabelText('Loan term (years; 0 = cash)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const event = onChange.mock.calls[0][0][0]
    expect(event.loanYears).toBeUndefined()
    expect(event.loanRate).toBeUndefined()
    expect(event.inflationRate).toBeUndefined()
    expect(event.downPaymentPct).toBe(1)
  })

  it('normalizes a fully paid home and zero-value resale', () => {
    const onChange = mount()
    fireEvent.change(screen.getByLabelText('Purchase price (2032 $)'), { target: { value: '800000' } })
    fireEvent.change(screen.getByLabelText('Down payment (%)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Resale date (optional)'), { target: { value: '2035-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const event = onChange.mock.calls[0][0][0]
    expect(event.loanYears).toBeUndefined()
    expect(event.resaleValueM).toBe(0)
  })

  it('allows an existing mortgage from before 2020 and clamps repeat terms', () => {
    const onChange = mount()
    fireEvent.change(screen.getByLabelText('Purchase / start date'), { target: { value: '2019-01-01' } })
    fireEvent.change(screen.getByLabelText('Purchase price (2032 $)'), { target: { value: '600000' } })
    fireEvent.change(screen.getByLabelText('Repeat every N years (0 = once)'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const event = onChange.mock.calls[0][0][0]
    expect(event.date).toBe('2019-01-01')
    expect(event.replacementEveryYears).toBe(50)
  })
})
