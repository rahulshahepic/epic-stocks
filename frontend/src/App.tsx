import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isLoggedIn } from './api.ts'
import Layout from './scaffold/components/Layout.tsx'
import { ToastProvider } from './scaffold/components/Toast.tsx'
import { ThemeProvider } from './scaffold/contexts/ThemeContext.tsx'
import { MaintenanceProvider, useMaintenance } from './scaffold/contexts/MaintenanceContext.tsx'
import { ViewingProvider } from './scaffold/contexts/ViewingContext.tsx'
import Login from './scaffold/pages/Login.tsx'
import AuthCallback from './scaffold/pages/AuthCallback.tsx'
import InviteLanding from './scaffold/pages/InviteLanding.tsx'
import PrivacyPolicy from './scaffold/pages/PrivacyPolicy.tsx'
import Dashboard from './app/pages/Dashboard.tsx'
import Events from './app/pages/Events.tsx'
import Grants from './app/pages/Grants.tsx'
import Loans from './app/pages/Loans.tsx'
import Prices from './app/pages/Prices.tsx'
import ImportExport from './app/pages/ImportExport.tsx'
import ImportWizard from './app/components/ImportWizard.tsx'
import Settings from './scaffold/pages/Settings.tsx'
import Admin from './scaffold/pages/Admin.tsx'
import Sales from './app/pages/Sales.tsx'

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />
}

// Wraps financial pages — shows a placeholder during maintenance instead of
// attempting to load encrypted data that the app can't serve right now.
function FinancialRoute({ children }: { children: React.ReactNode }) {
  const maintenance = useMaintenance()
  if (!maintenance) return <>{children}</>
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 h-3 w-3 animate-pulse rounded-full bg-amber-400" />
      <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
        Maintenance in progress
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        Financial data is temporarily unavailable. Check back shortly.
      </p>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <MaintenanceProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite" element={<InviteLanding />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route element={<RequireAuth><ViewingProvider><Layout /></ViewingProvider></RequireAuth>}>
            <Route index element={<FinancialRoute><Dashboard /></FinancialRoute>} />
            <Route path="events" element={<FinancialRoute><Events /></FinancialRoute>} />
            <Route path="grants" element={<FinancialRoute><Grants /></FinancialRoute>} />
            <Route path="sales" element={<FinancialRoute><Sales /></FinancialRoute>} />
            <Route path="loans" element={<FinancialRoute><Loans /></FinancialRoute>} />
            <Route path="prices" element={<FinancialRoute><Prices /></FinancialRoute>} />
            <Route path="import" element={<FinancialRoute><ImportExport /></FinancialRoute>} />
            <Route path="wizard" element={<FinancialRoute><div className="p-4"><ImportWizard isPage /></div></FinancialRoute>} />
            <Route path="settings" element={<FinancialRoute><Settings /></FinancialRoute>} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Routes>
      </ToastProvider>
      </MaintenanceProvider>
    </BrowserRouter>
    </ThemeProvider>
  )
}
