import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { getToken, api } from './api.ts'
import Layout from './components/Layout.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import Login from './pages/Login.tsx'
import PrivacyPolicy from './pages/PrivacyPolicy.tsx'
import Dashboard from './pages/Dashboard.tsx'
import Events from './pages/Events.tsx'
import Grants from './pages/Grants.tsx'
import Loans from './pages/Loans.tsx'
import Prices from './pages/Prices.tsx'
import ImportExport from './pages/ImportExport.tsx'
import Settings from './pages/Settings.tsx'
import Admin from './pages/Admin.tsx'
import Sales from './pages/Sales.tsx'
import { useMe } from './hooks/useMe.ts'

function RequireAuth({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />
}

// Full-screen overlay for regular users — blocks all interaction.
function MaintenanceOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="max-w-sm px-6 text-center">
        <div className="mx-auto mb-5 h-3 w-3 animate-pulse rounded-full bg-amber-400" />
        <h1 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Maintenance in progress
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The site will be back shortly. This page checks automatically.
        </p>
      </div>
    </div>
  )
}

// Non-blocking banner for admins — lets them reach the admin panel to end maintenance.
function MaintenanceBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950">
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-800" />
      Maintenance mode is active — financial data is unavailable to users.
    </div>
  )
}

function MaintenanceGate({ maintenance }: { maintenance: boolean }) {
  const location = useLocation()
  const me = useMe()

  if (!maintenance) return null
  // Admins on /admin see a non-blocking banner so they can still toggle maintenance off
  if (me?.is_admin && location.pathname === '/admin') return <MaintenanceBanner />
  return <MaintenanceOverlay />
}

export default function App() {
  const [maintenance, setMaintenance] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const s = await api.status()
        if (cancelled) return
        if (maintenance && !s.maintenance) {
          // Maintenance just ended — reload so all data refetches cleanly
          window.location.reload()
          return
        }
        setMaintenance(s.maintenance)
      } catch {
        // Network error: leave current state unchanged
      }
    }

    check()

    // Poll every 15 s normally; switches to 5 s while in maintenance
    const delay = maintenance ? 5_000 : 15_000
    intervalRef.current = setInterval(check, delay)
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [maintenance])

  return (
    <ThemeProvider>
    <BrowserRouter>
      <ToastProvider>
        <MaintenanceGate maintenance={maintenance} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="grants" element={<Grants />} />
            <Route path="sales" element={<Sales />} />
            <Route path="loans" element={<Loans />} />
            <Route path="prices" element={<Prices />} />
            <Route path="import" element={<ImportExport />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
    </ThemeProvider>
  )
}
