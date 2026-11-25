import { simulate, type SimParams } from '../pages/Retirement.math.ts'

self.onmessage = (event: MessageEvent<SimParams>) => {
  try {
    const params = event.data
    const result = simulate(params)
    const baseline = params.plannedEvents?.length ? simulate({ ...params, plannedEvents: [] }) : null
    self.postMessage({ result, baseline })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to run the retirement simulation.' })
  }
}
