import {
  DEFAULT_PARAMS,
  simulate,
  computeFanPercentiles,
  type SimParams
} from '../pages/Retirement.math.ts'

self.onmessage = (event: MessageEvent<Partial<SimParams>>) => {
  try {
    const result = simulate({
      ...DEFAULT_PARAMS,
      ...event.data,
      paths: 2000,
      seed: 1729
    })
    self.postMessage({
      pctRuin: result.pctRuin,
      medianFinalM: result.medianFinalM,
      startingTotal: result.startingTotal,
      fan: computeFanPercentiles(result)
    })
  } catch {
    self.postMessage({
      error:
        'The simulation could not run. Check the demo assumptions and retry.'
    })
  }
}
