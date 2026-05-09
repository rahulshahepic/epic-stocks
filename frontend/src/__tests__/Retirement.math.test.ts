import { describe, it, expect } from 'vitest'
import {
  MEAN_BLOCK_LEN,
  computeAnnualTax,
  computeFanPercentiles,
  DEFAULT_PARAMS,
  finalPercentiles,
  FINAL_PERCENTILES,
  HISTORICAL_RETURNS,
  histogram,
  irmaaSurcharge,
  migrateLoadedParams,
  mulberry32,
  projectedSpend,
  quantile,
  resolveScenarioShifts,
  RETIREMENT_ACCESS_AGE,
  SCENARIOS,
  simulate,
  SPEND_RAMP_FLOOR,
  ssAdjustment,
} from '../app/pages/Retirement.math.ts'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 5; i++) expect(a()).toBe(b())
  })

  it('returns values in [0,1)', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('HISTORICAL_RETURNS', () => {
  it('covers a contiguous span of years', () => {
    expect(HISTORICAL_RETURNS.length).toBeGreaterThan(90)
    for (let i = 1; i < HISTORICAL_RETURNS.length; i++) {
      expect(HISTORICAL_RETURNS[i].year).toBe(HISTORICAL_RETURNS[i - 1].year + 1)
    }
  })

  it('arithmetic mean of real stock returns matches long-run U.S. (~8% +/- 2pp)', () => {
    const mean =
      HISTORICAL_RETURNS.reduce((s, r) => s + r.stockReal, 0) / HISTORICAL_RETURNS.length
    expect(mean).toBeGreaterThan(0.06)
    expect(mean).toBeLessThan(0.10)
  })

  it('arithmetic mean of real bond returns is positive but modest (~2%)', () => {
    const mean =
      HISTORICAL_RETURNS.reduce((s, r) => s + r.bondReal, 0) / HISTORICAL_RETURNS.length
    expect(mean).toBeGreaterThan(0.0)
    expect(mean).toBeLessThan(0.04)
  })
})

describe('resolveScenarioShifts', () => {
  it('returns the built-in shift for non-custom scenarios', () => {
    expect(resolveScenarioShifts({ scenario: 'historical', customStockShift: 0.99, customBondShift: 0.99 }))
      .toEqual(SCENARIOS.historical)
    expect(resolveScenarioShifts({ scenario: 'moderate', customStockShift: 0, customBondShift: 0 }))
      .toEqual(SCENARIOS.moderate)
    expect(resolveScenarioShifts({ scenario: 'cautious', customStockShift: 0, customBondShift: 0 }))
      .toEqual(SCENARIOS.cautious)
  })
  it('uses the user shifts when scenario is custom', () => {
    expect(resolveScenarioShifts({ scenario: 'custom', customStockShift: -0.04, customBondShift: -0.015 }))
      .toEqual({ stockShift: -0.04, bondShift: -0.015 })
  })
})

describe('ssAdjustment', () => {
  it('returns 1 at FRA', () => {
    expect(ssAdjustment(67)).toBe(1)
  })
  it('reduces benefit for early claim (62 → ~70%)', () => {
    expect(ssAdjustment(62)).toBeCloseTo(0.7, 3)
  })
  it('reduces benefit at 65 by ~13.33%', () => {
    expect(ssAdjustment(65)).toBeCloseTo(1 - 0.1333, 3)
  })
  it('reduces benefit at 66 by ~6.67%', () => {
    expect(ssAdjustment(66)).toBeCloseTo(1 - 0.0667, 3)
  })
  it('adds 8% per year delayed credits past FRA', () => {
    expect(ssAdjustment(68)).toBeCloseTo(1.08, 6)
    expect(ssAdjustment(69)).toBeCloseTo(1.16, 6)
    expect(ssAdjustment(70)).toBeCloseTo(1.24, 6)
  })
  it('caps delayed credits at age 70', () => {
    expect(ssAdjustment(72)).toBe(ssAdjustment(70))
  })
})

describe('block bootstrap', () => {
  it('uses MEAN_BLOCK_LEN of 20 (stationary bootstrap, matches doc/UI defaults)', () => {
    expect(MEAN_BLOCK_LEN).toBe(20)
  })

  it('30-year retiree at 2.3% WR has near-zero ruin in historical scenario', () => {
    // Walking actual 30-year historical windows from each starting year
    // ruins on 0/98 paths at this withdrawal rate. The 10-year-block
    // bootstrap matches that in the typical retirement-horizon case (3
    // blocks/path is enough to vary outcomes without enabling pathological
    // stitching).
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 12,
      taxableAdditional: 0,
      stockPct: 0.9,
      bondPct: 0.05,
      defaultSpend: 275,
      minSpend: 130,
      healthInsurance: 25,
      currentAge: 65,
      endAge: 95,
      scenario: 'historical',
      paths: 5000,
      seed: 77,
    })
    expect(r.pctRuin).toBeLessThan(0.005)
  })

  it('the custom-zero scenario matches historical when shifts are 0', () => {
    const a = simulate({ ...DEFAULT_PARAMS, epicExit: 5, paths: 200, seed: 21, scenario: 'historical' })
    const b = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 5,
      paths: 200,
      seed: 21,
      scenario: 'custom',
      customStockShift: 0,
      customBondShift: 0,
    })
    expect(b.medianFinalM).toBeCloseTo(a.medianFinalM, 9)
    expect(b.pctRuin).toBeCloseTo(a.pctRuin, 9)
  })

  it('moderate is strictly worse on median than historical (same seed)', () => {
    const base = { ...DEFAULT_PARAMS, epicExit: 5, paths: 500, seed: 33 }
    const hist = simulate({ ...base, scenario: 'historical' })
    const mod = simulate({ ...base, scenario: 'moderate' })
    expect(mod.medianFinalM).toBeLessThan(hist.medianFinalM)
  })

  it('cautious is strictly worse on median than moderate (same seed)', () => {
    const base = { ...DEFAULT_PARAMS, epicExit: 5, paths: 500, seed: 41 }
    const mod = simulate({ ...base, scenario: 'moderate' })
    const cau = simulate({ ...base, scenario: 'cautious' })
    expect(cau.medianFinalM).toBeLessThan(mod.medianFinalM)
  })

  it('moderate shift compresses the right tail materially vs historical (90/5/5, 51yr)', () => {
    // The user-reported failure mode: i.i.d. lognormal gave ~3% chance of
    // ending a billionaire from $12M, even in moderate. The bootstrap+shift
    // model should produce a meaningfully smaller right tail under moderate
    // than under historical, on the same seed.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 12,
      taxableAdditional: 0,
      stockPct: 0.9,
      bondPct: 0.05,
      defaultSpend: 275,
      minSpend: 130,
      healthInsurance: 25,
      currentAge: 44,
      endAge: 95,
      paths: 5000,
      seed: 99,
    }
    const hist = simulate({ ...base, scenario: 'historical' })
    const mod = simulate({ ...base, scenario: 'moderate' })
    const billion = (r: ReturnType<typeof simulate>) => {
      let n = 0
      for (let i = 0; i < r.finalWealth.length; i++) if (r.finalWealth[i] >= 1000) n++
      return n
    }
    const histBn = billion(hist)
    const modBn = billion(mod)
    expect(modBn).toBeLessThan(histBn)
    // Moderate should keep the absolute billionaire chance under 3% (vs the
    // ~3-4% the i.i.d. lognormal model produced for the same inputs).
    expect(modBn / mod.finalWealth.length).toBeLessThan(0.03)
  })
})

describe('projectedSpend (behavioral spending ramp)', () => {
  it('returns default spend at or above starting wealth', () => {
    expect(projectedSpend(1.0, 300, 100)).toBe(300)
    expect(projectedSpend(1.5, 300, 100)).toBe(300)
    expect(projectedSpend(10, 300, 100)).toBe(300)
  })

  it('returns min spend at or below the floor ratio', () => {
    expect(projectedSpend(SPEND_RAMP_FLOOR, 300, 100)).toBe(100)
    expect(projectedSpend(0.25, 300, 100)).toBe(100)
    expect(projectedSpend(0, 300, 100)).toBe(100)
  })

  it('linearly interpolates between floor and starting wealth', () => {
    // At the midpoint (0.75 = halfway between 0.5 and 1.0) we expect the
    // spend halfway between min (100) and default (300) → 200.
    expect(projectedSpend(0.75, 300, 100)).toBe(200)
    // At 0.6 (20% of the way from 0.5 to 1.0), spend = 100 + 0.2*(300-100) = 140.
    expect(projectedSpend(0.6, 300, 100)).toBeCloseTo(140, 6)
    // At 0.9 (80% of the way), spend = 100 + 0.8*200 = 260.
    expect(projectedSpend(0.9, 300, 100)).toBeCloseTo(260, 6)
  })

  it('flattens to a single value when default == min', () => {
    expect(projectedSpend(0.3, 250, 250)).toBe(250)
    expect(projectedSpend(0.6, 250, 250)).toBe(250)
    expect(projectedSpend(1.2, 250, 250)).toBe(250)
  })
})

describe('graded spending in simulate()', () => {
  it('reduces ruin probability vs an equivalent flat-spend run on a stressed portfolio', () => {
    // Same portfolio, same returns; the only difference is whether spending
    // can ramp down. Behavioral spend (default != min) should produce
    // strictly fewer ruins than a flat-spend run pinned at the default.
    const stressed = {
      ...DEFAULT_PARAMS,
      epicExit: 4,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 250,
      healthInsurance: 25,
      scenario: 'cautious' as const,
      paths: 1500,
      seed: 51,
    }
    const flat = simulate({ ...stressed, minSpend: 250 })
    const ramped = simulate({ ...stressed, minSpend: 100 })
    expect(ramped.pctRuin).toBeLessThan(flat.pctRuin)
  })
})

describe('quantile', () => {
  it('handles exact indices', () => {
    expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5)
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
  it('linearly interpolates', () => {
    expect(quantile([10, 20], 0.5)).toBe(15)
    expect(quantile([0, 100], 0.25)).toBe(25)
  })
  it('returns 0 on empty input', () => {
    expect(quantile([], 0.5)).toBe(0)
  })
})

describe('simulate', () => {
  it('is deterministic given a seed', () => {
    const r1 = simulate({ ...DEFAULT_PARAMS, epicExit: 4, paths: 200, seed: 11 })
    const r2 = simulate({ ...DEFAULT_PARAMS, epicExit: 4, paths: 200, seed: 11 })
    expect(r1.medianFinalM).toBe(r2.medianFinalM)
    expect(r1.pctRuin).toBe(r2.pctRuin)
    expect(r1.finalWealth[0]).toBe(r2.finalWealth[0])
    expect(r1.finalWealth[199]).toBe(r2.finalWealth[199])
  })

  it('returns starting total at year 0', () => {
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 3,
      taxableAdditional: 1,
      stockPct: 0.7,
      bondPct: 0.2,
      paths: 50,
      seed: 1,
    })
    // total = 4, equity = 4 × 0.9 = 3.6, cash = 4 × 0.1 = 0.4
    expect(r.startingEquity).toBeCloseTo(3.6, 6)
    expect(r.startingCash).toBeCloseTo(0.4, 6)
    expect(r.startingTotal).toBeCloseTo(4, 6)
    const fanIdx0 = r.fanYears.indexOf(0)
    expect(r.fanWealth[fanIdx0][0]).toBeCloseTo(4, 6)
  })

  it('honours endAge / currentAge for the simulation horizon', () => {
    const r = simulate({ ...DEFAULT_PARAMS, currentAge: 60, endAge: 90, paths: 5, seed: 1 })
    expect(r.years).toBe(30)
    expect(r.fanYears[r.fanYears.length - 1]).toBe(30)
    expect(r.fanAges[0]).toBe(60)
    expect(r.fanAges[r.fanAges.length - 1]).toBe(90)
  })

  it('zeroes health insurance after age 65 when checkbox is on', () => {
    // Two parallel runs that differ only in HI: with-zero vs without-zero.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 3,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 200,
      minSpend: 100,
      healthInsurance: 50, // exaggerated to make the difference show
      currentAge: 60,
      endAge: 80,
      paths: 200,
      seed: 11,
    }
    const withZero = simulate({ ...base, zeroHIPost65: true })
    const without = simulate({ ...base, zeroHIPost65: false })
    expect(withZero.medianFinalM).toBeGreaterThan(without.medianFinalM)
  })

  it('adds spouse SS as a second income stream when includeSpouse is on', () => {
    // Both spouses already past their claim age so SS flows from year 1.
    // Healthcare zero'd via includeSpouse=false comparator → only diff is SS income.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 3,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 200,
      minSpend: 100,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 70,
      endAge: 90,
      claimAge: 67,
      ssMonthly: 2500,
      spouseClaimAge: 67,
      spouseCurrentAge: 70,
      spouseSsMonthly: 2000,
      paths: 200,
      seed: 5,
    }
    const without = simulate({ ...base, includeSpouse: false })
    const withSpouse = simulate({ ...base, includeSpouse: true })
    expect(withSpouse.medianFinalM).toBeGreaterThan(without.medianFinalM)
  })

  it('honours spouse claim age — no spouse SS before that age', () => {
    // Spouse 10 yr younger; sim ends before spouse hits claim age, so the
    // spouse SS stream never flows. (Filing status still flips Single→MFJ when
    // includeSpouse is on, so tax brackets shift modestly — covered separately.)
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 3,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 200,
      minSpend: 100,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 70,
      endAge: 75,            // 5-yr horizon
      claimAge: 67,
      ssMonthly: 2500,
      spouseCurrentAge: 60,  // spouse turns 65 only at end of horizon
      spouseClaimAge: 67,    // would claim 7 yr after horizon ends
      spouseSsMonthly: 5000, // big number — would be visible if it leaked in
      paths: 100,
      seed: 9,
    }
    const off = simulate({ ...base, includeSpouse: false })
    const on = simulate({ ...base, includeSpouse: true })
    // Difference should reflect only the MFJ-vs-Single bracket / std-deduction
    // delta on owner SS (≤$1K/yr × 5yr ≈ $5K total). Anywhere near the spouse
    // SS stream ($60K/yr × 5yr × 0.7 SS adj = ~$210K) means it leaked in.
    expect(Math.abs(on.medianFinalM - off.medianFinalM)).toBeLessThan(0.05)
  })

  it('steps health insurance 100% → 50% → 0% as each spouse hits Medicare', () => {
    // Spouse 5 yr younger. Owner hits 65 at year 5, spouse at year 10.
    // Without spouse the post-owner-65 years are 0% HI (current behaviour).
    // With spouse, those 5 years between owner-65 and spouse-65 are 50% HI,
    // so total spending is higher and final wealth lower.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 5,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 150,
      minSpend: 100,
      healthInsurance: 60,    // exaggerated to make the difference visible
      zeroHIPost65: true,
      currentAge: 60,
      endAge: 80,
      ssMonthly: 0,           // strip out SS to isolate the HI effect
      spouseSsMonthly: 0,
      claimAge: 67,
      spouseClaimAge: 67,
      spouseCurrentAge: 55,   // 5 yr younger
      paths: 200,
      seed: 13,
    }
    const single = simulate({ ...base, includeSpouse: false })
    const couple = simulate({ ...base, includeSpouse: true })
    expect(couple.medianFinalM).toBeLessThan(single.medianFinalM)
  })

  it('switches HI from pre-Medicare premium to base Medicare + IRMAA after 65', () => {
    // With both spouses past 65 and zeroHIPost65 on, a huge pre-Medicare HI
    // input ($60K/yr) gets replaced by Medicare base premium + IRMAA, which
    // for low-MAGI retirees is well under $10K/yr per person. Wealth at end
    // should be much higher than running the same sim with zeroHIPost65 off
    // (which keeps the $60K bill running for the entire horizon).
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 4,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 150,
      minSpend: 100,
      healthInsurance: 60,
      currentAge: 70,
      endAge: 85,
      ssMonthly: 0,
      spouseSsMonthly: 0,
      claimAge: 67,
      spouseClaimAge: 67,
      spouseCurrentAge: 70,
      includeSpouse: true,
      paths: 200,
      seed: 17,
    }
    const medicareOn = simulate({ ...base, zeroHIPost65: true })
    const medicareOff = simulate({ ...base, zeroHIPost65: false })
    expect(medicareOn.medianFinalM).toBeGreaterThan(medicareOff.medianFinalM)
  })

  it('produces ruin in pessimistic / under-funded retirements', () => {
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 4,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 300,
      minSpend: 135,
      scenario: 'cautious',
      paths: 500,
      seed: 7,
    })
    expect(r.pctRuin).toBeGreaterThan(0.5)
  })

  it('produces almost no ruin in over-funded retirements', () => {
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 30,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 300,
      minSpend: 135,
      scenario: 'historical',
      paths: 500,
      seed: 3,
    })
    expect(r.pctRuin).toBeLessThan(0.02)
  })

  it('exposes a fan year for every multiple of 5 up to years', () => {
    const r = simulate({ ...DEFAULT_PARAMS, currentAge: 50, endAge: 100, paths: 10, seed: 1 })
    expect(r.fanYears).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
    expect(r.fanWealth.length).toBe(r.fanYears.length)
    for (const arr of r.fanWealth) expect(arr.length).toBe(10)
  })
})

describe('computeFanPercentiles', () => {
  it('returns p5..p95 in sorted order per year', () => {
    const r = simulate({ ...DEFAULT_PARAMS, epicExit: 5, paths: 300, seed: 4 })
    const fan = computeFanPercentiles(r)
    expect(fan.length).toBe(r.fanYears.length)
    for (const row of fan) {
      expect(row.p5).toBeLessThanOrEqual(row.p10)
      expect(row.p10).toBeLessThanOrEqual(row.p25)
      expect(row.p25).toBeLessThanOrEqual(row.p50)
      expect(row.p50).toBeLessThanOrEqual(row.p75)
      expect(row.p75).toBeLessThanOrEqual(row.p90)
      expect(row.p90).toBeLessThanOrEqual(row.p95)
    }
  })
})

describe('finalPercentiles', () => {
  it('returns one row per requested quantile in order', () => {
    const r = simulate({ ...DEFAULT_PARAMS, paths: 200, seed: 2 })
    const rows = finalPercentiles(r)
    expect(rows.length).toBe(FINAL_PERCENTILES.length)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].value).toBeGreaterThanOrEqual(rows[i - 1].value)
    }
  })
})

describe('histogram', () => {
  it('excludes ruined paths and partitions the rest into bins', () => {
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 6,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 300,
      minSpend: 135,
      scenario: 'historical',
      paths: 600,
      seed: 5,
    })
    const h = histogram(r, 20)
    expect(h.bins.length).toBe(20)
    const totalBinned = h.bins.reduce((s, b) => s + b.count, 0)
    expect(totalBinned + h.excluded).toBe(r.finalWealth.length)
    expect(h.excluded).toBeGreaterThan(0)
    expect(totalBinned).toBeGreaterThan(0)
  })

  it('marks each bin as above or below starting wealth', () => {
    const r = simulate({ ...DEFAULT_PARAMS, epicExit: 5, paths: 300, seed: 8 })
    const h = histogram(r, 25)
    for (const b of h.bins) {
      const mid = (b.x0 + b.x1) / 2
      expect(b.aboveStart).toBe(mid >= h.startingTotal)
    }
  })

  // hi/lo == 9, just under the 10x threshold → linear.
  it('picks linear when hi/lo <= threshold', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const r = makeSyntheticResult(values, 100)
    const h = histogram(r, 10)
    expect(h.scale).toBe('linear')
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(values.length)
  })

  // hi/lo == 10000, well above threshold → log.
  it('picks log when hi/lo > threshold', () => {
    const values = [1, 10, 100, 1000, 10000]
    const r = makeSyntheticResult(values, 100)
    const h = histogram(r, 20)
    expect(h.scale).toBe('log')
    expect(h.bins.length).toBe(20)
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(values.length)
    for (const b of h.bins) {
      expect(b.x1).toBeGreaterThan(b.x0)
      expect(b.x0).toBeGreaterThan(0)
    }
    for (let i = 1; i < h.bins.length; i++) {
      expect(h.bins[i].x0).toBeGreaterThanOrEqual(h.bins[i - 1].x0)
    }
  })

  it('log bins are equal-width in log space', () => {
    const r = makeSyntheticResult([1, 5, 20, 100, 500, 2000, 10000], 100)
    const h = histogram(r, 12)
    expect(h.scale).toBe('log')
    const widths = h.bins.map(b => Math.log(b.x1) - Math.log(b.x0))
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeCloseTo(widths[0], 10)
    }
  })

  // Edge case: a non-ruined path with wealth 0 forbids log binning (log(0) = -∞).
  it('falls back to linear when lo === 0', () => {
    const r = makeSyntheticResult([0, 100, 1000, 10000], 100)
    const h = histogram(r, 10)
    expect(h.scale).toBe('linear')
  })

  // A single absurdly low surviving path must not drag the visible left
  // edge across many decades. The outlier still counts (lands in bin 0),
  // but the leftmost bin's x0 should be near the bulk of the data.
  it('log mode trims extreme low outliers from the visible range', () => {
    const bulk: number[] = []
    for (let i = 0; i < 1000; i++) bulk.push(50 + (i % 200))  // ~50–250
    const values = [0.0001, ...bulk, 50000]  // one absurdly low + one absurdly high
    const r = makeSyntheticResult(values, 100)
    const h = histogram(r, 30)
    expect(h.scale).toBe('log')
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(values.length)
    // Trim should keep the left edge well above the $0.0001 outlier.
    expect(h.bins[0].x0).toBeGreaterThan(1)
    // The outlier lands in bin 0 and the high outlier in the last bin.
    expect(h.bins[0].count).toBeGreaterThanOrEqual(1)
    expect(h.bins[h.bins.length - 1].count).toBeGreaterThanOrEqual(1)
  })

  // The trim must not push starting wealth out of the visible range, otherwise
  // the dashed reference line on the chart would render off-screen.
  it('log mode keeps starting wealth inside the visible range', () => {
    const values = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 50, 100, 200, 1000]
    const start = 5  // sits between the two clusters
    const r = makeSyntheticResult(values, start)
    const h = histogram(r, 20)
    expect(h.scale).toBe('log')
    expect(h.bins[0].x0).toBeLessThanOrEqual(start)
    expect(h.bins[h.bins.length - 1].x1).toBeGreaterThanOrEqual(start)
  })
})

describe('computeAnnualTax', () => {
  const noState = { stateOrdinaryRate: 0, stateLTCGRate: 0 }

  it('zero income → zero tax', () => {
    const t = computeAnnualTax({ ordinaryGross: 0, ltcg: 0, status: 'mfj', ...noState })
    expect(t.total).toBe(0)
  })

  it('income below standard deduction → zero federal ordinary tax', () => {
    // MFJ std deduction = $31,500. $20K ordinary income → 0 fed tax.
    const t = computeAnnualTax({ ordinaryGross: 20_000, ltcg: 0, status: 'mfj', ...noState })
    expect(t.fedOrdinary).toBe(0)
  })

  it('progressive ordinary brackets', () => {
    // MFJ, $100K gross. After $31.5K std ded → $68.5K taxable.
    // 10% on first $24.8K = $2,480
    // 12% on next $43.7K (= $68.5K - $24.8K) = $5,244
    // Total = $7,724
    const t = computeAnnualTax({ ordinaryGross: 100_000, ltcg: 0, status: 'mfj', ...noState })
    expect(t.fedOrdinary).toBeCloseTo(7_724, -1)
  })

  it('LTCG stacks on top of ordinary income for bracket determination', () => {
    // MFJ. $40K ordinary - $31.5K std ded = $8.5K taxable ord.
    // $50K LTCG: stacks at $8.5K cumulative → first $96.7K-$8.5K = $88.2K of
    // LTCG fits in the 0% bracket, so all $50K is at 0% LTCG.
    const t = computeAnnualTax({ ordinaryGross: 40_000, ltcg: 50_000, status: 'mfj', ...noState })
    expect(t.fedLTCG).toBe(0)
  })

  it('LTCG that pushes past the 15% threshold is taxed at 15% on the excess', () => {
    // MFJ. $200K ordinary - $31.5K = $168.5K taxable ord.
    // $50K LTCG stacks at $168.5K → all in 15% bracket (above $96.7K) →
    // 15% × $50K = $7,500.
    const t = computeAnnualTax({ ordinaryGross: 200_000, ltcg: 50_000, status: 'mfj', ...noState })
    expect(t.fedLTCG).toBeCloseTo(7_500, -1)
  })

  it('NIIT 3.8% applies when MAGI exceeds the threshold', () => {
    // MFJ NIIT threshold = $250K. $200K ord + $100K LTCG = $300K MAGI.
    // NIIT = 3.8% × min($100K LTCG, $50K excess) = 3.8% × $50K = $1,900.
    const t = computeAnnualTax({ ordinaryGross: 200_000, ltcg: 100_000, status: 'mfj', ...noState })
    expect(t.niit).toBeCloseTo(1_900, -1)
  })

  it('NIIT does not apply when MAGI is below the threshold', () => {
    // MFJ. $100K ord + $50K LTCG = $150K MAGI < $250K threshold → NIIT = 0.
    const t = computeAnnualTax({ ordinaryGross: 100_000, ltcg: 50_000, status: 'mfj', ...noState })
    expect(t.niit).toBe(0)
  })

  it('Single brackets are tighter than MFJ', () => {
    const mfj = computeAnnualTax({ ordinaryGross: 200_000, ltcg: 0, status: 'mfj', ...noState })
    const single = computeAnnualTax({ ordinaryGross: 200_000, ltcg: 0, status: 'single', ...noState })
    expect(single.fedOrdinary).toBeGreaterThan(mfj.fedOrdinary)
  })

  it('state tax applies as a flat rate on top of federal', () => {
    // 9.85% state on both ordinary and LTCG (CA-ish).
    const t = computeAnnualTax({
      ordinaryGross: 100_000,
      ltcg: 50_000,
      status: 'mfj',
      stateOrdinaryRate: 0.0985,
      stateLTCGRate: 0.0985,
    })
    expect(t.state).toBeCloseTo(100_000 * 0.0985 + 50_000 * 0.0985, 6)
  })

  it('no-state-tax filer (TX/FL/NV) gets zero state tax', () => {
    const t = computeAnnualTax({
      ordinaryGross: 200_000,
      ltcg: 100_000,
      status: 'mfj',
      stateOrdinaryRate: 0,
      stateLTCGRate: 0,
    })
    expect(t.state).toBe(0)
  })
})

describe('irmaaSurcharge', () => {
  it('returns 0 below the first threshold', () => {
    expect(irmaaSurcharge(150_000, 'mfj')).toBe(0)
    expect(irmaaSurcharge(100_000, 'single')).toBe(0)
  })

  it('steps up monotonically with MAGI', () => {
    const tiers = [200_000, 220_000, 280_000, 350_000, 500_000, 800_000]
    let prev = -1
    for (const m of tiers) {
      const s = irmaaSurcharge(m, 'mfj')
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('single thresholds are half the MFJ thresholds', () => {
    // The first non-zero MFJ tier kicks in at $212K; single at $106K.
    expect(irmaaSurcharge(213_000, 'mfj')).toBeGreaterThan(0)
    expect(irmaaSurcharge(107_000, 'single')).toBeGreaterThan(0)
    expect(irmaaSurcharge(107_000, 'mfj')).toBe(0)
  })
})

describe('migrateLoadedParams', () => {
  it('maps legacy `additional` into taxableAdditional with full basis', () => {
    const m = migrateLoadedParams({ epicExit: 5, additional: 2 })
    expect(m.taxableAdditional).toBe(2)
    expect(m.additionalBasis).toBe(2)
  })

  it('strips refillTaxDrag (no equivalent in the new model)', () => {
    const m = migrateLoadedParams({ epicExit: 5, additional: 1, refillTaxDrag: 0.25 })
    expect((m as Record<string, unknown>).refillTaxDrag).toBeUndefined()
  })

  it('preserves new-shape params unchanged', () => {
    const m = migrateLoadedParams({
      epicExit: 5,
      taxableAdditional: 1.5,
      additionalBasis: 0.3,
      traditional: 2,
      roth: 1,
    })
    expect(m.taxableAdditional).toBe(1.5)
    expect(m.additionalBasis).toBe(0.3)
    expect(m.traditional).toBe(2)
    expect(m.roth).toBe(1)
  })

  it('does not overwrite explicit new-shape fields with legacy fallback', () => {
    const m = migrateLoadedParams({ additional: 5, taxableAdditional: 2, additionalBasis: 0.5 })
    expect(m.taxableAdditional).toBe(2)
    expect(m.additionalBasis).toBe(0.5)
  })
})

describe('account buckets and 59½ gating', () => {
  // Common base: pre-59½ retiree with most wealth in a 401(k). The bridge
  // years should fund spending entirely from cash + taxable.
  const bridge = {
    ...DEFAULT_PARAMS,
    epicExit: 0,
    taxableAdditional: 0.5,
    additionalBasis: 0.5,
    traditional: 5,
    roth: 0,
    stockPct: 0.7,
    bondPct: 0.2,
    defaultSpend: 200,
    minSpend: 200,
    healthInsurance: 25,
    zeroHIPost65: false,  // strip Medicare model to isolate the gate
    currentAge: 50,
    endAge: 65,
    ssMonthly: 0,
    spouseSsMonthly: 0,
    paths: 200,
    seed: 31,
  }

  it('pre-59½ ruin happens when cash+taxable can\'t cover spending even with full 401(k)', () => {
    const r = simulate(bridge)
    // $0.5M taxable at $200K/yr spend can't bridge ~10 years to age 59.5 →
    // the path runs out of accessible wealth before 401(k) unlocks.
    expect(r.pctRuin).toBeGreaterThan(0.5)
  })

  it('moving the same wealth into taxable removes the bridge-year ruin', () => {
    const taxableHeavy = {
      ...bridge,
      taxableAdditional: 5.5,
      additionalBasis: 5.5,  // full basis
      traditional: 0,
    }
    const r = simulate(taxableHeavy)
    // Now everything is accessible — same $5.5M, same spend, drastically lower ruin.
    expect(r.pctRuin).toBeLessThan(0.05)
  })

  it('Roth wealth is also locked pre-59½ and cannot bridge', () => {
    // Same total wealth ($5.5M), all in Roth instead of taxable. Should
    // ruin at the same rate as the all-traditional case (Roth is locked too).
    const allRoth = { ...bridge, taxableAdditional: 0.5, traditional: 0, roth: 5 }
    const r = simulate(allRoth)
    expect(r.pctRuin).toBeGreaterThan(0.5)
  })

  it('post-59½ retiree taps the 401(k) with no liquidity ruin', () => {
    // Same dollar amounts, but starting at 60 instead of 50. Now traditional
    // is immediately accessible, so ruin should drop dramatically.
    const post = { ...bridge, currentAge: 60, endAge: 75 }
    const r = simulate(post)
    expect(r.pctRuin).toBeLessThan(0.05)
  })
})

describe('Epic exit basis treatment', () => {
  it('treats Epic exit proceeds as full basis (less tax than legacy 0-basis assumption)', () => {
    // Epic exit = $5M with full basis. Withdrawals from this bucket only
    // realize LTCG on growth above the $5M starting basis. The gain fraction
    // starts at 0 and grows over time.
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 5,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 150,
      minSpend: 100,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 65,
      endAge: 90,
      ssMonthly: 0,
      paths: 500,
      seed: 51,
    })
    // Median final >0 (no ruin in moderate spend / high basis case).
    expect(r.medianFinalM).toBeGreaterThan(0)
    expect(r.pctRuin).toBeLessThan(0.1)
  })

  it('zero-basis taxable additional taxes more aggressively than full-basis', () => {
    // Two parallel sims. Same total taxable wealth but one has zero basis
    // (fully appreciated) and the other has full basis (just realized).
    // The zero-basis case should have lower median final wealth because
    // every withdrawal triggers full LTCG tax, vs. the full-basis case where
    // initial withdrawals are tax-free principal returns.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 0,
      taxableAdditional: 5,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 200,
      minSpend: 150,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 65,
      endAge: 90,
      ssMonthly: 0,
      paths: 500,
      seed: 73,
      // Need a state rate to make LTCG noticeable on smaller withdrawals
      // (the federal 0% LTCG bracket otherwise zeros out small gains).
      stateLTCGRate: 0.05,
    }
    const fullBasis = simulate({ ...base, additionalBasis: 5 })
    const zeroBasis = simulate({ ...base, additionalBasis: 0 })
    expect(zeroBasis.medianFinalM).toBeLessThan(fullBasis.medianFinalM)
  })
})

describe('SS taxation and filing status', () => {
  it('MFJ filing produces lower tax than Single on the same income (wider brackets)', () => {
    // Single owner with high SS but no spouse. With includeSpouse on, filing
    // is MFJ and brackets are wider, lowering tax → higher final wealth.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 0,
      taxableAdditional: 3,
      additionalBasis: 0,  // all gains → maximal LTCG visibility
      traditional: 2,
      roth: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 250,
      minSpend: 200,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 65,
      endAge: 80,
      ssMonthly: 3000,  // owner SS only
      spouseSsMonthly: 0,  // no spouse SS — isolate filing-status effect
      claimAge: 67,
      spouseClaimAge: 67,
      spouseCurrentAge: 65,
      paths: 300,
      seed: 17,
    }
    const single = simulate({ ...base, includeSpouse: false })
    const mfj = simulate({ ...base, includeSpouse: true })
    expect(mfj.medianFinalM).toBeGreaterThan(single.medianFinalM)
  })
})

describe('RETIREMENT_ACCESS_AGE constant', () => {
  it('is 59.5 (standard 401(k) / IRA penalty-free withdrawal age)', () => {
    expect(RETIREMENT_ACCESS_AGE).toBe(59.5)
  })
})

// Build a SimResult with given non-ruined finalWealth values; ruined entries
// are not added so the histogram sees exactly the values passed in.
function makeSyntheticResult(finalValues: number[], startingTotal: number) {
  return {
    fanYears: [],
    fanAges: [],
    fanWealth: [] as Float64Array[],
    finalWealth: Float64Array.from(finalValues),
    ruined: new Uint8Array(finalValues.length),
    startingEquity: 0,
    startingCash: 0,
    startingTotal,
    years: 0,
    pctAboveStart: 0,
    pctRuin: 0,
    medianFinalM: 0,
    p10FinalM: 0,
  }
}
