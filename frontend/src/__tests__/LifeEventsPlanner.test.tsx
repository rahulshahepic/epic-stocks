import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LifeEventsPlanner from '../app/pages/LifeEventsPlanner.tsx'
import type { PlannedEvent } from '../app/pages/Retirement.math.ts'

function mount() {
  const onChange = vi.fn<(events: PlannedEvent[]) => void>()
  render(<LifeEventsPlanner events={[]} retirementDate="2032-01-01"
    onChange={onChange} comparison={null} onRun={vi.fn()}
    running={false} readonly={false} />)
  fireEvent.click(screen.getByRole('button', { name: /Add planned expense/ }))
  return onChange
}

describe('life event editor saves backend-compatible shapes', () => {
  it('normalizes a cash house with a stale interest rate', () => {
    const onChange = mount()
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '1200000' } })
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
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '800000' } })
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
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '600000' } })
    fireEvent.change(screen.getByLabelText('Repeat every N years (0 = once)'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const event = onChange.mock.calls[0][0][0]
    expect(event.date).toBe('2019-01-01')
    expect(event.replacementEveryYears).toBe(50)
  })
})
