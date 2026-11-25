/**
 * Client for the no-account trial preview (/api/trial/analyze).
 *
 * No session required — this is the on-ramp for someone who doesn't want to
 * create an account yet. Nothing here is written to a database; the response
 * carries the draft, which after signing up becomes the edits that add it to
 * the new account (/api/epic-import/changes, then /api/changes).
 */
import { api, apiFetch } from '../api.ts'
import { claimMeasurement, measurementToken } from '../scaffold/onboarding.ts'
import type {
  GrantEntry, LoanEntry, PriceEntry, TaxSettings, TimelineEvent,
} from '../api.ts'
import { beginAnalysis, measurementAllowed } from '../scaffold/onboarding.ts'
export { measurementAllowed } from '../scaffold/onboarding.ts'
import { platform } from '../platform/index.ts'

export interface TrialFinding {
  code: string
  severity: 'error' | 'warning' | 'info'
  subject: string
  message: string
}

export interface TrialSummary {
  grants: number
  loans: number
  prices: number
  total_shares: number
  total_loan_balance: number
  grant_years: number[]
}

export interface TrialAnalyzeResponse {
  measurementSequence?: number
  /** True when the newest price in the files is from an earlier year. */
  price_is_stale: boolean
  draft: Record<string, unknown>
  /** The same shapes the signed-in app renders from — ids are negative, nothing is saved. */
  grants: GrantEntry[]
  loans: LoanEntry[]
  prices: PriceEntry[]
  timeline: TimelineEvent[]
  summary: TrialSummary
  /** The rates a new account starts with, so the preview matches what signing up gives. */
  tax_defaults: TaxSettings
  findings: TrialFinding[]
  blocked: boolean
  reconciles: boolean
}


export async function trialAnalyze(
  shareCsv: File | null,
  statementPdf: File | null,
  /** Today's share price, when the files only carry older ones. */
  currentPrice?: number,
): Promise<TrialAnalyzeResponse> {
  const attempt = await beginAnalysis('trial')
  const body = new FormData()
  if (attempt) { body.append('attempt_token', attempt.token); body.append('attempt_sequence', String(attempt.sequence)) }
  body.append('measure_usage', String(measurementAllowed()))
  if (shareCsv) body.append('share_csv', shareCsv)
  if (statementPdf) body.append('statement_pdf', statementPdf)
  if (currentPrice != null && currentPrice > 0) body.append('current_price', String(currentPrice))
  const result = await apiFetch<TrialAnalyzeResponse>('/api/trial/analyze', { method: 'POST', body }, 'Could not read those files')
  return {...result, measurementSequence: attempt?.sequence}
}

/**
 * Funnel pings. Each adds one to an anonymous daily total on the server and
 * carries nothing else — no identity, no payload. Fire-and-forget by design:
 * a count that fails to record must never interrupt what the person was doing.
 */
export function pingSaveIntent(): void {
  if (!measurementAllowed()) return
  void apiFetch('/api/trial/save-intent', { method: 'POST' }).catch(() => {})
}

export function pingConverted(): void {
  if (!measurementAllowed()) return
  void apiFetch('/api/trial/converted', { method: 'POST' }).catch(() => {})
}

const STORAGE_KEY = 'trial_draft'

export async function discardTrialPreview(): Promise<void> {
  await Promise.all(['trial_draft', 'trial_saved_at', 'trial_preview', 'trial_preview_expired'].map(key => platform.storage.remove(key)))
}

/** Stashed before redirecting to sign-in so signup can save it without a re-upload. */
export async function stashTrialPayload(draft: Record<string, unknown>): Promise<void> {
  const raw = JSON.stringify(draft)
  await platform.storage.set(STORAGE_KEY, raw)
  if (await platform.storage.get(STORAGE_KEY) !== raw) throw new Error('Could not keep your preview on this device. Sign in first, then import your files from your account.')
  await platform.storage.set('trial_saved_at', String(Date.now()))
  await platform.storage.remove('trial_preview_expired')
}

export async function hasTrialPayload(): Promise<boolean> {
  const stamp = await platform.storage.get('trial_saved_at')
  if (stamp && (!Number.isFinite(Number(stamp)) || Date.now() - Number(stamp) > 30 * 60 * 1000)) {
    await platform.storage.remove(STORAGE_KEY)
    await platform.storage.remove('trial_preview')
    await platform.storage.remove('trial_saved_at')
    await platform.storage.set('trial_preview_expired', '1')
    return false
  }
  return !!await platform.storage.get(STORAGE_KEY)
}

export async function takeStashedTrialPayload(): Promise<Record<string, unknown> | null> {
  if (!await hasTrialPayload()) return null
  const raw = await platform.storage.get(STORAGE_KEY)
  if (!raw) return null
  await discardTrialPreview()
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Signup and an already signed-in preview follow the same addition-only save. */
export async function saveTrialDraft(draft: Record<string, unknown>): Promise<void> {
  await claimMeasurement()
  const { changes, blocked } = await api.draftChanges(draft)
  if (blocked) throw new Error('Your preview needs review. Import the files again to resolve the findings.')
  const additions = changes.filter(c => c.action === 'create')
  if (additions.length) {
    const preview = await api.previewChanges(additions)
    if (!preview.confirm) throw new Error('Your preview could not be confirmed. Import the files again to review it.')
    const token = await measurementToken()
    if (token) await api.applyChanges(additions, preview.confirm, token)
    else await api.applyChanges(additions, preview.confirm)
    pingConverted()
  }
  const outcome = additions.length ? (changes.some(c => c.action !== 'create') ? 'partial' : 'saved') : changes.length ? 'review' : 'matched'
  await platform.storage.set('trial_carryover_result', outcome)
  await platform.storage.remove('trial_preview')
  await platform.storage.remove(STORAGE_KEY)
}
