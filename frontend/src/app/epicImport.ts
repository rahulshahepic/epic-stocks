/**
 * Client for the Epic file importer (/api/epic-import).
 *
 * The app never calls a language model. When a parse cannot be trusted, the
 * server hands back a prompt for the user to paste into whichever assistant
 * they already use; whatever comes back is posted here and checked again.
 */
import type { GrantEntry, LoanEntry, PriceEntry } from '../api.ts'

export interface Finding {
  code: string
  severity: 'error' | 'warning' | 'info'
  subject: string
  message: string
}

export interface DraftSummary {
  grants: number
  loans: number
  prices: number
  total_shares: number
  total_loan_balance: number
  grant_years: number[]
}

/** The draft in the shape the wizard's own data loader consumes. */
export interface WizardPrefill {
  grants: GrantEntry[]
  loans: LoanEntry[]
  prices: PriceEntry[]
}

export interface AnalyzeResponse {
  draft: Record<string, unknown>
  wizard_payload: Record<string, unknown>
  wizard_prefill: WizardPrefill
  findings: Finding[]
  /** True when we could not read the documents themselves — nothing else is trustworthy. */
  blocked: boolean
  /** True when nothing disagrees at all. */
  reconciles: boolean
  prompt: string
  summary: DraftSummary
  origin: 'parsed' | 'supplied'
}

export interface Difference {
  entity: 'grant' | 'loan' | 'price'
  key: string
  field: string
  imported: string
  existing: string
  rule: string
  severity: 'error' | 'warning' | 'info'
  note: string
}

export interface ReconcileReport {
  differences: Difference[]
  counts: Record<string, number>
  errors: number
  warnings: number
}

export interface DiffResponse {
  draft: Record<string, unknown>
  findings: Finding[]
  report: ReconcileReport
  markdown: string
}

export interface EpicFiles {
  shareCsv?: File | null
  statementPdf?: File | null
  exportXlsx?: File | null
  revisedDraft?: File | null
}

function form(files: EpicFiles, revisedJson?: string): FormData {
  const body = new FormData()
  if (files.exportXlsx) body.append('export_xlsx', files.exportXlsx)
  if (files.shareCsv) body.append('share_csv', files.shareCsv)
  if (files.statementPdf) body.append('statement_pdf', files.statementPdf)
  if (files.revisedDraft) body.append('revised_draft', files.revisedDraft)
  if (revisedJson) body.append('revised_json', revisedJson)
  return body
}

async function post<T>(path: string, files: EpicFiles, revisedJson?: string): Promise<T> {
  const resp = await fetch(path, {
    method: 'POST', credentials: 'include', body: form(files, revisedJson),
  })
  if (!resp.ok) {
    const parsed = await resp.json().catch(() => null)
    throw new Error(parsed?.detail || `Request failed (${resp.status})`)
  }
  return resp.json() as Promise<T>
}

export const epicImport = {
  /** Round one reads the files; later rounds also carry whatever came back. */
  analyze: (files: EpicFiles, revisedJson?: string) =>
    post<AnalyzeResponse>('/api/epic-import/analyze', files, revisedJson),

  diff: (files: EpicFiles) => post<DiffResponse>('/api/epic-import/diff', files),
}

export function severityOf(findings: Finding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
  }
}

export function downloadText(text: string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
