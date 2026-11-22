import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen } from '@testing-library/react'
import LifeEventsPlanner from '../app/pages/LifeEventsPlanner.tsx'
import type { PlannedEvent, SimResult } from '../app/pages/Retirement.math.ts'

function mount() {
  const onChange = vi.fn<(events: PlannedEvent[]) => void>()
  render(<LifeEventsPlanner events={[]} retirementDate="2032-01-01"
    onChange={onChange} comparison={null} onRun={vi.fn()}
    running={false} />)
  fireEvent.click(screen.getByRole('button', { name: /Add planned expense/ }))
  fireEvent.change(screen.getByLabelText('Prices entered in'), { target: { value: 'retirement' } })
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
    expect(screen.queryByLabelText('Loan interest rate (%)')).toBeNull()
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
    expect(screen.getByLabelText('Payment')).toHaveValue('cash')
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

it('saves causal rules and car lifetime with nominal depreciation', () => {
  const onChange = mount()
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vehicle' } })
  fireEvent.change(screen.getByLabelText('Purchase / start date'), { target: { value: '2037-01-01' } })
  fireEvent.click(screen.getByLabelText('Buy only when conditions hold'))
  fireEvent.change(screen.getByLabelText(/Minimum portfolio before purchase/), { target: { value: '5000000' } })
  fireEvent.change(screen.getByLabelText(/Minimum portfolio as %/), { target: { value: '120' } })
  fireEvent.change(screen.getByLabelText('Sell car after N years (optional)'), { target: { value: '15' } })
  fireEvent.change(screen.getByLabelText('Annual depreciation (% nominal; 0 = flat price)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  const event = onChange.mock.calls[0][0][0]
  expect(event.condition).toEqual({ requireFullSpending: true, minPortfolioM: 5, minStartingWealthRatio: 1.2 })
  expect(event.lifetimeYears).toBe(15)
  expect(event.depreciationRate).toBe(0)
  expect(event.inflationRate).toBe(0.025)
  expect(event.resaleDate).toBeUndefined()
})

it('allows optional thresholds to be cleared', () => {
  const onChange = mount()
  fireEvent.click(screen.getByLabelText('Buy only when conditions hold'))
  const threshold = screen.getByLabelText(/Minimum portfolio before purchase/)
  fireEvent.change(threshold, { target: { value: '5000000' } })
  fireEvent.change(threshold, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(onChange.mock.calls[0][0][0].condition).toEqual({ requireFullSpending: true })
})

it('rejects a zero vehicle lifetime before autosave', () => {
  const onChange = mount()
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vehicle' } })
  fireEvent.change(screen.getByLabelText('Sell car after N years (optional)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Vehicle lifetime must be 1–50')
  expect(onChange).not.toHaveBeenCalled()
})

it('preserves typing, pasting, clearing and editing 140% without floating point text', async () => {
  const onChange = mount()
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Buy only when conditions hold'))
  const input = screen.getByLabelText(/Minimum portfolio as %/)
  await user.type(input, '140')
  expect(input).toHaveValue(140)
  await user.clear(input)
  await user.paste('140')
  expect(input).toHaveValue(140)
  await user.clear(input)
  await user.type(input, '139')
  expect(input).toHaveValue(139)
  await user.clear(input)
  await user.type(input, '140')
  await user.selectOptions(screen.getByLabelText('If conditions are not met'), 'defer')
  fireEvent.change(screen.getByLabelText('Stop waiting after (optional)'), { target: { value: '2040-01-01' } })
  await user.click(screen.getByRole('button', { name: 'Add event' }))
  expect(onChange.mock.calls[0][0][0]).toMatchObject({ condition: { minStartingWealthRatio: 1.4 },
    conditionFailure: 'defer', deadlineDate: '2040-01-01' })
})

it('shows category-specific ownership controls and hides financing until requested', () => {
  mount()
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vehicle' } })
  expect(screen.getByLabelText(/Annual ownership costs/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Loan interest rate (%)')).toBeNull()
  expect(screen.queryByLabelText('Stop recurring costs (optional)')).toBeNull()
  fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'finance' } })
  expect(screen.getByLabelText('Loan interest rate (%)')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'education' } })
  expect(screen.queryByLabelText('Payment')).toBeNull()
  expect(screen.queryByLabelText(/Resale date/)).toBeNull()
  expect(screen.getByLabelText('Duration (years; optional)')).toBeInTheDocument()
})

it('keeps today-dollar prices stable when changing inflation and converts only on save', () => {
  const onChange = mount()
  fireEvent.change(screen.getByLabelText('Prices entered in'), { target: { value: 'today' } })
  const price = screen.getByLabelText(/Purchase price/)
  fireEvent.change(price, { target: { value: '100000' } })
  fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('Assumed inflation (%)'), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Loan interest rate (%)'), { target: { value: '0' } })
  expect(price).toHaveValue(100000)
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(onChange.mock.calls[0][0][0].amountM).toBe(0.1)
})

it('rejects out-of-range percentages inline before autosaving', () => {
  const onChange = mount()
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vehicle' } })
  fireEvent.change(screen.getByLabelText('Sell car after N years (optional)'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Annual depreciation (% nominal; 0 = flat price)'), { target: { value: '140' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(screen.getByRole('alert')).toHaveTextContent('between 0% and 100%')
  expect(onChange).not.toHaveBeenCalled()
})

it('preserves four years of tuition when the start moves, including after editing', () => {
  const onChange = vi.fn()
  const events: PlannedEvent[] = [{ id: 'college', title: 'College', kind: 'education', date: '2044-08-01', amountM: 0, annualCostM: 0.1, durationYears: 4 }]
  render(<LifeEventsPlanner events={events} retirementDate="2032-01-01" onChange={onChange} comparison={null} onRun={vi.fn()} running={false} />)
  fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }))
  expect(screen.getByLabelText('Duration (years; optional)')).toHaveValue(4)
  fireEvent.change(screen.getByLabelText('Purchase / start date'), { target: { value: '2045-08-01' } })
  expect(screen.getByLabelText('Duration (years; optional)')).toHaveValue(4)
  fireEvent.click(screen.getByRole('button', { name: 'Update event' }))
  expect(onChange.mock.calls[0][0][0]).toMatchObject({ date: '2045-08-01', durationYears: 4 })
  expect(onChange.mock.calls[0][0][0].endDate).toBeUndefined()
})

it('requires an explicit financing rate while allowing a deliberate interest-free loan', () => {
  const onChange = mount()
  fireEvent.change(screen.getByLabelText(/Purchase price/), { target: { value: '100000' } })
  fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'finance' } })
  expect(screen.getByLabelText('Loan interest rate (%)')).toHaveValue(null)
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the loan interest rate')
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Loan interest rate (%)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
  expect(onChange.mock.calls[0][0][0].loanRate).toBe(0)
})
