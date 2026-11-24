import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PurchaseResults from '../app/pages/PurchaseResults.tsx'
import type { PlannedEvent, SimResult } from '../app/pages/Retirement.math.ts'

const car: PlannedEvent = { id: 'car', title: 'Sports car', kind: 'vehicle', date: '2035-01-01', amountM: .2,
  condition: { requireFullSpending: true }, conditionFailure: 'defer', lifetimeYears: 10, replacementEveryYears: 10 }
const result = {
  preRetirementFundingGapM: 0, pctRuin: .03, medianFinalM: 12,
  purchaseSummary: { paths: 1000, pathsWithPurchase: 680, purchaseProbability: .68, fundedPurchaseProbability: .65,
    meanPurchases: .8, distribution: [{ purchases: 0, paths: 320, probability: .32 }, { purchases: 1, paths: 280, probability: .28 }, { purchases: 2, paths: 400, probability: .4 }] },
  eventOutcomes: [{ eventId: 'car', title: 'Sports car', purchaseProbability: .5, skippedProbability: .5,
    onTimeProbability: .3, delayedProbability: .2, fundedPurchaseProbability: .48, meanPurchases: .7,
    meanDelayMonths: 24, firstPurchaseByYear: [{ year: 2035, probability: .3 }, { year: 2037, probability: .2 }] }],
} as SimResult
const baseline = { ...result, pctRuin: .01, medianFinalM: 14 }

describe('purchase result hierarchy', () => {
  it('shows one headline and preserves the different funded statistic in expandable details', () => {
    render(<PurchaseResults events={[car]} comparison={{ baseline, withEvents: result }} />)
    expect(screen.getAllByText('68.0%')).toHaveLength(1)
    const funded = screen.getByText(/Buy \+ fully fund retirement: 65.00%/)
    expect(funded).not.toBeVisible()
    expect(screen.getByText('680 of 1,000 simulations include an optional purchase.')).not.toBeVisible()
    expect(screen.getByText('50.0% bought')).toBeVisible()
    expect(screen.getByRole('img', { name: 'Sports car first purchase timing' })).toBeVisible()
    fireEvent.click(screen.getByText('Calculation details'))
    expect(funded).toBeVisible()
    expect(screen.getByText(/Purchase probability alone includes simulations with a funding shortfall/)).toBeVisible()
    fireEvent.click(screen.getByLabelText('Details for Sports car'))
    expect(screen.getByText('Average wait among buyers: 2.0 years')).toBeVisible()
    expect(screen.getByText(/Average purchases per simulation, including replacements: 0.70/)).toBeVisible()
  })

  it('does not present zero optional-purchase odds for an all-required plan', () => {
    render(<PurchaseResults events={[{ ...car, condition: undefined }]} comparison={{ baseline, withEvents: { ...result, eventOutcomes: [] } }} />)
    expect(screen.queryByText('Chance of at least one optional purchase')).toBeNull()
    expect(screen.getByText('Required expenses')).toBeVisible()
    expect(screen.getByText('Scheduled in every simulation')).toBeVisible()
    expect(screen.getByText('Without planned expenses')).not.toBeVisible()
    fireEvent.click(screen.getByText('Plan comparison details'))
    expect(screen.getByText('Without planned expenses')).toBeVisible()
    expect(screen.getByText('With planned expenses')).toBeVisible()
  })

  it('reports a baseline funding gap and suppresses all purchase probabilities', () => {
    render(<PurchaseResults events={[car]} comparison={{ baseline: { ...baseline, preRetirementFundingGapM: .1 }, withEvents: result }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('$100,000')
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.queryByText('68.0%')).toBeNull()
  })
})
