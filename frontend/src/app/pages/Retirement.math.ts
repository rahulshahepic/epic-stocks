// Pure math for the retirement Monte Carlo simulator.
// All dollar amounts are in $M (millions) of real (inflation-adjusted) dollars
// unless noted otherwise. Spend / health-insurance inputs are in $K/year real.
//
// Returns are sampled by 5-year circular block bootstrap from 1928-2025 US
// stock + 10yr Treasury history (Damodaran nominal returns, BLS CPI). Each
// block preserves intra-block stock/bond co-movement, autocorrelation, and
// crash/recovery shape that an i.i.d. lognormal model misses. Scenarios
// differ only by a constant shift added to every resampled return — this
// re-locates the distribution without distorting its variance, autocorrelation,
// or tail asymmetry.

export type Scenario = 'historical' | 'moderate' | 'cautious' | 'custom'

export interface ScenarioParams {
  stockShift: number  // added to every resampled stock return
  bondShift: number   // added to every resampled bond return
}

// Built-in scenario shifts. 'custom' uses params.customStockShift / customBondShift.
// Moderate ≈ Vanguard 2025 10-yr outlook (raw historical CAGR minus ~2pp on
// equities given current valuations); cautious tightens further.
export const SCENARIOS: Record<Exclude<Scenario, 'custom'>, ScenarioParams> = {
  historical: { stockShift: 0, bondShift: 0 },
  moderate: { stockShift: -0.02, bondShift: -0.005 },
  cautious: { stockShift: -0.035, bondShift: -0.01 },
}

export const SCENARIO_LABELS: Record<Scenario, string> = {
  historical: 'Historical',
  moderate: 'Moderate',
  cautious: 'Cautious',
  custom: 'Custom',
}

// Stationary bootstrap (Politis & Romano 1994): at each year, with
// probability 1/MEAN_BLOCK_LEN start a new random block, otherwise advance
// one year. Block lengths are geometrically distributed with mean L. Mean
// 20 gives a strong bias toward keeping each path on a single contiguous
// historical run (P(no jumps in 30 years) ≈ 22%), which mostly suppresses
// the synthetic-bad-stitching that fixed shorter blocks fall victim to at
// long horizons, while geometric variance still produces enough short
// blocks for inter-path Monte Carlo diversity.
export const MEAN_BLOCK_LEN = 20

// Behavioral spending ramp: when total wealth (equity + cash) falls to this
// fraction of the starting total or below, annual spend is clamped to
// minSpend. At ≥100% of start it's at defaultSpend. Linear interpolation in
// between. Models the empirical reality that retirees cut discretionary
// spend as their portfolio shrinks rather than blindly drawing the same
// dollars regardless of remaining balance.
export const SPEND_RAMP_FLOOR = 0.5

// Given a current wealth ratio (currentTotal / startingTotal), return the
// blended annual spend the simulator would use that year (excluding health
// insurance). Pure function so the UI can show worked examples that match
// the math exactly.
export function projectedSpend(wealthRatio: number, defaultSpend: number, minSpend: number): number {
  const t = Math.max(0, Math.min(1, (wealthRatio - SPEND_RAMP_FLOOR) / (1 - SPEND_RAMP_FLOOR)))
  return minSpend + t * (defaultSpend - minSpend)
}

export interface HistoricalReturn {
  year: number
  stockReal: number
  bondReal: number
}

// Raw US data 1928-2025: [year, S&P 500 nominal, 10yr T.Bond nominal, CPI %].
// Stocks + bonds: Aswath Damodaran (NYU Stern). CPI: BLS via Minneapolis Fed.
// Real return = (1 + nominal) / (1 + cpi) - 1, computed below.
const HISTORICAL_RAW: ReadonlyArray<readonly [number, number, number, number]> = [
  [1928, 0.4381, 0.0084, -0.0120],
  [1929, -0.0830, 0.0420, 0.0000],
  [1930, -0.2512, 0.0454, -0.0270],
  [1931, -0.4384, -0.0256, -0.0890],
  [1932, -0.0864, 0.0879, -0.1030],
  [1933, 0.4998, 0.0186, -0.0520],
  [1934, -0.0119, 0.0796, 0.0350],
  [1935, 0.4674, 0.0447, 0.0260],
  [1936, 0.3194, 0.0502, 0.0100],
  [1937, -0.3534, 0.0138, 0.0370],
  [1938, 0.2928, 0.0421, -0.0200],
  [1939, -0.0110, 0.0441, -0.0130],
  [1940, -0.1067, 0.0540, 0.0070],
  [1941, -0.1277, -0.0202, 0.0510],
  [1942, 0.1917, 0.0229, 0.1090],
  [1943, 0.2506, 0.0249, 0.0600],
  [1944, 0.1903, 0.0258, 0.0160],
  [1945, 0.3582, 0.0380, 0.0230],
  [1946, -0.0843, 0.0313, 0.0850],
  [1947, 0.0520, 0.0092, 0.1440],
  [1948, 0.0570, 0.0195, 0.0770],
  [1949, 0.1830, 0.0466, -0.0100],
  [1950, 0.3081, 0.0043, 0.0110],
  [1951, 0.2368, -0.0030, 0.0790],
  [1952, 0.1815, 0.0227, 0.0230],
  [1953, -0.0121, 0.0414, 0.0080],
  [1954, 0.5256, 0.0329, 0.0030],
  [1955, 0.3260, -0.0134, -0.0030],
  [1956, 0.0744, -0.0226, 0.0150],
  [1957, -0.1046, 0.0680, 0.0330],
  [1958, 0.4372, -0.0210, 0.0270],
  [1959, 0.1206, -0.0265, 0.0108],
  [1960, 0.0034, 0.1164, 0.0150],
  [1961, 0.2664, 0.0206, 0.0110],
  [1962, -0.0881, 0.0569, 0.0120],
  [1963, 0.2261, 0.0168, 0.0120],
  [1964, 0.1642, 0.0373, 0.0130],
  [1965, 0.1240, 0.0072, 0.0160],
  [1966, -0.0997, 0.0291, 0.0300],
  [1967, 0.2380, -0.0158, 0.0280],
  [1968, 0.1081, 0.0327, 0.0430],
  [1969, -0.0824, -0.0501, 0.0550],
  [1970, 0.0356, 0.1675, 0.0580],
  [1971, 0.1422, 0.0979, 0.0430],
  [1972, 0.1876, 0.0282, 0.0330],
  [1973, -0.1431, 0.0366, 0.0620],
  [1974, -0.2590, 0.0199, 0.1110],
  [1975, 0.3700, 0.0361, 0.0910],
  [1976, 0.2383, 0.1598, 0.0570],
  [1977, -0.0698, 0.0129, 0.0650],
  [1978, 0.0651, -0.0078, 0.0760],
  [1979, 0.1852, 0.0067, 0.1130],
  [1980, 0.3174, -0.0299, 0.1350],
  [1981, -0.0470, 0.0820, 0.1030],
  [1982, 0.2042, 0.3281, 0.0610],
  [1983, 0.2234, 0.0320, 0.0320],
  [1984, 0.0615, 0.1373, 0.0430],
  [1985, 0.3124, 0.2571, 0.0350],
  [1986, 0.1849, 0.2428, 0.0190],
  [1987, 0.0581, -0.0496, 0.0370],
  [1988, 0.1654, 0.0822, 0.0410],
  [1989, 0.3148, 0.1769, 0.0480],
  [1990, -0.0306, 0.0624, 0.0540],
  [1991, 0.3023, 0.1500, 0.0420],
  [1992, 0.0749, 0.0936, 0.0300],
  [1993, 0.0997, 0.1421, 0.0300],
  [1994, 0.0133, -0.0804, 0.0260],
  [1995, 0.3720, 0.2348, 0.0280],
  [1996, 0.2268, 0.0143, 0.0290],
  [1997, 0.3310, 0.0994, 0.0230],
  [1998, 0.2834, 0.1492, 0.0160],
  [1999, 0.2089, -0.0825, 0.0220],
  [2000, -0.0903, 0.1666, 0.0340],
  [2001, -0.1185, 0.0557, 0.0280],
  [2002, -0.2197, 0.1512, 0.0160],
  [2003, 0.2836, 0.0038, 0.0230],
  [2004, 0.1074, 0.0449, 0.0270],
  [2005, 0.0483, 0.0287, 0.0340],
  [2006, 0.1561, 0.0196, 0.0320],
  [2007, 0.0548, 0.1021, 0.0290],
  [2008, -0.3655, 0.2010, 0.0380],
  [2009, 0.2594, -0.1112, -0.0040],
  [2010, 0.1482, 0.0846, 0.0160],
  [2011, 0.0210, 0.1604, 0.0320],
  [2012, 0.1589, 0.0297, 0.0210],
  [2013, 0.3215, -0.0910, 0.0150],
  [2014, 0.1352, 0.1075, 0.0160],
  [2015, 0.0138, 0.0128, 0.0010],
  [2016, 0.1177, 0.0069, 0.0130],
  [2017, 0.2161, 0.0280, 0.0210],
  [2018, -0.0423, -0.0002, 0.0240],
  [2019, 0.3121, 0.0964, 0.0180],
  [2020, 0.1802, 0.1133, 0.0120],
  [2021, 0.2847, -0.0442, 0.0470],
  [2022, -0.1804, -0.1783, 0.0800],
  [2023, 0.2606, 0.0388, 0.0410],
  [2024, 0.2488, -0.0164, 0.0290],
  [2025, 0.1778, 0.0780, 0.0260],
]

export const HISTORICAL_RETURNS: ReadonlyArray<HistoricalReturn> = HISTORICAL_RAW.map(
  ([year, nomS, nomB, infl]) => ({
    year,
    stockReal: (1 + nomS) / (1 + infl) - 1,
    bondReal: (1 + nomB) / (1 + infl) - 1,
  }),
)

export interface SimParams {
  epicExit: number       // $M
  additional: number     // $M
  stockPct: number       // 0..1, % of total portfolio
  bondPct: number        // 0..1, % of total portfolio (cash = 1 - stockPct - bondPct)
  defaultSpend: number   // $K/yr (excluding health insurance)
  minSpend: number       // $K/yr floor (excluding health insurance)
  healthInsurance: number // $K/yr
  zeroHIPost65: boolean  // health-insurance cost goes to 0 once age > 65
  refillTaxDrag: number  // 0..1
  scenario: Scenario
  customStockShift: number  // applied when scenario === 'custom'
  customBondShift: number   // applied when scenario === 'custom'
  ssMonthly: number      // $/month at FRA
  claimAge: number       // 62-70
  currentAge: number     // age at simulation start
  endAge: number         // simulate to this age
  paths: number
  fra: number            // 67
  // Spouse extension. When includeSpouse is false the rest are ignored.
  includeSpouse: boolean
  spouseCurrentAge: number  // age at simulation start (derived from spouse DOB + retirement date)
  spouseSsMonthly: number   // $/month at FRA (0 = no spouse SS)
  spouseClaimAge: number    // 62-70
  seed?: number
}

export const DEFAULT_PARAMS: SimParams = {
  epicExit: 0,
  additional: 0,
  stockPct: 0.7,
  bondPct: 0.2,
  // Spend defaults are auto-derived from total portfolio (3% / 2%) by the UI
  // once the exit-preview / saved params land. 0 here is just a placeholder.
  defaultSpend: 0,
  minSpend: 0,
  healthInsurance: 25,
  zeroHIPost65: true,
  refillTaxDrag: 0.25,
  scenario: 'historical',
  customStockShift: 0,
  customBondShift: 0,
  ssMonthly: 2500,
  claimAge: 67,
  currentAge: 50,
  endAge: 95,
  paths: 100_000,
  fra: 67,
  includeSpouse: false,
  spouseCurrentAge: 50,
  spouseSsMonthly: 0,
  spouseClaimAge: 67,
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

// Resolve the (stockShift, bondShift) pair for a given params object.
export function resolveScenarioShifts(params: Pick<SimParams, 'scenario' | 'customStockShift' | 'customBondShift'>): ScenarioParams {
  if (params.scenario === 'custom') {
    return { stockShift: params.customStockShift, bondShift: params.customBondShift }
  }
  return SCENARIOS[params.scenario]
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
  fanAges: number[]
  fanWealth: Float64Array[]
  finalWealth: Float64Array
  ruined: Uint8Array
  startingEquity: number
  startingCash: number
  startingTotal: number
  years: number
  pctAboveStart: number
  pctRuin: number
  medianFinalM: number
  p10FinalM: number
}

export function simulate(params: SimParams): SimResult {
  const rand = params.seed != null ? mulberry32(params.seed) : Math.random
  const { stockShift, bondShift } = resolveScenarioShifts(params)
  const data = HISTORICAL_RETURNS
  const dataLen = data.length

  const totalPortfolio = params.epicExit + params.additional
  const stockPct = Math.max(0, params.stockPct)
  const bondPct = Math.max(0, params.bondPct)
  const equityPct = stockPct + bondPct
  const cashPct = Math.max(0, 1 - equityPct)
  const startingEquity = totalPortfolio * Math.min(1, equityPct)
  const startingCash = totalPortfolio * cashPct
  const startingTotal = startingEquity + startingCash

  // Within equity, weights for stock vs. bond.
  const wS = equityPct > 0 ? stockPct / equityPct : 0
  const wB = 1 - wS

  const defaultSpendM = params.defaultSpend / 1000
  const minSpendM = params.minSpend / 1000
  const hiM = params.healthInsurance / 1000

  const ssAdj = ssAdjustment(params.claimAge, params.fra)
  const ssAnnualM = ((params.ssMonthly * 12) / 1_000_000) * ssAdj

  const hasSpouse = params.includeSpouse
  const spouseSsAdj = hasSpouse ? ssAdjustment(params.spouseClaimAge, params.fra) : 1
  const spouseSsAnnualM = hasSpouse
    ? ((params.spouseSsMonthly * 12) / 1_000_000) * spouseSsAdj
    : 0

  const cashTarget = startingCash
  const taxDrag = Math.max(0, Math.min(0.99, params.refillTaxDrag))

  const Y = Math.max(1, Math.round(params.endAge - params.currentAge))
  const N = Math.max(1, Math.round(params.paths))

  // Fan years: 0, 5, 10, ... up to Y.
  const fanYears: number[] = []
  for (let y = 0; y <= Y; y += 5) fanYears.push(y)
  if (fanYears[fanYears.length - 1] !== Y) fanYears.push(Y)
  const fanAges = fanYears.map(y => params.currentAge + y)

  const yearToFanIdx = new Map<number, number>()
  fanYears.forEach((y, idx) => yearToFanIdx.set(y, idx))

  const fanWealth: Float64Array[] = fanYears.map(() => new Float64Array(N))
  const finalWealth = new Float64Array(N)
  const ruined = new Uint8Array(N)
  const fan0Idx = yearToFanIdx.get(0)
  if (fan0Idx != null) fanWealth[fan0Idx].fill(startingTotal)

  const jumpProb = 1 / MEAN_BLOCK_LEN

  for (let i = 0; i < N; i++) {
    let equity = startingEquity
    let cash = startingCash
    let isRuined = false
    let dataIdx = Math.floor(rand() * dataLen)

    for (let y = 1; y <= Y; y++) {
      const age = params.currentAge + y
      const equityBefore = equity

      // Stationary bootstrap: each year (after the first), with probability
      // 1/L jump to a new uniformly-random year; otherwise advance one year.
      // Geometric block-length distribution with mean L.
      if (y > 1) {
        if (rand() < jumpProb) dataIdx = Math.floor(rand() * dataLen)
        else dataIdx = (dataIdx + 1) % dataLen
      }
      const sample = data[dataIdx]
      const stockR = sample.stockReal + stockShift
      const bondR = sample.bondReal + bondShift

      let portR = 0
      if (equity > 0) {
        portR = wS * stockR + wB * bondR
        equity = equity * (1 + portR)
        if (equity < 0) equity = 0
      }

      // Behavioral spending: ramp linearly between minSpend (at ≤50% of
      // starting total) and defaultSpend (at ≥100%). People dial back as
      // their nest egg shrinks; this prevents the simulator from spending at
      // full default while sitting at a fraction of the starting balance.
      const wealthRatio = startingTotal > 0 ? (equity + cash) / startingTotal : 0
      const spendT = Math.max(0, Math.min(1, (wealthRatio - SPEND_RAMP_FLOOR) / (1 - SPEND_RAMP_FLOOR)))
      const baseSpendM = minSpendM + spendT * (defaultSpendM - minSpendM)
      const spouseAge = params.spouseCurrentAge + y
      let hiThisYear = hiM
      if (params.zeroHIPost65) {
        if (hasSpouse) {
          const ownerOnMedicare = age > 65
          const spouseOnMedicare = spouseAge > 65
          if (ownerOnMedicare && spouseOnMedicare) hiThisYear = 0
          else if (ownerOnMedicare || spouseOnMedicare) hiThisYear = hiM * 0.5
        } else if (age > 65) {
          hiThisYear = 0
        }
      }
      const totalSpendM = baseSpendM + hiThisYear

      const ownerSsM = age >= params.claimAge ? ssAnnualM : 0
      const spouseSsM = hasSpouse && spouseAge >= params.spouseClaimAge ? spouseSsAnnualM : 0
      const ssIncomeM = ownerSsM + spouseSsM
      let needed = totalSpendM - ssIncomeM

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

      // Refill cash only from this year's *net positive equity change* — i.e.
      // earnings in excess of what we already pulled out for spending. This
      // preserves equity principal, never selling more than the year's gain.
      const equityChange = equity - equityBefore
      if (equityChange > 0 && cash < cashTarget) {
        const refillRoom = cashTarget - cash
        const grossSell = Math.min(refillRoom / (1 - taxDrag), equityChange)
        if (grossSell > 0) {
          equity -= grossSell
          cash += grossSell * (1 - taxDrag)
        }
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
    fanAges,
    fanWealth,
    finalWealth,
    ruined,
    startingEquity,
    startingCash,
    startingTotal,
    years: Y,
    pctAboveStart: above / N,
    pctRuin: ruin / N,
    medianFinalM,
    p10FinalM,
  }
}

export interface FanPercentiles {
  year: number
  age: number
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
      age: result.fanAges[idx],
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
  scale: 'linear' | 'log'
}

// Switch to log-binning when the spread between min and max non-ruined wealth
// crosses this multiplier. Linear bins squash long-tailed distributions into
// the leftmost 1–2 bars; log bins reveal the tail.
export const HISTOGRAM_LOG_THRESHOLD = 10

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
    return { bins: [], excluded, total: result.finalWealth.length, startingTotal: start, scale: 'linear' }
  }
  if (hi === lo) hi = lo + 1

  const useLog = lo > 0 && hi / lo > HISTOGRAM_LOG_THRESHOLD
  const counts = new Array<number>(binCount).fill(0)

  if (useLog) {
    // A single surviving outlier ($10 of wealth in a portfolio that's mostly
    // $1M–$1B) would otherwise drag the visible range across 9 decades and
    // fill the left axis with rounded-to-zero ticks. Trim the visible range
    // to the central 99% of survivors, but always keep `start` in view so
    // the reference line renders. Out-of-range values still count — they
    // land in the first or last bin.
    const sortedKept = new Float64Array(kept)
    let j = 0
    for (let i = 0; i < result.finalWealth.length; i++) {
      if (!result.ruined[i]) sortedKept[j++] = result.finalWealth[i]
    }
    sortedKept.sort()
    const trimLo = quantile(sortedKept, 0.005)
    const trimHi = quantile(sortedKept, 0.995)
    let loEff = trimLo > 0 ? trimLo : lo
    let hiEff = trimHi > loEff ? trimHi : hi
    if (start > 0) {
      if (start < loEff) loEff = start
      if (start > hiEff) hiEff = start
    }
    if (hiEff <= loEff) hiEff = loEff * 1.0001
    const loLog = Math.log(loEff)
    const hiLog = Math.log(hiEff)
    const widthLog = (hiLog - loLog) / binCount
    for (let i = 0; i < result.finalWealth.length; i++) {
      if (result.ruined[i]) continue
      const v = result.finalWealth[i]
      let b = v <= 0 ? 0 : Math.floor((Math.log(v) - loLog) / widthLog)
      if (b >= binCount) b = binCount - 1
      if (b < 0) b = 0
      counts[b]++
    }
    const bins = counts.map((count, i) => {
      const x0 = Math.exp(loLog + i * widthLog)
      const x1 = Math.exp(loLog + (i + 1) * widthLog)
      return { x0, x1, count, aboveStart: (x0 + x1) / 2 >= start }
    })
    return { bins, excluded, total: result.finalWealth.length, startingTotal: start, scale: 'log' }
  }

  const width = (hi - lo) / binCount
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
  return { bins, excluded, total: result.finalWealth.length, startingTotal: start, scale: 'linear' }
}
