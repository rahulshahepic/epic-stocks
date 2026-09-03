import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { trialAnalyze, stashTrialPayload, type TrialAnalyzeResponse } from '../trialImport.ts'
import FindingList from '../components/FindingList.tsx'
import { useAppContext } from '../../scaffold/contexts/AppContext.tsx'
import DisclaimerNotice from '../../scaffold/components/DisclaimerNotice.tsx'
import UnofficialBadge from '../../scaffold/components/UnofficialBadge.tsx'
import { Card, Eyebrow, IconTile } from '../../scaffold/components/ui/Card.tsx'
import { IconBell, IconMountainFlag, IconPieChart, IconShield } from '../../scaffold/components/ui/icons.tsx'

type Stage = 'upload' | 'analyzing' | 'result'

const TYPE_COLORS: Record<string, string> = {
  'Exercise': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Down payment exchange': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Vesting': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Share Price': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Loan Payoff': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const SAVE_REASONS = [
  {
    icon: <IconBell />, tone: 'amber' as const, title: 'Notifications',
    body: 'Get alerted when a new share price posts or a loan payoff is coming due.',
  },
  {
    icon: <IconMountainFlag />, tone: 'emerald' as const, title: 'Retirement planning',
    body: 'Project vesting and a liquidation date years out, on your own numbers.',
  },
  {
    icon: <IconPieChart />, tone: 'violet' as const, title: 'Comp calculation',
    body: 'See what a grant is really worth after tax and loan payoff.',
  },
  {
    icon: <IconShield />, tone: 'brand' as const, title: 'It sticks around',
    body: 'This page forgets everything on refresh. An account keeps your history.',
  },
]

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtNum(n: number | null) {
  return n != null ? n.toLocaleString('en-US') : '—'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-cs-muted">{label}</dt>
      <dd className="text-sm font-semibold text-cs-text">{value}</dd>
    </div>
  )
}

function UploadStage({
  csv, pdf, setCsv, setPdf, busy, error, onRun,
}: {
  csv: File | null; pdf: File | null
  setCsv: (f: File | null) => void; setPdf: (f: File | null) => void
  busy: boolean; error: string; onRun: () => void
}) {
  return (
    <Card className="text-left">
      <Eyebrow className="mb-2">No account needed</Eyebrow>
      <p className="text-sm text-cs-text-2">
        In Shareworks, open the <strong>Documents</strong> tab and download two files:
        your latest <strong>Stock Loan Statement</strong> and{' '}
        <strong>Data for Stock Workbook</strong>. Upload them here exactly as they
        download — no editing needed. We'll compute your full vesting timeline right
        in this tab, before you decide whether to save anything.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="trial-csv" className="text-xs font-medium text-cs-text-2">
            Data for Stock Workbook (.csv)
          </label>
          <input
            id="trial-csv" type="file" accept=".csv,text/csv" disabled={busy}
            onChange={e => setCsv(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>
        <div>
          <label htmlFor="trial-pdf" className="text-xs font-medium text-cs-text-2">
            Stock Loan Statement (.pdf)
          </label>
          <input
            id="trial-pdf" type="file" accept=".pdf,application/pdf" disabled={busy}
            onChange={e => setPdf(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs text-cs-muted file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cs-brand hover:file:bg-rose-100 disabled:opacity-50 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
        </div>
        <button
          type="button" onClick={onRun} disabled={(!csv && !pdf) || busy}
          className="w-full rounded-xl bg-cs-brand px-4 py-3 text-sm font-semibold text-white shadow-card hover:bg-cs-brand-hover disabled:opacity-40"
        >
          {busy ? 'Reading…' : 'See my numbers'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="mt-3 text-[11px] text-cs-muted">
        Nothing is uploaded to a database and no account is created. If you close
        or refresh this tab, everything shown here is gone.
      </p>
    </Card>
  )
}

function ResultStage({ result, onSave, onStartOver, saving }: {
  result: TrialAnalyzeResponse; onSave: () => void; onStartOver: () => void; saving: boolean
}) {
  const counts = {
    errors: result.findings.filter(f => f.severity === 'error').length,
    warnings: result.findings.filter(f => f.severity === 'warning').length,
  }

  return (
    <div className="space-y-4 text-left">
      <Card>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Grants" value={String(result.summary.grants)} />
          <Stat label="Loans" value={String(result.summary.loans)} />
          <Stat label="Total shares" value={result.summary.total_shares.toLocaleString()} />
          <Stat label="Loan balance" value={fmt$(result.summary.total_loan_balance)} />
        </dl>

        <p className={`mt-3 text-xs font-medium ${
          result.blocked ? 'text-red-600 dark:text-red-400'
            : counts.errors > 0 ? 'text-amber-700 dark:text-amber-400'
            : 'text-green-700 dark:text-green-400'}`}
        >
          {result.blocked
            ? "The statement doesn't add up to its own totals — some of it was misread."
            : counts.errors > 0
              ? `${counts.errors} figure(s) do not agree between your two files.`
              : 'Everything reconciles against the totals in your own paperwork.'}
        </p>

        <FindingList findings={result.findings} />

        {(result.blocked || counts.errors > 0) && (
          <p className="mt-3 text-xs text-cs-muted">
            Sign up to finish this in the full import wizard — it includes a
            repair loop for exactly this kind of mismatch.
          </p>
        )}
      </Card>

      {result.timeline.length > 0 && (
        <Card padded={false}>
          <div className="overflow-x-auto p-4 sm:p-5">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-cs-muted">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Event</th>
                  <th className="pb-2 pr-3 font-medium text-right">Shares</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cum. shares</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cum. income</th>
                  <th className="pb-2 font-medium text-right">Cum. cap gains</th>
                </tr>
              </thead>
              <tbody>
                {result.timeline.map((e, i) => (
                  <tr key={i} className="border-t border-cs-border">
                    <td className="py-1.5 pr-3 text-cs-text-2">{e.date}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[e.event_type] ?? 'bg-cs-raised text-cs-text-2'}`}>
                        {e.event_type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text-2">{fmtNum(e.vested_shares)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text">{fmtNum(e.cum_shares)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text">{fmt$(e.cum_income)}</td>
                    <td className="py-1.5 text-right tabular-nums text-cs-text">{fmt$(e.cum_cap_gains)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <Eyebrow className="mb-3">Why people save this</Eyebrow>
        <div className="space-y-2.5">
          {SAVE_REASONS.map(r => (
            <div key={r.title} className="flex items-center gap-3">
              <IconTile tone={r.tone}>{r.icon}</IconTile>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-cs-text">{r.title}</p>
                <p className="text-xs leading-snug text-cs-text-2">{r.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button" onClick={onSave} disabled={saving}
          className="mt-4 w-full rounded-xl bg-cs-brand px-4 py-3 text-sm font-semibold text-white shadow-card hover:bg-cs-brand-hover disabled:opacity-50"
        >
          {saving ? 'One moment…' : 'Save my numbers — sign up'}
        </button>
        <button
          type="button" onClick={onStartOver}
          className="mt-2 w-full rounded-xl border border-cs-border-strong bg-cs-surface px-4 py-2.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
        >
          Start over with different files
        </button>
      </Card>
    </div>
  )
}

export default function Try() {
  const navigate = useNavigate()
  const { appName } = useAppContext()
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('upload')
  const [result, setResult] = useState<TrialAnalyzeResponse | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function run() {
    setStage('analyzing')
    setError('')
    try {
      setResult(await trialAnalyze(csv, pdf))
      setStage('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those files')
      setStage('upload')
    }
  }

  function startOver() {
    setCsv(null)
    setPdf(null)
    setResult(null)
    setError('')
    setStage('upload')
  }

  async function saveAndSignUp() {
    if (!result) return
    setSaving(true)
    try {
      await stashTrialPayload(result.wizard_payload)
      navigate('/login')
    } catch {
      setSaving(false)
      setError('Could not hold onto your data locally — try signing up first, then import again.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-cs-base px-4 py-10">
      <div className={`w-full ${stage === 'result' ? 'max-w-2xl' : 'max-w-sm'}`}>
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-cs-text">
            Try <span className="text-cs-brand">{appName}</span> with your own files
          </h1>
          <UnofficialBadge className="mt-2" />
          <p className="mx-auto mt-2 max-w-[26rem] text-sm leading-relaxed text-cs-text-2">
            No sign-up, no email — upload what Shareworks already gives you and see
            your computed timeline in this tab.
          </p>
        </div>

        <DisclaimerNotice className="mt-6" />

        <div className="mt-6">
          {stage === 'result' && result
            ? <ResultStage result={result} onSave={saveAndSignUp} onStartOver={startOver} saving={saving} />
            : (
              <UploadStage
                csv={csv} pdf={pdf} setCsv={setCsv} setPdf={setPdf}
                busy={stage === 'analyzing'} error={error} onRun={run}
              />
            )}
        </div>

        <p className="mt-4 text-center text-xs text-cs-text-2">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-cs-brand underline decoration-cs-brand/40 underline-offset-2 hover:text-cs-brand-hover"
          >
            Sign in
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
