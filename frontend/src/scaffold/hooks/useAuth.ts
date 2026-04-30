import { useState, useCallback } from 'react'
import { isLoggedIn } from '../../api.ts'
import { resetMeCache } from './useMe.ts'
import { resetConfigCache } from './useConfig.ts'

function clearLocalSessionState() {
  resetMeCache()
  resetConfigCache()
  sessionStorage.removeItem('viewing_context')
  localStorage.removeItem('dashboard_range')
  localStorage.removeItem('dashboard_holdingsOpen')
  localStorage.removeItem('dashboard_loansOpen')
  localStorage.removeItem('dashboard_cardDate')
}

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean>(isLoggedIn)

  const logout = useCallback(async () => {
    clearLocalSessionState()
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthenticated(false)
    window.location.href = '/login'
  }, [])

  const logoutEverywhere = useCallback(async () => {
    clearLocalSessionState()
    await fetch('/api/auth/logout-everywhere', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthenticated(false)
    window.location.href = '/login'
  }, [])

  return { isAuthenticated: authenticated, logout, logoutEverywhere }
}
