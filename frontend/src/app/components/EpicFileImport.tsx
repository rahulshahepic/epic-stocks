import { useState } from 'react'
import ImportWizard from './ImportWizard.tsx'
import FindingList, { ReportFindingsButton } from './FindingList.tsx'
import { ReportableError } from '../../scaffold/components/ReportProblem.tsx'
import StalePriceNotice from './StalePriceNotice.tsx'
import { downloadText, epicImport, severityOf, type AnalyzeResponse } from '../epicImport.ts'
import { platform } from '../../platform/index.ts'

type Stage = 'idle' | 'analyzing' | 'result' | 'review'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-cs-muted">{label}</dt>
      <dd className="text-sm font-semibold text-cs-text">{value}</dd>
    </div>
  )
}

/**
 * Import from the two files Epic already sends you.
 *
 * The app parses them and checks the result against arithmetic the documents
 * assert about themselves. When that does not add up it hands you a prompt to
 * paste into whichever assistant you already use, and checks whatever comes
 * back the same way. You never sign off on a file — you sign off in the wizard,
 * looking at your own position.
 */
export default function EpicFileImport() {
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [repricing, setRepricing] = useState(false)
  const [pricedAt, setPricedAt] = useState<number | null>(null)

  const files = { shareCsv: csv, statementPdf: pdf }
  const busy = stage === 'analyzing'

  async function run(revisedJson?: string, revisedDraft?: File | null) {
    setStage('analyzing')
    setError('')
    try {
      setResult(await epicImport.analyze({ ...files, revisedDraft }, revisedJson,
                                         pricedAt ?? undefined))
      setStage('result')
      setPasted('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those files')
      setStage(result ? 'result' : 'idle')
    }
  }

  /** Re-read the same files with today's price folded in as a price point. */
  async function applyCurrentPrice(price: number) {
    setRepricing(true)
    try {
      setResult(await epicImport.analyze(files, undefined, price))
      setPricedAt(price)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that price')
    } finally {
      setRepricing(false)
    }
  }

  async function copyPrompt() {
    if (!result) return
    try {
      if (!await platform.files.copyText(result.prompt)) {
        throw new Error('clipboard unavailable')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not reach the clipboard — use Download instead.')
    }
  }

  if (stage === 'review' && result) {
    return (
      <div className="rounded-lg border-2 border-cs-border bg-cs-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-cs-text">Review your import</p>
          <button
            type="button"
            onClick={() => setStage('result')}
            className="rounded-md bg-gray-200 px-3 py-1 text-xs font-medium text-cs-text-2 hover:bg-gray-300"
          >
            Back
          </button>
        </div>
        <p className="mb-3 text-xs text-cs-muted">
          Nothing has been saved yet. Step through and check the numbers are yours —
          finishing the wizard is what writes them.
        </p>
        <ImportWizard prefill={result.wizard_prefill} />
      </div>
    )
  }

  const draftPrices = (result?.draft?.prices as { effective_date: string; price: number }[] | undefined) ?? []
  const newest = draftPrices.length ? draftPrices[draftPrices.length - 1] : null
  const latestPrice = newest?.price ?? 0
  const latestDate = newest?.effective_date ?? ''

  const counts = result ? severityOf(result.findings) : { errors: 0, warnings: 0 }
  const needsHelp = !!result && (result.blocked || counts.errors > 0)

  return (
    <div className="flex flex-col rounded-lg border-2 border-cs-border bg-cs-surface p-4">
      <span className="text-sm font-semibold text-cs-text">Import from Shareworks</span>
      <span className="mt-1 text-xs text-cs-muted">
        In Shareworks, open the <strong>Documents</strong> tab and download two files:
        your latest <strong>Stock Loan Statement</strong> and{' '}
        <strong>Data for Stock Workbook</strong>. Upload them here exactly as they
        download &mdash; no editing needed.
      </span>
      <span className="mt-2 text-xs text-cs-muted">
        Vesting schedules come from the company grant schedule, so only your own
        figures are read from the files.
      </span>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="epic-csv" className="text-xs font-medium text-cs-text-2">
            Data for Stock Workbook (.csv)
          </label>
          <input
            id="epic-csv" type="file" accept=".csv,text/csv" disabled={busy}
            onChange={e => { setCsv(e.target.files?.[0] ?? null); setResult(null); setStage('idle') }}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>
        <div>
          <label htmlFor="epic-pdf" className="text-xs font-medium text-cs-text-2">
            Stock Loan Statement (.pdf)
          </label>
          <input
            id="epic-pdf" type="file" accept=".pdf,application/pdf" disabled={busy}
            onChange={e => { setPdf(e.target.files?.[0] ?? null); setResult(null); setStage('idle') }}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>
        <button
          type="button" onClick={() => run()} disabled={(!csv && !pdf) || busy}
          className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Reading…' : result ? 'Read again' : 'Read my files'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 dark:bg-red-900/30">
          <ReportableError
            message={error}
            source="import"
            className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400"
          />
        </div>
      )}

      {stage === 'result' && result && (
        <div className="mt-4 border-t border-cs-border pt-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Stat label="Grants" value={String(result.summary.grants)} />
            <Stat label="Loans" value={String(result.summary.loans)} />
            <Stat label="Total shares" value={result.summary.total_shares.toLocaleString()} />
            <Stat
              label="Loan balance"
              value={result.summary.total_loan_balance.toLocaleString(undefined, {
                style: 'currency', currency: 'USD', maximumFractionDigits: 0,
              })}
            />
          </dl>

          <p className={`mt-3 text-xs font-medium ${
            result.blocked ? 'text-red-600 dark:text-red-400'
              : counts.errors > 0 ? 'text-amber-700 dark:text-amber-400'
              : 'text-green-700 dark:text-green-400'}`}>
            {result.blocked
              ? 'The statement does not add up to its own totals — some of it was misread.'
              : counts.errors > 0
                ? `${counts.errors} figure(s) do not agree between your two files.`
                : 'Everything reconciles against the totals in your own paperwork.'}
          </p>

          <FindingList findings={result.findings} />

          {(result.blocked || counts.errors > 0 || counts.warnings > 0) && (
            <p className="mt-2">
              <ReportFindingsButton findings={result.findings} blocked={result.blocked} />
            </p>
          )}

          {result.price_is_stale && pricedAt == null && (
            <div className="mt-3">
              <StalePriceNotice
                latestPrice={latestPrice} latestDate={latestDate}
                onApply={applyCurrentPrice} busy={repricing}
              />
            </div>
          )}
          {pricedAt != null && (
            <p className="mt-3 text-xs text-cs-muted">
              Includes the {pricedAt.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })} you
              entered for today — it saves with the rest when you finish the wizard.
            </p>
          )}

          {!result.blocked && (
            <button
              type="button" onClick={() => setStage('review')}
              className="mt-3 rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              {counts.errors > 0 ? 'Review anyway' : 'Review and finish'}
            </button>
          )}

          {needsHelp && (
            <div className="mt-4 rounded-md border border-cs-border bg-cs-raised p-3">
              <p className="text-xs font-semibold text-cs-text">Get help fixing this</p>
              <p className="mt-1 text-xs text-cs-muted">
                Copy the text below into ChatGPT, Claude, or whichever assistant you use,
                and attach your CSV and PDF. It contains the draft so far, exactly what
                did not add up, and the format to reply in. Paste the reply back here and
                we will check it the same way. Repeat until it comes back clean.
              </p>
              <p className="mt-1 text-[11px] text-cs-muted">
                Your figures go to whichever assistant you choose — this app does not send
                them anywhere.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button" onClick={copyPrompt}
                  className="rounded-md bg-rose-50 px-3 py-1.5 text-xs font-medium text-cs-brand hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300"
                >
                  {copied ? 'Copied' : 'Copy prompt'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadText(result.prompt, 'epic-import-prompt.md', 'text/markdown')}
                  className="rounded-md bg-cs-raised px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700"
                >
                  Download
                </button>
              </div>

              <label htmlFor="epic-paste" className="mt-3 block text-xs font-medium text-cs-text-2">
                Paste the reply
              </label>
              <textarea
                id="epic-paste" rows={4} value={pasted} disabled={busy}
                onChange={e => setPasted(e.target.value)}
                placeholder="Paste the whole JSON object the assistant produced, starting at {"
                className="mt-1 w-full rounded-md border border-cs-border bg-cs-surface p-2 font-mono text-[11px] text-cs-text placeholder:text-cs-muted disabled:opacity-50"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button" onClick={() => run(pasted)} disabled={!pasted.trim() || busy}
                  className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? 'Checking…' : 'Check this'}
                </button>
                <span className="text-xs text-cs-muted">or</span>
                <label htmlFor="epic-revised" className="sr-only">Upload the reply as a file</label>
                <input
                  id="epic-revised" type="file" accept=".json,.xlsx" disabled={busy}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) run(undefined, f)
                  }}
                  className="block text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-cs-raised file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-text-2 disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
