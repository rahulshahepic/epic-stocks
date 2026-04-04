import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { useMe } from '../hooks/useMe.ts'
import { useMaintenance } from '../contexts/MaintenanceContext.tsx'
import { useConfig } from '../hooks/useConfig.ts'

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

export default function Layout() {
  const { logout } = useAuth()
  const me = useMe()
  const maintenance = useMaintenance()
  const config = useConfig()
  const epicMode = config?.epic_mode ?? false
  const baseItems = epicMode ? NAV_ITEMS.filter(item => item.to !== '/import') : NAV_ITEMS
  const navItems = me?.is_admin ? [...baseItems, { to: '/admin', label: 'Admin' }] : baseItems

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

      <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-sm font-bold text-rose-700 dark:text-rose-400">
            Equity Tracker
          </span>
          <button
            onClick={logout}
            aria-label="Sign out of your account"
            className="text-xs text-stone-500 hover:text-stone-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Sign Out
          </button>
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
                    : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
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

      <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-500 dark:border-slate-800 dark:text-slate-400">
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
