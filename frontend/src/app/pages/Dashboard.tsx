import ExitDateComparison from '../components/ExitDateComparison.tsx'
import StarterQuestions from '../components/StarterQuestions.tsx'
import AnnouncedPrice from '../components/AnnouncedPrice.tsx'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import ReminderOffer from '../components/ReminderOffer.tsx'
import AnnualStockSummary from '../components/AnnualStockSummary.tsx'
import EquityTerms from '../components/EquityTerms.tsx'
import PositionTour from '../components/PositionTour.tsx'
import { useMe } from '../../scaffold/hooks/useMe.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useChartColors, type DateRange } from '../components/chartAxes.ts'
import { useToday } from '../dateUtils.ts'
import { fmt$, fmtFullDate, fmtNum, fmtPrice, exitCashLabel, sharePriceBasis, stockValueLabel } from '../format.ts'
import { CostCards } from './dashboard/CostCards.tsx'
import { DashboardCharts } from './dashboard/DashboardCharts.tsx'
import { EarningsCards } from './dashboard/EarningsCards.tsx'
import { ShareCards } from './dashboard/ShareCards.tsx'
import {
  findStalePrice, hasDivergentFuturePrice, lastTimelineDate, maxTimelineDate,
} from './Dashboard.math.ts'
import { api, apiFetchBlob } from '../../api.ts'
import type { TimelineEvent, PriceEntry, LoanEntry, TaxSettings, ExitPreview, DeductionPreview } from '../../api.ts'
import type { DashboardSnapshot, DashboardChartsData } from './Dashboard.types.ts'
import { platform } from '../../platform/index.ts'
import ExitBreakdownCard from '../components/ExitBreakdownCard.tsx'
import { useApiData } from '../hooks/useApiData.ts'
import GetStarted from '../components/GetStarted.tsx'
import TipCarousel from '../components/TipCarousel.tsx'
import { useViewing } from '../../scaffold/contexts/viewing.ts'
import { HeroCard, IconTile, Eyebrow } from '../../scaffold/components/ui/Card.tsx'
import { cardClass } from '../../scaffold/components/ui/cardShell.ts'
import { IconTrendUp } from '../../scaffold/components/ui/icons.tsx'
import { StatCard as Card } from '../components/StatCard.tsx'
import { StockJourney } from '../components/StockJourney.tsx'
import campusWatercolor from '../../assets/campus-watercolor.webp'

/**
 * Nudge when the newest share price on file is from an earlier year.
 *
 * Epic announces a price each spring, and every figure on this page is computed
 * from the newest one on file. Between announcements — or if someone simply has
 * not added this year's yet — the whole position is valued at a price that can
 * be a year or more old, with nothing on screen to say so. Dismissal is keyed to
 * the stale year, so it stays gone until a new year makes it true again.
 */
function StalePriceBanner({ latest, readOnly, onAddPrice }: { latest: PriceEntry; readOnly: boolean; onAddPrice?: () => void }) {
  const key = `stale-price-dismissed-${latest.effective_date.slice(0, 4)}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  if (dismissed) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">
          Your last recorded share price is from {latest.effective_date.slice(0, 4)} ({fmtPrice(latest.price)}).
        </span>{' '}
        This year's announced price has not been recorded. Any applicable growth estimate remains tentative.
        {!readOnly && ' Record this year\'s announcement to confirm the price.'}
      </p>
      {!readOnly && (
        onAddPrice ? <button type="button" onClick={onAddPrice} className="rounded-lg bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover">Add a price</button> : <Link
          to="/prices#announced-price"
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

function OwnerPositionTour() {
  const me = useMe()
  return me ? <PositionTour key={me.id} accountId={me.id} /> : null
}

export default function Dashboard() {
  const config = useConfig()
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const readOnly = !!viewing
  const priceEditor = useRef<HTMLDetailsElement>(null)
  const [priceEditorActive, setPriceEditorActive] = useState(false)
  const openPriceEditor = useCallback(() => {
    const editor = priceEditor.current
    if (!editor) { setPriceEditorActive(true); return }
    editor.open = true
    editor.scrollIntoView?.({ block: 'start' })
    editor.querySelector('input')?.focus()
  }, [])
  useEffect(() => {
    if (priceEditorActive) openPriceEditor()
  }, [priceEditorActive, openPriceEditor])
  const today = useToday()
  const [importSaved, setImportSaved] = useState(false)
  const [carryover, setCarryover] = useState('')
  useEffect(() => {
    if (vid) return
    let active = true
    void platform.storage.get('trial_carryover_result').then(value => {
      if (!active || !value) return
      setCarryover(value); if (value === 'saved' || value === 'partial') setImportSaved(true)
      void platform.storage.remove('trial_carryover_result')
    })
    return () => { active = false }
  }, [vid])

  const fetchEvents = useCallback(() => vid ? api.getSharedEvents(vid) : api.getEvents(), [vid])
  const fetchPrices = useCallback(() => vid ? api.getSharedPrices(vid) : api.getPrices(), [vid])
  const fetchLoans = useCallback(() => vid ? api.getSharedLoans(vid) : api.getLoans(), [vid])
  const fetchTaxSettings = useCallback(() => vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(), [vid])

  const { data: events, reload: reloadEvents } = useApiData<TimelineEvent[]>(fetchEvents)
  const { data: prices, reload: reloadPrices } = useApiData<PriceEntry[]>(fetchPrices)
  const { data: loans, reload: reloadLoans } = useApiData<LoanEntry[]>(fetchLoans)
  const { data: taxSettings, reload: reloadTaxSettings } = useApiData<TaxSettings>(fetchTaxSettings)
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
  const lastEventDate = useMemo(() => lastTimelineDate(events), [events])
  const [customCardDate, setCustomCardDate] = useState<string>(() => {
    const mode = localStorage.getItem('dashboard_dateMode')
    if (!mode || mode === 'today') return today
    if (mode === 'last-event') return today // dynamic modes derive their date from the current data
    return localStorage.getItem('dashboard_cardDate') ?? today
  })
  const cardDate = dateMode === 'today' ? today : dateMode === 'last-event' ? lastEventDate : customCardDate
  const [snapshotDate, setSnapshotDate] = useState(cardDate)
  useEffect(() => {
    const timer = setTimeout(() => setSnapshotDate(cardDate), 200)
    return () => clearTimeout(timer)
  }, [cardDate])
  const fetchDashboard = useCallback(async () => ({
    ...await (vid ? api.getSharedDashboardSnapshot(vid, snapshotDate) : api.getDashboardSnapshot(snapshotDate)),
    viewId: vid ?? 0,
  }), [vid, snapshotDate])
  const { data: dash, loading: dashLoading, error: dashError, reload: reloadDash } = useApiData<DashboardSnapshot & {viewId: number}>(fetchDashboard)
  const snapshot = !dashLoading && !dashError && dash?.as_of === cardDate && dash.viewId === (vid ?? 0) ? dash : null
  const fetchCharts = useCallback(async () => ({
    ...await (vid ? api.getSharedDashboardCharts(vid) : api.getDashboardCharts()),
    viewId: vid ?? 0,
  }), [vid])
  const { data: chartData, error: chartsError, reload: reloadCharts } = useApiData<DashboardChartsData & {viewId: number}>(fetchCharts)
  const charts = !chartsError && chartData?.viewId === (vid ?? 0) ? chartData : null
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
  const showExitPreview = cardDate >= today
  const [exitPreview, setExitPreview] = useState<ExitPreview | null | 'loading'>(null)

  useEffect(() => {
    if (!showExitPreview) {
      setExitPreview(null)
      return
    }
    setExitPreview('loading')
    let cancelled = false
    const timer = setTimeout(() => {
      const fetcher = vid ? api.getSharedPreviewExit(vid, cardDate) : api.previewExit(cardDate)
      fetcher
        .then(result => { if (!cancelled) setExitPreview(result) })
        .catch(() => { if (!cancelled) setExitPreview(null) })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [cardDate, showExitPreview, vid, taxSettings])

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
      reloadCharts()
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
        if (typeof cd === 'string' && cd.length === 10) setCustomCardDate(cd)
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
    const controller = new AbortController()
    const t = setTimeout(() => {
      api.saveDashboardPrefs({
        dateMode,
        cardDate,
        range,
        openBreakdowns: [...openBreakdowns],
      } as Record<string, unknown>, controller.signal).catch(() => {})
    }, 400)
    return () => { clearTimeout(t); controller.abort() }
  }, [vid, dateMode, cardDate, range, openBreakdowns])

  // Only show projected/dashed styling when a future price actually differs from the current price
  const hasFuturePrices = useMemo(() => hasDivergentFuturePrice(prices), [prices])

  // Last event/price date for default end in range picker
  const maxDate = useMemo(() => maxTimelineDate(events, prices), [events, prices])

  // The newest non-estimated price, when it predates the current year. Estimates
  // are projections the user made themselves, so they do not count as knowing
  // this year's price.
  const stalePrice = useMemo(() => findStalePrice(prices), [prices])

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

  if (dashLoading && !dash) {
    return <p className="p-6 text-center text-sm text-cs-text-2">Loading...</p>
  }

  if (!dash) {
    return <div role="alert" className="p-6 text-center text-sm text-red-500">
      <p>Failed to load dashboard</p>
      <button type="button" onClick={reloadDash} className="mt-2 underline">Retry</button>
    </div>
  }

  const isEmpty = events?.length === 0

  if (isEmpty && !readOnly) {
    return <>{(carryover === 'failed' || carryover === 'expired') && <p role="alert" className="mb-4 rounded-xl border border-cs-border p-4 text-sm text-cs-text">{carryover === 'expired' ? 'Your preview expired after 30 minutes.' : 'We couldn’t save your preview automatically.'} Import your files again below; your account is ready.</p>}<GetStarted onImported={() => { setImportSaved(true); reloadEvents(); reloadPrices(); reloadLoans(); reloadDash(); reloadCharts(); reloadTaxSettings() }} /></>
  }

  if (isEmpty && readOnly) {
    return <p className="py-12 text-center text-sm text-cs-muted">This user has no data yet.</p>
  }

  const cv = snapshot?.cards
  const grantHoldings = snapshot?.grant_holdings ?? null
  const activeLoans = snapshot?.active_loans ?? null
  const breakdowns = snapshot?.breakdowns ?? null
  const hasInterestDeduction = (cv?.interest_deduction_total ?? 0) > 0
  const hasInterestLoans = loans?.some(l => l.loan_type === 'Interest' || l.loan_type === 'Purchase') ?? false
  const showDeductionCard = !!cv && (hasInterestDeduction || hasInterestLoans)
  const hasPrice = cv != null && cv.current_price !== null
  const hasPastRecords = events?.some(e => e.event_type !== 'Share Price' && e.date < `${today.slice(0, 4)}-01-01`)
  const totalValue = cv?.total_stock_value ?? null
  const datedExit = exitPreview && exitPreview !== 'loading' && exitPreview.date === cardDate ? exitPreview : null

  return (
    <div className="campus-dashboard space-y-5 sm:space-y-6">
      {importSaved && <p role="status" className="text-sm text-cs-text">Your import is saved. Here’s your position.</p>}
      {carryover === 'partial' && <p role="status" className="text-sm text-cs-text">New records from your preview were saved. Existing records were preserved; re-import to review any corrections.</p>}
      {carryover === 'review' && <p role="status" className="text-sm text-cs-text">Your existing records were preserved. Your preview contains corrections that were not saved automatically. <Link to="/import" className="underline">Review those changes in Import</Link>.</p>}
      {carryover === 'matched' && <p role="status" className="text-sm text-cs-text">Your preview already matches your saved records. Here’s your position.</p>}
      {carryover === 'expired' && <p role="status" className="text-sm text-cs-text">Your preview expired after 30 minutes. <Link to="/import" className="underline">Import the files again</Link> to review and save them.</p>}
      {carryover === 'failed' && <p role="alert" className="text-sm text-cs-text">We couldn’t save your preview automatically. <Link to="/import" className="underline">Import your files again</Link> to review and save it.</p>}
      {cv && cv.current_price === null && grantHoldings && grantHoldings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">Price not entered for this date. Add a share price to value your shares and project your exit.</p>
          {!readOnly && (!config?.epic_mode && cardDate.startsWith(today.slice(0, 4)) ? <button type="button" onClick={openPriceEditor} className="rounded-lg bg-cs-brand px-3 py-2 text-xs font-semibold text-white hover:bg-cs-brand-hover">Add a price</button> : <Link to="/prices" className="rounded-lg bg-cs-brand px-3 py-2 text-xs font-semibold text-white hover:bg-cs-brand-hover">Add a price</Link>)}
        </div>
      )}
      {cardDate === today && hasPrice && stalePrice && <StalePriceBanner latest={stalePrice} readOnly={readOnly} onAddPrice={!config?.epic_mode ? openPriceEditor : undefined} />}
      {!readOnly && !config?.epic_mode && priceEditorActive && <details ref={priceEditor} className="scroll-mt-24 rounded-xl border border-cs-border p-4"><summary className="cursor-pointer text-sm font-semibold text-cs-brand">Update the announced price</summary><div className="mt-3"><AnnouncedPrice onSaved={() => { reloadPrices(); reloadEvents(); reloadDash(); reloadCharts(); reloadTaxSettings() }} /></div></details>}
      {cv && grantHoldings && (
        <HeroCard
          className="campus-hero min-h-72 p-6 sm:min-h-64 sm:p-8"
        >
          <img
            aria-hidden="true"
            src={campusWatercolor}
            className="campus-watercolor"
            alt=""
          />
          <span className="campus-sticker" lang="la" title="Through hardship to the stars">Ad astra per aspera</span>
          <div className="relative z-10 mt-7 grid gap-6 sm:mt-5 sm:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)] sm:items-end">
            <div>
              <Eyebrow className="text-white">The view from here · {fmtFullDate(cardDate)}</Eyebrow>
              <p className="mt-2 font-serif text-4xl font-semibold tabular-nums tracking-tight sm:text-6xl">
                {!hasPrice ? `${fmtNum(cv.total_shares)} shares` : showExitPreview ? (datedExit?.liquidation_net_cash == null ? '—' : fmt$(datedExit.liquidation_net_cash)) : (totalValue === null ? '—' : fmt$(totalValue))}
              </p>
              <p className="mt-2 text-sm font-semibold text-white">{!hasPrice ? 'Vested shares' : showExitPreview ? exitCashLabel(cardDate === today) : stockValueLabel}</p>
              {hasPrice && showExitPreview && <p className="mt-2 text-xs text-white">{exitPreview === 'loading' ? 'Calculating exit…' : datedExit ? 'Excludes cash from earlier sales. Unvested purchased shares are modeled at cost. Expand the exit breakdown for obligations and taxes.' : 'Exit estimate unavailable. Stock holdings are shown below.'}</p>}

              {hasPrice && <p className="mt-2 text-xs text-white">{sharePriceBasis(datedExit?.price_effective_date ?? snapshot?.price_effective_date,
                datedExit?.price_is_estimate ?? cv.price_is_estimate)}</p>}
              {!!datedExit?.liquidation_shortfall && <p className="mt-2 text-sm font-semibold text-white">Additional cash needed to settle: {fmt$(datedExit.liquidation_shortfall)}</p>}
            </div>
            <div className="space-y-3 border-t border-white/35 pt-4 text-sm sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <p className="font-bold tabular-nums">
                {showExitPreview && datedExit ? <>
                  {fmt$(datedExit.gross_vested)} vested shares
                  {datedExit.unvested_cost_proceeds > 0 && <> + {fmt$(datedExit.unvested_cost_proceeds)} unvested at cost</>}
                  {datedExit.outstanding_principal > 0 && <> − {fmt$(datedExit.outstanding_principal)} loans</>}
                  {datedExit.outstanding_accrued_interest > 0 && <> − {fmt$(datedExit.outstanding_accrued_interest)} accrued interest</>}
                  {(datedExit.outstanding_projected_loans ?? 0) > 0 && <> − {fmt$(datedExit.outstanding_projected_loans!)} projected tax loans</>}
                  {(datedExit.projected_payoffs_before_exit ?? 0) > 0 && <> − {fmt$(datedExit.projected_payoffs_before_exit!)} earlier projected payoffs</>}
                  <> − {fmt$(datedExit.liquidation_tax)} est. tax</>
                </> : <>
                  {totalValue === null ? 'Stock value needs a share price' : cv.net_equity != null && `${fmt$(cv.net_equity)} stock equity before exit taxes`}
                </>}
              </p>
              {(activeLoans?.length ?? 0) > 0 && cv.interest_status && <p className="text-sm text-white">Interest: {cv.interest_status}</p>}
              <p className="font-semibold tabular-nums">
                {fmtNum(cv.total_shares)} vested shares · {cv.current_price === null ? 'Price not entered' : `${fmtPrice(cv.current_price)}/share`}
                {cv.price_is_estimate ? ' tentative, awaiting announcement' : ''}
              </p>
              {cv.next_event && (
                <Link to={`/events?date=${cv.next_event.date}`} aria-label="Open next event" className="block w-full border-t border-white/35 pt-3 text-left">
                  <span className="text-xs font-semibold uppercase tracking-wide">Next stop</span><br />
                  <span className="font-bold">{fmtFullDate(cv.next_event.date)}</span>
                  <span className="text-xs"> · {cv.next_event.event_type}</span>
                  {cv.next_event_detail?.event_type === 'Share Price' && cv.next_event_detail.price_is_estimate && (
                    <span className="text-xs"> · estimated price change</span>
                  )}
                </Link>
              )}
            </div>
          </div>
        </HeroCard>
      )}

      {importSaved && !readOnly && <OwnerPositionTour />}
      {snapshot?.summary_sentences?.length ? <details key={`${vid ?? 0}-${importSaved}`} open={importSaved} className="rounded-2xl border border-cs-border bg-cs-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-cs-text">In plain words</summary>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-cs-text-2">{snapshot.summary_sentences.map(s => <li key={s}>{s}</li>)}</ul>
      </details> : null}
      {!readOnly && snapshot && <div className="flex flex-wrap gap-3 text-sm font-semibold text-cs-brand">
        <a href="#exit-details" className="min-h-11 rounded-lg border border-cs-border-strong px-3 py-2">Explore leaving</a>
        <Link to="/retirement" className="min-h-11 rounded-lg border border-cs-border-strong px-3 py-2">Will it fund retirement? →</Link>
        {config?.ai_connections && <Link to="/connect-ai" className="min-h-11 rounded-lg border border-cs-border-strong px-3 py-2">Ask your assistant</Link>}
      </div>}

      {/* Date selector for card values */}
      <div className="campus-wayfinder rounded-2xl border border-cs-border bg-cs-surface px-3 py-2.5 shadow-card sm:flex sm:items-center sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor="dashboard-date" className="shrink-0 text-xs font-medium text-cs-muted">As of</label>
          <input
            id="dashboard-date"
            type="date"
            value={cardDate}
            max={maxDate}
            onChange={e => { if (e.target.value) { setDateMode('custom'); setCustomCardDate(e.target.value) } }}
            className="h-7 flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 text-xs text-cs-text"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-0">
          <span className="shrink-0 text-xs text-cs-muted">Jump to:</span>
          {([
            { label: 'Today', mode: 'today' as const },
            { label: 'Last event', mode: 'last-event' as const, title: 'Jump to your last event, excluding tentative price estimates' },
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

      <EquityTerms terms={['vesting', 'basis', 'loan', 'tax', 'exit', 'price']} />

      {!readOnly && cardDate === today && snapshot && <ReminderOffer event={events?.find(e => e.date > today && (e.event_type === 'Vesting' || e.event_type === 'Loan Payoff')) ?? null} />}

      {events && <StockJourney events={events} asOf={cardDate} />}

      <div className="grid gap-3 lg:grid-cols-2">
        {!readOnly && <TipCarousel onApply={() => { reloadDash(); reloadCharts(); reloadEvents(); reloadTaxSettings() }} />}

      </div>

      {!snapshot && <div role={dashError ? 'alert' : 'status'} className="text-sm text-cs-muted">
        {dashError ? <>Could not load totals for {fmtFullDate(cardDate)}. <button type="button" onClick={reloadDash} className="underline">Retry</button></> : 'Loading totals…'}
      </div>}

      {snapshot && hasPrice && showExitPreview && (
        <div id="exit-details" aria-live="polite" aria-atomic="true" className="scroll-mt-28 space-y-2">
          <details><summary className="cursor-pointer rounded-xl border border-cs-border bg-cs-surface p-4 text-sm font-semibold text-cs-text">Exit breakdown and earlier cash</summary>
            {exitPreview === 'loading' ? (
              <p className="text-xs text-cs-muted">Calculating…</p>
            ) : exitPreview && exitPreview.date === cardDate ? (
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
                    <p className="mt-2.5 text-xs font-medium uppercase tracking-wide text-cs-text-2">Cash from exit plus earlier activity</p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-cs-text">{fmt$(exitPreview.net_cash)}</p>
                    <p className="mt-1 text-xs text-cs-muted">Includes prior sales and modeled deduction savings</p>
                  </button>
                  <Card label="Gross Proceeds" value={fmt$(exitPreview.gross_vested + exitPreview.unvested_cost_proceeds)} variant="gains" explanation="gross_proceeds" subtitle="Liquidated shares × price" />
                  <Card label="Loans Paid Off" value={fmt$(exitPreview.outstanding_principal + exitPreview.outstanding_accrued_interest + (exitPreview.outstanding_projected_loans ?? 0) + (exitPreview.projected_payoffs_before_exit ?? 0))} variant="loans" explanation="debt_settlement" subtitle="Principal + accrued interest" />
                  <Card label="Est. Divest Tax" value={fmt$(exitPreview.liquidation_tax)} variant="tax" explanation="divest_tax" subtitle="Capital gains on liquidation" />
                </div>
                {exitBreakdownOpen && <>
                  <p className="text-xs text-cs-muted">Settlement interest includes {taxSettings?.exit_payoff_lag_days ?? 0} extra days after exit. Tax rates and lot selection use your saved settings; the price {cv?.price_is_estimate ? 'is tentative' : 'uses the applicable saved record'}.</p>
                  <ExitBreakdownCard s={exitPreview} />
                </>}
              </>
            ) : (
              <p className="text-xs text-cs-muted">Exit estimate unavailable for this date</p>
            )}
          </details>
          <ExitDateComparison date={cardDate} invitationId={vid} />
        </div>
      )}


      {/* (F) aria-live so screen readers announce summary updates when cardDate changes */}
      {cv && <div aria-live="polite" aria-atomic="true" className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-cs-muted">Up to this date</p>

        <ShareCards cv={cv} cardDate={cardDate} grantHoldings={grantHoldings}
          totalValue={totalValue} hideNextEvent openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />

        {(cv.total_income !== 0 || cv.total_cap_gains !== 0 || cv.cash_received !== 0 || cv.total_tax_paid !== 0 || cv.total_loan_principal !== 0 || cv.total_interest !== 0) && <details className="space-y-3">
          <summary className="cursor-pointer py-2 text-sm font-semibold text-cs-text">Earnings and borrowing costs</summary>
          <EarningsCards cv={cv} breakdowns={breakdowns}
            openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />

          <CostCards cv={cv} activeLoans={activeLoans} breakdowns={breakdowns}
            hasInterestDeduction={hasInterestDeduction}
            openBreakdowns={openBreakdowns} toggleBreakdown={toggleBreakdown} />
        </details>}
      </div>}


      {!readOnly && snapshot && hasPastRecords && <AnnualStockSummary />}
      {!readOnly && config?.ai_connections && snapshot && <details className="rounded-xl border border-cs-border p-4"><summary className="cursor-pointer text-sm font-semibold text-cs-text">Explore with your assistant</summary><div className="mt-3"><StarterQuestions questions={snapshot.starter_questions} /></div></details>}

      {showDeductionCard && !readOnly && (() => {
        const displayEnabled = pendingDeduction ?? savedDeduction
        const currentSavings = cv?.tax_savings_from_deduction ?? 0
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
                aria-label="Investment interest deduction"
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

      {chartsError && <p role="alert" className="text-sm text-cs-muted">Could not load charts. <button type="button" onClick={reloadCharts} className="underline">Retry charts</button></p>}
      {charts && <DashboardCharts
        events={events} prices={prices} dash={charts} c={c}
        range={range} setRange={setRange}
        rangeInterest={rangeInterest} setRangeInterest={setRangeInterest}
        rangeLoan={rangeLoan} setRangeLoan={setRangeLoan}
        maxDate={maxDate} hasFuturePrices={hasFuturePrices} />}
    </div>
  )
}
