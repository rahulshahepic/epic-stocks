import MeasurementChoice from '../../scaffold/components/MeasurementChoice.tsx'
import StockFiles from './StockFiles.tsx'
import { claimMeasurement, measurementEvent } from '../../scaffold/onboarding.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import ImportEvidence from './ImportEvidence.tsx'
import EurekaFileGuide from './EurekaFileGuide.tsx'
import ChangeList from './ChangeList.tsx'
import type { Change } from '../../api.ts'
import FindingList, { ReportFindingsButton } from './FindingList.tsx'
import { ReportableError } from '../../scaffold/components/ReportProblem.tsx'
import StalePriceNotice from './StalePriceNotice.tsx'
import { downloadText, epicImport, severityOf, type AnalyzeResponse } from '../epicImport.ts'
import { fmt$, fmtFullDate, fmtPrice } from '../format.ts'
import { platform } from '../../platform/index.ts'

type Stage = 'idle' | 'analyzing' | 'result'

function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-cs-muted">{label}</dt>
      <dd className="text-sm font-semibold text-cs-text">{value}{caption && <span className="mt-1 block text-xs font-normal text-cs-text-2">{caption}</span>}</dd>
    </div>
  )
}

/**
 * Import from the two files Epic already sends you.
 *
 * The app parses them and checks the result against arithmetic the documents
 * assert about themselves. When that does not add up it hands you a prompt to
 * paste into whichever assistant you already use, and checks whatever comes
 * back the same way. What it would change is listed on one screen: untick
 * anything you do not want, check, and save.
 */
export default function EpicFileImport({ allowAssistant = false, onApplied }: { allowAssistant?: boolean; onApplied?: () => void }) {
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [replacing, setReplacing] = useState(false)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const uploadHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (stage === 'result' && result) void measurementEvent('preview_viewed', result.measurementSequence).then(claimMeasurement)
  }, [stage, result])
  useEffect(() => {
    if (stage === 'result' && !replacing) {
      reviewHeading.current?.focus()
    } else if (replacing) {
      uploadHeading.current?.focus()
    }
  }, [stage, replacing])
  const [repair, setRepair] = useState<{ json?: string; file?: File | null }>({})
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [repricing, setRepricing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [pricedAt, setPricedAt] = useState<number | null>(null)
  const [answers, setAnswers] = useState<Record<number, { date: string; price: string }>>({})

  const answered: Change[] = useMemo(() => (result?.unanswered_sales ?? []).flatMap((s, i) => {
    const a = answers[i]
    const price = Number(a?.price)
    return a?.date && price > 0
      ? [{ kind: 'sale' as const, action: 'create' as const, label: `Sale on ${a.date}`,
        values: { date: a.date, shares: s.shares, price_per_share: price, notes: s.notes } }]
      : []
  }), [result, answers])

  const files = { shareCsv: csv, statementPdf: pdf }
  const busy = stage === 'analyzing' || repricing || checking

  async function run(revisedJson?: string, revisedDraft?: File | null) {
    setStage('analyzing')
    setError('')
    try {
      setResult(await epicImport.analyze({ ...files, revisedDraft }, revisedJson,
        pricedAt ?? undefined))
      setRepair({ json: revisedJson, file: revisedDraft })
      setStage('result')
      setReplacing(false)
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
      setResult(await epicImport.analyze({ ...files, revisedDraft: repair.file }, repair.json, price))
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

  const draftPrices = (result?.draft?.prices as { effective_date: string; price: number }[] | undefined) ?? []
  const newest = draftPrices.length ? draftPrices[draftPrices.length - 1] : null
  const latestPrice = newest?.price ?? 0
  const latestDate = newest?.effective_date ?? ''

  const counts = result ? severityOf(result.findings) : { errors: 0, warnings: 0 }
  const needsHelp = !!result && (result.blocked || counts.errors > 0)
  const reviewing = stage === 'result' && !!result && !replacing
  const statementDate = typeof result?.draft.statement_date === 'string' ? result.draft.statement_date : null
  const staleStatement = result?.reconciliation?.some(check => check.status === 'stale')
  const hasStatement = !!pdf || statementDate != null || (result?.summary.loans ?? 0) > 0

  return (
    <div className="flex flex-col rounded-lg border-2 border-cs-border bg-cs-surface p-4">
      <div hidden={reviewing}>
        <h2 ref={uploadHeading} tabIndex={-1} className="scroll-mt-28 text-base font-semibold text-cs-text">Import from Eureka</h2>
        <div className="mt-2"><EurekaFileGuide allowAssistant={allowAssistant} /></div>
        <span className="mt-2 text-xs text-cs-muted">
          Vesting dates start from the company grant schedule; you can change any
          of them afterwards on the Grants page.
        </span>

        <div className="mt-3 space-y-3">
          <StockFiles csv={csv} pdf={pdf} disabled={busy} onFiles={({workbook, statement}) => {
            if (workbook) setCsv(workbook)
            if (statement) setPdf(statement)
            setResult(null); setStage('idle'); setPricedAt(null); setAnswers({})
          }} />
          <details><summary className="cursor-pointer py-2 text-xs text-cs-text-2">Choose or replace files separately</summary>
            <div>
              <label htmlFor="epic-csv" className="text-xs font-medium text-cs-text-2">
                Data for Stock Workbook (.csv or .xlsx)
              </label>
              <input
                id="epic-csv" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy}
                onChange={e => { setCsv(e.target.files?.[0] ?? null); setResult(null); setStage('idle'); setPricedAt(null); setAnswers({}) }}
                className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
              />
            </div>
            <div>
              <label htmlFor="epic-pdf" className="text-xs font-medium text-cs-text-2">
                Stock Loan Statement (.pdf)
              </label>
              <input
                id="epic-pdf" type="file" accept=".pdf,application/pdf" disabled={busy}
                onChange={e => { setPdf(e.target.files?.[0] ?? null); setResult(null); setStage('idle'); setPricedAt(null); setAnswers({}) }}
                className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
              />
            </div>
          </details>
          <button
            type="button" onClick={() => run()} disabled={(!csv && !pdf) || busy}
            className="min-h-11 rounded-lg bg-cs-brand px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Reading…' : 'Read my files'}
          </button>
          {replacing && result && stage !== 'analyzing' && <button type="button" onClick={() => setReplacing(false)} className="ml-3 min-h-11 text-sm text-cs-text underline">Back to review</button>}
        </div>

        <MeasurementChoice />
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

      {result && (
        <div hidden={!reviewing} className="space-y-3">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 ref={reviewHeading} tabIndex={-1} className="scroll-mt-28 font-serif text-xl font-semibold text-cs-text">What we found</h2>
              <p className="mt-1 text-sm text-cs-text">{result.summary.grants} {result.summary.grants === 1 ? 'grant' : 'grants'}{hasStatement ? ` and ${result.summary.loans} ${result.summary.loans === 1 ? 'loan' : 'loans'}` : ''}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => setReplacing(true)} className="min-h-11 px-1 text-sm font-semibold text-cs-brand underline disabled:opacity-50">Replace files</button>
          </header>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-cs-raised p-3">
            <Stat label="Shares in files" value={result.summary.total_shares.toLocaleString()} />
            <Stat label="Loan principal in files" value={hasStatement && !result.blocked ? fmt$(result.summary.total_loan_balance) : 'Unavailable'}
              caption={statementDate ? `Statement from ${fmtFullDate(statementDate)}${staleStatement ? ' · out of date' : ''}` : hasStatement ? 'Statement date unavailable' : 'No statement uploaded'} />
          </dl>

          <p className={`mt-3 text-xs font-medium ${
            result.blocked ? 'text-red-600 dark:text-red-400'
              : counts.errors > 0 ? 'text-amber-700 dark:text-amber-400'
                : 'text-green-700 dark:text-green-400'}`}>
            {result.blocked
              ? 'The statement does not add up to its own totals — some of it was misread.'
              : counts.errors > 0
                ? `${counts.errors} figure(s) do not agree between your two files.`
                : result.changes.length || answered.length
                  ? 'You can preview these changes. Review anything that needs your input before saving.'
                  : 'No changes to preview.'}
          </p>

          {result.price_is_stale && pricedAt == null && <p className="text-sm text-cs-text-2">
            Share price in the files: {latestDate ? `${fmtPrice(latestPrice)} from ${fmtFullDate(latestDate)}` : 'unavailable'}. You can add this year’s announced price below.
          </p>}
          {!result.blocked && result.unanswered_sales.length > 0 && <p className="text-sm text-cs-text-2">
            <a href="#import-unmatched-shares" className="font-semibold text-cs-brand underline">Review shares that left a grant</a> if you know they were sold.
          </p>}
          {!result.blocked && (
            <>
              {repricing && <p role="status" className="text-sm text-cs-text-2">Updating the review with your price…</p>}
              <div hidden={repricing}>
                <ChangeList changes={result.changes} extra={answered} onApplied={onApplied} onBusyChange={setChecking} disabled={repricing} />
              </div>
            </>
          )}

          <FindingList findings={result.findings} grouped collapseAll={!result.blocked && counts.errors === 0 && !result.changes.length && !answered.length} />
          {!!result.reconciliation?.length && <details className="mt-3 rounded-md border border-cs-border p-3">
            <summary className="min-h-7 cursor-pointer text-xs font-semibold text-cs-text">What the files could verify</summary>
            {typeof result.draft.statement_date === 'string' && <p className="my-2 text-xs text-cs-text-2">Statement dated {result.draft.statement_date}.</p>}
            <ImportEvidence evidence={result.reconciliation} />
          </details>}

          {(result.blocked || counts.errors > 0 || counts.warnings > 0) && (
            <p className="mt-2">
              <ReportFindingsButton findings={result.findings} blocked={result.blocked} />
            </p>
          )}

          {result.price_is_stale && pricedAt == null && (
            <div className="mt-3">
              <StalePriceNotice
                latestPrice={latestPrice} latestDate={latestDate}
                onApply={applyCurrentPrice} busy={busy}
              />
            </div>
          )}
          {pricedAt != null && (
            <p className="mt-3 text-xs text-cs-muted">
              Includes the {pricedAt.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })} you
              entered for today — it saves with the rest.
            </p>
          )}

          {!result.blocked && result.unanswered_sales.length > 0 && (
            <div id="import-unmatched-shares" className="mt-3 scroll-mt-28 rounded-md border border-cs-border p-2.5">
              <p className="text-xs font-semibold text-cs-text">Shares that left a grant</p>
              <p className="mt-1 text-xs text-cs-muted">
                Your files show these shares gone but not when or for how much. Fill in a
                sale only if it was one. You can leave it blank and record it later.
              </p>
              {result.unanswered_sales.map((sale, i) => (
                <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_1fr] items-end gap-2 text-xs">
                  <span className="text-cs-text">{sale.shares.toLocaleString()} shares</span>
                  <label className="text-cs-muted">Date
                    <input type="date" disabled={busy} value={answers[i]?.date ?? ''}
                      onChange={e => setAnswers(a => ({ ...a, [i]: { date: e.target.value, price: a[i]?.price ?? '' } }))}
                      className="mt-0.5 block w-full rounded border border-cs-border bg-cs-surface px-1.5 py-1 text-cs-text" />
                  </label>
                  <label className="text-cs-muted">Price per share
                    <input type="number" disabled={busy} min="0" step="0.01" value={answers[i]?.price ?? ''}
                      onChange={e => setAnswers(a => ({ ...a, [i]: { date: a[i]?.date ?? '', price: e.target.value } }))}
                      className="mt-0.5 block w-full rounded border border-cs-border bg-cs-surface px-1.5 py-1 text-cs-text" />
                  </label>
                </div>
              ))}
            </div>
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
