import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ReportProblemLink } from './ReportProblem.tsx'
import { useAuth } from '../hooks/useAuth.ts'
import { useMe } from '../hooks/useMe.ts'
import { useMaintenance } from '../contexts/maintenance.ts'
import { useConfig } from '../hooks/useConfig.ts'
import { useViewing } from '../contexts/viewing.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import PushNudge from './PushNudge.tsx'
import UnofficialBadge from './UnofficialBadge.tsx'
import StagingSeedPanel from '../../app/components/StagingSeedPanel.tsx'
import { CampusCorner, CampusNavIcon } from './CampusMotifs.tsx'
import TaskOutcome from '../../app/components/TaskOutcome.tsx'

export default function Layout() {
  const { logout } = useAuth()
  const me = useMe()
  const maintenance = useMaintenance()
  const config = useConfig()
  const { viewing, setViewing, clearViewing } = useViewing()
  const { appName, appDisclaimerShort, navItems: appNavItems, viewerHiddenRoutes, epicModeHiddenRoutes } = useAppContext()
  const staging = config?.staging_demo || import.meta.env.VITE_APP_ENV === 'staging' || window.location.hostname === 'staging.epic-stocks.com'
  const epicMode = config?.epic_mode ?? false
  const baseItems = epicMode ? [...appNavItems.filter(item => !epicModeHiddenRoutes.has(item.to)), { to: '/settings', label: 'Settings' }] : [...appNavItems, { to: '/settings', label: 'Settings' }]
  const navItems = viewing ? baseItems.filter(item => !viewerHiddenRoutes.has(item.to)) : baseItems
  const adminLinks = [
    ...(!viewing && me?.is_admin ? [{ to: '/admin', label: 'Site Admin' }] : []),
    ...(!viewing && (me?.is_admin || me?.is_content_admin) ? [{ to: '/content', label: 'Content Admin' }] : []),
  ]
  const sharedAccounts = me?.shared_accounts ?? []

  useEffect(() => {
    if (!me || !viewing) return
    const valid = (me.shared_accounts ?? []).some(a => a.invitation_id === viewing.invitationId)
    if (!valid) clearViewing()
  }, [me, viewing, clearViewing])

  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => { mainRef.current?.focus() }, [location.pathname])

  const primaryItems = navItems.filter(item => ['/', '/planning', '/settings'].includes(item.to))
  const recordsRoutes = ['/events', '/grants', '/sales', '/loans', '/prices', '/import']
  const workshopRoutes = ['/settings', '/connect-ai', '/content', '/admin', '/import-diagnostics']
  const isRecords = recordsRoutes.includes(location.pathname)
  const isWorkshop = workshopRoutes.includes(location.pathname)
  const isPlanning = ['/planning', '/retirement'].includes(location.pathname)
  const isObservatory = isPlanning || location.pathname === '/comp-calculator'
  const moreGroups: NavigationGroup[] = [
    { links: navItems.filter(item => item.to === '/comp-calculator').map(item => ({ ...item, label: 'Compensation Calculator' })) },
    {
      label: 'Stock records',
      links: navItems.filter(item => recordsRoutes.includes(item.to))
        .map(item => item.to === '/import' ? { ...item, label: 'Import / Export' } : item),
    },
    {
      label: 'Admin',
      links: adminLinks,
    },
  ].filter(group => group.links.length > 0)
  const primaryLocation = (to: string) => {
    if (to === location.pathname) return 'page'
    if ((to === '/' && isRecords) || (to === '/planning' && isPlanning)) return 'location'
  }
  const campusWing = isRecords
    ? { id: 'records', label: 'The records wing', motto: 'Verba volant, scripta manent', translation: 'Spoken words fly; written words remain' }
    : isWorkshop
      ? { id: 'workshop', label: 'The workshop', motto: 'Festina lente', translation: 'Make haste slowly' }
      : isObservatory
        ? { id: 'observatory', label: 'The observatory', motto: 'Ad astra per aspera', translation: 'Through hardship to the stars' }
        : null
  const motif = isRecords ? 'records' : isWorkshop ? 'workshop' : isObservatory ? 'observatory' : 'garden'

  return (
    <div className="flex min-h-screen flex-col bg-cs-base">
      <a href="#main-content" className="skip-nav" onClick={event => {
        const main = mainRef.current
        if (!main) return
        event.preventDefault()
        main.focus({ preventScroll: true })
        main.scrollIntoView({ block: 'start' })
      }}>Skip to main content</a>
      <div className="sticky top-0 z-40 bg-cs-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-cs-surface/75">
        {staging && <div role="status" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100">Staging environment — fictional test data</div>}
        {maintenance && <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-medium text-amber-950"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-800" />Maintenance in progress — financial data is temporarily unavailable</div>}
        {viewing && <div className="flex items-center justify-center gap-2 bg-blue-100 px-4 py-1.5 text-xs font-medium text-blue-900 dark:bg-blue-900/30 dark:text-blue-300">Viewing {viewing.name}&rsquo;s data (read-only)<button onClick={clearViewing} className="ml-2 rounded bg-blue-200 px-2 py-0.5 text-xs font-medium hover:bg-blue-300 dark:bg-blue-800 dark:hover:bg-blue-700">Back to my data</button></div>}
        <header className="border-b border-cs-border">
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="flex min-w-0 shrink items-center gap-2 text-sm font-extrabold tracking-tight text-cs-brand dark:text-rose-300">
              <img src="/favicon.svg" alt="" aria-hidden="true" className="h-7 w-7 shrink-0" />
              <span className="flex min-w-0 flex-col items-start leading-tight"><span className="truncate">{appName}</span><UnofficialBadge className="mt-0.5" /></span>
            </span>
            <div className="flex min-w-0 shrink items-center gap-2">
              {sharedAccounts.length > 0 && <select value={viewing?.invitationId ?? ''} onChange={e => { const val = e.target.value; if (!val) clearViewing(); else { const acct = sharedAccounts.find(a => a.invitation_id === Number(val)); if (acct) setViewing(acct.invitation_id, acct.inviter_name) } }} className="min-w-0 max-w-[6.5rem] shrink rounded border border-cs-border-strong bg-cs-surface px-2 py-1 text-xs text-cs-text" aria-label="Switch between your data and shared accounts"><option value="">My Data</option>{sharedAccounts.map(a => <option key={a.invitation_id} value={a.invitation_id}>{a.inviter_name}&rsquo;s Data</option>)}</select>}
              {me && <span className="min-w-0 break-words text-xs text-cs-muted">{me.name || me.email}</span>}
              <button onClick={logout} aria-label="Sign out of your account" className="shrink-0 whitespace-nowrap text-xs text-cs-text-2 hover:text-cs-text">Sign Out</button>
            </div>
          </div>
          <nav aria-label="Main navigation" className="mx-auto hidden w-full max-w-[90rem] gap-1 px-6 pb-2.5 lg:px-8 md:flex">
            {primaryItems.map(({ to, label }) => <Link key={to} to={to} aria-current={primaryLocation(to)} className={`campus-nav-link group flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${primaryLocation(to) ? 'bg-rose-700 text-white shadow-sm' : 'text-cs-text-2 hover:bg-cs-raised hover:text-cs-text'}`}><CampusNavIcon route={to} className="h-3.5 w-3.5 opacity-75 transition-transform group-hover:-rotate-6" />{label}</Link>)}
            <MoreNavigation key={location.key} groups={moreGroups} />
          </nav>
        </header>
      </div>
      {config && !viewing && !staging && !me?.reviewer_account && <PushNudge />}
      <main id="main-content" ref={mainRef} tabIndex={-1} data-campus-wing={campusWing?.id} className={`campus-page-shell relative mx-auto w-full max-w-[90rem] flex-1 scroll-mt-28 px-4 py-5 pb-24 outline-none sm:px-6 sm:py-7 lg:px-8 md:pb-8 ${location.pathname === '/settings' ? 'overflow-clip' : 'overflow-hidden'}`}>
        <CampusCorner variant={motif} className="pointer-events-none absolute -right-5 top-2 h-36 w-52 text-cs-text opacity-70 sm:right-3 lg:h-44 lg:w-64" />
        <div className="relative z-[1]">
          {me?.reviewer_account && <p role="status" className="mb-4 rounded-xl border border-cs-border bg-cs-surface p-3 text-sm font-semibold">FICTIONAL REVIEW DATA · {me.reviewer_account.platform} · {me.reviewer_account.scenario}. These are invented financial records, not actual Epic prices or personal accounts.</p>}
          {campusWing && <div className="campus-wing-marker max-w-4xl"><span>{campusWing.label}</span><span lang="la" title={campusWing.translation}>{campusWing.motto}</span></div>}
          {!config ? <p role="status">Loading application…</p> : staging && !['/admin', '/content', '/connect-ai'].some(path => location.pathname.startsWith(path)) && !me?.staging_account?.initialized
            ? (me ? <StagingSeedPanel /> : <p role="status">Loading staging workspace…</p>)
            : <>
              {!viewing && <TaskOutcome />}
              {isRecords && <nav aria-label="Stock records" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-cs-border pb-2">
                {navItems.filter(item => recordsRoutes.includes(item.to)).map(({ to, label }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `inline-flex min-h-11 items-center rounded-lg px-3 text-sm ${isActive ? 'bg-cs-brand-subtle font-semibold text-cs-brand dark:text-rose-300' : 'text-cs-text-2 hover:bg-cs-raised'}`}>
                    {to === '/import' ? 'Import / Export' : label}
                  </NavLink>
                ))}
              </nav>}
              <Outlet />
            </>}
        </div>
      </main>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-cs-border bg-cs-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_-20px_rgba(26,20,17,0.45)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2 py-1.5">
          {primaryItems.map(({ to, label }) => (
            <Link key={to} to={to} aria-current={primaryLocation(to)}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center text-xs font-semibold ${primaryLocation(to) ? 'bg-cs-brand-subtle text-cs-brand dark:text-rose-300' : 'text-cs-text-2'}`}>
              <CampusNavIcon route={to} />{label}
            </Link>
          ))}
          <MoreNavigation key={location.key} groups={moreGroups} mobile />
        </div>
      </nav>
      <footer className="mb-16 border-t border-cs-border px-4 py-4 text-center text-xs text-cs-text-2 md:mb-0"><Link to="/privacy" className="underline hover:text-cs-text">Privacy Policy</Link><span className="mx-2 text-cs-muted">·</span><a href="/terms" className="underline hover:text-cs-text">Terms of Use</a><span className="mx-2 text-cs-muted">·</span><ReportProblemLink />{appDisclaimerShort && <p className="mx-auto mt-2 max-w-md">{appDisclaimerShort}</p>}</footer>
    </div>
  )
}

type NavigationGroup = { label?: string; links: { to: string; label: string }[] }

function MoreNavigation({ groups, mobile = false }: { groups: NavigationGroup[]; mobile?: boolean }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (container.current?.contains(document.activeElement)) {
        event.preventDefault()
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [open])

  return (
    <div
      ref={container}
      className={mobile ? undefined : 'relative'}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(previous => !previous)}
        className={`flex items-center justify-center text-xs font-semibold ${mobile
          ? 'min-h-11 w-full flex-col gap-0.5 rounded-xl px-1 py-1.5'
          : 'h-full gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5'} ${open
          ? 'bg-cs-brand-subtle text-cs-brand dark:text-rose-300'
          : 'text-cs-text-2 hover:bg-cs-raised hover:text-cs-text'}`}
      >
        <CampusNavIcon route="more" className={mobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        More
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={`absolute z-10 max-h-[min(65dvh,26rem)] overflow-y-auto overscroll-contain rounded-2xl border border-cs-border bg-cs-surface p-2 shadow-pop ${mobile
          ? 'inset-x-3 bottom-full mx-auto mb-2 max-w-lg'
          : 'left-0 top-full mt-2 w-80'}`}
      >
        {groups.map(group => (
          <div key={group.label ?? group.links[0].to} className="border-b border-cs-border p-1 last:border-b-0">
            {group.label && <h2 className="px-2 pt-1 text-xs font-semibold text-cs-muted">{group.label}</h2>}
            <div className={group.label ? 'grid grid-cols-2 gap-x-1' : undefined}>
              {group.links.map(({ to, label }) => (
                <NavLink key={to} to={to} onClick={() => setOpen(false)}
                  className={({ isActive }) => `flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm ${isActive
                    ? 'bg-cs-brand-subtle font-semibold text-cs-brand dark:text-rose-300'
                    : 'text-cs-text-2 hover:bg-cs-raised hover:text-cs-text'}`}>
                  <CampusNavIcon route={to} className="h-4 w-4 shrink-0 opacity-75" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
