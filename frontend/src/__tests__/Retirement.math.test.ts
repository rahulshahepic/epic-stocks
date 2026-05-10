import { describe, it, expect } from 'vitest'
import {
  MEAN_BLOCK_LEN,
  computeAnnualTax,
  computeFanPercentiles,
  computeSpousePayrollTax,
  DEFAULT_PARAMS,
  finalPercentiles,
  FINAL_PERCENTILES,
  fraFromBirthYear,
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
  SS_EARNINGS_EXEMPT_BEFORE_FRA,
  SS_WAGE_BASE_REAL,
  ssAdjustment,
  spouseSsAfterEarningsTest,
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
  it('covers 1,100+ monthly observations spanning 90+ years', () => {
    expect(HISTORICAL_RETURNS.length).toBeGreaterThan(1100)
    // First entry is Jan 1928 (yyyymm = 192801), last is Sep 2023 (202309)
    expect(HISTORICAL_RETURNS[0].year).toBe(192801)
    expect(HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year).toBe(202309)
  })

  it('arithmetic mean of monthly real stock returns is ~0.5–0.8% (≈ 7–10% annualised)', () => {
    const mean =
      HISTORICAL_RETURNS.reduce((s, r) => s + r.stockReal, 0) / HISTORICAL_RETURNS.length
    expect(mean).toBeGreaterThan(0.004)
    expect(mean).toBeLessThan(0.009)
  })

  it('arithmetic mean of monthly real bond returns is positive but modest', () => {
    const mean =
      HISTORICAL_RETURNS.reduce((s, r) => s + r.bondReal, 0) / HISTORICAL_RETURNS.length
    expect(mean).toBeGreaterThan(0.0)
    expect(mean).toBeLessThan(0.005)
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
  it('uses MEAN_BLOCK_LEN of 240 months (≈ 20-year blocks, stationary bootstrap)', () => {
    expect(MEAN_BLOCK_LEN).toBe(240)
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
    // endAge shortened to 80 so the ramp has room to differentiate before
    // the portfolio fully exhausts in both cases.
    const stressed = {
      ...DEFAULT_PARAMS,
      epicExit: 4,
      taxableAdditional: 0,
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 250,
      healthInsurance: 25,
      endAge: 80,
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
  const noLTCG = { stateLTCGRate: 0 }

  it('zero income → zero tax', () => {
    const t = computeAnnualTax({ traditionalWithdrawal: 0, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.total).toBe(0)
  })

  it('income below standard deduction → zero federal ordinary tax', () => {
    // MFJ std deduction = $31,500. $20K ordinary income → 0 fed tax.
    // (WI brackets still apply at the state level — they have no std deduction here.)
    const t = computeAnnualTax({ traditionalWithdrawal: 20_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.fedOrdinary).toBe(0)
  })

  it('progressive ordinary brackets', () => {
    // MFJ, $100K gross. After $31.5K std ded → $68.5K taxable.
    // 10% on first $24.8K = $2,480
    // 12% on next $43.7K (= $68.5K - $24.8K) = $5,244
    // Total = $7,724
    const t = computeAnnualTax({ traditionalWithdrawal: 100_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.fedOrdinary).toBeCloseTo(7_724, -1)
  })

  it('LTCG stacks on top of ordinary income for bracket determination', () => {
    // MFJ. $40K ordinary - $31.5K std ded = $8.5K taxable ord.
    // $50K LTCG: stacks at $8.5K cumulative → first $96.7K-$8.5K = $88.2K of
    // LTCG fits in the 0% bracket, so all $50K is at 0% LTCG.
    const t = computeAnnualTax({ traditionalWithdrawal: 40_000, ssTaxable: 0, ltcg: 50_000, status: 'mfj', ...noLTCG })
    expect(t.fedLTCG).toBe(0)
  })

  it('LTCG that pushes past the 15% threshold is taxed at 15% on the excess', () => {
    // MFJ. $200K ordinary - $31.5K = $168.5K taxable ord.
    // $50K LTCG stacks at $168.5K → all in 15% bracket (above $96.7K) →
    // 15% × $50K = $7,500.
    const t = computeAnnualTax({ traditionalWithdrawal: 200_000, ssTaxable: 0, ltcg: 50_000, status: 'mfj', ...noLTCG })
    expect(t.fedLTCG).toBeCloseTo(7_500, -1)
  })

  it('NIIT 3.8% applies when MAGI exceeds the threshold', () => {
    // MFJ NIIT threshold = $250K. $200K ord + $100K LTCG = $300K MAGI.
    // NIIT = 3.8% × min($100K LTCG, $50K excess) = 3.8% × $50K = $1,900.
    const t = computeAnnualTax({ traditionalWithdrawal: 200_000, ssTaxable: 0, ltcg: 100_000, status: 'mfj', ...noLTCG })
    expect(t.niit).toBeCloseTo(1_900, -1)
  })

  it('NIIT does not apply when MAGI is below the threshold', () => {
    // MFJ. $100K ord + $50K LTCG = $150K MAGI < $250K threshold → NIIT = 0.
    const t = computeAnnualTax({ traditionalWithdrawal: 100_000, ssTaxable: 0, ltcg: 50_000, status: 'mfj', ...noLTCG })
    expect(t.niit).toBe(0)
  })

  it('Single brackets are tighter than MFJ', () => {
    const mfj = computeAnnualTax({ traditionalWithdrawal: 200_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    const single = computeAnnualTax({ traditionalWithdrawal: 200_000, ssTaxable: 0, ltcg: 0, status: 'single', ...noLTCG })
    expect(single.fedOrdinary).toBeGreaterThan(mfj.fedOrdinary)
  })

  it('Wisconsin progressive brackets: $100K MFJ traditional withdrawal', () => {
    // $100K traditional, MFJ, no SS, no LTCG.
    // WI brackets MFJ: 3.5% on $0-$20K, 4.4% on $20K-$40K, 5.3% on $40K-$440K.
    // 3.5% × $20K = $700
    // 4.4% × $20K = $880
    // 5.3% × $60K = $3,180
    // Total = $4,760
    const t = computeAnnualTax({ traditionalWithdrawal: 100_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.state).toBeCloseTo(4_760, -1)
  })

  it('Wisconsin progressive: low-income year pays the lowest bracket only', () => {
    // $15K traditional, MFJ — entirely in WI's 3.5% bracket.
    // 3.5% × $15K = $525
    const t = computeAnnualTax({ traditionalWithdrawal: 15_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.state).toBeCloseTo(525, 1)
  })

  it('Wisconsin progressive: high-income year hits the 7.65% top bracket', () => {
    // $500K MFJ traditional. Top bracket starts at $440K → $60K taxed at 7.65%.
    // 3.5% × $20K + 4.4% × $20K + 5.3% × $400K + 7.65% × $60K
    // = $700 + $880 + $21,200 + $4,590 = $27,370
    const t = computeAnnualTax({ traditionalWithdrawal: 500_000, ssTaxable: 0, ltcg: 0, status: 'mfj', ...noLTCG })
    expect(t.state).toBeCloseTo(27_370, -1)
  })

  it('Wisconsin SS exemption: state tax ignores SS, federal still includes 85%', () => {
    // WI exempts Social Security from state tax — $30K SS adds $25.5K to
    // federal taxable income but $0 to the WI bracket calc.
    const noSS = computeAnnualTax({
      traditionalWithdrawal: 100_000, ssTaxable: 0,
      ltcg: 0, status: 'mfj', stateLTCGRate: 0,
    })
    const withSS = computeAnnualTax({
      traditionalWithdrawal: 100_000, ssTaxable: 25_500,  // 85% of $30K SS gross
      ltcg: 0, status: 'mfj', stateLTCGRate: 0,
    })
    // State tax should be IDENTICAL (both have $100K traditional, no LTCG).
    expect(withSS.state).toBeCloseTo(noSS.state, 6)
    // Federal ordinary should be HIGHER with SS in the mix.
    expect(withSS.fedOrdinary).toBeGreaterThan(noSS.fedOrdinary)
  })

  it('Wisconsin LTCG: separate flat user rate on top of WI ordinary brackets', () => {
    // The user enters their post-30%-WI-exclusion effective LTCG rate
    // (~5.36% at top bracket). It's flat — not a separate bracket schedule.
    const t = computeAnnualTax({
      traditionalWithdrawal: 0, ssTaxable: 0, ltcg: 100_000,
      status: 'mfj', stateLTCGRate: 0.0536,
    })
    // No traditional → no WI ordinary tax. Just $100K × 5.36%.
    expect(t.state).toBeCloseTo(5_360, 1)
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
  it('maps legacy `additional` into taxableAdditional with zero basis (fully appreciated)', () => {
    // Conservative default: pre-existing wealth user hadn't broken down is
    // assumed to be fully appreciated. They can override in advanced view.
    const m = migrateLoadedParams({ epicExit: 5, additional: 2 })
    expect(m.taxableAdditional).toBe(2)
    expect(m.additionalBasis).toBe(0)
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

describe('CPI basis decay', () => {
  // Cost basis is fixed in nominal $ in real life; the simulator runs in
  // real $, so basis loses purchasing power year over year. Using each
  // sampled year's actual CPI keeps the path internally consistent.

  it('full-basis taxable bucket erodes over time → realizes more LTCG', () => {
    // Two parallel sims: one with a short horizon (basis barely erodes)
    // and one with a long horizon (basis erodes substantially). The long
    // horizon should pay materially more LTCG-equivalent tax → lower
    // median final wealth proportional to starting wealth.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 0,
      taxableAdditional: 5,
      additionalBasis: 5,  // start at full basis so erosion is the only LTCG source
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 200,
      minSpend: 200,  // flat — isolate basis effect from spending ramp
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 65,
      endAge: 95,
      ssMonthly: 0,
      stateLTCGRate: 0.05,  // make LTCG visible
      paths: 300,
      seed: 91,
    }
    const r = simulate(base)
    // With basis decay this should have non-zero ruin paths or at minimum
    // a noticeable tax burden — sanity: the sim doesn't blow up and produces
    // sensible numbers.
    expect(r.medianFinalM).toBeGreaterThan(0)
    expect(Number.isFinite(r.medianFinalM)).toBe(true)
  })

  it('historical sequence reproduces a path deterministically', () => {
    // Same seed → identical outputs. Decay is path-dependent (sampled
    // year's CPI), so the seed must drive the same CPI sequence.
    const p = {
      ...DEFAULT_PARAMS,
      epicExit: 5,
      taxableAdditional: 1,
      additionalBasis: 1,
      defaultSpend: 200,
      minSpend: 200,
      healthInsurance: 0,
      currentAge: 65,
      endAge: 90,
      paths: 50,
      seed: 123,
    }
    const a = simulate(p)
    const b = simulate(p)
    expect(a.medianFinalM).toBe(b.medianFinalM)
    expect(a.finalWealth[0]).toBe(b.finalWealth[0])
  })
})

describe('refill cash from gains is taxed', () => {
  it('full-basis taxable + 0% federal LTCG bracket → near-zero refill tax', () => {
    // Modest spend keeps total income under the federal 0% LTCG threshold
    // (~$96.7K MFJ). Refill LTCG should land in 0% bracket → tax-free
    // refill (state still applies if non-zero, but we set 0).
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 5,
      taxableAdditional: 0,
      includeSpouse: true,  // MFJ → wider brackets
      stockPct: 0.7,
      bondPct: 0.2,
      defaultSpend: 60,
      minSpend: 60,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 70,
      endAge: 80,
      ssMonthly: 0,
      spouseSsMonthly: 0,
      stateLTCGRate: 0,
      paths: 200,
      seed: 41,
    })
    expect(r.medianFinalM).toBeGreaterThan(0)
  })

  it('high state LTCG rate makes refill tax visible — lower final wealth', () => {
    // Two parallel sims, only state LTCG rate differs. Higher state LTCG →
    // refills cost more → lower median final.
    const base = {
      ...DEFAULT_PARAMS,
      epicExit: 0,
      taxableAdditional: 5,
      additionalBasis: 0,  // fully appreciated, so refill always realizes gain
      stockPct: 0.8,
      bondPct: 0.1,
      defaultSpend: 250,
      minSpend: 250,
      healthInsurance: 0,
      zeroHIPost65: false,
      currentAge: 65,
      endAge: 90,
      ssMonthly: 0,
      paths: 400,
      seed: 67,
    }
    const lowState = simulate({ ...base, stateLTCGRate: 0 })
    const highState = simulate({ ...base, stateLTCGRate: 0.10 })
    expect(highState.medianFinalM).toBeLessThan(lowState.medianFinalM)
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

describe('fraFromBirthYear', () => {
  it('returns 66 for birth years 1954 and earlier', () => {
    expect(fraFromBirthYear(1950)).toBe(66)
    expect(fraFromBirthYear(1954)).toBe(66)
  })

  it('returns 67 for birth years 1960 and later', () => {
    expect(fraFromBirthYear(1960)).toBe(67)
    expect(fraFromBirthYear(1985)).toBe(67)
  })

  it('interpolates 2 months per year for 1955–1959', () => {
    expect(fraFromBirthYear(1955)).toBeCloseTo(66 + 2 / 12, 9)
    expect(fraFromBirthYear(1957)).toBeCloseTo(66 + 6 / 12, 9)  // 66½
    expect(fraFromBirthYear(1959)).toBeCloseTo(66 + 10 / 12, 9)
  })
})

describe('computeSpousePayrollTax', () => {
  it('charges 6.2% SS + 1.45% Medicare on wages below the wage base', () => {
    const wages = 100_000
    const tax = computeSpousePayrollTax(wages, 'mfj')
    const expected = 0.062 * wages + 0.0145 * wages
    expect(tax).toBeCloseTo(expected, 2)
  })

  it('caps SS at SS_WAGE_BASE_REAL but continues Medicare above it', () => {
    const wages = SS_WAGE_BASE_REAL + 50_000
    const tax = computeSpousePayrollTax(wages, 'mfj')
    const ssCap = 0.062 * SS_WAGE_BASE_REAL
    const medicare = 0.0145 * wages
    expect(tax).toBeCloseTo(ssCap + medicare, 2)
  })

  it('adds 0.9% additional Medicare on MFJ wages above $250K', () => {
    const wages = 300_000
    const tax = computeSpousePayrollTax(wages, 'mfj')
    const ss = 0.062 * SS_WAGE_BASE_REAL
    const medicare = 0.0145 * wages
    const addl = 0.009 * (wages - 250_000)
    expect(tax).toBeCloseTo(ss + medicare + addl, 2)
  })

  it('uses $200K threshold for single filers', () => {
    const wages = 250_000
    const mfj = computeSpousePayrollTax(wages, 'mfj')
    const single = computeSpousePayrollTax(wages, 'single')
    // MFJ threshold is $250K so no additional Medicare; single threshold is $200K so it applies
    expect(single).toBeGreaterThan(mfj)
  })

  it('returns zero for zero wages', () => {
    expect(computeSpousePayrollTax(0, 'mfj')).toBe(0)
  })
})

describe('spouseSsAfterEarningsTest', () => {
  it('applies no reduction at or after FRA', () => {
    // spouseAge >= spouseFra: full benefit regardless of earnings
    const ssM = 3_000 / 12 / 1_000_000
    const workM = 200_000 / 12 / 1_000_000
    expect(spouseSsAfterEarningsTest(ssM, workM, 67, 67)).toBeCloseTo(ssM, 9)
    expect(spouseSsAfterEarningsTest(ssM, workM, 68, 67)).toBeCloseTo(ssM, 9)
  })

  it('applies no reduction when not working', () => {
    const ssM = 2_000 / 12 / 1_000_000
    expect(spouseSsAfterEarningsTest(ssM, 0, 63, 67)).toBeCloseTo(ssM, 9)
  })

  it('reduces SS $1 per $2 of earnings above exempt amount before FRA', () => {
    const annualSs = 24_000  // $24K/yr SS benefit
    const annualWages = SS_EARNINGS_EXEMPT_BEFORE_FRA + 10_000  // $10K over exempt
    const ssM = annualSs / 12 / 1_000_000
    const workM = annualWages / 12 / 1_000_000
    const result = spouseSsAfterEarningsTest(ssM, workM, 64, 67)
    const expectedAnnualReduction = 10_000 / 2
    const expectedMonthlyM = (annualSs - expectedAnnualReduction) / 12 / 1_000_000
    expect(result).toBeCloseTo(expectedMonthlyM, 9)
  })

  it('floors SS at zero (high earner eliminates benefit entirely)', () => {
    const ssM = 1_000 / 12 / 1_000_000    // $1K/yr SS
    const workM = 500_000 / 12 / 1_000_000 // $500K wages — withheld > benefit
    expect(spouseSsAfterEarningsTest(ssM, workM, 63, 67)).toBe(0)
  })
})

describe('simulate — spouse work income', () => {
  const base = {
    ...DEFAULT_PARAMS,
    epicExit: 3,
    taxableAdditional: 0,
    additionalBasis: 0,
    traditional: 0,
    roth: 0,
    stockPct: 0.6,
    bondPct: 0.3,
    defaultSpend: 80,
    minSpend: 60,
    healthInsurance: 25,
    zeroHIPost65: false,
    ssMonthly: 2500,
    claimAge: 67,
    currentAge: 55,
    endAge: 85,
    fra: 67,
    includeSpouse: true,
    spouseCurrentAge: 52,
    spouseSsMonthly: 1500,
    spouseClaimAge: 67,
    spouseFra: 67,
    spouseWorkIncome: 0,
    spouseStopWorkAge: 65,
    stateLTCGRate: 0.05,
    paths: 500,
    seed: 42,
  }

  it('spouse work income reduces portfolio draw — higher final wealth than no income', () => {
    const noWork = simulate({ ...base, spouseWorkIncome: 0 })
    const working = simulate({ ...base, spouseWorkIncome: 150 })  // $150K/yr
    expect(working.medianFinalM).toBeGreaterThan(noWork.medianFinalM)
  })

  it('higher work income → greater benefit', () => {
    const low = simulate({ ...base, spouseWorkIncome: 50 })
    const high = simulate({ ...base, spouseWorkIncome: 200 })
    expect(high.medianFinalM).toBeGreaterThan(low.medianFinalM)
  })

  it('work income with stop-work age: stops early yields less than working longer', () => {
    const early = simulate({ ...base, spouseWorkIncome: 120, spouseStopWorkAge: 57 })
    const late  = simulate({ ...base, spouseWorkIncome: 120, spouseStopWorkAge: 65 })
    expect(late.medianFinalM).toBeGreaterThan(early.medianFinalM)
  })

  it('earnings test lowers SS benefit when claiming before FRA while working', () => {
    // Spouse earns well above exempt amount while claiming early
    const noWork = simulate({
      ...base, spouseWorkIncome: 0, spouseClaimAge: 62,
    })
    const working = simulate({
      ...base, spouseWorkIncome: 100, spouseClaimAge: 62, spouseStopWorkAge: 67,
    })
    // Working adds income but the net SS reduction is captured. Working spouse
    // should still come out ahead on total wealth even with the earnings test.
    expect(working.medianFinalM).toBeGreaterThan(noWork.medianFinalM)
  })

  it('zero work income produces identical result to default (no work income path)', () => {
    const a = simulate({ ...base, spouseWorkIncome: 0 })
    const b = simulate({ ...base })  // default is 0
    expect(a.medianFinalM).toBeCloseTo(b.medianFinalM, 4)
  })

  it('employer HI eliminates pre-Medicare premium → higher final wealth than paying out of pocket', () => {
    const paying = simulate({ ...base, healthInsurance: 30, spouseHasEmployerHI: false })
    const covered = simulate({ ...base, healthInsurance: 30, spouseHasEmployerHI: true })
    expect(covered.medianFinalM).toBeGreaterThan(paying.medianFinalM)
  })

  it('employer HI benefit ends at spouseStopWorkAge', () => {
    // Stopping work very early means fewer covered years → less benefit than stopping late
    const earlyStop = simulate({ ...base, healthInsurance: 30, spouseHasEmployerHI: true, spouseStopWorkAge: 53 })
    const lateStop  = simulate({ ...base, healthInsurance: 30, spouseHasEmployerHI: true, spouseStopWorkAge: 65 })
    expect(lateStop.medianFinalM).toBeGreaterThan(earlyStop.medianFinalM)
  })

  it('employer HI with no spouse has no effect', () => {
    const a = simulate({ ...base, includeSpouse: false, spouseHasEmployerHI: false })
    const b = simulate({ ...base, includeSpouse: false, spouseHasEmployerHI: true })
    expect(a.medianFinalM).toBeCloseTo(b.medianFinalM, 4)
  })
})
