import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { useMe } from '../hooks/useMe.ts'
import { useMaintenance } from '../contexts/MaintenanceContext.tsx'

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
  const navItems = me?.is_admin ? [...NAV_ITEMS, { to: '/admin', label: 'Admin' }] : NAV_ITEMS

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      {maintenance && (
        <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-medium text-amber-950">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-800" />
          Maintenance in progress — financial data is temporarily unavailable
        </div>
      )}
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-sm font-bold text-transparent">
            Equity Tracker
          </span>
          <button
            onClick={logout}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Sign Out
          </button>
        </div>

        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
        <Link
          to="/privacy"
          className="underline hover:text-gray-600 dark:hover:text-gray-300"
        >
          Privacy Policy
        </Link>
      </footer>
    </div>
  )
}
