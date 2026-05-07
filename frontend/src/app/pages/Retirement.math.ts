// Pure math for the retirement Monte Carlo simulator.
// All dollar amounts are in $M (millions) of real (inflation-adjusted) dollars
// unless noted otherwise.

export type Scenario = 'historical' | 'moderate' | 'cautious'

export interface ScenarioParams {
  sMean: number
  sStd: number
  bMean: number
  bStd: number
}

export const SCENARIOS: Record<Scenario, ScenarioParams> = {
  historical: { sMean: 0.07, sStd: 0.17, bMean: 0.015, bStd: 0.08 },
  moderate: { sMean: 0.05, sStd: 0.18, bMean: 0, bStd: 0.09 },
  cautious: { sMean: 0.035, sStd: 0.20, bMean: -0.005, bStd: 0.10 },
}

export const SCENARIO_LABELS: Record<Scenario, string> = {
  historical: 'Historical',
  moderate: 'Moderate',
  cautious: 'Cautious',
}

export interface SimParams {
  epicExit: number
  additional: number
  cashBuffer: number
  defaultSpend: number
  minSpend: number
  equityAlloc: number
  scenario: Scenario
  ssMonthly: number
  claimAge: number
  refillTaxDrag: number
  years: number
  paths: number
  retireAge: number
  fra: number
  rho: number
  seed?: number
}

export const DEFAULT_PARAMS: SimParams = {
  epicExit: 0,
  additional: 0,
  cashBuffer: 0.5,
  defaultSpend: 300,
  minSpend: 135,
  equityAlloc: 0.8,
  scenario: 'historical',
  ssMonthly: 2500,
  claimAge: 67,
  refillTaxDrag: 0.25,
  years: 50,
  paths: 100_000,
  retireAge: 43,
  fra: 67,
  rho: -0.05,
}

// Mulberry32 — small, fast, deterministic PRNG (used for seedable tests).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Box-Muller: returns two independent N(0,1) samples per call.
export function boxMuller(rand: () => number): [number, number] {
  let u1 = rand()
  while (u1 === 0) u1 = rand()
  const u2 = rand()
  const r = Math.sqrt(-2 * Math.log(u1))
  const theta = 2 * Math.PI * u2
  return [r * Math.cos(theta), r * Math.sin(theta)]
}

// Convert quoted arithmetic std dev (of returns) to log-return sigma.
//   σ_log² = ln(1 + (σ_a / (1 + μ_g))²)
export function arithToLogSigma(geomMean: number, arithStd: number): number {
  const ratio = arithStd / (1 + geomMean)
  return Math.sqrt(Math.log(1 + ratio * ratio))
}

// SS benefit adjustment factor at claim age. FRA default 67.
//   Early: 5/9 of 1% per month for first 36, 5/12 of 1% per month beyond.
//   Late: 8% per year delayed retirement credit, capped at age 70.
export function ssAdjustment(claimAge: number, fra: number = 67): number {
  if (claimAge === fra) return 1
  if (claimAge < fra) {
    const monthsEarly = (fra - claimAge) * 12
    const first36 = Math.min(monthsEarly, 36)
    const beyond = Math.max(0, monthsEarly - 36)
    const reduction = first36 * (5 / 9) / 100 + beyond * (5 / 12) / 100
    return 1 - reduction
  }
  const yearsLate = Math.min(claimAge - fra, 70 - fra)
  return 1 + 0.08 * yearsLate
}

// Sample correlated stock & bond *arithmetic* one-year returns from the
// underlying log-normal process (ρ correlation in log space).
export function sampleAnnualReturns(
  muS: number,
  sigS: number,
  muB: number,
  sigB: number,
  rho: number,
  rand: () => number,
): [number, number] {
  const [z1, z2] = boxMuller(rand)
  const wS = z1
  const wB = rho * z1 + Math.sqrt(1 - rho * rho) * z2
  const stockR = Math.exp(muS + sigS * wS) - 1
  const bondR = Math.exp(muB + sigB * wB) - 1
  return [stockR, bondR]
}

// Linear interpolation quantile on a sorted ascending array.
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const idx = q * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

export interface SimResult {
  fanYears: number[]
  fanWealth: Float64Array[]
  finalWealth: Float64Array
  ruined: Uint8Array
  startingEquity: number
  startingCash: number
  startingTotal: number
  pctAboveStart: number
  pctRuin: number
  medianFinalM: number
  p10FinalM: number
}

export function simulate(params: SimParams): SimResult {
  const rand = params.seed != null ? mulberry32(params.seed) : Math.random
  const sc = SCENARIOS[params.scenario]
  const muS = Math.log(1 + sc.sMean)
  const muB = Math.log(1 + sc.bMean)
  const sigS = arithToLogSigma(sc.sMean, sc.sStd)
  const sigB = arithToLogSigma(sc.bMean, sc.bStd)

  const startingEquity = params.epicExit + params.additional
  const startingCash = params.cashBuffer
  const startingTotal = startingEquity + startingCash

  const wEq = params.equityAlloc
  const wBd = 1 - wEq

  const defaultSpendM = params.defaultSpend / 1000
  const minSpendM = params.minSpend / 1000

  const ssAdj = ssAdjustment(params.claimAge, params.fra)
  const ssAnnualM = ((params.ssMonthly * 12) / 1_000_000) * ssAdj
  const ssStartYear = params.claimAge - params.retireAge

  const cashTarget = params.cashBuffer
  const taxDrag = params.refillTaxDrag

  const fanYears: number[] = []
  for (let y = 0; y <= params.years; y += 5) fanYears.push(y)
  if (fanYears[fanYears.length - 1] !== params.years) fanYears.push(params.years)

  const N = params.paths
  const Y = params.years
  const yearToFanIdx = new Map<number, number>()
  fanYears.forEach((y, idx) => yearToFanIdx.set(y, idx))

  const fanWealth: Float64Array[] = fanYears.map(() => new Float64Array(N))
  const finalWealth = new Float64Array(N)
  const ruined = new Uint8Array(N)
  const fan0Idx = yearToFanIdx.get(0)
  if (fan0Idx != null) fanWealth[fan0Idx].fill(startingTotal)

  for (let i = 0; i < N; i++) {
    let equity = startingEquity
    let cash = startingCash
    let isRuined = false

    for (let y = 1; y <= Y; y++) {
      const [stockR, bondR] = sampleAnnualReturns(muS, sigS, muB, sigB, params.rho, rand)
      const portR = wEq * stockR + wBd * bondR

      equity = equity * (1 + portR)
      if (equity < 0) equity = 0

      const spend = portR < 0 ? minSpendM : defaultSpendM
      const ssIncome = y >= ssStartYear ? ssAnnualM : 0
      let needed = spend - ssIncome

      if (needed > 0) {
        const fromCash = Math.min(cash, needed)
        cash -= fromCash
        needed -= fromCash
      } else if (needed < 0) {
        cash -= needed // surplus into cash
        needed = 0
      }

      if (needed > 0 && equity > 0) {
        const grossNeeded = needed / (1 - taxDrag)
        if (equity >= grossNeeded) {
          equity -= grossNeeded
          needed = 0
        } else {
          needed -= equity * (1 - taxDrag)
          equity = 0
        }
      }

      if (portR > 0 && cash < cashTarget && equity > 0) {
        const shortfall = cashTarget - cash
        const grossSell = Math.min(shortfall / (1 - taxDrag), equity)
        equity -= grossSell
        cash += grossSell * (1 - taxDrag)
      }

      if (equity <= 0 && cash <= 0) isRuined = true
      if (equity < 0) equity = 0
      if (cash < 0) cash = 0

      const fanIdx = yearToFanIdx.get(y)
      if (fanIdx != null) fanWealth[fanIdx][i] = equity + cash
    }

    finalWealth[i] = equity + cash
    ruined[i] = isRuined ? 1 : 0
  }

  const sortedFinal = Float64Array.from(finalWealth)
  sortedFinal.sort()
  const medianFinalM = quantile(sortedFinal, 0.5)
  const p10FinalM = quantile(sortedFinal, 0.10)

  let above = 0
  let ruin = 0
  for (let i = 0; i < N; i++) {
    if (finalWealth[i] > startingTotal) above++
    if (ruined[i]) ruin++
  }

  return {
    fanYears,
    fanWealth,
    finalWealth,
    ruined,
    startingEquity,
    startingCash,
    startingTotal,
    pctAboveStart: above / N,
    pctRuin: ruin / N,
    medianFinalM,
    p10FinalM,
  }
}

export interface FanPercentiles {
  year: number
  p5: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
}

export function computeFanPercentiles(result: SimResult): FanPercentiles[] {
  return result.fanWealth.map((arr, idx) => {
    const sorted = Float64Array.from(arr)
    sorted.sort()
    return {
      year: result.fanYears[idx],
      p5: quantile(sorted, 0.05),
      p10: quantile(sorted, 0.10),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.50),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.90),
      p95: quantile(sorted, 0.95),
    }
  })
}

export interface PercentileRow {
  q: number
  value: number
}

export const FINAL_PERCENTILES = [0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99]

export function finalPercentiles(result: SimResult): PercentileRow[] {
  const sorted = Float64Array.from(result.finalWealth)
  sorted.sort()
  return FINAL_PERCENTILES.map(q => ({ q, value: quantile(sorted, q) }))
}

export interface HistogramResult {
  bins: { x0: number; x1: number; count: number; aboveStart: boolean }[]
  excluded: number
  total: number
  startingTotal: number
}

export function histogram(result: SimResult, binCount: number = 30): HistogramResult {
  const start = result.startingTotal
  let excluded = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < result.finalWealth.length; i++) {
    if (result.ruined[i]) {
      excluded++
      continue
    }
    const v = result.finalWealth[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const kept = result.finalWealth.length - excluded
  if (kept === 0) {
    return { bins: [], excluded, total: result.finalWealth.length, startingTotal: start }
  }
  if (hi === lo) hi = lo + 1
  const width = (hi - lo) / binCount
  const counts = new Array<number>(binCount).fill(0)
  for (let i = 0; i < result.finalWealth.length; i++) {
    if (result.ruined[i]) continue
    let b = Math.floor((result.finalWealth[i] - lo) / width)
    if (b >= binCount) b = binCount - 1
    if (b < 0) b = 0
    counts[b]++
  }
  const bins = counts.map((count, i) => {
    const x0 = lo + i * width
    const x1 = lo + (i + 1) * width
    return { x0, x1, count, aboveStart: (x0 + x1) / 2 >= start }
  })
  return { bins, excluded, total: result.finalWealth.length, startingTotal: start }
}
