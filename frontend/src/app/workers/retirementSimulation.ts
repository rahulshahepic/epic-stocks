import { simulate, type SimParams } from '../pages/Retirement.math.ts'

self.onmessage = (event: MessageEvent<{ params: SimParams; marketPathSeed: number; compareOnly?: boolean }>) => {
  try {
    const { params, marketPathSeed, compareOnly } = event.data
    const result = simulate(params, marketPathSeed)
    const baseline = !compareOnly && params.plannedEvents?.length ? simulate({ ...params, plannedEvents: [] }, marketPathSeed) : null
    self.postMessage({ result, baseline })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to run the retirement simulation.' })
  }
}
