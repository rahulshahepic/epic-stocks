import { describe, it, expect } from 'vitest'
import {
  arithToLogSigma,
  boxMuller,
  computeFanPercentiles,
  DEFAULT_PARAMS,
  finalPercentiles,
  FINAL_PERCENTILES,
  histogram,
  mulberry32,
  quantile,
  sampleAnnualReturns,
  SCENARIOS,
  simulate,
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

describe('boxMuller', () => {
  it('produces N(0,1) samples (approximate stats over many draws)', () => {
    const rand = mulberry32(12345)
    const samples: number[] = []
    for (let i = 0; i < 10000; i++) {
      const [a, b] = boxMuller(rand)
      samples.push(a, b)
    }
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(Math.abs(Math.sqrt(variance) - 1)).toBeLessThan(0.05)
  })
})

describe('arithToLogSigma', () => {
  it('matches the closed form for small ratios', () => {
    // For small σ_a/(1+μ): σ_log ≈ σ_a/(1+μ)
    const s = arithToLogSigma(0.07, 0.17)
    expect(s).toBeCloseTo(Math.sqrt(Math.log(1 + (0.17 / 1.07) ** 2)), 8)
  })
  it('is monotonic in arithmetic std', () => {
    const a = arithToLogSigma(0.05, 0.10)
    const b = arithToLogSigma(0.05, 0.20)
    expect(b).toBeGreaterThan(a)
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

describe('sampleAnnualReturns', () => {
  it('produces stock returns whose log-sample mean ≈ μ_log', () => {
    const sc = SCENARIOS.historical
    const muS = Math.log(1 + sc.sMean)
    const muB = Math.log(1 + sc.bMean)
    const sigS = arithToLogSigma(sc.sMean, sc.sStd)
    const sigB = arithToLogSigma(sc.bMean, sc.bStd)
    const rand = mulberry32(7)
    const logS: number[] = []
    const logB: number[] = []
    for (let i = 0; i < 20000; i++) {
      const [s, b] = sampleAnnualReturns(muS, sigS, muB, sigB, -0.05, rand)
      logS.push(Math.log(1 + s))
      logB.push(Math.log(1 + b))
    }
    const meanS = logS.reduce((a, x) => a + x, 0) / logS.length
    const meanB = logB.reduce((a, x) => a + x, 0) / logB.length
    expect(Math.abs(meanS - muS)).toBeLessThan(0.01)
    expect(Math.abs(meanB - muB)).toBeLessThan(0.01)
  })

  it('honours the requested correlation in log space (within tolerance)', () => {
    const muS = 0.05
    const muB = 0.01
    const sigS = 0.15
    const sigB = 0.07
    const rho = -0.05
    const rand = mulberry32(99)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < 20000; i++) {
      const [s, b] = sampleAnnualReturns(muS, sigS, muB, sigB, rho, rand)
      xs.push(Math.log(1 + s))
      ys.push(Math.log(1 + b))
    }
    const mx = xs.reduce((a, x) => a + x, 0) / xs.length
    const my = ys.reduce((a, x) => a + x, 0) / ys.length
    let cov = 0,
      vx = 0,
      vy = 0
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my)
      vx += (xs[i] - mx) ** 2
      vy += (ys[i] - my) ** 2
    }
    const corr = cov / Math.sqrt(vx * vy)
    expect(Math.abs(corr - rho)).toBeLessThan(0.03)
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
      additional: 1,
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
      additional: 0,
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

  it('produces ruin in pessimistic / under-funded retirements', () => {
    const r = simulate({
      ...DEFAULT_PARAMS,
      epicExit: 4,
      additional: 0,
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
      additional: 0,
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
})
