import { useReportProblem, type ReportPrefill } from '../../scaffold/components/reportContext.ts'
import type { Finding } from '../epicImport.ts'
import { summariseFindings } from './findingSummary.ts'

const TONE: Record<string, string> = {
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
  warning: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'border-cs-border bg-cs-raised text-cs-text-2',
}

/** Findings the importer raised while reading the files. */
export default function FindingList({ findings, grouped = false, collapseAll = false }: { findings: Finding[]; grouped?: boolean; collapseAll?: boolean }) {
  if (findings.length === 0) return null
  if (grouped) {
    const needsYou = findings.filter(f => f.severity === 'error' || ['G1', 'G2', 'C12'].includes(f.code))
    const fyi = findings.filter(f => !needsYou.includes(f))
    const groups = <>
      {needsYou.length > 0 && <section className="mt-3"><h3 className="text-sm font-semibold text-cs-text">Needs you</h3><FindingList findings={needsYou} /></section>}
      {fyi.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-cs-text-2">FYI · {fyi.length} check{fyi.length === 1 ? '' : 's'}</summary><FindingList findings={fyi} /></details>}
    </>
    return collapseAll ? <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-cs-text-2">Import checks · {findings.length}</summary>{groups}</details> : groups
  }
  const order = { error: 0, warning: 1, info: 2 } as const
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity])

  return (
    <ul className="mt-3 space-y-2">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${f.subject}-${i}`}
          className={`rounded-md border p-2 text-xs ${TONE[f.severity]}`}>
          <span className="font-mono text-[10px] text-cs-muted">{f.code}</span>
          {f.subject && <span className="ml-2 font-medium">{f.subject}</span>}
          <p className="mt-1 leading-relaxed">{f.code === 'S1' && f.severity !== 'error' ? `Review the vesting dates against your grant agreement on the Grants page after saving.`
            : f.code === 'C9' ? `The loan rate differs from the company schedule; check it against your statement.`
              : f.code === 'G3' ? `Cost per share was calculated from the file's total cost.`
                : f.message}</p>
          {['S1', 'C9', 'G3'].includes(f.code) && !(f.code === 'S1' && f.severity === 'error') && <details className="mt-1"><summary className="cursor-pointer text-[11px]">Check details</summary><p className="mt-1">{f.message}</p></details>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Offered wherever an import comes back wrong. An import that misreads a file is
 * the failure most worth hearing about — it is invisible in the server logs,
 * because nothing threw.
 */
export function ReportFindingsButton({
  findings,
  blocked = false,
  className = '',
  documents,
  workflow,
}: {
  findings: Finding[]
  blocked?: boolean
  className?: string
  documents?: ReportPrefill['documents']
  workflow?: string
}) {
  const { openReport } = useReportProblem()
  return (
    <button
      type="button"
      onClick={() => openReport({
        source: 'import',
        publicSafeSummary: summariseFindings(findings, blocked),
        documents,
        workflow: [workflow, 'Import findings', ...findings.slice(0, 20).map(
          finding => `${finding.code} (${finding.severity}) ${finding.subject ?? ''} ${finding.message}`,
        )].filter(Boolean).join('\n'),
        message: 'The import got this wrong: ',
      })}
      className={`text-xs font-medium text-cs-brand underline underline-offset-2 hover:text-cs-brand-hover ${className}`}
    >
      Report this import problem
    </button>
  )
}
