import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe } from '../../scaffold/hooks/useMe.ts'
import { downloadText, epicImport, type DiffResponse, type Difference }
  from '../epicImport.ts'
import FindingList from '../components/FindingList.tsx'

const SEVERITY_TONE: Record<string, string> = {
  error: 'text-red-700 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-cs-muted',
}

function DiffTable({ differences }: { differences: Difference[] }) {
  if (differences.length === 0) {
    return (
      <p className="mt-3 rounded-md bg-green-50 p-3 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300">
        No differences — the importer reproduces your data exactly.
      </p>
    )
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-xs">
        <thead className="text-cs-muted">
          <tr className="border-b border-cs-border">
            <th className="py-1 pr-3 font-medium">Rule</th>
            <th className="py-1 pr-3 font-medium">What</th>
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Imported</th>
            <th className="py-1 pr-3 font-medium">Yours</th>
            <th className="py-1 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {differences.map((d, i) => (
            <tr key={`${d.entity}-${d.key}-${d.field}-${i}`}
                className="border-b border-cs-border/50 align-top">
              <td className={`py-1 pr-3 font-mono font-semibold ${SEVERITY_TONE[d.severity]}`}>
                {d.rule}
              </td>
              <td className="py-1 pr-3 text-cs-text-2">{d.entity} {d.key}</td>
              <td className="py-1 pr-3 font-mono text-cs-text-2">{d.field || '—'}</td>
              <td className="py-1 pr-3 font-mono text-cs-text">{d.imported}</td>
              <td className="py-1 pr-3 font-mono text-cs-text">{d.existing}</td>
              <td className="py-1 text-cs-muted">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The correction loop for the Epic importer.
 *
 * Export your data from the app, then upload it here alongside the Epic files it
 * should have been built from. The importer runs against the files and every
 * difference is listed with the id of the rule that produced it — hand the
 * report back and the rule gets fixed. Nothing here writes to your data.
 */
export default function ImportDiagnostics() {
  const me = useMe()
  const [exportFile, setExportFile] = useState<File | null>(null)
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DiffResponse | null>(null)
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  if (!me) return null
  if (!me.is_admin) return <Navigate to="/" replace />

  const ready = !!exportFile && (!!csv || !!pdf)

  async function run() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await epicImport.diff({
        exportXlsx: exportFile, shareCsv: csv, statementPdf: pdf,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed')
    } finally {
      setBusy(false)
    }
  }

  const report = result?.report
  const statementDate = (result?.draft?.statement_date as string | null) ?? null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-cs-text">Import diagnostics</h2>
        <p className="mt-1 text-xs text-cs-muted">
          Checks the importer against real data. Export your data from
          Import&nbsp;/&nbsp;Export, then upload it here with the Shareworks files from
          the same date. Every difference names the rule that produced it, so the
          report can be handed back as a bug report. Nothing on this page writes
          anything.
        </p>
      </div>

      <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">
        <div className="space-y-3">
          {([
            ['diag-export', 'Your export (Vesting.xlsx)', '.xlsx', setExportFile],
            ['diag-csv', 'Data for Stock Workbook (.csv)', '.csv,text/csv', setCsv],
            ['diag-pdf', 'Stock Loan Statement (.pdf)', '.pdf,application/pdf', setPdf],
          ] as const).map(([id, label, accept, setter]) => (
            <div key={id}>
              <label htmlFor={id} className="text-xs font-medium text-cs-text-2">{label}</label>
              <input
                id={id}
                type="file"
                accept={accept}
                disabled={busy}
                onChange={e => setter(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!ready || busy}
          className="mt-3 rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Comparing…' : 'Compare'}
        </button>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 p-3 dark:bg-red-900/30">
            <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {result && report && (
        <>
          <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-cs-text">
                {report.errors} error · {report.warnings} warning ·{' '}
                {report.differences.length - report.errors - report.warnings} info
              </p>
              <button
                type="button"
                onClick={() => downloadText(
                  result.markdown, `import-diff-${statementDate ?? 'report'}.md`, 'text/markdown')}
                className="rounded-md bg-cs-raised px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                Download report (.md)
              </button>
            </div>
            <p className="mt-1 text-xs text-cs-muted">
              Statement dated {statementDate ?? 'unknown'} ·{' '}
              {report.counts.imported_grants} grants / {report.counts.imported_loans} loans /{' '}
              {report.counts.imported_prices} prices derived, against{' '}
              {report.counts.existing_grants} / {report.counts.existing_loans} /{' '}
              {report.counts.existing_prices} in the export.
            </p>
            <DiffTable differences={report.differences} />
          </div>

          <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">
            <p className="text-sm font-semibold text-cs-text">What the files themselves said</p>
            <FindingList findings={result.findings} />
            {result.findings.length === 0 && (
              <p className="mt-2 text-xs text-cs-muted">Nothing to report — every cross-check passed.</p>
            )}
          </div>

          <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">
            <button
              type="button"
              onClick={() => setShowRaw(v => !v)}
              className="text-xs font-medium text-cs-brand hover:underline"
            >
              {showRaw ? 'Hide' : 'Show'} the raw report
            </button>
            {showRaw && (
              <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-cs-raised p-3 text-[11px] leading-relaxed text-cs-text-2">
                {result.markdown}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}
