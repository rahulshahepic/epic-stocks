/**
 * Client for the no-account trial preview (/api/trial/analyze).
 *
 * No session required — this is the on-ramp for someone who doesn't want to
 * create an account yet. Nothing here is written to a database; the response
 * carries a wizard_payload that /api/wizard/submit accepts as-is, once they
 * decide to sign up and save it.
 */
import { apiFetch } from '../api.ts'
import type {
  GrantEntry, LoanEntry, PriceEntry, TaxSettings, TimelineEvent, WizardSubmitPayload,
} from '../api.ts'
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
  /** True when the newest price in the files is from an earlier year. */
  price_is_stale: boolean
  wizard_payload: WizardSubmitPayload
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

export function trialAnalyze(
  shareCsv: File | null,
  statementPdf: File | null,
  /** Today's share price, when the files only carry older ones. */
  currentPrice?: number,
): Promise<TrialAnalyzeResponse> {
  const body = new FormData()
  if (shareCsv) body.append('share_csv', shareCsv)
  if (statementPdf) body.append('statement_pdf', statementPdf)
  if (currentPrice != null && currentPrice > 0) body.append('current_price', String(currentPrice))
  return apiFetch<TrialAnalyzeResponse>('/api/trial/analyze', { method: 'POST', body }, 'Could not read those files')
}

/**
 * Funnel pings. Each adds one to an anonymous daily total on the server and
 * carries nothing else — no identity, no payload. Fire-and-forget by design:
 * a count that fails to record must never interrupt what the person was doing.
 */
export function pingSaveIntent(): void {
  void apiFetch('/api/trial/save-intent', { method: 'POST' }).catch(() => {})
}

export function pingConverted(): void {
  void apiFetch('/api/trial/converted', { method: 'POST' }).catch(() => {})
}

const STORAGE_KEY = 'trial_wizard_payload'

/** Stashed before redirecting to sign-in so signup can save it without a re-upload. */
export async function stashTrialPayload(payload: WizardSubmitPayload): Promise<void> {
  await platform.storage.set(STORAGE_KEY, JSON.stringify(payload))
}

export async function takeStashedTrialPayload(): Promise<WizardSubmitPayload | null> {
  const raw = await platform.storage.get(STORAGE_KEY)
  if (!raw) return null
  await platform.storage.remove(STORAGE_KEY)
  try {
    return JSON.parse(raw) as WizardSubmitPayload
  } catch {
    return null
  }
}
