import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TODAY, useChartColors, type DateRange } from '../components/chartAxes.ts'
import { fmt$, fmtFullDate, fmtNum, fmtPrice } from '../format.ts'
import { CostCards } from './dashboard/CostCards.tsx'
import { DashboardCharts } from './dashboard/DashboardCharts.tsx'
import { EarningsCards } from './dashboard/EarningsCards.tsx'
import { ShareCards } from './dashboard/ShareCards.tsx'
import {
  computeActiveLoans, computeBreakdowns, computeCardValues, computeGrantHoldings,
  findStalePrice, hasDivergentFuturePrice, lastTimelineDate, maxTimelineDate,
} from './Dashboard.math.ts'
import { api, apiFetchBlob } from '../../api.ts'
import type { DashboardData, TimelineEvent, PriceEntry, LoanEntry, GrantEntry, TaxSettings, SaleEntry, ExitPreview, DeductionPreview } from '../../api.ts'
import { platform } from '../../platform/index.ts'
import ExitBreakdownCard from '../components/ExitBreakdownCard.tsx'
import { useApiData } from '../hooks/useApiData.ts'
import ImportWizard from '../components/ImportWizard.tsx'
import TipCarousel from '../components/TipCarousel.tsx'
import { useViewing } from '../../scaffold/contexts/viewing.ts'
import { HeroCard, IconTile, Eyebrow } from '../../scaffold/components/ui/Card.tsx'
import { cardClass } from '../../scaffold/components/ui/cardShell.ts'
import { Sparkline, IconTrendUp } from '../../scaffold/components/ui/icons.tsx'
import { StatCard as Card } from '../components/StatCard.tsx'

/**
 * Nudge when the newest share price on file is from an earlier year.
 *
 * Epic announces a price each spring, and every figure on this page is computed
 * from the newest one on file. Between announcements — or if someone simply has
 * not added this year's yet — the whole position is valued at a price that can
 * be a year or more old, with nothing on screen to say so. Dismissal is keyed to
 * the stale year, so it stays gone until a new year makes it true again.
 */
function StalePriceBanner({ latest, readOnly }: { latest: PriceEntry; readOnly: boolean }) {
  const key = `stale-price-dismissed-${latest.effective_date.slice(0, 4)}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  if (dismissed) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">
          Your newest share price is from {latest.effective_date.slice(0, 4)} ({fmtPrice(latest.price)}).
        </span>{' '}
        Everything here is valued at it, so your position probably reads low.
        {!readOnly && ' Add this year\'s price to bring these figures up to date.'}
      </p>
      {!readOnly && (
        <Link
          to="/prices"
          className="rounded-lg bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover"
        >
          Add a price
        </Link>
      )}
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          try { localStorage.setItem(key, '1') } catch { /* private mode */ }
        }}
        className="text-xs font-medium text-amber-800 hover:underline dark:text-amber-300"
      >
        Dismiss
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const readOnly = !!viewing

  const fetchDashboard = useCallback(() => vid ? api.getSharedDashboard(vid) : api.getDashboard(), [vid])
  const fetchEvents = useCallback(() => vid ? api.getSharedEvents(vid) : api.getEvents(), [vid])
  const fetchPrices = useCallback(() => vid ? api.getSharedPrices(vid) : api.getPrices(), [vid])
  const fetchLoans = useCallback(() => vid ? api.getSharedLoans(vid) : api.getLoans(), [vid])
  const fetchGrants = useCallback(() => vid ? api.getSharedGrants(vid) : api.getGrants(), [vid])
  const fetchTaxSettings = useCallback(() => vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(), [vid])
  const fetchSales = useCallback(() => vid ? api.getSharedSales(vid) : api.getSales(), [vid])

  const { data: dash, loading: dashLoading, reload: reloadDash } = useApiData<DashboardData>(fetchDashboard)
  const { data: events, reload: reloadEvents } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans } = useApiData<LoanEntry[]>(fetchLoans)
  const { data: grantsData } = useApiData<GrantEntry[]>(fetchGrants)
  const { data: taxSettings, reload: reloadTaxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
  const { data: sales } = useApiData<SaleEntry[]>(fetchSales)
  const c = useChartColors()
  const [rangeInterest, setRangeInterest] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [rangeLoan, setRangeLoan] = useState<DateRange>({ mode: 'all', start: '', end: '' })
  const [range, setRange] = useState<DateRange>(() => {
    try {
      const saved = localStorage.getItem('dashboard_range')
      if (saved) return JSON.parse(saved) as DateRange
    } catch {}
    return { mode: 'all', start: '', end: '' }
  })
  const [dateMode, setDateMode] = useState<'today' | 'last-event' | 'custom'>(() => {
    const saved = localStorage.getItem('dashboard_dateMode')
    if (saved === 'today' || saved === 'last-event' || saved === 'custom') return saved
    return 'today'
  })
  const [cardDate, setCardDate] = useState<string>(() => {
    const mode = localStorage.getItem('dashboard_dateMode')
    if (!mode || mode === 'today') return TODAY
    if (mode === 'last-event') return TODAY // resolved after events load via effect
    return localStorage.getItem('dashboard_cardDate') ?? TODAY
  })
  const [exitBreakdownOpen, setExitBreakdownOpen] = useState(false)
  const [openBreakdowns, setOpenBreakdowns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('dashboard_openBreakdowns')
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch {}
    const initial = new Set<string>()
    if (localStorage.getItem('dashboard_holdingsOpen') === 'true') initial.add('grants')
    if (localStorage.getItem('dashboard_loansOpen') === 'true') initial.add('activeLoans')
    return initial
  })
  const toggleBreakdown = useCallback((key: string) => {
    setOpenBreakdowns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])
  useEffect(() => {
    if (vid) return // viewer changes are in-memory only
    localStorage.setItem('dashboard_openBreakdowns', JSON.stringify([...openBreakdowns]))
  }, [openBreakdowns, vid])

  // Load an exit preview for the current cardDate (only meaningful for today or later).
  const showExitPreview = cardDate >= TODAY
  const [exitPreview, setExitPreview] = useState<ExitPreview | null | 'loading'>(null)

  useEffect(() => {
    if (!showExitPreview) {
      setExitPreview(null)
      return
    }
    setExitPreview('loading')
    const timer = setTimeout(() => {
      const fetcher = vid ? api.getSharedPreviewExit(vid, cardDate) : api.previewExit(cardDate)
      fetcher
        .then(result => setExitPreview(result))
        .catch(() => setExitPreview(null))
    }, 200)
    return () => clearTimeout(timer)
  }, [cardDate, showExitPreview, vid])

  // Investment interest deduction preview
  const [pendingDeduction, setPendingDeduction] = useState<boolean | null>(null)
  const [deductionPreview, setDeductionPreview] = useState<DeductionPreview | null | 'loading'>(null)
  const [savingDeduction, setSavingDeduction] = useState(false)

  // Reset pending when saved setting reloads
  useEffect(() => { setPendingDeduction(null) }, [taxSettings])

  const savedDeduction = taxSettings?.deduct_investment_interest ?? false
  const pendingDeductionChanged = pendingDeduction !== null && pendingDeduction !== savedDeduction

  // When toggling on for the first time (no existing exclusions), tell the
  // preview to auto-exclude past years so the number matches what Apply will do.
  const shouldExcludePast = pendingDeduction === true && !savedDeduction && !taxSettings?.deduction_excluded_years?.length

  useEffect(() => {
    if (!pendingDeductionChanged || pendingDeduction === null) {
      setDeductionPreview(null)
      return
    }
    setDeductionPreview('loading')
    const timer = setTimeout(() => {
      api.previewDeduction(pendingDeduction, shouldExcludePast)
        .then(result => setDeductionPreview(result))
        .catch(() => setDeductionPreview(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [pendingDeductionChanged, pendingDeduction, shouldExcludePast])

  async function applyDeduction(enabled: boolean) {
    setSavingDeduction(true)
    try {
      const update: Partial<TaxSettings> = { deduct_investment_interest: enabled }
      // When first enabling and no year customization exists yet,
      // auto-exclude past years (you can't retroactively itemize)
      if (enabled && taxSettings && !taxSettings.deduction_excluded_years?.length) {
        const thisYear = new Date().getFullYear()
        const pastYears = (taxSettings.taxable_years ?? []).filter(y => y < thisYear)
        if (pastYears.length > 0) {
          update.deduction_excluded_years = pastYears
        }
      }
      await api.updateTaxSettings(update)
      reloadDash()
      reloadEvents()
      reloadTaxSettings()
    } finally {
      setSavingDeduction(false)
    }
  }

  useEffect(() => {
    if (vid) return
    localStorage.setItem('dashboard_range', JSON.stringify(range))
  }, [range, vid])

  useEffect(() => {
    if (vid) return
    localStorage.setItem('dashboard_dateMode', dateMode)
    if (dateMode === 'custom') localStorage.setItem('dashboard_cardDate', cardDate)
  }, [dateMode, cardDate, vid])

  // Load owner's saved dashboard prefs when viewing — used as the initial state
  // for date-mode / cardDate / range / openBreakdowns. Local changes the viewer
  // makes from here are in-memory only (the gates above prevent persistence).
  // Owner's own dashboard saves to the server too, so the next viewer fetch
  // reflects the owner's latest choice. Runs once per viewing context change.
  const ownerPrefsAppliedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!vid) {
      ownerPrefsAppliedRef.current = null
      return
    }
    if (ownerPrefsAppliedRef.current === vid) return
    api.getSharedDashboardPrefs(vid)
      .then(({ prefs }) => {
        ownerPrefsAppliedRef.current = vid
        const m = (prefs as Record<string, unknown>).dateMode
        if (m === 'today' || m === 'last-event' || m === 'custom') setDateMode(m)
        const cd = (prefs as Record<string, unknown>).cardDate
        if (typeof cd === 'string' && cd.length === 10) setCardDate(cd)
        const rg = (prefs as Record<string, unknown>).range
        if (rg && typeof rg === 'object' && 'mode' in rg) setRange(rg as DateRange)
        const ob = (prefs as Record<string, unknown>).openBreakdowns
        if (Array.isArray(ob)) setOpenBreakdowns(new Set(ob.filter(x => typeof x === 'string') as string[]))
      })
      .catch(() => {})
  }, [vid])

  // Sync owner's dashboard prefs to the server (debounced) so shared viewers
  // see the owner's latest choices. Skipped while viewing (viewer changes don't
  // overwrite the owner's persisted prefs).
  useEffect(() => {
    if (vid) return
    const t = setTimeout(() => {
      api.saveDashboardPrefs({
        dateMode,
        cardDate,
        range,
        openBreakdowns: [...openBreakdowns],
      } as Record<string, unknown>).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [vid, dateMode, cardDate, range, openBreakdowns])

  // Only show projected/dashed styling when a future price actually differs from the current price
  const hasFuturePrices = useMemo(() => hasDivergentFuturePrice(prices), [prices])

  // Last event/price date for default end in range picker
  const maxDate = useMemo(() => maxTimelineDate(events, prices), [events, prices])

  // The newest non-estimated price, when it predates the current year. Estimates
  // are projections the user made themselves, so they do not count as knowing
  // this year's price.
  const stalePrice = useMemo(() => findStalePrice(prices), [prices])

  // Date of the last event on the timeline, projections included
  const lastEventDate = useMemo(() => lastTimelineDate(events), [events])

  // Keep cardDate in sync when using a dynamic mode
  useEffect(() => {
    if (dateMode === 'today') setCardDate(TODAY)
    else if (dateMode === 'last-event') setCardDate(lastEventDate)
  }, [dateMode, lastEventDate])

  // Card values computed from local data as of cardDate
  const cardValues = useMemo(() => computeCardValues(events, loans, sales, taxSettings, cardDate, prices), [events, loans, sales, taxSettings, cardDate, prices])

  // Per-grant holdings breakdown as of cardDate
  const grantHoldings = useMemo(() => computeGrantHoldings(grantsData, events, loans, sales, taxSettings, cardDate), [grantsData, events, loans, sales, taxSettings, cardDate])

  // Active (non-settled, non-refinanced) loans as of cardDate
  const activeLoans = useMemo(() => computeActiveLoans(loans, events, sales, cardDate), [loans, events, sales, cardDate])

  // Breakdown data (Cash/Income/Cap Gains/Interest/Tax) computed as of cardDate.
  const breakdowns = useMemo(() => computeBreakdowns(events, loans, sales, taxSettings, cardDate), [events, loans, sales, taxSettings, cardDate])

  const [downloading, setDownloading] = useState(false)
  async function downloadReport() {
    setDownloading(true)
    try {
      const exportUrl = vid
        ? `/api/sharing/view/${vid}/export/excel`
        : `/api/export/holdings-report?as_of=${encodeURIComponent(cardDate)}`
      const blob = await apiFetchBlob(exportUrl, 'Export failed')
      await platform.files.saveBlob(blob, `Holdings_Report_${cardDate}.xlsx`)
    } catch { /* silent */ }
    setDownloading(false)
  }

  if (dashLoading) {
    return <p className="p-6 text-center text-sm text-cs-text-2">Loading...</p>
  }

  if (!dash) {
    return <p className="p-6 text-center text-sm text-red-500">Failed to load dashboard</p>
  }

  const isEmpty = !events || events.length === 0

  if (isEmpty && !readOnly) {
    return <ImportWizard onComplete={reloadEvents} />
  }

  if (isEmpty && readOnly) {
    return <p className="py-12 text-center text-sm text-cs-muted">This user has no data yet.</p>
  }

  const cv = cardValues ?? {
    current_price: dash.current_price,
    total_shares: dash.total_shares,
    total_income: dash.total_income,
    total_cap_gains: dash.total_cap_gains,
    total_loan_principal: dash.total_loan_principal,
    total_tax_paid: dash.total_tax_paid ?? 0,
    cash_received: dash.cash_received ?? 0,
    interest_deduction_total: dash.interest_deduction_total ?? 0,
    tax_savings_from_deduction: dash.tax_savings_from_deduction ?? 0,
    next_event: dash.next_event,
    next_event_detail: null as TimelineEvent | null,
    total_interest: 0,
    price_is_estimate: false,
  }
  const hasInterestDeduction = (cv.interest_deduction_total ?? 0) > 0
  const hasInterestLoans = loans?.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') ?? false
  const showDeductionCard = hasInterestDeduction || hasInterestLoans

  // Computed once and shared by the hero card and the Value Today card below — they used to
  // each call grantHoldings.reduce() independently, which is how the two could silently drift
  // apart if only one call site got a future fix.
  const totalValue = grantHoldings ? grantHoldings.reduce((s, h) => s + h.totalValue, 0) : 0

  return (
    <div className="space-y-6">
      {/* Date selector for card values */}
      <div className="rounded-xl border border-cs-border bg-cs-surface px-3 py-2.5 shadow-card">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-cs-muted">As of</span>
          <input
            type="date"
            value={cardDate}
            max={maxDate}
            onChange={e => { setDateMode('custom'); setCardDate(e.target.value) }}
            className="h-7 flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 text-xs text-cs-text"
          />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="shrink-0 text-xs text-cs-muted">Jump to:</span>
          {([
            { label: 'Today', mode: 'today' as const },
            { label: 'Last event', mode: 'last-event' as const, title: 'Jump to your last scheduled event' },
          ]).map(({ label, mode, title }) => (
            <button
              key={label}
              onClick={() => setDateMode(mode)}
              title={title}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                dateMode === mode
                  ? 'bg-cs-brand text-white'
                  : 'bg-cs-raised text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700 '
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={downloadReport}
            disabled={downloading}
            title="Download holdings report as Excel"
            className="ml-auto text-xs text-cs-muted hover:text-cs-text-2 disabled:opacity-50 "
          >
            {downloading ? '…' : 'Export'}
          </button>
        </div>
      </div>

      {!readOnly && <TipCarousel onApply={() => { reloadDash(); reloadEvents(); reloadTaxSettings() }} />}

      {stalePrice && <StalePriceBanner latest={stalePrice} readOnly={readOnly} />}

      {grantHoldings && (
        <HeroCard watermark={<Sparkline className="h-24 w-40" color="#fff" />}>
          <Eyebrow className="text-white">Net worth · as of {fmtFullDate(cardDate)}</Eyebrow>
          <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">
            {fmt$(totalValue - cv.total_loan_principal)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white">
            <span><span className="font-semibold">{fmtNum(cv.total_shares)}</span> vested shares</span>
            <span className="hidden h-1 w-1 rounded-full bg-white/60 sm:inline-block" />
            <span>
              <span className="font-semibold">{fmtPrice(cv.current_price)}</span> / share
              {cv.price_is_estimate && <span className="ml-1">(est.)</span>}
            </span>
            {cv.total_loan_principal > 0 && (
              <>
                <span className="hidden h-1 w-1 rounded-full bg-white/60 sm:inline-block" />
                <span>{fmt$(totalValue)} in shares − {fmt$(cv.total_loan_principal)} loans</span>
              </>
            )}
          </div>
        </HeroCard>
      )}

      {/* (F) aria-live so screen readers announce summary updates when cardDate changes */}
      <div aria-live="polite" aria-atomic="true" className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cs-muted">Up to this date</p>

        <ShareCards cv={cv} cardDate={cardDate} grantHoldings={grantHoldings}
          totalValue={totalValue} openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />

        <EarningsCards cv={cv} breakdowns={breakdowns}
          openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />

        <CostCards cv={cv} activeLoans={activeLoans} breakdowns={breakdowns}
          hasInterestDeduction={hasInterestDeduction}
          openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />
      </div>

      {showExitPreview && (
        <div aria-live="polite" aria-atomic="true" className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cs-muted">
            If you exited on this date
          </p>
          {exitPreview === 'loading' ? (
            <p className="text-xs text-cs-muted">Calculating…</p>
          ) : exitPreview ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  onClick={() => setExitBreakdownOpen(o => !o)}
                  aria-expanded={exitBreakdownOpen}
                  className={cardClass('md', 'col-span-2 text-left transition hover:-translate-y-0.5 hover:shadow-pop')}
                >
                  <div className="flex items-center justify-between">
                    <IconTile tone="emerald" className="h-8 w-8 rounded-lg">
                      <IconTrendUp className="h-4 w-4" />
                    </IconTile>
                    <span className={`text-cs-muted transition-transform ${exitBreakdownOpen ? 'rotate-180' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  </div>
                  <p className="mt-2.5 text-xs font-medium uppercase tracking-wide text-cs-text-2">Net Cash at Exit</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-cs-text">{fmt$(exitPreview.net_cash)}</p>
                </button>
                <Card label="Gross Proceeds" value={fmt$(exitPreview.gross_vested + exitPreview.unvested_cost_proceeds)} variant="gains" subtitle="Liquidated shares × price" />
                <Card label="Loans Paid Off" value={fmt$(exitPreview.outstanding_principal + exitPreview.outstanding_accrued_interest)} variant="loans" subtitle="Principal + accrued interest" />
                <Card label="Est. Divest Tax" value={fmt$(exitPreview.liquidation_tax)} variant="tax" subtitle="Capital gains on liquidation" />
              </div>
              {exitBreakdownOpen && <ExitBreakdownCard s={exitPreview} />}
            </>
          ) : (
            <p className="text-xs text-cs-muted">No price data for this date</p>
          )}
        </div>
      )}

      {showDeductionCard && !readOnly && (() => {
        const displayEnabled = pendingDeduction ?? savedDeduction
        const currentSavings = cardValues?.tax_savings_from_deduction ?? dash.tax_savings_from_deduction ?? 0
        const previewSavings = pendingDeductionChanged
          ? (deductionPreview === 'loading' ? null : deductionPreview?.tax_savings_from_deduction ?? null)
          : null
        const delta = pendingDeductionChanged
          ? (deductionPreview === 'loading' ? '…' : previewSavings !== null
            ? (displayEnabled ? `+${fmt$(previewSavings)}` : `−${fmt$(currentSavings)}`)
            : null)
          : (displayEnabled ? fmt$(currentSavings) : null)
        const excludedYears = new Set(taxSettings?.deduction_excluded_years ?? [])
        const allYears = [...(taxSettings?.taxable_years ?? [])].sort((a, b) => a - b)
        const appliedYears = allYears.filter(y => !excludedYears.has(y))
        const appliedLabel = appliedYears.length === 0
          ? 'No years applied.'
          : appliedYears.length === allYears.length
            ? `Applied to all years (${appliedYears[0]}–${appliedYears[appliedYears.length - 1]}).`
            : appliedYears.length <= 4
              ? `Applied to ${appliedYears.join(', ')}.`
              : `Applied to ${appliedYears[0]}–${appliedYears[appliedYears.length - 1]} (${excludedYears.size} yr${excludedYears.size !== 1 ? 's' : ''} excluded).`
        return (
          <div className="rounded-md bg-cs-raised px-3 py-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-cs-muted">Interest deduction</span>
              <span className={`flex-1 font-semibold tabular-nums ${pendingDeductionChanged ? (displayEnabled ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400') : 'text-cs-text-2'}`}>
                {delta ?? '—'}
              </span>
              {pendingDeductionChanged && (
                <>
                  <button
                    onClick={() => applyDeduction(pendingDeduction!)}
                    disabled={savingDeduction || deductionPreview === 'loading'}
                    className="rounded bg-rose-700 px-2.5 py-1 font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                  >
                    {savingDeduction ? '…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => setPendingDeduction(null)}
                    disabled={savingDeduction}
                    className="text-cs-muted hover:text-cs-text-2 disabled:opacity-50 "
                  >
                    ✕
                  </button>
                </>
              )}
              <button
                role="switch"
                aria-checked={displayEnabled}
                onClick={() => setPendingDeduction(!displayEnabled)}
                disabled={savingDeduction}
                className={`relative shrink-0 h-6 w-11 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${displayEnabled ? 'bg-purple-600 dark:bg-purple-500' : 'bg-cs-border-strong '}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${displayEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {savedDeduction && !pendingDeductionChanged && (
              <p className="mt-1 text-[10px] text-cs-muted">
                {appliedLabel}{' '}
                <a href="/settings" className="underline hover:text-cs-text">
                  Customize years
                </a>
              </p>
            )}
          </div>
        )
      })()}

      <DashboardCharts
        events={events} prices={prices} loans={loans} dash={dash} taxSettings={taxSettings} c={c}
        range={range} setRange={setRange}
        rangeInterest={rangeInterest} setRangeInterest={setRangeInterest}
        rangeLoan={rangeLoan} setRangeLoan={setRangeLoan}
        maxDate={maxDate} hasFuturePrices={hasFuturePrices} />
    </div>
  )
}
