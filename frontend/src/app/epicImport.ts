/** Client for the Epic statement importer (/api/epic-import). */

export interface Finding {
  code: string
  severity: 'error' | 'warning' | 'info'
  subject: string
  message: string
}

export interface ProposedGrant {
  year: number
  type: string
  shares: number
  price: number
  vest_start: string
  periods: number
  exercise_date: string
  dp_shares: number
  election_83b: boolean
  source_label: string
  rules: Record<string, string>
  uncertain: string[]
}

export interface ProposedLoan {
  loan_number: string
  grant_year: number
  grant_type: string
  loan_type: string
  loan_year: number
  amount: number
  interest_rate: number
  due_date: string
  source_name: string
  rules: Record<string, string>
  uncertain: string[]
}

export interface ProposedPrice {
  effective_date: string
  price: number
  rules: Record<string, string>
  uncertain: string[]
}

export interface Proposal {
  statement_date: string | null
  conventions: Record<string, number>
  grants: ProposedGrant[]
  loans: ProposedLoan[]
  prices: ProposedPrice[]
  findings: Finding[]
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
  conventions: Record<string, number>
  counts: Record<string, number>
  errors: number
  warnings: number
}

export interface ImportPlan {
  grants_created: string[]
  grants_updated: number
  loans_created: string[]
  loans_updated: number
  prices_created: string[]
  loans_not_on_statement: string[]
}

export interface PreviewResponse {
  proposal: Proposal
  plan: ImportPlan
  report: ReconcileReport
}

export interface ApplyResponse {
  grants_created: number
  grants_updated: number
  loans_created: number
  loans_updated: number
  prices_created: number
  loans_not_on_statement: string[]
  findings: Finding[]
}

export interface DiffResponse {
  proposal: Proposal
  report: ReconcileReport
  report_with_defaults: ReconcileReport
  markdown: string
}

export interface EpicFiles {
  shareCsv?: File | null
  statementPdf?: File | null
  exportXlsx?: File | null
}

function body({ shareCsv, statementPdf, exportXlsx }: EpicFiles): FormData {
  const form = new FormData()
  if (exportXlsx) form.append('export_xlsx', exportXlsx)
  if (shareCsv) form.append('share_csv', shareCsv)
  if (statementPdf) form.append('statement_pdf', statementPdf)
  return form
}

async function post<T>(path: string, files: EpicFiles): Promise<T> {
  const resp = await fetch(path, { method: 'POST', credentials: 'include', body: body(files) })
  if (!resp.ok) {
    const parsed = await resp.json().catch(() => null)
    throw new Error(parsed?.detail || `Request failed (${resp.status})`)
  }
  return resp.json() as Promise<T>
}

export const epicImport = {
  preview: (files: EpicFiles) => post<PreviewResponse>('/api/epic-import/preview', files),

  apply: (files: EpicFiles, opts: { adoptSchedule?: boolean; overwritePrices?: boolean } = {}) => {
    const q = new URLSearchParams({
      adopt_schedule: String(!!opts.adoptSchedule),
      overwrite_prices: String(!!opts.overwritePrices),
    })
    return post<ApplyResponse>(`/api/epic-import/apply?${q}`, files)
  },

  diff: (files: EpicFiles) => post<DiffResponse>('/api/epic-import/diff', files),
}

/** Save the reconciliation report as a Markdown file. */
export function downloadMarkdown(markdown: string, statementDate: string | null) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `import-diff-${statementDate || 'report'}.md`
  a.click()
  URL.revokeObjectURL(url)
}
