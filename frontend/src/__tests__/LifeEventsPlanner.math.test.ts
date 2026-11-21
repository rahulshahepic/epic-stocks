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
