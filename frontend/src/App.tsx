import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken } from './api.ts'
import Layout from './components/Layout.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import Login from './pages/Login.tsx'
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

export default function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
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
