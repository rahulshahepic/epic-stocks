import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { api, type TaxSettings } from '../../api.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import { useMe, updateMeCache } from '../../scaffold/hooks/useMe.ts'
import { capGainsRate } from './CompCalculator.math.ts'
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

function InfoButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={e => {
        // Stop the click from bubbling to the surrounding <label>, which would
        // refocus the associated input.
        e.stopPropagation()
        onToggle()
      }}
      aria-label={`Show ${label} explanation`}
      aria-expanded={open}
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-stone-400 text-[9px] font-bold leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:border-slate-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      ?
    </button>
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
  info?: ReactNode
}
function NumInput({ label, value, onChange, step, min, max, suffix, hint, info }: NumInputProps) {
  // Use local string state so leading zeros (e.g. "025") don't get stuck when
  // parseFloat collapses them back to the same numeric prop and React's
  // controlled input bails out of a DOM update.
  const [text, setText] = useState<string>(() => (Number.isFinite(value) ? String(value) : '0'))
  const [focused, setFocused] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const inputId = useId()

  useEffect(() => {
    if (focused) return
    const parsed = parseFloat(text)
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(Number.isFinite(value) ? String(value) : '0')
    }
  }, [value, focused, text])

  // Note: the InfoButton lives OUTSIDE the <label> so testing-library doesn't
  // associate it with the input via label-contains-control matching (that
  // would make getByLabelText return the button instead of the input).
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label htmlFor={inputId} className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
          {label}
          {suffix && <span className="ml-1 text-gray-400 dark:text-slate-500">({suffix})</span>}
        </label>
        {info && <InfoButton open={infoOpen} onToggle={() => setInfoOpen(o => !o)} label={label} />}
      </div>
      <input
        id={inputId}
        type="number"
        step={step ?? 'any'}
        min={min}
        max={max}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={e => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          onChange(Number.isFinite(v) ? v : 0)
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseFloat(text)
          if (Number.isFinite(parsed)) setText(String(parsed))
          else setText(Number.isFinite(value) ? String(value) : '0')
        }}
        className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      {hint && <span className="text-[10px] text-gray-400 dark:text-slate-500">{hint}</span>}
      {info && infoOpen && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {info}
        </div>
      )}
    </div>
  )
}

interface SliderInputProps {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
  hint?: string
  formatValue?: (n: number) => string
}
function SliderInput({ label, value, onChange, min, max, step = 1, suffix, hint, formatValue }: SliderInputProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-[11px] font-medium text-gray-700 dark:text-slate-200">
        <span>
          {label}
          {suffix && <span className="ml-1 text-gray-400 dark:text-slate-500">({suffix})</span>}
        </span>
        <span className="tabular-nums text-gray-900 dark:text-slate-100">
          {formatValue ? formatValue(value) : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-stone-200 accent-rose-600 dark:bg-slate-700"
      />
      {hint && <span className="text-[10px] text-gray-400 dark:text-slate-500">{hint}</span>}
    </label>
  )
}

interface FanRow {
  year: number
  age: number
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
    age: p.age,
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
      <p className="mb-1 font-semibold tabular-nums">Age {row.age} (year {row.year})</p>
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

function ageFromDOB(dob: string | null | undefined, asOf: string = TODAY): number | null {
  if (!dob) return null
  const a = new Date(dob)
  const b = new Date(asOf)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  let years = b.getUTCFullYear() - a.getUTCFullYear()
  const m = b.getUTCMonth() - a.getUTCMonth()
  if (m < 0 || (m === 0 && b.getUTCDate() < a.getUTCDate())) years--
  return years
}

export default function Retirement() {
  const { viewing } = useViewing()
  const c = useChartColors()
  const me = useMe()
  const [retirementDate, setRetirementDate] = useState<string>(TODAY)
  const [exitPreviewLoading, setExitPreviewLoading] = useState(false)
  const exitOverriddenRef = useRef(false)
  const refillOverriddenRef = useRef(false)
  const defaultSpendOverriddenRef = useRef(false)
  const minSpendOverriddenRef = useRef(false)
  const paramsLoadedRef = useRef(false)
  const [params, setParams] = useState<SimParams>(() => ({ ...DEFAULT_PARAMS }))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const [sigmaOpen, setSigmaOpen] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [ownerDOB, setOwnerDOB] = useState<string | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [savingDOB, setSavingDOB] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const vid = viewing?.invitationId

  // Resolve who's DOB we're showing.  When viewing, fetch the owner's profile;
  // otherwise use the cached /me data.
  useEffect(() => {
    if (vid) {
      api.getSharedProfile(vid)
        .then(p => {
          setOwnerDOB(p.date_of_birth)
          setOwnerName(p.name)
        })
        .catch(() => {})
    } else if (me) {
      setOwnerDOB(me.date_of_birth ?? null)
      setOwnerName(me.name)
    }
  }, [vid, me])

  // Load saved sim params (owner's, viewer-readonly when sharing). Run once
  // per (vid) change so a manually-edited param isn't snapped back later.
  useEffect(() => {
    paramsLoadedRef.current = false
    const fetcher = vid ? api.getSharedRetirementParams(vid) : api.getRetirementParams()
    fetcher
      .then(({ params: saved }) => {
        if (saved && typeof saved === 'object') {
          setParams(prev => ({ ...prev, ...saved as Partial<SimParams> }))
          // Treat saved values as user choices: don't auto-overwrite them.
          if ('epicExit' in saved) exitOverriddenRef.current = true
          if ('refillTaxDrag' in saved) refillOverriddenRef.current = true
          if ('defaultSpend' in saved) defaultSpendOverriddenRef.current = true
          if ('minSpend' in saved) minSpendOverriddenRef.current = true
        }
        paramsLoadedRef.current = true
      })
      .catch(() => {
        paramsLoadedRef.current = true
      })
  }, [vid])

  // Push DOB-derived current age into params so the math module uses it.
  // (We keep currentAge in SimParams so `simulate` stays a pure function.)
  useEffect(() => {
    const age = ageFromDOB(ownerDOB)
    if (age != null && age > 0) {
      setParams(prev => (prev.currentAge === age ? prev : { ...prev, currentAge: age }))
    }
  }, [ownerDOB])

  // Pre-fill Epic exit value from previewExit at the chosen retirement date.
  // Uses the shared variant when viewing someone else's account.
  useEffect(() => {
    if (exitOverriddenRef.current) return
    let cancelled = false
    setExitPreviewLoading(true)
    const fetcher = vid ? api.getSharedPreviewExit(vid, retirementDate) : api.previewExit(retirementDate)
    fetcher
      .then(p => {
        if (cancelled || !p) return
        const m = Number((p.net_cash / 1_000_000).toFixed(3))
        setParams(prev => ({ ...prev, epicExit: Math.max(0, m) }))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setExitPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [retirementDate, vid])

  // Pre-fill refill tax drag from the (shared or own) blended LT cap-gains rate.
  useEffect(() => {
    if (refillOverriddenRef.current) return
    const fetcher = vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings()
    fetcher
      .then((ts: TaxSettings) => {
        if (refillOverriddenRef.current) return
        const rate = capGainsRate(ts)
        if (Number.isFinite(rate) && rate >= 0 && rate < 1) {
          setParams(prev => ({ ...prev, refillTaxDrag: Number(rate.toFixed(4)) }))
        }
      })
      .catch(() => {})
  }, [vid])

  // Default spend / min spend auto-derive from total portfolio (3% / 2%).
  // Stops auto-deriving once the user (or saved params) has touched the field.
  useEffect(() => {
    const totalK = (params.epicExit + params.additional) * 1000
    if (totalK <= 0) return
    const wantDefault = Math.round(totalK * 0.03)
    const wantMin = Math.round(totalK * 0.02)
    setParams(prev => {
      let next = prev
      if (!defaultSpendOverriddenRef.current && prev.defaultSpend !== wantDefault) {
        next = { ...next, defaultSpend: wantDefault }
      }
      if (!minSpendOverriddenRef.current && prev.minSpend !== wantMin) {
        next = { ...next, minSpend: wantMin }
      }
      return next
    })
  }, [params.epicExit, params.additional])

  const update = useCallback(<K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }, [])

  const saveDOB = useCallback(async (newDOB: string) => {
    if (vid) return // viewer can't edit owner's DOB
    setSavingDOB(true)
    try {
      const result = await api.updateProfile({ date_of_birth: newDOB || '' })
      setOwnerDOB(result.date_of_birth)
      updateMeCache({ date_of_birth: result.date_of_birth })
    } finally {
      setSavingDOB(false)
    }
  }, [vid])

  const totalPortfolio = params.epicExit + params.additional
  const cashPct = Math.max(0, 1 - params.stockPct - params.bondPct)
  const startingCash = totalPortfolio * cashPct
  const allocOver = params.stockPct + params.bondPct > 1
  const ssAdj = ssAdjustment(params.claimAge, params.fra)
  const ssAnnualK = (params.ssMonthly * 12 / 1000) * ssAdj
  const ssStartYear = Math.max(0, params.claimAge - params.currentAge)
  const years = Math.max(1, Math.round(params.endAge - params.currentAge))
  const dobMissing = !ownerDOB

  const run = useCallback(() => {
    setRunning(true)
    setTimeout(() => {
      try {
        const r = simulate(params)
        setResult(r)
        setHasRun(true)
        // Persist params for the owner only — viewers don't write back.
        if (!vid) {
          setSaveStatus('saving')
          api.saveRetirementParams(params as unknown as Record<string, unknown>)
            .then(() => setSaveStatus('saved'))
            .catch(() => setSaveStatus('idle'))
        }
      } finally {
        setRunning(false)
      }
    }, 30)
  }, [params, vid])

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
            Viewing {viewing.name}&rsquo;s exit value &amp; tax rates · simulation runs in your browser
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
              A {params.paths.toLocaleString()}-path Monte Carlo of a {years}-year retirement (age {params.currentAge} to {params.endAge}), run entirely in your browser.
              Total portfolio is split into stocks, bonds, and cash by the percentages you choose.
              Withdrawals come from cash first, then equity (with a tax drag); cash is refilled only from the year's net positive equity gain (preserves principal).
              Social Security kicks in at your chosen claim age with the SSA early/late factor applied to your FRA monthly benefit.
            </p>
            <p className="mb-2">
              All dollar values are <strong>real</strong> (inflation-adjusted). <strong>Default spend</strong> excludes health insurance — the health-insurance line is added separately and zeros out at age 66 by default (Medicare).
              In bad years (negative portfolio return) spending drops to the <strong>minimum</strong> floor.
            </p>
            <p>
              Pre-populated Epic exit value comes from "If you exited" on the Dashboard for the date you choose below; refill tax drag defaults to your blended LT cap-gains rate from <em>Settings → Tax Rates</em>.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
          {vid ? `${ownerName ?? 'Owner'}'s details` : 'Your details'}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
              Date of birth
            </span>
            <input
              type="date"
              value={ownerDOB ?? ''}
              disabled={!!vid || savingDOB}
              onChange={e => {
                setOwnerDOB(e.target.value || null)
              }}
              onBlur={e => {
                if (!vid) saveDOB(e.target.value)
              }}
              className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none disabled:bg-stone-100 disabled:text-stone-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-400"
            />
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              {vid
                ? 'Set by the data owner'
                : dobMissing
                  ? 'Used to estimate Social Security claim timing and Medicare eligibility (age 65)'
                  : `Saved · age ${ageFromDOB(ownerDOB) ?? '—'} today · used for SS / Medicare timing`}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
              Retirement date
            </span>
            <input
              type="date"
              value={retirementDate}
              onChange={e => {
                exitOverriddenRef.current = false
                setRetirementDate(e.target.value)
              }}
              className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              {exitPreviewLoading ? 'Fetching exit preview…' : 'Drives the exit amount below'}
            </span>
          </label>
        </div>
        <p className="mt-4 mb-2 text-[11px] font-semibold text-gray-700 dark:text-slate-200">Portfolio</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <NumInput
            label="Epic exit value"
            value={params.epicExit}
            onChange={v => {
              exitOverriddenRef.current = true
              update('epicExit', v)
            }}
            min={0}
            step={0.1}
            suffix="$M"
            hint="Auto-filled from the date above; editable"
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
        </div>

        <p className="mt-4 mb-2 text-[11px] font-semibold text-gray-700 dark:text-slate-200">
          Allocation of total portfolio (cash = remainder)
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumInput
            label="Stocks"
            value={Math.round(params.stockPct * 100)}
            onChange={v => update('stockPct', Math.max(0, Math.min(100, v)) / 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
          />
          <NumInput
            label="Bonds"
            value={Math.round(params.bondPct * 100)}
            onChange={v => update('bondPct', Math.max(0, Math.min(100, v)) / 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
              Cash <span className="ml-1 text-gray-400 dark:text-slate-500">(%)</span>
            </span>
            <div className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-sm tabular-nums text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {(cashPct * 100).toFixed(0)}%
            </div>
            <span className={`text-[10px] ${allocOver ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-slate-500'}`}>
              {allocOver ? 'Stocks + Bonds > 100% — adjust' : 'Auto: 100 − stocks − bonds'}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-stone-500 dark:text-slate-400">
          Total portfolio: <strong className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$M(totalPortfolio)}</strong>
          {' '}→ stocks {fmt$M(totalPortfolio * params.stockPct)} ·
          {' '}bonds {fmt$M(totalPortfolio * params.bondPct)} ·
          {' '}cash {fmt$M(startingCash)}
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Spending & taxes</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <NumInput
            label="Default spend"
            value={params.defaultSpend}
            onChange={v => {
              defaultSpendOverriddenRef.current = true
              update('defaultSpend', v)
            }}
            min={0}
            step={5}
            suffix="$K/yr"
            hint="Default = 3% of total portfolio · excludes health insurance"
          />
          <NumInput
            label="Minimum spend (floor)"
            value={params.minSpend}
            onChange={v => {
              minSpendOverriddenRef.current = true
              update('minSpend', v)
            }}
            min={0}
            step={5}
            suffix="$K/yr"
            hint="Default = 2% of total portfolio"
            info={
              <>
                <p className="mb-1">
                  In any year your portfolio loses money (negative return), the simulation cuts spending from your
                  default down to this floor. The bigger the gap between default and floor, the more flexibility
                  you&rsquo;re modelling in bad years.
                </p>
                <p className="mb-1">
                  Defaults: <strong>default spend = 3%</strong> of total portfolio, <strong>floor = 2%</strong>.
                  So on a $10M portfolio you&rsquo;d spend $300K most years and drop to $200K (a 33% cut) in
                  down-market years.
                </p>
                <p>
                  Don&rsquo;t want to model any spending cut? Set this floor equal to your default spend &mdash; the
                  simulation will then keep spending the same in every year regardless of returns.
                </p>
              </>
            }
          />
          <NumInput
            label="Health insurance"
            value={params.healthInsurance}
            onChange={v => update('healthInsurance', v)}
            min={0}
            step={1}
            suffix="$K/yr"
            hint="Pre-Medicare premiums + OOP"
          />
          <NumInput
            label="Refill tax drag"
            value={Math.round(params.refillTaxDrag * 1000) / 10}
            onChange={v => {
              refillOverriddenRef.current = true
              update('refillTaxDrag', Math.max(0, Math.min(99, v)) / 100)
            }}
            min={0}
            max={99}
            step={0.5}
            suffix="%"
            hint="Default = your blended LT cap-gains rate"
          />
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-800">
          <input
            type="checkbox"
            checked={params.zeroHIPost65}
            onChange={e => update('zeroHIPost65', e.target.checked)}
            className="rounded"
          />
          <span className="text-gray-700 dark:text-slate-200">
            Zero out health insurance after age 65 <span className="text-gray-400 dark:text-slate-500">(Medicare kicks in)</span>
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">Return scenario</p>
          <InfoButton open={sigmaOpen} onToggle={() => setSigmaOpen(o => !o)} label="Return scenario" />
        </div>
        {sigmaOpen && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="mb-1">
              Each scenario is a pair of bell-curves describing how stocks and bonds might behave over the
              long run. The <strong>mean</strong> is the average yearly return; <strong>σ (sigma)</strong> is
              how much returns swing year-to-year.
            </p>
            <p className="mb-1">
              Roughly, about 2/3 of years fall within mean&nbsp;&plusmn;&nbsp;σ. So with equity mean&nbsp;7% and
              σ&nbsp;17%, a typical year ranges from about &minus;10% to&nbsp;+24%; about 1 year in&nbsp;20 is
              worse than &minus;27% or better than&nbsp;+41%. Bigger σ = wilder swings (good <em>and</em> bad).
            </p>
            <p>
              <strong>Historical</strong> uses long-run U.S. averages (7% / 1.5% real).&nbsp;
              <strong>Moderate</strong> trims means and slightly widens σ.&nbsp;
              <strong>Cautious</strong> trims them further with the widest σ &mdash; useful for stress-testing.
            </p>
          </div>
        )}
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

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Time horizon</p>
        <SliderInput
          label="Simulate until age"
          value={params.endAge}
          onChange={v => update('endAge', Math.max(params.currentAge + 1, Math.min(110, Math.round(v))))}
          min={Math.min(params.currentAge + 1, 110)}
          max={110}
          step={1}
          hint={`Starts at age ${params.currentAge} (from DOB) · ${years}-year horizon`}
        />
        {dobMissing && (
          <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
            ⚠ Set date of birth above to enable age-based features (current age defaults to 50).
          </p>
        )}
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Social Security</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumInput
            label="FRA monthly benefit"
            value={params.ssMonthly}
            onChange={v => update('ssMonthly', v)}
            min={0}
            step={50}
            suffix="$/mo"
            hint="At age 67 (FRA)"
          />
          <SliderInput
            label="Claim age"
            value={params.claimAge}
            onChange={v => update('claimAge', Math.max(62, Math.min(70, Math.round(v))))}
            min={62}
            max={70}
            step={1}
            formatValue={v => `${v}`}
            hint="62 = early reduction · 70 = max delayed credits"
          />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 sm:gap-3">
          <p className="text-stone-500 dark:text-slate-400">
            Adjustment factor at age {params.claimAge}: <strong className="text-gray-900 dark:text-slate-100">{(ssAdj * 100).toFixed(1)}%</strong> of FRA
          </p>
          <p className="text-stone-500 dark:text-slate-400">
            Adjusted monthly: <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${(params.ssMonthly * ssAdj).toFixed(0)}/mo</strong>
            {' · '}annual: <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${ssAnnualK.toFixed(1)}K</strong>
          </p>
          <p className="text-stone-500 dark:text-slate-400 sm:col-span-2">
            Starts simulation year {ssStartYear} ({params.currentAge >= params.claimAge ? 'immediately' : `age ${params.claimAge}`}).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || allocOver}
          className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400"
        >
          {running ? 'Running…' : hasRun ? 'Re-run simulation' : `Run ${params.paths.toLocaleString()} paths × ${years} years`}
        </button>
        {result && (
          <p className="text-[11px] text-stone-500 dark:text-slate-400">
            {result.finalWealth.length.toLocaleString()} paths simulated.
            {' '}
            {vid
              ? 'Viewer changes are not saved.'
              : saveStatus === 'saving'
                ? 'Saving inputs…'
                : saveStatus === 'saved'
                  ? 'Inputs saved.'
                  : 'Tweak and re-run anytime.'}
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
                <XAxis
                  dataKey="age"
                  tick={{ fontSize: 10, fill: c.axis }}
                  tickFormatter={(v: number) => `${v}`}
                />
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
              <span className="ml-auto">x-axis: age</span>
            </div>
          </div>

          {histData && (
            <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                  Final wealth distribution at age {params.endAge} (real $M)
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
              Final-age percentile table (real $M)
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
          Configure inputs above and press <strong>Run simulation</strong>. The default 100,000 × {years}-year run takes a few seconds in the browser.
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
