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
    expect(p.preRetirementNetM).toBeCloseTo(0.3)
    expect(p.preRetirementEpicNeedM).toBeCloseTo(0.3)
    expect(p.warnings.join(' ')).toContain('pre-retirement')
    expect(p.monthlyNeedM[1]).toBeGreaterThan(0)
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
