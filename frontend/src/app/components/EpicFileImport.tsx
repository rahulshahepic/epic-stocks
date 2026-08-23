import { useState } from 'react'
import { epicImport, type ApplyResponse, type PreviewResponse } from '../epicImport.ts'
import FindingList from './FindingList.tsx'

type Stage = 'idle' | 'previewing' | 'preview' | 'applying' | 'done' | 'error'

/**
 * Import from the two files Epic already gives you: the share summary CSV and
 * the Stock Loan Statement PDF. Preview first — nothing is written until you
 * confirm, and confirming merges rather than replaces.
 */
export default function EpicFileImport() {
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [result, setResult] = useState<ApplyResponse | null>(null)
  const [error, setError] = useState('')
  const [adoptSchedule, setAdoptSchedule] = useState(false)
  const [overwritePrices, setOverwritePrices] = useState(false)

  const files = { shareCsv: csv, statementPdf: pdf }
  const ready = !!csv || !!pdf
  const busy = stage === 'previewing' || stage === 'applying'

  function reset() {
    setPreview(null)
    setResult(null)
    setError('')
    setStage('idle')
  }

  async function runPreview() {
    setStage('previewing')
    setError('')
    try {
      setPreview(await epicImport.preview(files))
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
      setStage('error')
    }
  }

  async function runApply() {
    setStage('applying')
    setError('')
    try {
      setResult(await epicImport.apply(files, { adoptSchedule, overwritePrices }))
      setStage('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStage('error')
    }
  }

  const plan = preview?.plan
  const errorCount = preview?.proposal.findings.filter(f => f.severity === 'error').length ?? 0

  return (
    <div className="flex flex-col rounded-lg border-2 border-cs-border bg-cs-surface p-4">
      <span className="text-sm font-semibold text-cs-text">Import from Epic&rsquo;s files</span>
      <span className="mt-1 text-xs text-cs-muted">
        Upload the share summary CSV and the Stock Loan Statement PDF exactly as Epic
        sends them. Share counts, cost basis, loan balances and interest rates are read
        straight out of them — no retyping.
      </span>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="epic-csv" className="text-xs font-medium text-cs-text-2">
            Share summary (.csv)
          </label>
          <input
            id="epic-csv"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={e => { setCsv(e.target.files?.[0] ?? null); reset() }}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>
        <div>
          <label htmlFor="epic-pdf" className="text-xs font-medium text-cs-text-2">
            Stock Loan Statement (.pdf)
          </label>
          <input
            id="epic-pdf"
            type="file"
            accept=".pdf,application/pdf"
            disabled={busy}
            onChange={e => { setPdf(e.target.files?.[0] ?? null); reset() }}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>

        <button
          type="button"
          onClick={runPreview}
          disabled={!ready || busy}
          className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {stage === 'previewing' ? 'Reading files…' : 'Preview'}
        </button>
      </div>

      {(stage === 'preview' || stage === 'applying') && preview && plan && (
        <div className="mt-4 border-t border-cs-border pt-3">
          <p className="text-xs font-semibold text-cs-text">
            Statement dated {preview.proposal.statement_date ?? 'unknown'}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-cs-text-2 sm:grid-cols-3">
            <div><dt className="inline text-cs-muted">Grants </dt>
              <dd className="inline font-medium">{plan.grants_created.length} new, {plan.grants_updated} updated</dd></div>
            <div><dt className="inline text-cs-muted">Loans </dt>
              <dd className="inline font-medium">{plan.loans_created.length} new, {plan.loans_updated} updated</dd></div>
            <div><dt className="inline text-cs-muted">Prices </dt>
              <dd className="inline font-medium">{plan.prices_created.length} new</dd></div>
          </dl>

          {plan.loans_not_on_statement.length > 0 && (
            <p className="mt-2 text-xs text-cs-muted">
              {plan.loans_not_on_statement.length} loan(s) in your data are not on this
              statement — paid off or refinanced. They are kept, not deleted.
            </p>
          )}

          <FindingList findings={preview.proposal.findings} />

          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2 text-xs text-cs-text-2">
              <input type="checkbox" checked={adoptSchedule}
                     onChange={e => setAdoptSchedule(e.target.checked)}
                     className="mt-0.5 rounded border-cs-border-strong" />
              <span>
                <span className="font-medium">Also update vesting schedules</span>
                <br />
                <span className="text-cs-muted">
                  Off by default — the statement carries no vest dates, so your own
                  schedule is kept. Turn on only if the derived schedule looks right.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-cs-text-2">
              <input type="checkbox" checked={overwritePrices}
                     onChange={e => setOverwritePrices(e.target.checked)}
                     className="mt-0.5 rounded border-cs-border-strong" />
              <span>
                <span className="font-medium">Overwrite share prices you already entered</span>
                <br />
                <span className="text-cs-muted">Off by default — new years are added either way.</span>
              </span>
            </label>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={runApply}
              disabled={busy || errorCount > 0}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
            >
              {stage === 'applying' ? 'Importing…' : 'Import'}
            </button>
            <button type="button" onClick={reset}
                    className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-gray-300">
              Cancel
            </button>
          </div>
          {errorCount > 0 && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              Fix the {errorCount} error(s) above before importing — the files did not add up.
            </p>
          )}
        </div>
      )}

      {stage === 'done' && result && (
        <div className="mt-3 rounded-md bg-green-50 p-3 dark:bg-green-900/30">
          <p className="text-xs font-medium text-green-800 dark:text-green-300">
            Imported: {result.grants_created} grants added, {result.grants_updated} updated ·{' '}
            {result.loans_created} loans added, {result.loans_updated} updated ·{' '}
            {result.prices_created} prices added
          </p>
        </div>
      )}

      {stage === 'error' && error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 dark:bg-red-900/30">
          <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  )
}
