import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isLoggedIn } from './api.ts'
import { AppProvider } from './app/AppProvider.tsx'
import { useSessionRefresh } from './scaffold/hooks/useSessionRefresh.ts'
import Layout from './scaffold/components/Layout.tsx'
import ErrorBoundary from './scaffold/components/ErrorBoundary.tsx'
import { ReportProvider } from './scaffold/components/ReportProblem.tsx'
import { ToastProvider } from './scaffold/components/Toast.tsx'
import { ThemeProvider } from './scaffold/contexts/ThemeContext.tsx'
import { MaintenanceProvider } from './scaffold/contexts/MaintenanceContext.tsx'
import { useMaintenance } from './scaffold/contexts/maintenance.ts'
import { ViewingProvider } from './scaffold/contexts/ViewingContext.tsx'
import Login from './scaffold/pages/Login.tsx'
import Try from './app/pages/Try.tsx'
import Demo from './app/pages/Demo.tsx'
import AuthCallback from './scaffold/pages/AuthCallback.tsx'
import InviteLanding from './scaffold/pages/InviteLanding.tsx'
import Unsubscribe from './scaffold/pages/Unsubscribe.tsx'
import PrivacyPolicy from './scaffold/pages/PrivacyPolicy.tsx'
import Dashboard from './app/pages/Dashboard.tsx'
import Events from './app/pages/Events.tsx'
import Grants from './app/pages/Grants.tsx'
import Loans from './app/pages/Loans.tsx'
import Prices from './app/pages/Prices.tsx'
import ImportExport from './app/pages/ImportExport.tsx'
import ImportDiagnostics from './app/pages/ImportDiagnostics.tsx'
import Settings from './scaffold/pages/Settings.tsx'
import ConnectAi from './scaffold/pages/ConnectAi.tsx'
import Admin from './scaffold/pages/Admin.tsx'
import Content from './app/pages/Content.tsx'
import Sales from './app/pages/Sales.tsx'
import CompCalculator from './app/pages/CompCalculator.tsx'
import Retirement from './app/pages/Retirement.tsx'

function RequireAuth({ children }: { children: React.ReactNode }) {
  useSessionRefresh()
  const location = useLocation()
  const intent = ['/connect-ai', '/import', '/retirement', '/comp-calculator'].includes(location.pathname) ? `?intent=${encodeURIComponent(location.pathname)}` : ''
  const annualSummary = location.hash === '#annual-summary' && ['/', '/events'].includes(location.pathname)
  const planning = location.pathname === '/planning'
  const signIn = planning ? `/login?next=${encodeURIComponent(location.pathname + location.search)}` : annualSummary ? `/login?next=${encodeURIComponent('/events#annual-summary')}` : `/login${intent}`
  return isLoggedIn() ? <>{children}</> : <Navigate to={signIn} replace />
}

// Wraps financial pages — shows a placeholder during maintenance instead of
// attempting to load encrypted data that the app can't serve right now.
function FinancialRoute({ children }: { children: React.ReactNode }) {
  const maintenance = useMaintenance()
  if (!maintenance) return <>{children}</>
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 h-3 w-3 animate-pulse rounded-full bg-amber-400" />
      <p className="text-sm font-semibold text-cs-text-2">
        Maintenance in progress
      </p>
      <p className="mt-1 text-xs text-cs-muted">
        Financial data is temporarily unavailable. Check back shortly.
      </p>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ThemeProvider>
        <BrowserRouter>
          <MaintenanceProvider>
            {/* Report first: the crash screen and the error toasts both raise reports
 through it, so it has to sit outside them. */}
            <ReportProvider>
              <ToastProvider>
                <ErrorBoundary>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/try" element={<Try />} />
                    <Route path="/demo" element={<Demo />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/invite" element={<InviteLanding />} />
                    <Route path="/unsubscribe" element={<Unsubscribe />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route element={<RequireAuth><ViewingProvider><Layout /></ViewingProvider></RequireAuth>}>
                      <Route index element={<FinancialRoute><Dashboard /></FinancialRoute>} />
                      <Route path="events" element={<FinancialRoute><Events /></FinancialRoute>} />
                      <Route path="grants" element={<FinancialRoute><Grants /></FinancialRoute>} />
                      <Route path="sales" element={<FinancialRoute><Sales /></FinancialRoute>} />
                      <Route path="loans" element={<FinancialRoute><Loans /></FinancialRoute>} />
                      <Route path="comp-calculator" element={<FinancialRoute><CompCalculator /></FinancialRoute>} />
                      <Route path="planning" element={<FinancialRoute><Retirement /></FinancialRoute>} />
                      <Route path="retirement" element={<FinancialRoute><Retirement /></FinancialRoute>} />
                      <Route path="prices" element={<FinancialRoute><Prices /></FinancialRoute>} />
                      <Route path="import" element={<FinancialRoute><ImportExport /></FinancialRoute>} />
                      <Route path="wizard" element={<Navigate to="/import" replace />} />
                      <Route path="settings" element={<FinancialRoute><Settings /></FinancialRoute>} />
                      <Route path="connect-ai" element={<ConnectAi />} />
                      <Route path="admin" element={<Admin />} />
                      <Route path="import-diagnostics" element={<ImportDiagnostics />} />
                      <Route path="content" element={<Content />} />
                    </Route>
                  </Routes>
                </ErrorBoundary>
              </ToastProvider>
            </ReportProvider>
          </MaintenanceProvider>
        </BrowserRouter>
      </ThemeProvider>
    </AppProvider>
  )
}
