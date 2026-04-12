import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { useMe } from '../hooks/useMe.ts'
import { useMaintenance } from '../contexts/MaintenanceContext.tsx'
import { useConfig } from '../hooks/useConfig.ts'
import { useViewing } from '../contexts/ViewingContext.tsx'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/events', label: 'Events' },
  { to: '/grants', label: 'Grants' },
  { to: '/sales', label: 'Sales' },
  { to: '/loans', label: 'Loans' },
  { to: '/prices', label: 'Prices' },
  { to: '/import', label: 'Import' },
  { to: '/settings', label: 'Settings' },
]

// Pages hidden when viewing someone else's data
const VIEWER_HIDDEN = new Set(['/import', '/wizard'])

export default function Layout() {
  const { logout } = useAuth()
  const me = useMe()
  const maintenance = useMaintenance()
  const config = useConfig()
  const { viewing, setViewing, clearViewing } = useViewing()
  const epicMode = config?.epic_mode ?? false
  const baseItems = epicMode ? NAV_ITEMS.filter(item => item.to !== '/import') : NAV_ITEMS
  const viewFilteredItems = viewing
    ? baseItems.filter(item => !VIEWER_HIDDEN.has(item.to))
    : baseItems
  const navItems = me?.is_admin && !viewing
    ? [...viewFilteredItems, { to: '/admin', label: 'Admin' }]
    : viewFilteredItems

  const sharedAccounts = me?.shared_accounts ?? []

  // (B) Focus management on route changes
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.focus()
  }, [location.pathname])

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-slate-950">
      {/* (A) Skip-navigation link */}
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>

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

      <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-sm font-bold text-rose-700 dark:text-rose-400">
            Equity Tracker
          </span>
          <div className="flex items-center gap-3">
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
                className="rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
            <button
              onClick={logout}
              aria-label="Sign out of your account"
              className="text-xs text-stone-600 hover:text-stone-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Sign Out
            </button>
          </div>
        </div>

        <nav aria-label="Main navigation" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-rose-700 text-white dark:bg-rose-600 dark:text-white'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none"
      >
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-600 dark:border-slate-800 dark:text-slate-400">
        <Link
          to="/privacy"
          className="underline hover:text-stone-600 dark:hover:text-slate-300"
        >
          Privacy Policy
        </Link>
      </footer>
    </div>
  )
}
