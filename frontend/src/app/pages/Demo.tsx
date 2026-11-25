import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import {
  DEMO_DATE,
  loadDemo,
  type DemoData,
  type DemoProfile,
  type DemoSimulation
} from '../demo.ts'
import { useChartColors } from '../components/chartAxes.ts'
import { fmt$, fmtNum, fmtFullDate } from '../format.ts'
import { ShareCards } from './dashboard/ShareCards.tsx'
import { EarningsCards } from './dashboard/EarningsCards.tsx'
import { CostCards } from './dashboard/CostCards.tsx'
import { StatCard } from '../components/StatCard.tsx'
import ExitBreakdownCard from '../components/ExitBreakdownCard.tsx'
import { Card, Eyebrow } from '../../scaffold/components/ui/Card.tsx'

const profiles = [
  ['early', 'Early career', '3 years'],
  ['established', 'Established', '10 years'],
  ['exit', 'Planning an exit', '20 years']
] as const
const button =
  'min-h-11 rounded-xl border border-cs-border-strong px-4 py-2 text-sm font-semibold text-cs-text hover:bg-cs-raised disabled:opacity-50'
const input =
  'mt-1 block min-h-11 w-full rounded-xl border border-cs-border-strong bg-cs-surface px-3 py-2 text-sm text-cs-text'
type Tab = 'Overview' | 'Events' | 'Sale what-if' | 'Retirement'

export default function Demo() {
  const colors = useChartColors()
  const [profile, setProfile] = useState<DemoProfile>('established')
  const [asOf, setAsOf] = useState(DEMO_DATE)
  const [retirementDate, setRetirementDate] = useState('2032-01-01')
  const [tab, setTab] = useState<Tab>('Overview')
  const viewDate = tab === 'Retirement' ? retirementDate : asOf
  const [data, setData] = useState<DemoData | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saleShares, setSaleShares] = useState('100')
  const [requestedShares, setRequestedShares] = useState<number>()
  const [breakdowns, setBreakdowns] = useState(new Set<string>())
  const [spend, setSpend] = useState('65')
  const [simulation, setSimulation] = useState<DemoSimulation | null>(null)
  const [simulating, setSimulating] = useState(false)
  const worker = useRef<Worker | null>(null)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    let active = true
    loadDemo(profile, viewDate, abort.signal, tab === 'Retirement' ? undefined : requestedShares)
      .then((result) => {
        if (active) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (active && !abort.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Demo unavailable')
          setLoading(false)
        }
      })
    return () => {
      active = false
      abort.abort()
    }
  }, [profile, viewDate, requestedShares, revision, tab])
  useEffect(() => () => worker.current?.terminate(), [])

  function invalidate() {
    setData(null)
    setLoading(true)
    setError('')
    setSimulation(null)
    setSimulating(false)
    worker.current?.terminate()
    worker.current = null
    setBreakdowns(new Set())
  }
  function reset() {
    invalidate()
    setProfile('established')
    setAsOf(DEMO_DATE)
    setRetirementDate('2032-01-01')
    setRequestedShares(undefined)
    setSaleShares('100')
    setSpend('65')
    setTab('Overview')
    setRevision((v) => v + 1)
  }
  function toggle(key: string) {
    setBreakdowns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function runSimulation() {
    if (!data?.exit || (data.exit.liquidation_shortfall ?? 0) > 0) return
    worker.current?.terminate()
    setSimulation(null)
    setSimulating(true)
    setError('')
    const info = data.profiles[profile]
    const age =
      info.age + Number(retirementDate.slice(0, 4)) - Number(DEMO_DATE.slice(0, 4))
    const w = new Worker(
      new URL('../workers/demoSimulation.ts', import.meta.url),
      { type: 'module' }
    )
    worker.current = w
    w.onmessage = (event) => {
      if (worker.current !== w) return
      setSimulating(false)
      if (event.data.error) setError(event.data.error)
      else setSimulation(event.data)
      w.terminate()
      worker.current = null
    }
    w.onerror = () => {
      if (worker.current === w) {
        setSimulating(false)
        setError('The simulation could not run. Please retry.')
        w.terminate()
        worker.current = null
      }
    }
    w.postMessage({
      epicExit: data.exit.net_cash / 1_000_000,
      taxableAdditional: info.other_assets_m,
      additionalBasis: info.other_assets_m,
      defaultSpend: Number(spend),
      minSpend: Number(spend) * 0.7,
      currentAge: age,
      endAge: 95,
      simulationStartDate: retirementDate,
      asOfDate: DEMO_DATE,
      stateLTCGRate: 0.0536
    })
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-16 text-cs-text">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/login" className="text-sm font-semibold text-cs-text">
          Epic Stocks Unofficial
        </Link>
        <Link to="/try" className={button}>
          Use my own files →
        </Link>
      </header>
      <Card className="space-y-2 p-4 sm:p-5">
        <Eyebrow>Interactive demo · fictional data</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Take a look around
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-cs-text-2">Your position, a sale, or retirement. Try a change and see what happens. No sign-in or uploads.</p>
        <details className="text-xs text-cs-muted"><summary className="cursor-pointer py-1">About these fictional profiles</summary><p>
          These profiles do not represent Epic’s actual prices or compensation.
          The demo uses the same calculation services as an account. Changes last only while this page is open.
        </p></details>
      </Card>
      <section
        aria-label="Fictional employee profile"
        className="grid grid-cols-3 gap-2"
      >
        {profiles.map(([key, label, tenure]) => (
          <button
            key={key}
            className={`${button} !px-2 text-left !text-xs sm:!text-sm ${profile === key ? 'border-cs-brand bg-cs-brand-subtle' : 'bg-cs-surface'}`}
            aria-pressed={profile === key}
            onClick={() => {
              invalidate()
              setProfile(key)
              setRequestedShares(undefined)
              setSpend(key === 'early' ? '40' : key === 'exit' ? '90' : '65')
              setRevision((v) => v + 1)
            }}
          >
            <span className="block">{label}</span>
            <span className="mt-1 hidden text-xs font-normal text-cs-text-2 sm:block">
              {tenure} of fictional grants
            </span>
          </button>
        ))}
      </section>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs font-semibold">
          {tab === 'Retirement' ? 'Retirement date' : 'Explore as of'}
          <input
            className={input}
            type="date"
            min={DEMO_DATE}
            max="2042-12-31"
            value={viewDate}
            onChange={(e) => {
              const value = e.target.value
              if (!value || value < DEMO_DATE || value > '2042-12-31') return
              invalidate()
              if (tab === 'Retirement') setRetirementDate(value)
              else setAsOf(value)
              setRequestedShares(undefined)
            }}
          />
        </label>
        <button className={button} onClick={reset}>
          Reset demo
        </button>
      </div>
      <nav
        aria-label="Demo sections"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {(['Overview', 'Events', 'Sale what-if', 'Retirement'] as const).map(
          (t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={`${button} ${tab === t ? 'bg-cs-brand-subtle border-cs-brand' : ''}`}
              onClick={() => { if ((tab === 'Retirement') !== (t === 'Retirement')) invalidate(); setTab(t); requestAnimationFrame(() => content.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })) }}
            >
              {t}
            </button>
          )
        )}
      </nav>
      <div ref={content} className="scroll-mt-4" />
      {loading && (
        <p role="status" className="text-sm text-cs-text-2">
          Loading fictional profile…
        </p>
      )}
      {error && (
        <Card className="space-y-3 p-4">
          <p role="alert" className="text-sm text-cs-text">
            {error}
          </p>
          <button
            className={button}
            onClick={() => {
              invalidate()
              setRequestedShares(undefined)
              setRevision((v) => v + 1)
            }}
          >
            Retry
          </button>
        </Card>
      )}
      {data && !loading && (
        <>
          {tab === 'Overview' && (
            <div className="space-y-5">
              {data.exit && (
                <Card className="space-y-2 p-5">
                  <Eyebrow>
                    Estimated cash if leaving · {fmtFullDate(asOf)}
                  </Eyebrow>
                  <p className="text-3xl font-semibold tabular-nums">
                    {fmt$(data.exit.net_cash)}
                  </p>
                  <p className="text-xs text-cs-text-2">
                    After modeled taxes, loan obligations and interest. Future
                    values use invented estimates.
                  </p>
                </Card>
              )}
              <ShareCards
                cv={data.dashboard.cards}
                cardDate={asOf}
                grantHoldings={data.dashboard.grant_holdings}
                totalValue={data.dashboard.cards.total_stock_value ?? null}
                openBreakdowns={breakdowns}
                toggleBreakdown={toggle}
              />
              <EarningsCards
                cv={data.dashboard.cards}
                breakdowns={data.dashboard.breakdowns}
                openBreakdowns={breakdowns}
                toggleBreakdown={toggle}
              />
              <CostCards
                cv={data.dashboard.cards}
                activeLoans={data.dashboard.active_loans}
                breakdowns={data.dashboard.breakdowns}
                hasInterestDeduction={false}
                openBreakdowns={breakdowns}
                toggleBreakdown={toggle}
              />
              {data.exit && (
                <details className="rounded-xl border border-cs-border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    How exit cash is calculated
                  </summary>
                  <div className="mt-3">
                    <ExitBreakdownCard s={data.exit} />
                  </div>
                </details>
              )}
            </div>
          )}
          {tab === 'Events' && (
            <Card className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">
                Fictional stock timeline
              </h2>
              <p className="text-xs text-cs-muted">
                Full profile history through 2042. Dates after the demo’s
                starting date are projections.
              </p>
              <ol className="divide-y divide-cs-border">
                {data.events.map((event, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                  >
                    <span>
                      <span className="block font-semibold">
                        {event.event_type}
                      </span>
                      {event.date} · {event.grant_year ?? ''}{' '}
                      {event.grant_type ?? ''}
                    </span>
                    <span className="tabular-nums">
                      {fmtNum(event.cum_shares)} shares
                      {event.date > DEMO_DATE ? ' · projected' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {tab === 'Sale what-if' && (
            <Card className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">
                What would a sale bring in?
              </h2>
              <p className="text-sm text-cs-text-2">
                Estimate a sale at this profile’s invented price on{' '}
                {fmtFullDate(asOf)}. This quote does not change holdings or the
                retirement scenario.
              </p>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  invalidate()
                  setRequestedShares(Number(saleShares))
                  setRevision((v) => v + 1)
                }}
              >
                <label className="min-w-0 flex-1 text-xs font-semibold">
                  Shares to sell
                  <input
                    className={input}
                    type="number"
                    min="1"
                    max={Math.min(
                      10000,
                      data.dashboard.cards.total_shares
                    )}
                    step="1"
                    required
                    value={saleShares}
                    onChange={(e) => {
                      setSaleShares(e.target.value)
                      setData((prev) => (prev ? { ...prev, sale: null } : prev))
                    }}
                  />
                </label>
                <button className={button}>Estimate sale</button>
              </form>
              {data.sale && (
                <div
                  aria-label="Sale estimate"
                  className="grid gap-3 sm:grid-cols-3"
                >
                  <StatCard
                    variant="value"
                    label="Gross proceeds"
                    value={fmt$(data.sale.gross_proceeds)}
                  />
                  <StatCard
                    variant="value"
                    label="Estimated tax"
                    value={fmt$(data.sale.estimated_tax)}
                  />
                  <StatCard
                    variant="value"
                    label="Net proceeds"
                    value={fmt$(data.sale.net_proceeds)}
                  />
                </div>
              )}
            </Card>
          )}
          {tab === 'Retirement' && (
            <Card className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">
                Try a fictional retirement
              </h2>
              <p className="text-sm text-cs-text-2">
                Retire on {fmtFullDate(retirementDate)} using modeled exit cash plus{' '}
                {fmt$(data.profiles[profile].other_assets_m * 1_000_000)} of
                fictional brokerage savings (basis equals balance). This uses
                the account simulator with 2,000 repeatable paths.
              </p>
              <p className="text-xs text-cs-muted">
                70% stocks, 20% bonds, 10% cash; historical returns; spending
                can fall to 70%; $25k health insurance until 65; $2,500/month
                Social Security from 67; modeled through age 95. No additional
                salary or savings growth is assumed before the selected date.
              </p>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  runSimulation()
                }}
              >
                <label className="min-w-0 flex-1 text-xs font-semibold">
                  Annual spending ($ thousands)
                  <input
                    className={input}
                    type="number"
                    min="1"
                    max="500"
                    required
                    value={spend}
                    onChange={(e) => {
                      setSpend(e.target.value)
                      worker.current?.terminate()
                      worker.current = null
                      setSimulating(false)
                      setSimulation(null)
                    }}
                  />
                </label>
                <button
                  className={button}
                  disabled={simulating || !data.exit || (data.exit.liquidation_shortfall ?? 0) > 0}
                >
                  {simulating ? 'Simulating…' : 'Run simulation'}
                </button>
              </form>
              {data.exit && (data.exit.liquidation_shortfall ?? 0) > 0 && (
                <p role="status" className="text-sm">
                  This profile has an exit shortfall. Choose a later date to
                  explore retirement.
                </p>
              )}
              {simulation && (
                <section aria-label="Retirement results" className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard
                      variant="value"
                      label="Starting portfolio"
                      value={fmt$(simulation.startingTotal * 1_000_000)}
                    />
                    <StatCard
                      variant="value"
                      label="Paths with a funding shortfall"
                      value={`${(simulation.pctRuin * 100).toFixed(1)}%`}
                    />
                    <StatCard
                      variant="value"
                      label="Median ending wealth"
                      value={fmt$(simulation.medianFinalM * 1_000_000)}
                    />
                  </div>
                  <h3 className="text-sm font-semibold">
                    Wealth across possible markets
                  </h3>
                  <p className="text-xs text-cs-muted">
                    10th percentile, median and 90th percentile; dollar amounts
                    in millions.
                  </p>
                  <div
                    className="h-64 w-full min-w-0"
                    role="img"
                    aria-label="Portfolio wealth by age, with 10th, 50th and 90th percentile paths"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={simulation.fan}>
                        <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="age" stroke={colors.axis} tick={{ fontSize: 11 }} minTickGap={20} />
                        <YAxis width={45} stroke={colors.axis} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: colors.tooltipBg, color: colors.tooltipText, border: `1px solid ${colors.grid}` }} />
                        <Legend />
                        <Line
                          isAnimationActive={false}
                          dataKey="p10"
                          name="10th percentile ($M)"
                          stroke="#b45309"
                          dot={false}
                        />
                        <Line
                          isAnimationActive={false}
                          dataKey="p50"
                          name="Median ($M)"
                          stroke="#0f766e"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          isAnimationActive={false}
                          dataKey="p90"
                          name="90th percentile ($M)"
                          stroke="#6366f1"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-cs-muted">
                    Illustrative outcomes from invented finances, not a personal
                    retirement forecast.
                  </p>
                </section>
              )}
            </Card>
          )}
          <p className="text-xs leading-relaxed text-cs-muted">
            {data.assumptions}
          </p>
        </>
      )}
      <footer className="border-t border-cs-border pt-4 text-xs text-cs-text-2">
        Ready to explore your own position?{' '}
        <Link to="/try" className="font-semibold underline">
          Import your Eureka files
        </Link>
        . Fictional data will not be copied into your account.
      </footer>
    </main>
  )
}
