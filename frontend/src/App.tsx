import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken } from './api.ts'
import Layout from './components/Layout.tsx'
import Login from './pages/Login.tsx'
import Dashboard from './pages/Dashboard.tsx'

function Placeholder({ name }: { name: string }) {
  return <p className="text-sm text-gray-400">{name} — coming soon</p>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="events" element={<Placeholder name="Events Timeline" />} />
          <Route path="grants" element={<Placeholder name="Grants Management" />} />
          <Route path="loans" element={<Placeholder name="Loans Management" />} />
          <Route path="prices" element={<Placeholder name="Prices Management" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
