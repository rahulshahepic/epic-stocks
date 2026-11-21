import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, planCashFlows, simulate, type PlannedEvent } from '../app/pages/Retirement.math.ts'

const home: PlannedEvent = {
  id: 'home-1', title: 'House', kind: 'home', date: '2032-01-01',
  amountM: 1.2, downPaymentPct: 0.25, loanYears: 30, loanRate: 0.06,
  annualCostM: 0.024, saleOffsetM: 0.3, funding: 'epic',
}
const base = { ...DEFAULT_PARAMS, epicExit: 8, taxableAdditional: 1,
  additionalBasis: 0.4, traditional: 0.6, roth: 0.2,
  defaultSpend: 180, minSpend: 100, currentAge: 45, endAge: 75,
  paths: 200, seed: 1729, simulationStartDate: '2032-01-01' }

describe('hypothetical life-event cash flows', () => {
  it('models house down payment, existing-home proceeds, mortgage and carrying costs', () => {
    const p = planCashFlows([home], '2032-01-01', 360)
    // $300K down minus $300K existing-home sale proceeds, then mortgage + carrying.
    const r = 0.06 / 12
    const payment = 0.9 * r / (1 - Math.pow(1 + r, -360))
    expect(p.monthlyNeedM[1]).toBeCloseTo(payment + 0.024 / 12, 8)
    expect(p.monthlyNeedM[13]).toBeCloseTo(payment / 1.025 + 0.024 / 12, 8)
    expect(p.preRetirementNetM).toBe(0)
  })
  it('accounts for pre-retirement purchases without pretending to simulate wages', () => {
    const p = planCashFlows([{ ...home, date: '2030-01-01', saleOffsetM: 0 }], '2032-01-01', 360)
    const r = 0.06 / 12
    const monthly = 0.9 * r / (1 - Math.pow(1 + r, -360))
    const preRetirementLoan = Array.from({ length: 24 }, (_, i) =>
      monthly / Math.pow(1.025, i / 12)).reduce((sum, n) => sum + n, 0)
    const expected = 0.3 + 0.024 * 2 + preRetirementLoan
    expect(p.preRetirementNetM).toBeCloseTo(expected)
    expect(p.preRetirementEpicNeedM).toBeCloseTo(expected)
    expect(p.warnings.join(' ')).toContain('pre-retirement')
    expect(p.monthlyNeedM[1]).toBeGreaterThan(0)
  })
  it('does not drop pre-retirement college tuition or recurring replacements', () => {
    const p = planCashFlows([
      { id: 'tuition', title: 'College', kind: 'education', date: '2029-01-01',
        amountM: 0, annualCostM: 0.06, endDate: '2031-12-01' },
      { id: 'car', title: 'Car', kind: 'vehicle', date: '2028-01-01',
        amountM: 0.05, replacementEveryYears: 2, replacementCostM: 0.05 },
    ], '2032-01-01', 120)
    // Three years of tuition, initial car and a replacement in 2030.
    expect(p.preRetirementNetM).toBeCloseTo(0.18 + 0.05 + 0.05)
  })
  it('stops ongoing costs at end date and handles a resale net of remaining debt', () => {
    const p = planCashFlows([{ ...home, endDate: '2033-01-01',
      resaleDate: '2034-01-01', resaleValueM: 1.4 }], '2032-01-01', 120)
    expect(p.monthlyNeedM[14]).toBeGreaterThan(0)
    expect(p.monthlyNeedM[25]).toBeLessThan(0)
    expect(p.monthlyNeedM[26]).toBe(0)
  })
  it('schedules recurring tuition and vehicle replacements', () => {
    const p = planCashFlows([
      { id: 'college', title: 'College', kind: 'education', date: '2034-01-01',
        amountM: 0, annualCostM: 0.05, endDate: '2037-12-01' },
      { id: 'car', title: 'Car', kind: 'vehicle', date: '2032-01-01',
        amountM: 0.08, replacementEveryYears: 5, replacementCostM: 0.09 },
    ], '2032-01-01', 180)
    expect(p.monthlyNeedM[1]).toBeCloseTo(0.08)
    expect(p.monthlyNeedM[25]).toBeCloseTo(0.05 / 12)
    expect(p.monthlyNeedM[61]).toBeCloseTo(0.09 + 0.05 / 12)
    expect(p.monthlyNeedM[73]).toBe(0)
  })
  it('repeats a Disney vacation without needing a second price', () => {
    const p = planCashFlows([{ id: 'disney', title: 'Disney vacation', kind: 'travel',
      date: '2032-07-01', amountM: 0.02, replacementEveryYears: 3 }],
    '2032-01-01', 120)
    expect(p.monthlyNeedM[7]).toBeCloseTo(0.02)
    expect(p.monthlyNeedM[43]).toBeCloseTo(0.02)
    expect(p.monthlyNeedM[79]).toBeCloseTo(0.02)
  })
  it('excludes sunk costs on existing homes and only charges future loan payments', () => {
    const oldHome: PlannedEvent = { id: 'old', title: 'Paid-off home', kind: 'home',
      date: '1990-01-01', amountM: 0.4, downPaymentPct: 0.2,
      loanYears: 30, loanRate: 0.05 }
    const paid = planCashFlows([oldHome], '2032-01-01', 120, '2026-11-01')
    expect(paid.preRetirementNetM).toBe(0)
    const mortgage = planCashFlows([{ ...oldHome, date: '2019-01-01' }],
      '2032-01-01', 120, '2026-11-01')
    const rate = 0.05 / 12
    const payment = 0.32 * rate / (1 - Math.pow(1 + rate, -360))
    // Nov 2026 through Dec 2031, inclusive: 62 remaining pre-retirement payments.
    const remaining = Array.from({ length: 62 }, (_, i) =>
      payment / Math.pow(1.025, (94 + i) / 12)).reduce((sum, n) => sum + n, 0)
    expect(mortgage.preRetirementNetM).toBeCloseTo(remaining)
    expect(mortgage.preRetirementNetM).toBeLessThan(0.2)
  })
  it('keeps replacement purchases after recurring costs end', () => {
    const p = planCashFlows([{
      id: 'car', title: 'Car', kind: 'vehicle', date: '2032-01-01',
      amountM: 0.04, annualCostM: 0.012, endDate: '2033-01-01',
      replacementEveryYears: 3, replacementCostM: 0.05,
    }], '2032-01-01', 120)
    expect(p.monthlyNeedM[1]).toBeCloseTo(0.041)
    expect(p.monthlyNeedM[14]).toBe(0)
    expect(p.monthlyNeedM[37]).toBeCloseTo(0.05)
    expect(p.monthlyNeedM[73]).toBeCloseTo(0.05)
  })
  it('reports an unfunded pre-retirement purchase without inventing a retirement-account withdrawal', () => {
    const purchase: PlannedEvent = {
      id: 'unfunded', title: 'Large house', kind: 'home',
      date: '2030-01-01', amountM: 10, funding: 'epic',
    }
    for (const age of [45, 65]) {
      const result = simulate({
        ...base, currentAge: age, endAge: age + 10, paths: 10,
        epicExit: 1, taxableAdditional: 0.2, traditional: 3, roth: 2,
        plannedEvents: [purchase], asOfDate: '2029-01-01',
      })
      expect(result.preRetirementFundingGapM).toBeCloseTo(8.8)
      expect(result.pctRuin).toBe(1)
      // Assets may remain in retirement accounts, but cannot pay the unfunded
      // pre-retirement purchase under this working-life approximation.
      expect(result.startingTotal).toBeCloseTo(5)
      expect(result.medianFinalM).toBeGreaterThan(0)
    }
    const affordable = simulate({
      ...base, paths: 10, epicExit: 12, taxableAdditional: 0.2,
      plannedEvents: [purchase], asOfDate: '2029-01-01',
    })
    expect(affordable.preRetirementFundingGapM).toBe(0)
  })
  it('changes the real Monte Carlo outcomes without altering input objects', () => {
    const withEvents = { ...base, plannedEvents: [{ id: 'wedding', title: 'Wedding',
      kind: 'wedding' as const, date: '2035-05-01', amountM: 0.5 }] }
    const baseline = simulate({ ...base, plannedEvents: [] })
    const changed = simulate(withEvents)
    expect(changed.medianFinalM).toBeLessThan(baseline.medianFinalM)
    expect(withEvents.plannedEvents[0].amountM).toBe(0.5)
    expect(baseline.startingTotal).toBeCloseTo(changed.startingTotal)
  })
})

describe('causal purchase conditions', () => {
  const car: PlannedEvent = { id: 'conditional-car', title: 'Optional car', kind: 'vehicle',
    date: '2037-01-01', amountM: 0.2, annualCostM: 0.01,
    resaleDate: '2042-01-01', resaleValueM: 0.1,
    condition: { minPortfolioM: 1000 } }
  it('skips the whole unpurchased asset, including debt, costs and resale proceeds', () => {
    const baseline = simulate(base)
    const skipped = simulate({ ...base, plannedEvents: [{ ...car,
      downPaymentPct: 0.2, loanYears: 10, loanRate: 0.05 }] })
    expect(skipped.finalWealth).toEqual(baseline.finalWealth)
    expect(skipped.eventOutcomes?.[0].purchaseProbability).toBe(0)
    expect(skipped.eventOutcomes?.[0].skippedProbability).toBe(1)
  })
  it('preserves unconditional results when the condition always passes', () => {
    const held = { ...car, replacementEveryYears: 5, replacementCostM: 0.15 }
    const unconditional = simulate({ ...base, plannedEvents: [{ ...held, condition: undefined }] })
    const conditional = simulate({ ...base, plannedEvents: [{ ...held, condition: { minPortfolioM: 0 } }] })
    expect(conditional.finalWealth).toEqual(unconditional.finalWealth)
    expect(conditional.eventOutcomes?.[0].purchaseProbability).toBe(1)
  })
  it('uses current wealth and the same spending ramp, without knowing later returns', () => {
    const full = simulate({ ...base, plannedEvents: [{ ...car,
      condition: { requireFullSpending: true, minStartingWealthRatio: 1 } }] })
    expect(full.eventOutcomes?.[0].purchaseProbability).toBeGreaterThan(0)
    expect(full.eventOutcomes?.[0].purchaseProbability).toBeLessThan(1)
    // Match the same first path's history with a shorter horizon. Future
    // random draws and final outcomes cannot change the purchase decision.
    const one = { ...base, paths: 1, plannedEvents: [{ ...car,
      condition: { requireFullSpending: true, minStartingWealthRatio: 1 } }] }
    expect(simulate({ ...one, endAge: 52 }).eventOutcomes)
      .toEqual(simulate(one).eventOutcomes)
  })
  it('does not treat full spending as a wealth test when the user disabled spending cuts', () => {
    const result = simulate({ ...base, minSpend: base.defaultSpend,
      plannedEvents: [{ ...car, condition: { requireFullSpending: true } }] })
    expect(result.eventOutcomes?.[0].purchaseProbability).toBe(1)
  })
  it('rechecks replacements while continuing costs and debt already committed', () => {
    const result = simulate({ ...base, paths: 1, stockPct: 0, bondPct: 0,
      traditional: 0, roth: 0, epicExit: 1, taxableAdditional: 0,
      defaultSpend: 0, minSpend: 0, healthInsurance: 0, zeroHIPost65: false, ssMonthly: 0,
      plannedEvents: [{ ...car, date: '2032-01-01', amountM: 0.4,
        annualCostM: 0.012, resaleDate: undefined, replacementEveryYears: 2,
        condition: { minPortfolioM: 0.8 } }] })
    expect(result.eventOutcomes?.[0].purchaseProbability).toBe(1)
    expect(result.eventOutcomes?.[0].meanPurchases).toBe(1)
    // Only the first purchase, then 30 years' ownership costs (no stopped bills).
    expect(result.finalWealth[0]).toBeCloseTo(0.24, 6)
  })
  it('refuses conditional pre-retirement purchases rather than silently applying them', () => {
    expect(() => simulate({ ...base, plannedEvents: [{ ...car, date: '2030-01-01' }] }))
      .toThrow(/at or after retirement/)
  })
})

describe('vehicle lifetime, depreciation and disposal', () => {
  const car: PlannedEvent = { id: 'collectible', title: 'Collectible car', kind: 'vehicle',
    date: '2032-01-01', amountM: 0.2, annualCostM: 0.012,
    lifetimeYears: 10, depreciationRate: 0, inflationRate: 0.025 }
  it('sells a zero-depreciation car for its nominal purchase price and stops ownership costs', () => {
    const flows = planCashFlows([car], '2032-01-01', 240)
    expect(flows.monthlyNeedM[121]).toBeCloseTo(0.001 - 0.2 / 1.025 ** 10)
    expect(flows.monthlyNeedM[122]).toBe(0)
  })
  it('applies annual depreciation and repays debt on sale', () => {
    const flows = planCashFlows([{ ...car, depreciationRate: 0.1,
      downPaymentPct: 0.2, loanYears: 20, loanRate: 0 }], '2032-01-01', 240)
    const payment = 0.16 / 240
    const remaining = 0.16 - payment * 121
    expect(flows.monthlyNeedM[121]).toBeCloseTo(
      payment / 1.025 ** 10 + 0.001 - 0.2 * (0.9 / 1.025) ** 10 + remaining / 1.025 ** 10)
    expect(flows.monthlyNeedM[122]).toBe(0)
  })
  it('gives each replacement its own lifetime and conditional purchase decision', () => {
    const result = simulate({ ...base, paths: 10, plannedEvents: [{ ...car,
      replacementEveryYears: 10, condition: { minPortfolioM: 1000 } }] })
    expect(result.finalWealth).toEqual(simulate({ ...base, paths: 10 }).finalWealth)
    expect(result.eventOutcomes).toHaveLength(1)
    expect(result.eventOutcomes?.every(o => o.skippedProbability === 1)).toBe(true)
    const flows = planCashFlows([{ ...car, replacementEveryYears: 10 }], '2032-01-01', 360)
    expect(flows.monthlyNeedM[121]).toBeCloseTo(0.202 - 0.2 / 1.025 ** 10)
    expect(flows.monthlyNeedM[241]).toBeCloseTo(0.202 - 0.2 / 1.025 ** 10)
  })
})

it('can buy a later recurring opportunity after skipping the first, without inventing the initial loan', () => {
  const result = simulate({ ...base, paths: 1, endAge: 51, stockPct: 0, bondPct: 0,
    glidePoints: [], traditional: 0, roth: 0, epicExit: 1, taxableAdditional: 0,
    defaultSpend: 0, minSpend: 0, healthInsurance: 0, zeroHIPost65: false,
    ssMonthly: 0, plannedEvents: [
      { id: 'cash', title: 'Cash proceeds', kind: 'other', date: '2033-01-01', amountM: 0, saleOffsetM: 0.5 },
      { id: 'trip', title: 'Optional trip', kind: 'travel', date: '2032-01-01',
        amountM: 0.1, replacementEveryYears: 2, condition: { minPortfolioM: 1.1 } },
    ] })
  expect(result.eventOutcomes?.[0].purchaseProbability).toBe(1)
  expect(result.eventOutcomes?.[0].meanPurchases).toBe(2)
  expect(result.finalWealth[0]).toBeCloseTo(1.3)
})
