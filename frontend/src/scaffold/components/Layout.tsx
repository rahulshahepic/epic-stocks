import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { useMe } from '../hooks/useMe.ts'
import { useMaintenance } from '../contexts/MaintenanceContext.tsx'
import { useConfig } from '../hooks/useConfig.ts'
import { useViewing } from '../contexts/ViewingContext.tsx'
import { useAppContext } from '../contexts/AppContext.tsx'
import PushNudge from './PushNudge.tsx'
import UnofficialBadge from './UnofficialBadge.tsx'

export default function Layout() {
 const { logout } = useAuth()
 const me = useMe()
 const maintenance = useMaintenance()
 const config = useConfig()
 const { viewing, setViewing, clearViewing } = useViewing()
 const { appName, appDisclaimerShort, navItems: appNavItems, viewerHiddenRoutes, epicModeHiddenRoutes } = useAppContext()
 const epicMode = config?.epic_mode ?? false
 const baseItems = epicMode
 ? [...appNavItems.filter(item => !epicModeHiddenRoutes.has(item.to)), { to: '/settings', label: 'Settings' }]
 : [...appNavItems, { to: '/settings', label: 'Settings' }]
 const viewFilteredItems = viewing
 ? baseItems.filter(item => !viewerHiddenRoutes.has(item.to))
 : baseItems
 const canContent = !viewing && (me?.is_admin || me?.is_content_admin)
 const withContent = canContent ? [...viewFilteredItems, { to: '/content', label: 'Content' }] : viewFilteredItems
 const navItems = me?.is_admin && !viewing
 ? [...withContent, { to: '/admin', label: 'Admin' }]
 : withContent

 const sharedAccounts = me?.shared_accounts ?? []

 // Clear stale viewing_context if the invitation is no longer valid for this user
 useEffect(() => {
 if (!me || !viewing) return
 const valid = sharedAccounts.some(a => a.invitation_id === viewing.invitationId)
 if (!valid) clearViewing()
 }, [me, viewing, sharedAccounts, clearViewing])

 // (B) Focus management on route changes
 const location = useLocation()
 const mainRef = useRef<HTMLElement>(null)
 useEffect(() => {
 mainRef.current?.focus()
 }, [location.pathname])

 return (
 <div className="flex min-h-screen flex-col bg-cs-base">
 {/* (A) Skip-navigation link */}
 <a href="#main-content" className="skip-nav">
 Skip to main content
 </a>

 {/* Top chrome in one sticky group. The iOS safe-area inset belongs on the
 topmost element of the page: while it sat on <header>, every banner
 rendered above the header — staging, maintenance, viewing — sat
 underneath the status bar instead of below it. */}
 <div className="sticky top-0 z-40 bg-cs-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-cs-surface/75">
 {import.meta.env.VITE_APP_ENV === 'staging' && (
 <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white">
 <span className="h-2 w-2 rounded-full bg-white/60" />
 Staging environment — not production data
 </div>
 )}

 {maintenance && (
 <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-medium text-amber-950">
 <span className="h-2 w-2 animate-pulse rounded-full bg-amber-800" />
 Maintenance in progress — financial data is temporarily unavailable
 </div>
 )}

 {viewing && (
 <div className="flex items-center justify-center gap-2 bg-blue-100 px-4 py-1.5 text-xs font-medium text-blue-900 dark:bg-blue-900/30 dark:text-blue-300">
 Viewing {viewing.name}&rsquo;s data (read-only)
 <button
 onClick={clearViewing}
 className="ml-2 rounded bg-blue-200 px-2 py-0.5 text-xs font-medium hover:bg-blue-300 dark:bg-blue-800 dark:hover:bg-blue-700"
 >
 Back to my data
 </button>
 </div>
 )}

 <header className="border-b border-cs-border">
 <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
 <span className="flex min-w-0 shrink items-center gap-2 text-sm font-extrabold tracking-tight text-cs-brand">
 <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-cs-brand to-cs-brand-hover text-[11px] font-extrabold text-white">
 E
 </span>
 {/* Badge sits under the name rather than beside it: side by side, the two
 push the account controls off a 375px viewport. */}
 <span className="flex min-w-0 flex-col items-start leading-tight">
 <span className="truncate">{appName}</span>
 <UnofficialBadge className="mt-0.5" />
 </span>
 </span>
 <div className="flex min-w-0 shrink items-center gap-2">
 {sharedAccounts.length > 0 && (
 <select
 value={viewing?.invitationId ?? ''}
 onChange={e => {
 const val = e.target.value
 if (!val) {
 clearViewing()
 } else {
 const acct = sharedAccounts.find(a => a.invitation_id === Number(val))
 if (acct) setViewing(acct.invitation_id, acct.inviter_name)
 }
 }}
 className="min-w-0 max-w-[6.5rem] shrink rounded border border-cs-border-strong bg-cs-surface px-2 py-1 text-xs text-cs-text"
 aria-label="Switch between your data and shared accounts"
 >
 <option value="">My Data</option>
 {sharedAccounts.map(a => (
 <option key={a.invitation_id} value={a.invitation_id}>
 {a.inviter_name}&rsquo;s Data
 </option>
 ))}
 </select>
 )}
 {me && (
 <span className="min-w-0 break-words text-xs text-cs-muted">
 {me.name || me.email}
 </span>
 )}
 <button
 onClick={logout}
 aria-label="Sign out of your account"
 className="shrink-0 whitespace-nowrap text-xs text-cs-text-2 hover:text-cs-text "
 >
 Sign Out
 </button>
 </div>
 </div>

 <nav aria-label="Main navigation" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2.5">
 {navItems.map(({ to, label }) => (
 <NavLink
 key={to}
 to={to}
 end={to === '/'}
 className={({ isActive }) =>
 `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
 isActive
 ? 'bg-cs-brand text-white shadow-sm'
 : 'text-cs-text-2 hover:bg-cs-raised hover:text-cs-text'
 }`
 }
 >
 {label}
 </NavLink>
 ))}
 </nav>
 </header>
 </div>

 {!viewing && <PushNudge />}

 <main
 id="main-content"
 ref={mainRef}
 tabIndex={-1}
 className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none"
 >
 <Outlet />
 </main>

 <footer className="border-t border-cs-border px-4 py-4 text-center text-xs text-cs-text-2">
 <Link
 to="/privacy"
 className="underline hover:text-cs-text"
 >
 Privacy Policy
 </Link>
 {appDisclaimerShort && (
 <p className="mx-auto mt-2 max-w-md text-cs-muted">{appDisclaimerShort}</p>
 )}
 </footer>
 </div>
 )
}
