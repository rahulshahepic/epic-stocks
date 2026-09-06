import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { trialAnalyze, stashTrialPayload, pingSaveIntent, type TrialAnalyzeResponse } from '../trialImport.ts'
import type { TimelineEvent } from '../../api.ts'
import FindingList, { ReportFindingsButton } from '../components/FindingList.tsx'
import { ReportProblemLink } from '../../scaffold/components/ReportProblem.tsx'
import StalePriceNotice from '../components/StalePriceNotice.tsx'
import { StatCard } from '../components/StatCard.tsx'
import {
  ChartBox, IncomeCapGainsChart, PriceChart, SharesChart, TODAY,
  useChartColors, type DateRange,
} from '../components/charts.tsx'
import { fmt$, fmtFullDate, fmtNum, fmtPrice } from '../format.ts'
import { useAppContext } from '../../scaffold/contexts/AppContext.tsx'
import DisclaimerNotice from '../../scaffold/components/DisclaimerNotice.tsx'
import UnofficialBadge from '../../scaffold/components/UnofficialBadge.tsx'
import { Card, HeroCard, Eyebrow, IconTile } from '../../scaffold/components/ui/Card.tsx'
import {
  Sparkline, IconBell, IconMountainFlag, IconPieChart, IconCompass, IconDocument,
} from '../../scaffold/components/ui/icons.tsx'

type Stage = 'upload' | 'analyzing' | 'preview'
type Tab = 'dashboard' | 'events'

const EVENT_COLORS: Record<string, string> = {
  'Exercise': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Down payment exchange': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Vesting': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Share Price': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Loan Payoff': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

/** What the preview deliberately withholds, and why it needs an account. */
const LOCKED = [
  {
    icon: <IconBell />, tone: 'amber' as const, title: 'Notifications',
    body: 'Push or email before each vesting date and loan payoff — the things that are easy to miss.',
  },
  {
    icon: <IconMountainFlag />, tone: 'emerald' as const, title: 'Retirement simulator',
    body: '100,000 paths over real 1928–2023 market history, using this position plus your other assets.',
  },
  {
    icon: <IconPieChart />, tone: 'violet' as const, title: 'Total comp calculator',
    body: 'Turn the stock-loan program into one number you can hold against a salary offer.',
  },
  {
    icon: <IconCompass />, tone: 'sky' as const, title: 'Sales you have already made',
    body: 'This preview counts every share you were granted — it cannot subtract ones you have sold, so a position with past sales reads high here. An account records sales, their tax, and which shares cover which loan.',
  },
  {
    icon: <IconDocument />, tone: 'slate' as const, title: 'Your own tax rates',
    body: 'This preview assumes default rates. An account uses yours, and keeps your history as prices change.',
  },
]

interface AsOfValues {
  price: number
  shares: number
  unvestedShares: number
  income: number
  capGains: number
  vestedValue: number
  unvestedValue: number
  value: number
  costBasis: number
  loanBalance: number
  netWorth: number
  estTax: number
  nextEvent: TimelineEvent | null
}

/**
 * The position as of a date, from data held in memory.
 *
 * Shares are valued the way the signed-in dashboard values them: vested shares
 * at the current price, unvested shares at what they cost. Valuing only the
 * vested half while still subtracting every loan understates a real position by
 * the entire unvested book — enough to report a negative net worth to someone
 * whose position is well in the black.
 *
 * The dashboard folds in sales, early loan payments and per-user tax rates too.
 * A preview is a freshly read pair of documents and has none of those, so this
 * is that same walk with the branches that need an account left out.
 */
function valuesAsOf(r: TrialAnalyzeResponse, asOf: string): AsOfValues {
  let last: TimelineEvent | null = null
  for (const e of r.timeline) {
    if (e.date <= asOf) last = e
    else break
  }
  const nextEvent = r.timeline.find(e => e.date > asOf) ?? null
  const price = last?.share_price ?? 0
  const year = parseInt(asOf.slice(0, 4), 10)

  let shares = 0
  let unvestedShares = 0
  let vestedValue = 0
  let unvestedValue = 0
  let costBasis = 0
  for (const g of r.grants) {
    let vested = 0
    if (g.periods > 0) {
      const base = Math.floor(g.shares / g.periods)
      const rem = g.shares % g.periods
      for (let p = 0; p < g.periods; p++) {
        const vd = new Date(g.vest_start + 'T00:00:00')
        vd.setFullYear(vd.getFullYear() + p)
        if (vd.toISOString().slice(0, 10) <= asOf) vested += base + (p < rem ? 1 : 0)
      }
    }
    const unvested = g.shares - vested
    // dp_shares is negative where shares were handed over as a down payment.
    const held = Math.max(0, vested + (g.dp_shares ?? 0))
    shares += held
    unvestedShares += unvested
    vestedValue += held * price
    unvestedValue += unvested * g.price
    costBasis += g.shares * g.price
  }

  const refinanced = new Set(
    r.loans.map(l => l.refinances_loan_id).filter((id): id is number => id != null)
  )
  const loanBalance = r.loans
    .filter(l => l.loan_year <= year && !refinanced.has(l.id))
    .reduce((sum, l) => sum + l.amount, 0)

  const incomeRate = r.tax_defaults.federal_income_rate + r.tax_defaults.state_income_rate
  const estTax =
    r.loans.filter(l => l.loan_type === 'Tax' && l.loan_year <= year)
      .reduce((sum, l) => sum + l.amount, 0)
      + r.timeline.filter(e => e.event_type === 'Vesting' && e.date <= asOf && e.income > 0)
        .reduce((sum, e) => sum + e.income * incomeRate, 0)

  const value = vestedValue + unvestedValue
  return {
    price,
    shares,
    unvestedShares,
    income: last?.cum_income ?? 0,
    capGains: last?.cum_cap_gains ?? 0,
    vestedValue,
    unvestedValue,
    value,
    costBasis,
    loanBalance,
    netWorth: value - loanBalance,
    estTax,
    nextEvent,
  }
}

function UploadStage({ csv, pdf, setCsv, setPdf, busy, error, onRun }: {
  csv: File | null; pdf: File | null
  setCsv: (f: File | null) => void; setPdf: (f: File | null) => void
  busy: boolean; error: string; onRun: () => void
}) {
  return (
    <Card className="text-left">
      <Eyebrow className="mb-2">No account needed</Eyebrow>
      <p className="text-sm leading-relaxed text-cs-text-2">
        In Shareworks, open the <strong>Documents</strong> tab and download two files:
        your latest <strong>Stock Loan Statement</strong> and{' '}
        <strong>Data for Stock Workbook</strong>. Upload them exactly as they
        download — no editing needed.
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
          {busy ? 'Reading your files…' : 'See my numbers'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-cs-muted">
        Your files are read and thrown away — nothing is stored and no account is
        created. Close or refresh this tab and it is gone.
      </p>
    </Card>
  )
}

function AsOfControl({ asOf, setAsOf, lastEventDate }: {
  asOf: string; setAsOf: (d: string) => void; lastEventDate: string
}) {
  const pill = 'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="trial-as-of" className="text-xs font-medium text-cs-text-2">As of</label>
      <input
        id="trial-as-of" type="date" value={asOf}
        onChange={e => e.target.value && setAsOf(e.target.value)}
        className="h-7 rounded-md border border-cs-border-strong bg-cs-surface px-2 text-xs text-cs-text"
      />
      <button
        type="button" onClick={() => setAsOf(TODAY)} aria-pressed={asOf === TODAY}
        className={`${pill} ${asOf === TODAY ? 'bg-cs-brand text-white' : 'bg-cs-raised text-cs-text-2 hover:bg-cs-border'}`}
      >
        Today
      </button>
      <button
        type="button" onClick={() => setAsOf(lastEventDate)} aria-pressed={asOf === lastEventDate}
        className={`${pill} ${asOf === lastEventDate ? 'bg-cs-brand text-white' : 'bg-cs-raised text-cs-text-2 hover:bg-cs-border'}`}
      >
        Last event
      </button>
    </div>
  )
}

function DashboardTab({ result, asOf }: { result: TrialAnalyzeResponse; asOf: string }) {
  const c = useChartColors()
  // The preview shows every chart whole. Per-chart range pickers are a second
  // date control next to the as-of one, which is exactly the clutter a first
  // look does not need — an account gets those.
  const range: DateRange = { mode: 'all', start: '', end: '' }
  const v = useMemo(() => valuesAsOf(result, asOf), [result, asOf])
  const hasFuturePrices = result.prices.some(p => p.effective_date > TODAY)

  return (
    <div className="space-y-4">
      <HeroCard watermark={<Sparkline className="h-24 w-40" color="#fff" />}>
        <Eyebrow className="text-white">Net worth · as of {fmtFullDate(asOf)}</Eyebrow>
        <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">
          {fmt$(v.netWorth)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white">
          <span><span className="font-semibold">{fmtNum(v.shares)}</span> vested shares</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/60 sm:inline-block" />
          <span><span className="font-semibold">{fmtNum(v.unvestedShares)}</span> unvested</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/60 sm:inline-block" />
          <span><span className="font-semibold">{fmtPrice(v.price)}</span> / share</span>
        </div>
        <p className="mt-1 text-sm text-white">
          {fmt$(v.value)} in shares − {fmt$(v.loanBalance)} loans
        </p>
      </HeroCard>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard variant="price" label="Share price" value={fmtPrice(v.price)} />
        <StatCard variant="shares" label="Vested shares" value={fmtNum(v.shares)}
          subvalue={fmt$(v.vestedValue)} />
        <StatCard variant="unvested" label="Unvested shares" value={fmtNum(v.unvestedShares)}
          subvalue={fmt$(v.unvestedValue)} subtitle="At cost basis" />
        <StatCard variant="value" label="Total value" value={fmt$(v.value)}
          subtitle="Vested at FMV + unvested at cost basis" />
        <StatCard variant="costbasis" label="Cost basis" value={fmt$(v.costBasis)}
          subtitle="All grants, vested or not" />
        <StatCard variant="income" label="Income to date" value={fmt$(v.income)} />
        <StatCard variant="gains" label="Capital gains" value={fmt$(v.capGains)} />
        <StatCard variant="loans" label="Loan balance" value={fmt$(v.loanBalance)} />
        <StatCard
          variant="tax" label="Est. tax so far" value={fmt$(v.estTax)}
          subtitle="At default rates — an account uses yours"
        />
      </div>

      {v.nextEvent && (
        <Card className="flex items-center gap-3">
          <IconTile tone="sky"><IconCompass /></IconTile>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-cs-text-2">Next up</p>
            <p className="text-sm font-semibold text-cs-text">
              {v.nextEvent.event_type} on {fmtFullDate(v.nextEvent.date)}
              {v.nextEvent.vested_shares
                ? ` — ${fmtNum(v.nextEvent.vested_shares)} shares vest`
                : ''}
            </p>
          </div>
        </Card>
      )}

      <ChartBox title="Shares over time">
        <SharesChart events={result.timeline} c={c} range={range} hasFuturePrices={hasFuturePrices} />
      </ChartBox>
      <ChartBox title="Income & capital gains">
        <IncomeCapGainsChart events={result.timeline} c={c} range={range} hasFuturePrices={hasFuturePrices} />
      </ChartBox>
      <ChartBox title="Share price">
        <PriceChart prices={result.prices} c={c} range={range} hasFuturePrices={hasFuturePrices} />
      </ChartBox>
    </div>
  )
}

function EventsTab({ result, asOf }: { result: TrialAnalyzeResponse; asOf: string }) {
  const future = result.timeline.filter(e => e.date > asOf).length
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 className="text-sm font-semibold text-cs-text">
          {result.timeline.length} computed events
        </h2>
        {future > 0 && (
          <p className="text-xs text-cs-muted">
            {future} after {fmtFullDate(asOf)} — shown dimmed
          </p>
        )}
      </div>
      <div className="overflow-x-auto p-4 sm:p-5">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead>
            <tr className="text-cs-muted">
              <th className="pb-2 pr-3 font-medium">Date</th>
              <th className="pb-2 pr-3 font-medium">Event</th>
              <th className="pb-2 pr-3 font-medium">Grant</th>
              <th className="pb-2 pr-3 text-right font-medium">Shares</th>
              <th className="pb-2 pr-3 text-right font-medium">Price</th>
              <th className="pb-2 pr-3 text-right font-medium">Cum. shares</th>
              <th className="pb-2 pr-3 text-right font-medium">Cum. income</th>
              <th className="pb-2 text-right font-medium">Cum. gains</th>
            </tr>
          </thead>
          <tbody>
            {result.timeline.map((e, i) => (
              <tr key={i} className={`border-t border-cs-border ${e.date > asOf ? 'opacity-50' : ''}`}>
                <td className="whitespace-nowrap py-1.5 pr-3 text-cs-text-2">{fmtFullDate(e.date)}</td>
                <td className="py-1.5 pr-3">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${EVENT_COLORS[e.event_type] ?? 'bg-cs-raised text-cs-text-2'}`}>
                    {e.event_type}
                  </span>
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-cs-text-2">
                  {e.grant_year ? `${e.grant_year} ${e.grant_type ?? ''}`.trim() : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text-2">
                  {e.vested_shares != null ? fmtNum(e.vested_shares) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text-2">{fmtPrice(e.share_price)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text">{fmtNum(e.cum_shares)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-cs-text">{fmt$(e.cum_income)}</td>
                <td className="py-1.5 text-right tabular-nums text-cs-text">{fmt$(e.cum_cap_gains)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function WhyAnAccount({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <Card>
      <Eyebrow className="mb-1">Keep this</Eyebrow>
      <p className="text-sm text-cs-text-2">
        Everything above was computed in this tab and is gone when you close it.
        An account keeps it, and adds the parts a one-off read can't do:
      </p>
      <div className="mt-4 space-y-2.5">
        {LOCKED.map(f => (
          <div key={f.title} className="flex items-center gap-3">
            <IconTile tone={f.tone}>{f.icon}</IconTile>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-cs-text">{f.title}</p>
              <p className="text-xs leading-snug text-cs-text-2">{f.body}</p>
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
      <p className="mt-2 text-center text-[11px] text-cs-muted">
        Signing in carries these numbers straight into your account — no second upload.
      </p>
    </Card>
  )
}

export default function Try() {
  const navigate = useNavigate()
  const { appName } = useAppContext()
  const [csv, setCsv] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('upload')
  const [result, setResult] = useState<TrialAnalyzeResponse | null>(null)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [asOf, setAsOf] = useState(TODAY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [repricing, setRepricing] = useState(false)
  const [pricedAt, setPricedAt] = useState<number | null>(null)

  async function run(currentPrice?: number) {
    setStage('analyzing')
    setError('')
    try {
      const r = await trialAnalyze(csv, pdf, currentPrice)
      setResult(r)
      setTab('dashboard')
      setAsOf(TODAY)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those files')
      setStage('upload')
    }
  }

  /** Re-read the same files with today's price folded in as a price point. */
  async function applyCurrentPrice(price: number) {
    setRepricing(true)
    try {
      const r = await trialAnalyze(csv, pdf, price)
      setResult(r)
      setPricedAt(price)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that price')
    } finally {
      setRepricing(false)
    }
  }

  function startOver() {
    setCsv(null)
    setPdf(null)
    setResult(null)
    setError('')
    setPricedAt(null)
    setStage('upload')
  }

  async function saveAndSignUp() {
    if (!result) return
    setSaving(true)
    try {
      await stashTrialPayload(result.wizard_payload)
      pingSaveIntent()
      navigate('/login')
    } catch {
      setSaving(false)
      setError('Could not hold onto your data locally — try signing up first, then import again.')
    }
  }

  // ── Upload: a plain, focused page of its own ───────────────────────────────
  if (stage !== 'preview' || !result) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-cs-base px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <h1 className="text-2xl font-extrabold tracking-tight text-cs-text">
              Try <span className="text-cs-brand">{appName}</span> with your own files
            </h1>
            <UnofficialBadge className="mt-2" />
            <p className="mx-auto mt-2 max-w-[26rem] text-sm leading-relaxed text-cs-text-2">
              No sign-up, no email. Upload the two files Shareworks already gives you
              and get your dashboard and full vesting timeline in this tab.
            </p>
          </div>

          <DisclaimerNotice className="mt-6" />

          <div className="mt-6">
            <UploadStage
              csv={csv} pdf={pdf} setCsv={setCsv} setPdf={setPdf}
              busy={stage === 'analyzing'} error={error} onRun={run}
            />
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

          <p className="mt-2 text-center text-xs text-cs-text-2">
            Something look wrong?{' '}
            <ReportProblemLink className="font-medium text-cs-brand hover:text-cs-brand-hover" />
          </p>
        </div>
      </div>
    )
  }

  // ── Preview: the app itself, on data that only exists in this tab ──────────
  const lastEventDate = result.timeline.length
    ? result.timeline[result.timeline.length - 1].date
    : TODAY
  const errors = result.findings.filter(f => f.severity === 'error').length
  const tabClass = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active ? 'bg-cs-brand text-white' : 'bg-cs-raised text-cs-text-2 hover:bg-cs-border'}`

  return (
    <div className="min-h-screen bg-cs-base">
      <header className="sticky top-0 z-20 border-b border-cs-border bg-cs-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-extrabold tracking-tight text-cs-brand">{appName}</span>
            <UnofficialBadge />
          </div>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Preview · nothing saved
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button" onClick={startOver}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
            >
              New files
            </button>
            <button
              type="button" onClick={saveAndSignUp} disabled={saving}
              className="rounded-lg bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-50"
            >
              {saving ? 'One moment…' : 'Save & sign up'}
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <nav className="flex gap-2" aria-label="Preview sections">
            <button type="button" onClick={() => setTab('dashboard')}
              aria-pressed={tab === 'dashboard'} className={tabClass(tab === 'dashboard')}>
              Dashboard
            </button>
            <button type="button" onClick={() => setTab('events')}
              aria-pressed={tab === 'events'} className={tabClass(tab === 'events')}>
              Events
            </button>
          </nav>
          <AsOfControl asOf={asOf} setAsOf={setAsOf} lastEventDate={lastEventDate} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        {(result.blocked || errors > 0) && (
          <Card>
            <p className={`text-xs font-medium ${result.blocked ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
              {result.blocked
                ? "The statement doesn't add up to its own totals — some of it was misread, so these figures are incomplete."
                : `${errors} figure(s) do not agree between your two files.`}
            </p>
            <FindingList findings={result.findings} />
            <p className="mt-3 text-xs text-cs-muted">
              Sign up to finish this in the full import wizard — it has a repair
              loop for exactly this kind of mismatch.
            </p>
            <p className="mt-2">
              <ReportFindingsButton findings={result.findings} blocked={result.blocked} />
            </p>
          </Card>
        )}

        {result.price_is_stale && pricedAt == null && result.prices.length > 0 && (
          <StalePriceNotice
            latestPrice={result.prices[result.prices.length - 1].price}
            latestDate={result.prices[result.prices.length - 1].effective_date}
            onApply={applyCurrentPrice}
            busy={repricing}
          />
        )}
        {pricedAt != null && (
          <p className="text-xs text-cs-muted">
            Valued at the {fmtPrice(pricedAt)} you entered for today, not the older
            price in your files.
          </p>
        )}

        {tab === 'dashboard'
          ? <DashboardTab result={result} asOf={asOf} />
          : <EventsTab result={result} asOf={asOf} />}

        <WhyAnAccount onSave={saveAndSignUp} saving={saving} />

        <DisclaimerNotice />

        <p className="text-center text-xs text-cs-text-2">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-cs-brand underline decoration-cs-brand/40 underline-offset-2 hover:text-cs-brand-hover"
          >
            Sign in
          </Link>
          .
        </p>

        {/* The preview is a whole app's worth of numbers computed from someone's
            own files, with no account behind it. If it gets them wrong, this is
            the only way they can say so. */}
        <p className="pb-4 text-center text-xs text-cs-text-2">
          Numbers look wrong?{' '}
          <ReportProblemLink className="font-medium text-cs-brand hover:text-cs-brand-hover" />
        </p>
      </main>
    </div>
  )
}
