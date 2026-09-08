import { useEffect, useRef, useState } from 'react'
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
import { CampusCorner, CampusNavIcon } from './CampusMotifs.tsx'

export default function Layout() {
  const { logout } = useAuth()
  const me = useMe()
  const maintenance = useMaintenance()
  const config = useConfig()
  const { viewing, setViewing, clearViewing } = useViewing()
  const { appName, appDisclaimerShort, navItems: appNavItems, viewerHiddenRoutes, epicModeHiddenRoutes } = useAppContext()
  const epicMode = config?.epic_mode ?? false
  const baseItems = epicMode ? [...appNavItems.filter(item => !epicModeHiddenRoutes.has(item.to)), { to: '/settings', label: 'Settings' }] : [...appNavItems, { to: '/settings', label: 'Settings' }]
  const viewFilteredItems = viewing ? baseItems.filter(item => !viewerHiddenRoutes.has(item.to)) : baseItems
  const canContent = !viewing && (me?.is_admin || me?.is_content_admin)
  const withContent = canContent ? [...viewFilteredItems, { to: '/content', label: 'Content' }] : viewFilteredItems
  const navItems = me?.is_admin && !viewing ? [...withContent, { to: '/admin', label: 'Admin' }] : withContent
  const sharedAccounts = me?.shared_accounts ?? []
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (!me || !viewing) return
    const valid = (me.shared_accounts ?? []).some(a => a.invitation_id === viewing.invitationId)
    if (!valid) clearViewing()
  }, [me, viewing, clearViewing])

  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => { mainRef.current?.focus() }, [location.pathname])

  const mobilePrimaryItems = navItems.filter(item => ['/', '/events', '/retirement', '/grants'].includes(item.to))
  const recordsRoutes = ['/grants', '/loans', '/sales', '/prices', '/import']
  const workshopRoutes = ['/settings', '/content', '/admin', '/import-diagnostics']
  const isRecords = recordsRoutes.some(route => location.pathname.startsWith(route))
  const isWorkshop = workshopRoutes.some(route => location.pathname.startsWith(route))
  const isObservatory = location.pathname.startsWith('/retirement') || location.pathname.startsWith('/comp-calculator')
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
      <a href="#main-content" className="skip-nav">Skip to main content</a>
      <div className="sticky top-0 z-40 bg-cs-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-cs-surface/75">
        {import.meta.env.VITE_APP_ENV === 'staging' && <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white"><span className="h-2 w-2 rounded-full bg-white/60" />Staging environment — not production data</div>}
        {maintenance && <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-medium text-amber-950"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-800" />Maintenance in progress — financial data is temporarily unavailable</div>}
        {viewing && <div className="flex items-center justify-center gap-2 bg-blue-100 px-4 py-1.5 text-xs font-medium text-blue-900 dark:bg-blue-900/30 dark:text-blue-300">Viewing {viewing.name}&rsquo;s data (read-only)<button onClick={clearViewing} className="ml-2 rounded bg-blue-200 px-2 py-0.5 text-xs font-medium hover:bg-blue-300 dark:bg-blue-800 dark:hover:bg-blue-700">Back to my data</button></div>}
        <header className="border-b border-cs-border">
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="flex min-w-0 shrink items-center gap-2 text-sm font-extrabold tracking-tight text-cs-brand">
              <span className="campus-wordmark flex h-7 w-7 shrink-0 items-center justify-center bg-gradient-to-br from-cs-brand to-cs-brand-hover text-[11px] font-extrabold text-white">E</span>
              <span className="flex min-w-0 flex-col items-start leading-tight"><span className="truncate">{appName}</span><UnofficialBadge className="mt-0.5" /></span>
            </span>
            <div className="flex min-w-0 shrink items-center gap-2">
              {sharedAccounts.length > 0 && <select value={viewing?.invitationId ?? ''} onChange={e => { const val = e.target.value; if (!val) clearViewing(); else { const acct = sharedAccounts.find(a => a.invitation_id === Number(val)); if (acct) setViewing(acct.invitation_id, acct.inviter_name) } }} className="min-w-0 max-w-[6.5rem] shrink rounded border border-cs-border-strong bg-cs-surface px-2 py-1 text-xs text-cs-text" aria-label="Switch between your data and shared accounts"><option value="">My Data</option>{sharedAccounts.map(a => <option key={a.invitation_id} value={a.invitation_id}>{a.inviter_name}&rsquo;s Data</option>)}</select>}
              {me && <span className="min-w-0 break-words text-xs text-cs-muted">{me.name || me.email}</span>}
              <button onClick={logout} aria-label="Sign out of your account" className="shrink-0 whitespace-nowrap text-xs text-cs-text-2 hover:text-cs-text">Sign Out</button>
            </div>
          </div>
          <nav aria-label="Main navigation" className="mx-auto hidden w-full max-w-[90rem] gap-1 overflow-x-auto px-6 pb-2.5 lg:px-8 md:flex">
            {navItems.map(({ to, label }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `campus-nav-link group flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${isActive ? 'bg-cs-brand text-white shadow-sm' : 'text-cs-text-2 hover:bg-cs-raised hover:text-cs-text'}`}><CampusNavIcon route={to} className="h-3.5 w-3.5 opacity-75 transition-transform group-hover:-rotate-6" />{label}</NavLink>)}
          </nav>
        </header>
      </div>
      {!viewing && <PushNudge />}
      <main id="main-content" ref={mainRef} tabIndex={-1} data-campus-wing={campusWing?.id} className="campus-page-shell relative mx-auto w-full max-w-[90rem] flex-1 overflow-hidden px-4 py-5 pb-24 outline-none sm:px-6 sm:py-7 lg:px-8 md:pb-8">
        <CampusCorner variant={motif} className="pointer-events-none absolute -right-5 top-2 h-36 w-52 text-cs-text opacity-70 sm:right-3 lg:h-44 lg:w-64" />
        <div className="relative z-[1]">
          {campusWing && <div className="campus-wing-marker max-w-4xl"><span>{campusWing.label}</span><span lang="la" title={campusWing.translation}>{campusWing.motto}</span></div>}
          <Outlet />
        </div>
      </main>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-cs-border bg-cs-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_-20px_rgba(26,20,17,0.45)] backdrop-blur md:hidden">
        {mobileMenuOpen && <div id="mobile-more-menu" className="absolute bottom-full left-3 right-3 mb-2 rounded-2xl border border-cs-border bg-cs-surface p-3 shadow-pop"><p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-cs-muted">Everything</p><div className="grid grid-cols-3 gap-1">{navItems.filter(item => !mobilePrimaryItems.some(primary => primary.to === item.to)).map(({ to, label }) => <NavLink key={to} to={to} onClick={() => setMobileMenuOpen(false)} className={({ isActive }) => `flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center text-sm font-semibold ${isActive ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2 hover:bg-cs-raised'}`}><CampusNavIcon route={to} />{label}</NavLink>)}</div></div>}
        <div className="mx-auto grid max-w-lg grid-cols-5 px-2 py-1.5">{mobilePrimaryItems.map(({ to, label }) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} onClick={() => setMobileMenuOpen(false)} className={({ isActive }) => `flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-center text-xs font-semibold ${isActive ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2'}`}><CampusNavIcon route={to} className="h-4 w-4" />{label === 'Retirement' ? 'Plan' : label === 'Grants' ? 'Data' : label}</NavLink>)}<button type="button" aria-expanded={mobileMenuOpen} aria-controls="mobile-more-menu" onClick={() => setMobileMenuOpen(open => !open)} className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-center text-xs font-semibold ${mobileMenuOpen ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2'}`}><span className="text-base leading-4">•••</span>More</button></div>
      </nav>
      <footer className="mb-16 border-t border-cs-border px-4 py-4 text-center text-xs text-cs-text-2 md:mb-0"><Link to="/privacy" className="underline hover:text-cs-text">Privacy Policy</Link><span className="mx-2 text-cs-muted">·</span><ReportProblemLink />{appDisclaimerShort && <p className="mx-auto mt-2 max-w-md">{appDisclaimerShort}</p>}</footer>
    </div>
  )
}
