import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken } from './api.ts'
import Layout from './components/Layout.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import { MaintenanceProvider, useMaintenance } from './contexts/MaintenanceContext.tsx'
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />
}

// Wraps financial pages — shows a placeholder during maintenance instead of
// attempting to load encrypted data that the app can't serve right now.
function FinancialRoute({ children }: { children: React.ReactNode }) {
  const maintenance = useMaintenance()
  if (!maintenance) return <>{children}</>
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 h-3 w-3 animate-pulse rounded-full bg-amber-400" />
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Maintenance in progress
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<FinancialRoute><Dashboard /></FinancialRoute>} />
            <Route path="events" element={<FinancialRoute><Events /></FinancialRoute>} />
            <Route path="grants" element={<FinancialRoute><Grants /></FinancialRoute>} />
            <Route path="sales" element={<FinancialRoute><Sales /></FinancialRoute>} />
            <Route path="loans" element={<FinancialRoute><Loans /></FinancialRoute>} />
            <Route path="prices" element={<FinancialRoute><Prices /></FinancialRoute>} />
            <Route path="import" element={<FinancialRoute><ImportExport /></FinancialRoute>} />
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
