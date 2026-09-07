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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Clear stale viewing_context if the invitation is no longer valid for this user.
  // The list is read inside the effect: `?? []` makes a new array on every render,
  // so as a dependency it never compared equal and the effect ran every time.
  useEffect(() => {
    if (!me || !viewing) return
    const valid = (me.shared_accounts ?? []).some(a => a.invitation_id === viewing.invitationId)
    if (!valid) clearViewing()
  }, [me, viewing, clearViewing])

  // (B) Focus management on route changes
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.focus()
  }, [location.pathname])

  const mobilePrimaryItems = navItems.filter(item =>
    ['/', '/events', '/retirement', '/grants'].includes(item.to)
  )

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
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
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

          <nav aria-label="Main navigation" className="mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-6 pb-2.5 md:flex">
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
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 outline-none sm:px-6 sm:py-7 md:pb-8"
      >
        <Outlet />
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-cs-border bg-cs-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_-20px_rgba(26,20,17,0.45)] backdrop-blur md:hidden"
      >
        {mobileMenuOpen && (
          <div id="mobile-more-menu" className="absolute bottom-full left-3 right-3 mb-2 rounded-2xl border border-cs-border bg-cs-surface p-3 shadow-pop">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-cs-muted">Everything</p>
            <div className="grid grid-cols-3 gap-1">
              {navItems.filter(item => !mobilePrimaryItems.some(primary => primary.to === item.to)).map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `rounded-xl px-2 py-2.5 text-center text-sm font-semibold ${isActive ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2 hover:bg-cs-raised'}`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto grid max-w-lg grid-cols-5 px-2 py-1.5">
          {mobilePrimaryItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `rounded-xl px-1 py-2 text-center text-xs font-semibold ${isActive ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2'}`
              }
            >
              {label === 'Retirement' ? 'Plan' : label === 'Grants' ? 'Data' : label}
            </NavLink>
          ))}
          <button
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-more-menu"
            onClick={() => setMobileMenuOpen(open => !open)}
            className={`rounded-xl px-1 py-2 text-center text-xs font-semibold ${mobileMenuOpen ? 'bg-cs-brand-subtle text-cs-brand' : 'text-cs-text-2'}`}
          >
            More
          </button>
        </div>
      </nav>

      <footer className="mb-16 border-t border-cs-border px-4 py-4 text-center text-xs text-cs-text-2 md:mb-0">
        <Link
          to="/privacy"
          className="underline hover:text-cs-text"
        >
          Privacy Policy
        </Link>
        <span className="mx-2 text-cs-muted">·</span>
        <ReportProblemLink />
        {appDisclaimerShort && (
          <p className="mx-auto mt-2 max-w-md">{appDisclaimerShort}</p>
        )}
      </footer>
    </div>
  )
}
