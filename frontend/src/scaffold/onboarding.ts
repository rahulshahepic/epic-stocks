/** Optional, one-tab attempt measurement. No financial or identity payloads. */
import { apiFetch } from '../api.ts'
import { platform } from '../platform/index.ts'

type Attempt = { token: string; sequence: number; expires: number; entrypoint: 'trial' | 'account' }
const KEY = 'onboarding_attempt_v1'
const CHOICE = 'onboarding_counts_v1'
let pending: Promise<unknown> = Promise.resolve()
let consentRevision = 0

const DEADLINE_MS = 500
async function request<T = unknown>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      apiFetch<T>(path, {method: 'POST', body: JSON.stringify(body), signal: controller.signal}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Optional measurement deadline')) }, DEADLINE_MS) }),
    ])
  } finally { clearTimeout(timer) }
}

export function measurementAllowed(): boolean {
  try { return navigator.doNotTrack !== '1' && localStorage.getItem(CHOICE) === 'on' } catch { return false }
}

async function read(): Promise<Attempt | null> {
  try {
    const value = JSON.parse(await platform.storage.get(KEY) ?? 'null') as Attempt | null
    if (!value || !/^[0-9a-f]{48}$/.test(value.token) || !Number.isInteger(value.sequence) || value.sequence < 0 || value.sequence > 500 || value.expires <= Date.now()) { await platform.storage.remove(KEY); return null }
    return value
  } catch { return null }
}

export async function forgetMeasurement(): Promise<void> {
  const old = await read()
  await platform.storage.remove(KEY)
  if (old) void request('/api/onboarding/forget', {token: old.token}).catch(() => {})
}

export async function resetMeasurement(): Promise<void> {
  consentRevision += 1
  await forgetMeasurement()
}

export function setMeasurementAllowed(enabled: boolean): void {
  consentRevision += 1
  try { localStorage.setItem(CHOICE, enabled ? 'on' : 'off') } catch { /* opt-in remains off */ }
  if (!enabled) void forgetMeasurement()
}

export function beginAnalysis(entrypoint: 'trial' | 'account'): Promise<Attempt | null> {
  const revision = consentRevision
  const operation = pending.then(async () => {
    if (!measurementAllowed() || revision !== consentRevision) { await forgetMeasurement(); return null }
    let value = await read()
    if (!measurementAllowed() || revision !== consentRevision) { await forgetMeasurement(); return null }
    if (value && (value.entrypoint !== entrypoint || value.sequence >= 500)) { await forgetMeasurement(); value = null }
    if (!value) {
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('')
      const result = await request<{token: string | null; ttl_seconds: number}>('/api/onboarding/' + (entrypoint === 'account' ? 'start-account' : 'start'), {entrypoint, nonce, opt_in: true})
      if (!result.token) return null
      if (!measurementAllowed() || revision !== consentRevision) { void request('/api/onboarding/forget', {token: result.token}).catch(() => {}); return null }
      value = {token: result.token, sequence: 0, expires: Date.now() + result.ttl_seconds * 1000, entrypoint}
    }
    if (!measurementAllowed() || revision !== consentRevision) {
      void request('/api/onboarding/forget', {token: value.token}).catch(() => {})
      return null
    }
    value.sequence += 1
    await platform.storage.set(KEY, JSON.stringify(value))
    if (!measurementAllowed() || revision !== consentRevision) { await forgetMeasurement(); return null }
    return value
  }).catch(() => null)
  pending = operation
  return operation
}

export async function measurementToken(): Promise<string | undefined> {
  if (!measurementAllowed()) { void forgetMeasurement(); return undefined }
  const revision = consentRevision
  const value = await read()
  if (!measurementAllowed() || revision !== consentRevision) { void forgetMeasurement(); return undefined }
  return value?.token
}

export async function measurementEvent(event: 'preview_viewed' | 'save_intent' | 'reminder_enabled' | 'carryover_failed', sequence?: number): Promise<void> {
  if (!measurementAllowed()) { void forgetMeasurement(); return }
  const revision = consentRevision
  const value = await read()
  if (!measurementAllowed() || revision !== consentRevision) { void forgetMeasurement(); return }
  if (!value || (sequence != null && sequence !== value.sequence)) return
  const account = event === 'reminder_enabled' || event === 'carryover_failed'
  try {
    await request('/api/onboarding/' + (account ? 'account-event' : 'event'), {token: value.token, sequence: value.sequence, event, opt_in: true})
  } catch { /* Measurement never blocks the product flow. */ }
}

export async function claimMeasurement(): Promise<void> {
  const revision = consentRevision
  const token = await measurementToken()
  if (!token || !measurementAllowed() || revision !== consentRevision) return
  try {
    const result = await request<{recorded: boolean}>('/api/onboarding/claim', {token, opt_in: true})
    if (result.recorded === false) await forgetMeasurement()
  } catch { /* optional */ }
}
