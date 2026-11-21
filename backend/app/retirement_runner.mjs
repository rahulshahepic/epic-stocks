// Runs the exact TypeScript calculator compiled from Retirement.math.ts.
// One JSON request on stdin, one bounded summary on stdout. No network access.
import { readFileSync } from 'node:fs'
import {
  DEFAULT_PARAMS, simulate, computeFanPercentiles, finalPercentiles, planCashFlows,
} from './retirement.math.mjs'

try {
  const request = JSON.parse(readFileSync(0, 'utf8'))
  const params = { ...DEFAULT_PARAMS, ...request.params }
  const result = simulate(params)
  const planned = planCashFlows(params.plannedEvents ?? [], params.simulationStartDate ?? '2030-01-01', result.years * 12, params.asOfDate)
  const response = {
    paths: params.paths,
    planned: { preRetirementNetM: planned.preRetirementNetM,
      preRetirementEpicNeedM: planned.preRetirementEpicNeedM,
      warnings: planned.warnings },
    seed: params.seed,
    startingTotalM: result.startingTotal,
    startingCashM: result.startingCash,
    pctFundingShortfall: result.pctRuin,
    pctLiquidityShortfall: result.pctLiquidityShortfall,
    pctExhausted: result.pctExhausted,
    pctRuin: result.pctRuin,
    pctAboveStart: result.pctAboveStart,
    medianFinalM: result.medianFinalM,
    p10FinalM: result.p10FinalM,
    years: result.years,
    finalPercentiles: finalPercentiles(result),
    wealthByAge: computeFanPercentiles(result),
  }
  process.stdout.write(JSON.stringify(response))
} catch (error) {
  process.stderr.write('Retirement simulation failed: ' + (error instanceof Error ? error.message : 'unknown error'))
  process.exitCode = 1
}
