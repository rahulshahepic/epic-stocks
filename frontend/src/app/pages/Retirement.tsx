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
import { api } from '../../api.ts'
import { useDark } from '../../scaffold/hooks/useDark.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'
import { useMe, updateMeCache } from '../../scaffold/hooks/useMe.ts'
import {
  computeFanPercentiles,
  computeSpousePayrollTax,
  DEFAULT_PARAMS,
  finalPercentiles,
  fraFromBirthYear,
  HISTORICAL_RETURNS,
  histogram,
  migrateLoadedParams,
  projectedSpend,
  resolveScenarioShifts,
  RETIREMENT_ACCESS_AGE,
  SCENARIO_LABELS,
  simulate,
  SPEND_RAMP_FLOOR,
  SS_EARNINGS_EXEMPT_BEFORE_FRA,
  SS_WAGE_BASE_REAL,
  ssAdjustment,
  type FanPercentiles,
  type Scenario,
  type SimParams,
  type SimResult,
} from './Retirement.math.ts'

const SCENARIO_ORDER: Scenario[] = ['historical', 'moderate', 'cautious', 'custom']
// .year is yyyymm — extract just the calendar year for display.
const HISTORY_FIRST_YEAR = Math.floor(HISTORICAL_RETURNS[0].year / 100)
const HISTORY_LAST_YEAR = Math.floor(HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year / 100)

// Input is in $M. Renders dynamically across the full range so a $80K p10 reads
// "$80K" rather than "$0.08M" — every label on this page goes through here.
function fmt$M(n: number, digits: number = 2): string {
  if (!isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a === 0) return '$0'
  if (a >= 100) return `$${n.toFixed(0)}M`
  if (a >= 10) return `$${n.toFixed(1)}M`
  if (a >= 1) return `$${n.toFixed(digits)}M`
  if (a >= 0.001) return `$${(n * 1000).toFixed(0)}K`
  return `$${(n * 1_000_000).toFixed(0)}`
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

// Info popover for the min-spend control. Shows a worked-examples table so
// the user can see exactly what spending the sim will use at different
// portfolio levels, given their actual default/min/starting numbers.
function SpendRampInfo({
  defaultSpend,
  minSpend,
  startingTotal,
}: {
  defaultSpend: number
  minSpend: number
  startingTotal: number  // $M
}) {
  const floorPct = Math.round(SPEND_RAMP_FLOOR * 100)
  const ratios = [1.0, 0.9, 0.75, 0.6, 0.5, 0.4]
  const rows = ratios.map(r => ({
    ratio: r,
    portfolio: startingTotal * r,
    spend: projectedSpend(r, defaultSpend, minSpend),
  }))
  const flat = defaultSpend > 0 && minSpend === defaultSpend
  return (
    <>
      <p className="mb-1">
        We assume you'd cut back on spending if your nest egg shrank. When your wealth is at <strong>100% or more</strong> of where you started, you spend your <strong>default</strong>. When it drops to <strong>{floorPct}%</strong> or less, you've trimmed all the way down to your <strong>floor</strong>. In between, it scales smoothly.
      </p>
      <p className="mb-1">
        This is what people actually do — travel less, dine out less, skip the kitchen remodel — rather than spending the same in a recession as in a boom. The bigger the gap between default and floor, the more flexibility you're saying you have.
      </p>
      {startingTotal > 0 && defaultSpend > 0 && (
        <table className="my-2 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-stone-300 dark:border-slate-600">
              <th className="py-1 text-left font-semibold">If your wealth is</th>
              <th className="py-1 text-right font-semibold">% of start</th>
              <th className="py-1 text-right font-semibold">You'd spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ratio} className="border-b border-stone-100 dark:border-slate-700/50">
                <td className="py-0.5">{fmt$M(r.portfolio)}</td>
                <td className="py-0.5 text-right">{Math.round(r.ratio * 100)}%</td>
                <td className="py-0.5 text-right tabular-nums">${Math.round(r.spend)}K</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Want to assume you'd never cut back? Set the floor equal to your default — spending then stays flat no matter what the markets do.
        {flat && <span className="ml-1 italic">(That's what you've set right now.)</span>}
      </p>
    </>
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
      <Row k="best 5%" v={row.pct.p95} />
      <Row k="best 10%" v={row.pct.p90} />
      <Row k="best 25%" v={row.pct.p75} />
      <Row k="typical" v={row.pct.p50} />
      <Row k="worst 25%" v={row.pct.p25} />
      <Row k="worst 10%" v={row.pct.p10} />
      <Row k="worst 5%" v={row.pct.p5} />
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
      <p className="tabular-nums">{b.count.toLocaleString()} retirements ended in this range ({b.aboveStart ? 'above' : 'below'} starting wealth)</p>
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
  const [spouseDOB, setSpouseDOB] = useState<string | null>(null)
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
          const rawSaved = saved as Record<string, unknown>
          const savedDate = rawSaved.retirementDate
          const savedSpouseDOB = rawSaved.spouseDOB
          const migrated = migrateLoadedParams(rawSaved)
          // Strip non-SimParams sidecar fields before merging.
          delete (migrated as Record<string, unknown>).retirementDate
          delete (migrated as Record<string, unknown>).spouseDOB
          setParams(prev => ({ ...prev, ...migrated }))
          if (typeof savedDate === 'string' && savedDate) {
            setRetirementDate(savedDate)
          }
          if (typeof savedSpouseDOB === 'string') {
            setSpouseDOB(savedSpouseDOB || null)
          }
          // Treat saved values as user choices: don't auto-overwrite them.
          if ('epicExit' in rawSaved) exitOverriddenRef.current = true
          if ('defaultSpend' in rawSaved) defaultSpendOverriddenRef.current = true
          if ('minSpend' in rawSaved) minSpendOverriddenRef.current = true
        }
        paramsLoadedRef.current = true
      })
      .catch(() => {
        paramsLoadedRef.current = true
      })
  }, [vid])

  // Push the age-at-retirement-date into params as the simulation start age.
  // The exit-preview seeds wealth as of `retirementDate`, so the horizon must
  // also start there — otherwise the simulation grants free pre-retirement
  // compounding on top of an already-projected balance.
  useEffect(() => {
    const age = ageFromDOB(ownerDOB, retirementDate)
    if (age != null && age > 0) {
      setParams(prev => (prev.currentAge === age ? prev : { ...prev, currentAge: age }))
    }
  }, [ownerDOB, retirementDate])

  // Mirror of currentAge for the spouse — drives spouse SS start year and the
  // Medicare step-down for health insurance.
  useEffect(() => {
    if (!params.includeSpouse) return
    const age = ageFromDOB(spouseDOB, retirementDate)
    if (age != null && age > 0) {
      const birthYear = spouseDOB ? new Date(spouseDOB).getFullYear() : null
      const fra = birthYear != null ? fraFromBirthYear(birthYear) : 67
      setParams(prev => {
        const ageOk = prev.spouseCurrentAge === age
        const fraOk = prev.spouseFra === fra
        return ageOk && fraOk ? prev : { ...prev, spouseCurrentAge: age, spouseFra: fra }
      })
    }
  }, [spouseDOB, retirementDate, params.includeSpouse])

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

  // Pull state tax rates from the user's TaxSettings — federal is bracket-based
  // in the simulator (no user input needed), state is a flat rate from settings.
  // Always synced; the user adjusts state rates in Settings → Tax Rates.
  useEffect(() => {
    const fetcher = vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings()
    fetcher
      .then(ts => {
        // State ordinary income tax uses hard-coded WI brackets in the sim;
        // we only need the LTCG rate from TaxSettings (set this to your
        // post-30%-exclusion effective rate, ~5.36% at the WI top bracket).
        setParams(prev => ({
          ...prev,
          stateLTCGRate: Number.isFinite(ts.state_lt_cg_rate) ? ts.state_lt_cg_rate : 0,
        }))
      })
      .catch(() => {})
  }, [vid])

  // Default spend / min spend auto-derive from total portfolio (3% / 2%).
  // Stops auto-deriving once the user (or saved params) has touched the field.
  useEffect(() => {
    const totalK = (params.epicExit + params.taxableAdditional + params.traditional + params.roth) * 1000
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
  }, [params.epicExit, params.taxableAdditional, params.traditional, params.roth])

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

  // Debounced auto-save: persist the full param set whenever it (or
  // retirementDate / spouseDOB) changes. Owner only; viewer never writes.
  // Skips until the initial load completes so we don't save defaults over a
  // user's already-saved plan during the post-load merge.
  useEffect(() => {
    if (vid || !paramsLoadedRef.current) return
    setSaveStatus('saving')
    const t = setTimeout(() => {
      api.saveRetirementParams({
        ...(params as unknown as Record<string, unknown>),
        retirementDate,
        spouseDOB,
      })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('idle'))
    }, 500)
    return () => clearTimeout(t)
  }, [params, retirementDate, spouseDOB, vid])

  const totalPortfolio = params.epicExit + params.taxableAdditional + params.traditional + params.roth
  const taxableTotal = params.epicExit + params.taxableAdditional
  const cashPct = Math.max(0, 1 - params.stockPct - params.bondPct)
  const cashTargetRaw = totalPortfolio * cashPct
  const startingCash = Math.min(taxableTotal, cashTargetRaw)
  const cashUnderfunded = cashTargetRaw - startingCash > 0.001
  const allocOver = params.stockPct + params.bondPct > 1
  const ssAdj = ssAdjustment(params.claimAge, params.fra)
  const ssAnnualK = (params.ssMonthly * 12 / 1000) * ssAdj
  const ssStartYear = Math.max(0, params.claimAge - params.currentAge)
  const years = Math.max(1, Math.round(params.endAge - params.currentAge))
  const dobMissing = !ownerDOB
  const ageAtRetirement = ageFromDOB(ownerDOB, retirementDate) ?? params.currentAge
  const bridgeYears = Math.max(0, RETIREMENT_ACCESS_AGE - ageAtRetirement)
  const hasLockedAssets = params.traditional + params.roth > 0

  const run = useCallback(() => {
    setRunning(true)
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
        <span className="text-[11px] text-stone-500 dark:text-slate-400">
          {vid
            ? `Viewing ${viewing?.name ?? 'owner'}’s plan — your edits aren’t saved`
            : saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'saved'
                ? 'All inputs saved'
                : 'Inputs save automatically'}
        </span>
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
              We simulate your retirement {params.paths.toLocaleString()} times — from age {params.currentAge} to {params.endAge} — and show you how often things turn out well vs. badly.
              Every run uses real U.S. stock and bond returns from history ({HISTORY_FIRST_YEAR}–{HISTORY_LAST_YEAR}), borrowing multi-year stretches at a time so a 2008-style crash stays glued to the 2009 recovery (instead of cherry-picking only good or bad years).
              Your money is split into stocks, bonds, and cash based on the percentages you set.
            </p>
            <p className="mb-2">
              We track your wealth across four buckets so taxes come out right:
              {' '}<strong>cash</strong> (no tax to spend),
              {' '}<strong>taxable brokerage</strong> (you only owe capital-gains tax on the growth portion, not the original money you put in),
              {' '}<strong>401(k) / Traditional IRA</strong> (locked until age {RETIREMENT_ACCESS_AGE}, then taxed like a paycheck), and
              {' '}<strong>Roth</strong> (locked until age {RETIREMENT_ACCESS_AGE}, then totally tax-free).
              Each year we spend from cash first, then taxable brokerage, then 401(k), then Roth — and we calculate what you'd actually owe in federal + state taxes that year.
              If you retire before age {RETIREMENT_ACCESS_AGE} and your cash + brokerage run dry, the path counts as failed even if your 401(k) is still full — you can't legally touch it yet.
              Social Security kicks in at the age you choose, adjusted for early/late claiming.
            </p>
            <p className="mb-2">
              All dollar amounts are shown in <strong>today's purchasing power</strong> — so $200K spend in year 30 still means "what $200K buys today," not the inflated headline number.
              {' '}<strong>Default spend</strong> is what you live on excluding health insurance, which we add separately — your premium estimate before age 65, then Medicare cost (with extra fees if your income is high) after.
              Got a spouse? We add their Social Security stream and switch your tax brackets to married-filing-jointly.
              We also model that you'd cut spending if your nest egg shrank — at full wealth you spend the default, dropping toward your floor if things go badly.
            </p>
            <p>
              Your Epic exit number is pre-filled from the dashboard's "If you exited" estimate for the retirement date you pick. State tax rates come from <em>Settings → Tax Rates</em>.
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
                  ? 'Used to derive your age at retirement, Social Security claim timing, and Medicare eligibility (age 65)'
                  : `Age ${ageFromDOB(ownerDOB) ?? '—'} today, ${ageFromDOB(ownerDOB, retirementDate) ?? '—'} at retirement`}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
              Retirement date
            </span>
            <input
              type="date"
              value={retirementDate}
              disabled={!!vid}
              onChange={e => {
                exitOverriddenRef.current = false
                setRetirementDate(e.target.value)
              }}
              className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none disabled:bg-stone-100 disabled:text-stone-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-400"
            />
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              {exitPreviewLoading
                ? 'Fetching exit preview…'
                : vid
                  ? 'Set by the data owner'
                  : 'Sets your exit amount and how old you\'ll be when retirement starts'}
            </span>
          </label>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-800">
          <input
            type="checkbox"
            checked={params.includeSpouse}
            disabled={!!vid}
            onChange={e => update('includeSpouse', e.target.checked)}
            className="rounded"
          />
          <span className="text-gray-700 dark:text-slate-200">
            Include spouse <span className="text-gray-400 dark:text-slate-500">(adds their Social Security, switches to married-filing-jointly tax brackets, and counts each person's health insurance separately)</span>
          </span>
        </label>
        {params.includeSpouse && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">
                Spouse date of birth
              </span>
              <input
                type="date"
                value={spouseDOB ?? ''}
                disabled={!!vid}
                onChange={e => setSpouseDOB(e.target.value || null)}
                className="rounded border border-stone-300 bg-white px-2 py-1 text-sm tabular-nums text-gray-900 focus:border-rose-400 focus:outline-none disabled:bg-stone-100 disabled:text-stone-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-400"
              />
              <span className="text-[10px] text-gray-400 dark:text-slate-500">
                {spouseDOB
                  ? `Age ${ageFromDOB(spouseDOB) ?? '—'} today, ${ageFromDOB(spouseDOB, retirementDate) ?? '—'} at retirement`
                  : 'Used to time their Social Security and Medicare (kicks in at 65)'}
              </span>
            </label>
          </div>
        )}
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
            hint="Pre-filled from your dashboard for the retirement date above — you can override it"
          />
          <NumInput
            label="Additional portfolio"
            value={params.taxableAdditional}
            onChange={v => {
              setParams(prev => ({
                ...prev,
                taxableAdditional: v,
                // Simple-mode default: assume fully appreciated (basis = 0).
                // Conservative — most pre-existing brokerage held for years
                // has substantial unrealized gains. Open the advanced view
                // to set a real basis or split into 401(k)/Roth buckets.
                additionalBasis: prev.advanced ? prev.additionalBasis : 0,
              }))
            }}
            min={0}
            step={0.1}
            suffix="$M"
            hint={params.advanced ? 'Pre-existing taxable brokerage' : 'Treated as fully-appreciated taxable; open below for buckets/basis'}
          />
        </div>

        <button
          type="button"
          onClick={() => update('advanced', !params.advanced)}
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 hover:text-rose-800 dark:text-rose-300 dark:hover:text-rose-200"
        >
          <span>{params.advanced ? '▾' : '▸'}</span>
          <span>{params.advanced ? 'Hide account breakdown' : 'Break out by account type (more accurate taxes)'}</span>
        </button>
        {params.advanced && (
          <div className="mt-3 rounded border border-stone-200 bg-stone-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-2 text-[10px] leading-snug text-stone-600 dark:text-slate-400">
              Different account types are taxed very differently — splitting them out makes the simulation match what you'd actually owe each year.
              {' '}<strong>401(k) and Roth are off-limits until age {RETIREMENT_ACCESS_AGE}</strong> (the IRS hits early withdrawals with a 10% penalty), so if you retire earlier, those years have to be funded from your taxable brokerage and cash.
              When you sell from your <strong>brokerage</strong>, you only owe tax on the growth — the original money you put in (your "cost basis") comes back tax-free. Your Epic exit money has full basis because it was just sold.
              <strong> 401(k)</strong> withdrawals are taxed like a paycheck. <strong>Roth</strong> withdrawals are completely tax-free.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumInput
                label="What you originally paid (basis)"
                value={params.additionalBasis}
                onChange={v => update('additionalBasis', Math.max(0, v))}
                min={0}
                step={0.1}
                suffix="$M"
                hint={params.taxableAdditional > 0
                  ? `Of $${params.taxableAdditional.toFixed(2)}M brokerage. Default = $0 (assumes it's all grown from much less).`
                  : 'What you originally paid for your brokerage assets · default = $0'}
              />
              <NumInput
                label="401(k) / Traditional IRA"
                value={params.traditional}
                onChange={v => update('traditional', Math.max(0, v))}
                min={0}
                step={0.1}
                suffix="$M"
                hint={`Locked until age ${RETIREMENT_ACCESS_AGE} · taxed as income`}
              />
              <NumInput
                label="Roth IRA / Roth 401(k)"
                value={params.roth}
                onChange={v => update('roth', Math.max(0, v))}
                min={0}
                step={0.1}
                suffix="$M"
                hint={`Locked until age ${RETIREMENT_ACCESS_AGE} · withdrawals are tax-free`}
              />
            </div>
            {bridgeYears > 0 && hasLockedAssets && (
              <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                ⚠ You'd retire {bridgeYears.toFixed(1)} years before you can touch your 401(k)/Roth. Those bridge years have to come from your cash and brokerage — make sure they can cover it.
              </p>
            )}
          </div>
        )}

        <p className="mt-4 mb-2 text-[11px] font-semibold text-gray-700 dark:text-slate-200">
          How your money is invested (cash fills in the rest)
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
              {allocOver ? 'Stocks + bonds add to more than 100% — adjust' : 'Whatever\'s left after stocks + bonds'}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-stone-500 dark:text-slate-400">
          Total portfolio: <strong className="tabular-nums text-gray-900 dark:text-slate-100">{fmt$M(totalPortfolio)}</strong>
          {' '}→ stocks {fmt$M(totalPortfolio * params.stockPct)} ·
          {' '}bonds {fmt$M(totalPortfolio * params.bondPct)} ·
          {' '}cash {fmt$M(startingCash)}
        </p>
        <p className="mt-1 text-[10px] leading-snug text-stone-500 dark:text-slate-400">
          We assume your cash sits outside your retirement accounts (checking, savings, money market) — your 401(k) and Roth are treated as fully invested in stocks and bonds.
          If you actually keep stable-value funds inside a 401(k), the simulator will treat that as invested rather than spendable cash.
          {cashUnderfunded && params.advanced && (
            <span className="ml-1 text-amber-700 dark:text-amber-300">
              ⚠ You've asked for more cash than fits in your taxable accounts — the rest stays invested in your 401(k)/Roth.
            </span>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Spending</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
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
            hint="What you live on per year (excluding health insurance) · auto-set to 3% of your portfolio"
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
            hint="What you'd cut down to in a bad year · auto-set to 2% of your portfolio"
            info={
              <SpendRampInfo
                defaultSpend={params.defaultSpend}
                minSpend={params.minSpend}
                startingTotal={totalPortfolio}
              />
            }
          />
          <NumInput
            label="Health insurance"
            value={params.healthInsurance}
            onChange={v => update('healthInsurance', v)}
            min={0}
            step={1}
            suffix="$K/yr"
            hint="What you pay before Medicare kicks in (premium + out-of-pocket)"
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
            Switch to Medicare costs at age 65 <span className="text-gray-400 dark:text-slate-500">(replaces your premium with base Medicare, plus an income-based surcharge if your taxable income is high)</span>
          </span>
        </label>
        <p className="mt-3 text-[10px] leading-snug text-stone-500 dark:text-slate-400">
          Each year we calculate what you'd actually owe in taxes: federal income brackets (with the bigger married-filing-jointly brackets if you've added a spouse), federal capital-gains tax on investment growth, an extra 3.8% surcharge on investment income for higher earners, Medicare income surcharges after 65, Wisconsin progressive brackets (3.5%/4.4%/5.3%/7.65%) on 401(k) withdrawals, and {fmtPct(params.stateLTCGRate, 2)} on capital gains (from <em>Settings → Tax Rates</em> — this should be your post-30%-WI-exclusion effective rate, ~5.36% at the top WI bracket).
          We spend from your accounts in order: cash first (no tax), then brokerage (only the growth is taxed), then 401(k), then Roth — and the 401(k)/Roth stay locked until age {RETIREMENT_ACCESS_AGE}.
          <br /><span className="text-stone-400 dark:text-slate-500">Wisconsin assumption: Social Security is exempt from state tax (it still counts toward federal); state income tax uses WI's progressive brackets, not a flat marginal rate. Each dollar lands in its actual WI bracket since we know your full income each year.</span>
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">Return scenario</p>
          <InfoButton open={sigmaOpen} onToggle={() => setSigmaOpen(o => !o)} label="Return scenario" />
        </div>
        {sigmaOpen && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="mb-1">
              For each simulated retirement, we replay actual stretches of U.S. market history ({HISTORY_FIRST_YEAR}–{HISTORY_LAST_YEAR}) instead of making up returns from a formula.
              We pick a random starting month, walk forward month by month (so Oct 1929 is followed by Nov 1929, Sep 2008 by Oct 2008 — crashes stay glued to their actual recoveries), and occasionally jump to a different starting month to mix things up across the {params.paths.toLocaleString()} simulations.
              This is more honest than the usual "average return ± noise" approach, which can quietly invent stretches of bad years that never actually happened together.
            </p>
            <p className="mb-1">
              The four scenarios shift the historical returns up or down to reflect different views on the future:
              <strong> Historical</strong> — exactly what happened {HISTORY_FIRST_YEAR}–{HISTORY_LAST_YEAR}.
              <strong> Moderate</strong> — knock 2 percentage points off stock returns and 0.5pp off bonds (roughly Vanguard's 2025 10-year forecast given today's high valuations).
              <strong> Cautious</strong> — bigger haircut: stocks −3.5pp, bonds −1pp.
              <strong> Custom</strong> — set your own.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {SCENARIO_ORDER.map(s => {
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
              >
                {SCENARIO_LABELS[s]}
              </button>
            )
          })}
        </div>
        {params.scenario === 'custom' && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumInput
              label="Stocks return shift"
              value={Math.round(params.customStockShift * 1000) / 10}
              onChange={v => update('customStockShift', v / 100)}
              step={0.1}
              suffix="pp"
              hint="Added to every resampled stock return. e.g. −2 trims ~2pp/yr off historical"
            />
            <NumInput
              label="Bonds return shift"
              value={Math.round(params.customBondShift * 1000) / 10}
              onChange={v => update('customBondShift', v / 100)}
              step={0.1}
              suffix="pp"
              hint="Added to every resampled bond return"
            />
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-stone-500 dark:text-slate-400">
          Stationary block bootstrap of U.S. {HISTORY_FIRST_YEAR}&ndash;{HISTORY_LAST_YEAR} real returns ({HISTORICAL_RETURNS.length} months, ~20yr mean block).
          {' '}Stocks shift {fmtPct(resolveScenarioShifts(params).stockShift, 1)}, bonds shift {fmtPct(resolveScenarioShifts(params).bondShift, 1)}.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">How long to plan for</p>
        <SliderInput
          label="Plan until you're"
          value={params.endAge}
          onChange={v => update('endAge', Math.max(params.currentAge + 1, Math.min(110, Math.round(v))))}
          min={Math.min(params.currentAge + 1, 110)}
          max={110}
          step={1}
          formatValue={v => `age ${v}`}
          hint={`Retire at ${params.currentAge}, plan ${years} years of retirement (set this past your likely lifespan to be safe)`}
        />
        {dobMissing && (
          <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
            ⚠ Set your date of birth above so we can figure out your age (otherwise we assume 50).
          </p>
        )}
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-200">Social Security</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumInput
            label="Monthly benefit at age 67"
            value={params.ssMonthly}
            onChange={v => update('ssMonthly', v)}
            min={0}
            step={50}
            suffix="$/mo"
            hint='From your "my Social Security" estimate at age 67 (full retirement age)'
          />
          <SliderInput
            label="When you claim"
            value={params.claimAge}
            onChange={v => update('claimAge', Math.max(62, Math.min(70, Math.round(v))))}
            min={62}
            max={70}
            step={1}
            formatValue={v => `age ${v}`}
            hint="Claim at 62 = ~30% smaller checks · wait until 70 = ~24% bigger checks"
          />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 sm:gap-3">
          <p className="text-stone-500 dark:text-slate-400">
            Claiming at {params.claimAge} → you get <strong className="text-gray-900 dark:text-slate-100">{(ssAdj * 100).toFixed(1)}%</strong> of your age-67 benefit
          </p>
          <p className="text-stone-500 dark:text-slate-400">
            That's <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${(params.ssMonthly * ssAdj).toFixed(0)}/mo</strong>
            {' · '}or <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${ssAnnualK.toFixed(1)}K/yr</strong>
          </p>
          <p className="text-stone-500 dark:text-slate-400 sm:col-span-2">
            {params.currentAge >= params.claimAge ? 'Starts immediately (you\'ll be past claim age at retirement).' : `Starts ${ssStartYear} years into retirement (when you turn ${params.claimAge}).`}
          </p>
        </div>
        {params.includeSpouse && (
          <div className="mt-4 border-t border-stone-200 pt-3 dark:border-slate-700">
            <p className="mb-2 text-[11px] font-medium text-gray-700 dark:text-slate-200">Spouse</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumInput
                label="Spouse's monthly benefit at age 67"
                value={params.spouseSsMonthly}
                onChange={v => update('spouseSsMonthly', v)}
                min={0}
                step={50}
                suffix="$/mo"
                hint="0 if no Social Security · if claiming the spousal benefit, use half of the higher earner's amount"
              />
              <SliderInput
                label="When spouse claims"
                value={params.spouseClaimAge}
                onChange={v => update('spouseClaimAge', Math.max(62, Math.min(70, Math.round(v))))}
                min={62}
                max={70}
                step={1}
                formatValue={v => `age ${v}`}
                hint="Claim at 62 = ~30% smaller checks · wait until 70 = ~24% bigger checks"
              />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 sm:gap-3">
              <p className="text-stone-500 dark:text-slate-400">
                Claiming at {params.spouseClaimAge} → spouse gets <strong className="text-gray-900 dark:text-slate-100">{(ssAdjustment(params.spouseClaimAge, params.fra) * 100).toFixed(1)}%</strong> of the age-67 benefit
              </p>
              <p className="text-stone-500 dark:text-slate-400">
                That's <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${(params.spouseSsMonthly * ssAdjustment(params.spouseClaimAge, params.fra)).toFixed(0)}/mo</strong>
              </p>
            </div>

            {/* Spouse employment */}
            <div className="mt-4 border-t border-stone-200 pt-3 dark:border-slate-700">
              <p className="mb-2 text-[11px] font-medium text-gray-700 dark:text-slate-200">Spouse employment</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumInput
                  label="Annual gross income"
                  value={params.spouseWorkIncome}
                  onChange={v => update('spouseWorkIncome', v)}
                  min={0}
                  step={5}
                  suffix="$K/yr"
                  hint="Leave at 0 if spouse is already retired"
                />
                <NumInput
                  label="Stops working at age"
                  value={params.spouseStopWorkAge}
                  onChange={v => update('spouseStopWorkAge', Math.max(params.spouseCurrentAge, Math.round(v)))}
                  min={params.spouseCurrentAge}
                  max={80}
                  step={1}
                  suffix="yrs"
                  hint="Age when spouse's W-2 income ends"
                />
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-stone-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={params.spouseHasEmployerHI}
                  onChange={e => update('spouseHasEmployerHI', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-stone-300 text-rose-600 dark:border-slate-600"
                />
                Spouse's employer covers health insurance while working
                {params.spouseHasEmployerHI && (
                  <span className="text-stone-400 dark:text-slate-500">
                    · saves ~${params.healthInsurance.toFixed(0)}K/yr until age {params.spouseStopWorkAge}
                  </span>
                )}
              </label>
              {params.spouseWorkIncome > 0 && (() => {
                const annualGross = params.spouseWorkIncome * 1_000
                const payroll = computeSpousePayrollTax(annualGross, params.includeSpouse ? 'mfj' : 'single')
                const earningsTestActive = params.spouseClaimAge < params.spouseFra
                  && params.spouseWorkIncome * 1_000 > SS_EARNINGS_EXEMPT_BEFORE_FRA
                return (
                  <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 sm:gap-3">
                    <p className="text-stone-500 dark:text-slate-400">
                      Payroll taxes (SS + Medicare): <strong className="text-gray-900 dark:text-slate-100 tabular-nums">${(payroll / 1_000).toFixed(1)}K/yr</strong>
                      {annualGross > SS_WAGE_BASE_REAL && (
                        <> · SS capped at ${(SS_WAGE_BASE_REAL / 1_000).toFixed(0)}K wage base</>
                      )}
                    </p>
                    {earningsTestActive && (
                      <p className="text-amber-600 dark:text-amber-400">
                        SS earnings test applies — claiming before FRA while earning &gt;${(SS_EARNINGS_EXEMPT_BEFORE_FRA / 1_000).toFixed(0)}K/yr reduces spouse SS benefits until age {params.spouseFra}
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || allocOver}
          className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400"
        >
          {running ? 'Running…' : hasRun ? 'Re-run simulation' : `Simulate ${params.paths.toLocaleString()} retirements × ${years} years`}
        </button>
        {result && (
          <p className="text-[11px] text-stone-500 dark:text-slate-400">
            {result.finalWealth.length.toLocaleString()} retirements simulated.
          </p>
        )}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Ended richer than you started"
              value={fmtPct(result.pctAboveStart)}
              sub={`out of ${result.finalWealth.length.toLocaleString()} simulated retirements`}
              variant={result.pctAboveStart >= 0.5 ? 'good' : 'neutral'}
            />
            <StatCard
              label="Ran out of money"
              value={fmtPct(result.pctRuin)}
              sub="couldn't pay the bills in some year"
              variant={result.pctRuin <= 0.1 ? 'good' : result.pctRuin >= 0.3 ? 'bad' : 'neutral'}
            />
            <StatCard
              label="Typical ending wealth"
              value={fmt$M(result.medianFinalM)}
              sub={`half end above this · started at ${fmt$M(result.startingTotal)}`}
            />
            <StatCard
              label="Bad-case ending wealth"
              value={fmt$M(result.p10FinalM)}
              sub="10% of retirements end below this"
              variant={result.p10FinalM >= result.startingTotal ? 'good' : 'neutral'}
            />
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
              How your wealth could play out over time (today's dollars)
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
              <Legend swatch={c.band[2]} label="middle 50% of outcomes" />
              <Legend swatch={c.band[1]} label="middle 80%" />
              <Legend swatch={c.band[0]} label="middle 90%" />
              <Legend swatch={c.median} label="typical (median) outcome" thickLine />
              <Legend swatch={c.start} label={`starting wealth (${fmt$M(result.startingTotal)})`} dashed />
              <span className="ml-auto">your age →</span>
            </div>
          </div>

          {histData && (
            <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                  Where you end up at age {params.endAge} (today's dollars)
                </p>
                <p className="text-[10px] text-stone-500 dark:text-slate-400">
                  {histData.excluded.toLocaleString()} runs that ran out of money not shown ({fmtPct(histData.excluded / histData.total)})
                  {histData.scale === 'log' && <> · log scale</>}
                </p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={histData.bins.map(b => ({ ...b, mid: (b.x0 + b.x1) / 2 }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                  <XAxis
                    dataKey="mid"
                    type="number"
                    scale={histData.scale === 'log' ? 'log' : 'auto'}
                    domain={
                      histData.scale === 'log' && histData.bins.length > 0
                        ? [histData.bins[0].x0, histData.bins[histData.bins.length - 1].x1]
                        : ['dataMin', 'dataMax']
                    }
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
                <Legend swatch={c.good} label="ended richer than they started" />
                <Legend swatch={c.bad} label="ended poorer" />
                <Legend swatch={c.start} label={`starting wealth (${fmt$M(result.startingTotal)})`} dashed />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
              Range of final outcomes at age {params.endAge} (today's dollars)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-stone-500 dark:text-slate-400">
                    {finalRows.map(r => {
                      const q = Math.round(r.q * 100)
                      const label =
                        q === 1 ? 'worst 1%'
                        : q === 5 ? 'worst 5%'
                        : q === 10 ? 'worst 10%'
                        : q === 25 ? 'worst 25%'
                        : q === 50 ? 'middle (typical)'
                        : q === 75 ? 'best 25%'
                        : q === 90 ? 'best 10%'
                        : q === 95 ? 'best 5%'
                        : q === 99 ? 'best 1%'
                        : `${q}th pct`
                      return (
                        <th key={r.q} className="px-2 py-1 font-medium">{label}</th>
                      )
                    })}
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
              Runs that ran out of money show as $0.
            </p>
          </div>
        </>
      )}

      {!hasRun && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Set your numbers above and hit <strong>Run simulation</strong>. We'll simulate your retirement 100,000 times in your browser — takes a few seconds.
        </div>
      )}

      <footer className="pt-4 text-center text-[10px] text-gray-400 dark:text-slate-500">
        Everything runs in your browser — no data leaves your device. All amounts are in today's purchasing power. This is a planning tool, not financial advice.
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
