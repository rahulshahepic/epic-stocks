import { useReportProblem } from '../../scaffold/components/reportContext.ts'
import type { Finding } from '../epicImport.ts'
import { summariseFindings } from './findingSummary.ts'

const TONE: Record<string, string> = {
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
  warning: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'border-cs-border bg-cs-raised text-cs-text-2',
}

/** Findings the importer raised while reading the files. */
export default function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null
  const order = { error: 0, warning: 1, info: 2 } as const
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity])

  return (
    <ul className="mt-3 space-y-2">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${f.subject}-${i}`}
          className={`rounded-md border p-2 text-xs ${TONE[f.severity]}`}>
          <span className="font-mono font-semibold">{f.code}</span>
          {f.subject && <span className="ml-2 font-medium">{f.subject}</span>}
          <p className="mt-1 leading-relaxed">{f.message}</p>
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
}: {
  findings: Finding[]
  blocked?: boolean
  className?: string
}) {
  const { openReport } = useReportProblem()
  return (
    <button
      type="button"
      onClick={() => openReport({
        source: 'import',
        errorMessage: summariseFindings(findings, blocked),
        message: 'The import got this wrong: ',
      })}
      className={`text-xs font-medium text-cs-brand underline underline-offset-2 hover:text-cs-brand-hover ${className}`}
    >
      Report this import problem
    </button>
  )
}
