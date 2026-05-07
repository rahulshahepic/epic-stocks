import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../api.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import {
  computeFanPercentiles,
  DEFAULT_PARAMS,
  finalPercentiles,
  histogram,
  SCENARIO_LABELS,
  SCENARIOS,
  simulate,
  ssAdjustment,
  type FanPercentiles,
  type Scenario,
  type SimParams,
  type SimResult,
} from './Retirement.math.ts'

function fmt$M(n: number, digits: number = 2): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}M`
  if (Math.abs(n) >= 10) return `$${n.toFixed(1)}M`
  return `$${n.toFixed(digits)}M`
}

function fmtPct(n: number, digits: number = 1): string {
  return (n * 100).toFixed(digits) + '%'
}

interface ChartColors {
  grid: string
  axis: string
  tooltipBg: string
  tooltipText: string
  median: string
  start: string
  good: string
  bad: string
  band: [string, string, string]
}

function useChartColors(): ChartColors {
  const dark = useDark()
  return dark
    ? {
        grid: '#1e293b',
        axis: '#94a3b8',
        tooltipBg: '#0f172a',
        tooltipText: '#f1f5f9',
        median: '#fde68a',
        start: '#fbbf24',
        good: '#34d399',
        bad: '#f87171',
        band: ['#1e3a8a', '#2563eb', '#60a5fa'],
      }
    : {
        grid: '#e7e5e4',
        axis: '#78716c',
        tooltipBg: '#ffffff',
        tooltipText: '#1c1917',
        median: '#b45309',
        start: '#d97706',
        good: '#059669',
        bad: '#dc2626',
        band: ['#bfdbfe', '#60a5fa', '#1d4ed8'],
      }
}

function StatCard({
  label,
  value,
  sub,
  variant,
}: {
  label: string
  value: string
  sub?: string
  variant?: 'good' | 'bad' | 'neutral'
}) {
  const accent =
    variant === 'good'
      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
      : variant === 'bad'
      ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30'
      : 'border-stone-200 bg-white dark:border-slate-700 dark:bg-slate-900'
  return (
    <div className={`rounded-lg border p-3 ${accent}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-stone-500 dark:text-slate-400">{sub}</p>}
    </div>
  )
}

interface NumInputProps {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  hint?: string
}
function NumInput({ label, value, onChange, step, min, max, suffix, hint }: NumInputProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
        {label}
        {suffix && <span className="ml-1 text-gray-400 dark:text-slate-500">({suffix})</span>}
      </span>
      <input
        type="number"
        step={step ?? 'any'}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={e => {
          const v = parseFloat(e.target.value)
          onChange(Number.isFinite(v) ? v : 0)
        }}
        className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      {hint && <span className="text-[10px] text-gray-400 dark:text-slate-500">{hint}</span>}
    </label>
  )
}

interface FanRow {
  year: number
  base: number
  b1: number
  b2: number
  b3: number
  b4: number
  b5: number
  b6: number
  p50: number
  pct: FanPercentiles
}

function buildFanData(rows: FanPercentiles[]): FanRow[] {
  return rows.map(p => ({
    year: p.year,
    base: p.p5,
    b1: p.p10 - p.p5,
    b2: p.p25 - p.p10,
    b3: p.p50 - p.p25,
    b4: p.p75 - p.p50,
    b5: p.p90 - p.p75,
    b6: p.p95 - p.p90,
    p50: p.p50,
    pct: p,
  }))
}

function FanTooltip({
  active,
  payload,
  c,
}: {
  active?: boolean
  payload?: Array<{ payload: FanRow }>
  c: ChartColors
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const Row = ({ k, v }: { k: string; v: number }) => (
    <div className="flex justify-between gap-4 tabular-nums">
      <span className="text-stone-500 dark:text-slate-400">{k}</span>
      <span>{fmt$M(v)}</span>
    </div>
  )
  return (
    <div
      className="rounded-md border px-2.5 py-2 text-[11px] shadow-md"
      style={{ background: c.tooltipBg, color: c.tooltipText, borderColor: c.grid }}
    >
      <p className="mb-1 font-semibold tabular-nums">Year {row.year}</p>
      <Row k="p95" v={row.pct.p95} />
      <Row k="p90" v={row.pct.p90} />
      <Row k="p75" v={row.pct.p75} />
      <Row k="p50" v={row.pct.p50} />
      <Row k="p25" v={row.pct.p25} />
      <Row k="p10" v={row.pct.p10} />
      <Row k="p5" v={row.pct.p5} />
    </div>
  )
}

function HistogramTooltip({
  active,
  payload,
  c,
}: {
  active?: boolean
  payload?: Array<{ payload: { x0: number; x1: number; count: number; aboveStart: boolean } }>
  c: ChartColors
}) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-[11px] shadow-md"
      style={{ background: c.tooltipBg, color: c.tooltipText, borderColor: c.grid }}
    >
      <p className="font-semibold">{fmt$M(b.x0, 1)} – {fmt$M(b.x1, 1)}</p>
      <p className="tabular-nums">{b.count.toLocaleString()} paths ({b.aboveStart ? 'above' : 'below'} start)</p>
    </div>
  )
}

const TODAY = new Date().toISOString().slice(0, 10)

export default function Retirement() {
  const { viewing } = useViewing()
  const c = useChartColors()
  const [exitDefault, setExitDefault] = useState<number | null>(null)
  const [exitOverridden, setExitOverridden] = useState(false)
  const [params, setParams] = useState<SimParams>(() => ({ ...DEFAULT_PARAMS }))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  // Fetch exit preview to pre-populate Epic exit value (today's net cash on exit, in $M)
  useEffect(() => {
    if (viewing) return // skip — we don't have a shared variant of preview-exit
    api.previewExit(TODAY)
      .then(p => {
        if (!p) return
        const m = p.net_cash / 1_000_000
        setExitDefault(m)
      })
      .catch(() => {})
  }, [viewing])

  useEffect(() => {
    if (exitDefault != null && !exitOverridden) {
      setParams(prev => ({ ...prev, epicExit: Math.max(0, Number(exitDefault.toFixed(3))) }))
    }
  }, [exitDefault, exitOverridden])

  const update = useCallback(<K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }, [])

  const startingTotal = (params.epicExit + params.additional) + params.cashBuffer
  const ssAdj = ssAdjustment(params.claimAge, params.fra)
  const ssAnnualK = (params.ssMonthly * 12 / 1000) * ssAdj

  const run = useCallback(() => {
    setRunning(true)
    // Defer to next tick so the UI can repaint into the "running" state.
    setTimeout(() => {
      try {
        const r = simulate(params)
        setResult(r)
        setHasRun(true)
      } finally {
        setRunning(false)
      }
    }, 30)
  }, [params])

  const fanData = useMemo(() => (result ? buildFanData(computeFanPercentiles(result)) : []), [result])
  const histData = useMemo(() => (result ? histogram(result, 30) : null), [result])
  const finalRows = useMemo(() => (result ? finalPercentiles(result) : []), [result])

  const dataMaxY = useMemo(() => {
    if (!fanData.length) return 0
    return Math.max(...fanData.map(r => r.base + r.b1 + r.b2 + r.b3 + r.b4 + r.b5 + r.b6))
  }, [fanData])

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Retirement Simulator</h1>
        {viewing && (
          <span className="text-[11px] text-stone-500 dark:text-slate-400">
            Computed locally — uses defaults for shared accounts.
          </span>
        )}
      </div>

      <div className="rounded-lg border border-stone-200 bg-stone-50 dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setExplainerOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-700 dark:text-slate-200"
        >
          <span>What is this?</span>
          <span className="text-gray-400 dark:text-slate-500">{explainerOpen ? '▲' : '▼'}</span>
        </button>
        {explainerOpen && (
          <div className="border-t border-stone-200 px-4 py-3 text-xs leading-relaxed text-gray-600 dark:border-slate-700 dark:text-slate-300">
            <p className="mb-2">
              A {params.paths.toLocaleString()}-path Monte Carlo simulation of a {params.years}-year retirement, run entirely in your browser.
              Equity is split between stocks and bonds (correlated log-normal returns) with a separate cash buffer that earns 0% real.
              Withdrawals come from cash first, then equity (with a tax drag when refilling). Social Security kicks in at your chosen claim age.
            </p>
            <p className="mb-2">
              All dollar values are <strong>real</strong> (inflation-adjusted). Default spend is what you withdraw in good years; minimum spend is the floor in years with negative portfolio returns.
            </p>
            <p>
              Pre-populated Epic exit value comes from "If you exited today" on the Dashboard. Override it freely.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Portfolio</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <NumInput
            label="Epic exit value"
            value={params.epicExit}
            onChange={v => {
              setExitOverridden(true)
              update('epicExit', v)
            }}
            min={0}
            step={0.1}
            suffix="$M"
            hint={exitDefault != null ? `Pre-filled from today's exit preview (${fmt$M(exitDefault)})` : viewing ? 'Enter manually when viewing shared data.' : undefined}
          />
          <NumInput
            label="Additional portfolio"
            value={params.additional}
            onChange={v => update('additional', v)}
            min={0}
            step={0.1}
            suffix="$M"
            hint="Brokerage, 401k, etc."
          />
          <NumInput
            label="Cash buffer"
            value={params.cashBuffer}
            onChange={v => update('cashBuffer', v)}
            min={0}
            step={0.1}
            suffix="$M"
            hint="Held outside equity, 0% real return"
          />
        </div>
        <p className="mt-3 text-[11px] text-stone-500 dark:text-slate-400">
          Total starting wealth: <strong className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$M(startingTotal)}</strong>
          {' '}(equity {fmt$M(params.epicExit + params.additional)} + cash {fmt$M(params.cashBuffer)})
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Spending & allocation</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <NumInput
            label="Default spend"
            value={params.defaultSpend}
            onChange={v => update('defaultSpend', v)}
            min={0}
            step={5}
            suffix="$K/yr"
            hint="Withdrawn in good years"
          />
          <NumInput
            label="Minimum spend (floor)"
            value={params.minSpend}
            onChange={v => update('minSpend', v)}
            min={0}
            step={5}
            suffix="$K/yr"
            hint="Floor when portfolio drops"
          />
          <NumInput
            label="Equity allocation"
            value={Math.round(params.equityAlloc * 100)}
            onChange={v => update('equityAlloc', Math.max(0, Math.min(100, v)) / 100)}
            min={0}
            max={100}
            step={5}
            suffix="%"
            hint="Rest is bonds"
          />
          <NumInput
            label="Refill tax drag"
            value={Math.round(params.refillTaxDrag * 100)}
            onChange={v => update('refillTaxDrag', Math.max(0, Math.min(99, v)) / 100)}
            min={0}
            max={99}
            step={1}
            suffix="%"
            hint="Tax on equity sales to refill cash"
          />
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium text-gray-700 dark:text-slate-200">Return scenario</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SCENARIOS) as Scenario[]).map(s => {
              const sc = SCENARIOS[s]
              const active = params.scenario === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('scenario', s)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-rose-500 bg-rose-100 text-rose-800 dark:border-rose-400 dark:bg-rose-950/40 dark:text-rose-300'
                      : 'border-stone-300 bg-white text-gray-600 hover:bg-stone-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                  title={`Equity ${fmtPct(sc.sMean, 1)}±${fmtPct(sc.sStd, 0)} · Bonds ${fmtPct(sc.bMean, 1)}±${fmtPct(sc.bStd, 0)} (real, geometric)`}
                >
                  {SCENARIO_LABELS[s]}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-stone-500 dark:text-slate-400">
            Equity {fmtPct(SCENARIOS[params.scenario].sMean, 1)} / σ {fmtPct(SCENARIOS[params.scenario].sStd, 0)}
            {' · '}
            Bonds {fmtPct(SCENARIOS[params.scenario].bMean, 1)} / σ {fmtPct(SCENARIOS[params.scenario].bStd, 0)}
            {' · '}
            ρ {params.rho.toFixed(2)} (all real, geometric).
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Social Security</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumInput
            label="FRA monthly benefit"
            value={params.ssMonthly}
            onChange={v => update('ssMonthly', v)}
            min={0}
            step={50}
            suffix="$/mo"
            hint="At age 67 (FRA)"
          />
          <NumInput
            label="Claim age"
            value={params.claimAge}
            onChange={v => update('claimAge', Math.max(62, Math.min(70, Math.round(v))))}
            min={62}
            max={70}
            step={1}
            hint="Integer 62–70"
          />
          <NumInput
            label="Retirement age"
            value={params.retireAge}
            onChange={v => update('retireAge', Math.max(30, Math.min(70, Math.round(v))))}
            min={30}
            max={70}
            step={1}
            hint="Used to time SS start"
          />
        </div>
        <p className="mt-2 text-[11px] text-stone-500 dark:text-slate-400">
          Adjustment factor at age {params.claimAge}: <strong>{(ssAdj * 100).toFixed(1)}%</strong> of FRA
          {' · '}
          Annual benefit (real): <strong className="tabular-nums">${ssAnnualK.toFixed(1)}K</strong>
          {' · '}
          Starts simulation year {Math.max(0, params.claimAge - params.retireAge)}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400"
        >
          {running ? 'Running…' : hasRun ? 'Re-run simulation' : `Run ${params.paths.toLocaleString()} paths × ${params.years} years`}
        </button>
        {result && (
          <p className="text-[11px] text-stone-500 dark:text-slate-400">
            {result.finalWealth.length.toLocaleString()} paths simulated. Tweak inputs and re-run anytime.
          </p>
        )}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Above starting wealth"
              value={fmtPct(result.pctAboveStart)}
              sub={`${result.finalWealth.length.toLocaleString()} paths total`}
              variant={result.pctAboveStart >= 0.5 ? 'good' : 'neutral'}
            />
            <StatCard
              label="Ruin"
              value={fmtPct(result.pctRuin)}
              sub="Both pools hit 0"
              variant={result.pctRuin <= 0.1 ? 'good' : result.pctRuin >= 0.3 ? 'bad' : 'neutral'}
            />
            <StatCard
              label="Median final"
              value={fmt$M(result.medianFinalM)}
              sub={`vs start ${fmt$M(result.startingTotal)}`}
            />
            <StatCard
              label="P10 final"
              value={fmt$M(result.p10FinalM)}
              sub="10% of paths end below this"
              variant={result.p10FinalM >= result.startingTotal ? 'good' : 'neutral'}
            />
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
              Total wealth fan chart (real $M)
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={fanData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
                <YAxis
                  domain={[0, dataMaxY > 0 ? Math.ceil(dataMaxY * 1.05) : 'auto']}
                  tick={{ fontSize: 10, fill: c.axis }}
                  tickFormatter={(v: number) => fmt$M(v, 0)}
                />
                <Tooltip content={<FanTooltip c={c} />} />
                <Area dataKey="base" stackId="fan" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area dataKey="b1" stackId="fan" stroke="none" fill={c.band[0]} fillOpacity={0.5} isAnimationActive={false} />
                <Area dataKey="b2" stackId="fan" stroke="none" fill={c.band[1]} fillOpacity={0.5} isAnimationActive={false} />
                <Area dataKey="b3" stackId="fan" stroke="none" fill={c.band[2]} fillOpacity={0.55} isAnimationActive={false} />
                <Area dataKey="b4" stackId="fan" stroke="none" fill={c.band[2]} fillOpacity={0.55} isAnimationActive={false} />
                <Area dataKey="b5" stackId="fan" stroke="none" fill={c.band[1]} fillOpacity={0.5} isAnimationActive={false} />
                <Area dataKey="b6" stackId="fan" stroke="none" fill={c.band[0]} fillOpacity={0.5} isAnimationActive={false} />
                <Line dataKey="p50" type="monotone" stroke={c.median} strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceLine y={result.startingTotal} stroke={c.start} strokeDasharray="4 4" label={{ value: 'start', fontSize: 10, fill: c.start, position: 'right' }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-stone-500 dark:text-slate-400">
              <Legend swatch={c.band[0]} label="p5–p10 / p90–p95" />
              <Legend swatch={c.band[1]} label="p10–p25 / p75–p90" />
              <Legend swatch={c.band[2]} label="p25–p75" />
              <Legend swatch={c.median} label="median (p50)" thickLine />
              <Legend swatch={c.start} label={`start (${fmt$M(result.startingTotal)})`} dashed />
            </div>
          </div>

          {histData && (
            <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                  Year-{params.years} final wealth distribution (real $M)
                </p>
                <p className="text-[10px] text-stone-500 dark:text-slate-400">
                  {histData.excluded.toLocaleString()} ruin paths excluded ({fmtPct(histData.excluded / histData.total)})
                </p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={histData.bins.map(b => ({ ...b, mid: (b.x0 + b.x1) / 2 }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                  <XAxis
                    dataKey="mid"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tick={{ fontSize: 10, fill: c.axis }}
                    tickFormatter={(v: number) => fmt$M(v, 0)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: c.axis }} />
                  <Tooltip content={<HistogramTooltip c={c} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <ReferenceLine x={result.startingTotal} stroke={c.start} strokeDasharray="4 4" />
                  <Bar dataKey="count" isAnimationActive={false}>
                    {histData.bins.map((b, i) => (
                      <Cell key={i} fill={b.aboveStart ? c.good : c.bad} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-stone-500 dark:text-slate-400">
                <Legend swatch={c.good} label="above starting wealth" />
                <Legend swatch={c.bad} label="below starting wealth" />
                <Legend swatch={c.start} label={`start (${fmt$M(result.startingTotal)})`} dashed />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
              Year-{params.years} percentile table (real $M)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-slate-400">
                    {finalRows.map(r => (
                      <th key={r.q} className="px-2 py-1 font-medium">
                        p{Math.round(r.q * 100)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {finalRows.map(r => (
                      <td
                        key={r.q}
                        className={`px-2 py-1 ${
                          r.value >= result.startingTotal
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {fmt$M(r.value)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-stone-500 dark:text-slate-400">
              Includes ruin paths (final wealth = $0M when applicable).
            </p>
          </div>
        </>
      )}

      {!hasRun && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Configure inputs above and press <strong>Run simulation</strong>. The default 100,000 × 50-year run takes a few seconds in the browser.
        </div>
      )}

      <footer className="pt-4 text-center text-[10px] text-gray-400 dark:text-slate-500">
        All calculations run locally in your browser. Returns are real (inflation-adjusted) and stylized — not financial advice.
      </footer>
    </div>
  )
}

function Legend({ swatch, label, dashed, thickLine }: { swatch: string; label: string; dashed?: boolean; thickLine?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {thickLine ? (
        <span className="inline-block h-0.5 w-4 rounded" style={{ background: swatch }} />
      ) : (
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ background: dashed ? 'transparent' : swatch, border: dashed ? `1.5px dashed ${swatch}` : undefined }}
        />
      )}
      <span>{label}</span>
    </span>
  )
}
