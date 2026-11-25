import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { beginAnalysis, claimMeasurement, measurementAllowed, measurementEvent, measurementToken, resetMeasurement, setMeasurementAllowed } from '../scaffold/onboarding.ts'
import { platform } from '../platform/index.ts'
import { trialAnalyze } from '../app/trialImport.ts'

const KEY = 'onboarding_attempt_v1'
const token = 'a'.repeat(48)
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks()
  Object.defineProperty(navigator, 'doNotTrack', {value: null, configurable: true})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function store() { sessionStorage.setItem(KEY, JSON.stringify({token, sequence: 1, entrypoint: 'trial', expires: Date.now() + 86400000})) }

it('requires fresh explicit opt-in rather than inheriting the legacy choice', async () => {
  localStorage.setItem('trial_measurement', 'on')
  const fetcher = vi.spyOn(globalThis, 'fetch')
  expect(measurementAllowed()).toBe(false)
  expect(await beginAnalysis('trial')).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})

it('reuses one attempt and increases sequence numbers for retries without financial payloads', async () => {
  setMeasurementAllowed(true)
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({token, ttl_seconds: 86400})))
  expect((await beginAnalysis('trial'))?.sequence).toBe(1)
  expect((await beginAnalysis('trial'))?.sequence).toBe(2)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
  expect(Object.keys(body).sort()).toEqual(['entrypoint', 'nonce', 'opt_in'])
  await measurementEvent('preview_viewed', 1)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('removes a key returned after opt-out while start was in flight', async () => {
  setMeasurementAllowed(true)
  let finish!: (response: Response) => void
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/start')) return new Promise<Response>(resolve => { finish = resolve })
    return new Response('{}')
  })
  const first = beginAnalysis('trial')
  await vi.waitFor(() => expect(finish).toBeDefined())
  setMeasurementAllowed(false)
  finish(new Response(JSON.stringify({token, ttl_seconds: 86400})))
  expect(await first).toBeNull()
  expect(sessionStorage.getItem(KEY)).toBeNull()
  await vi.waitFor(() => expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/forget'))).toBe(true))
})

it('honors DNT changes and removes existing temporary linkage', async () => {
  setMeasurementAllowed(true); store()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  Object.defineProperty(navigator, 'doNotTrack', {value: '1', configurable: true})
  await measurementEvent('preview_viewed')
  expect(await measurementToken()).toBeUndefined()
  await vi.waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull())
  expect(fetcher.mock.calls.every(([u]) => String(u).endsWith('/forget'))).toBe(true)
})

it('continues an import after the optional start endpoint hangs', async () => {
  setMeasurementAllowed(true)
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).endsWith('/start')) return new Promise<Response>(() => {})
    return new Response(JSON.stringify({draft: {}, summary: {grants: 1}}))
  })
  const result = await trialAnalyze(new File(['fictional'], 'fixture.csv'), null)
  expect(result.summary.grants).toBe(1)
  expect(fetcher.mock.calls.some(([u]) => String(u).includes('/api/trial/analyze'))).toBe(true)
}, 3000)

it('bounds claim waits so an unavailable measurement endpoint cannot strand carryover', async () => {
  setMeasurementAllowed(true); store()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Promise<Response>(() => {}))
  const started = Date.now()
  await claimMeasurement()
  expect(Date.now() - started).toBeLessThan(1500)
}, 3000)


it.each(['event', 'token', 'claim'] as const)('honors opt-out during an asynchronous %s storage read', async kind => {
  setMeasurementAllowed(true); store()
  let finish!: (value: string | null) => void
  const value = sessionStorage.getItem(KEY)
  vi.spyOn(platform.storage, 'get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const operation = kind === 'event' ? measurementEvent('preview_viewed') : kind === 'token' ? measurementToken() : claimMeasurement()
  setMeasurementAllowed(false)
  finish(value)
  await operation
  await vi.waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull())
  expect(fetcher.mock.calls.every(([u]) => String(u).endsWith('/forget'))).toBe(true)
})


it('does not restore a late attempt after logout or start-over', async () => {
  setMeasurementAllowed(true)
  let finish!: (response: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/start')) return new Promise<Response>(resolve => { finish = resolve })
    return new Response('{}')
  })
  const operation = beginAnalysis('trial')
  const queued = beginAnalysis('trial')
  await vi.waitFor(() => expect(finish).toBeDefined())
  await resetMeasurement()
  finish(new Response(JSON.stringify({token, ttl_seconds: 86400})))
  expect(await operation).toBeNull()
  expect(await queued).toBeNull()
  expect(sessionStorage.getItem(KEY)).toBeNull()
})
