import { useState, useCallback } from 'react'
import { isLoggedIn } from '../../api.ts'
import { resetMeCache } from './useMe.ts'
import { resetConfigCache } from './useConfig.ts'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean>(isLoggedIn)

  const logout = useCallback(async () => {
    resetMeCache()
    resetConfigCache()
    // Clear user-specific storage to prevent data leaking across logins
    sessionStorage.removeItem('viewing_context')
    localStorage.removeItem('dashboard_range')
    localStorage.removeItem('dashboard_holdingsOpen')
    localStorage.removeItem('dashboard_loansOpen')
    localStorage.removeItem('dashboard_cardDate')
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthenticated(false)
    window.location.href = '/login'
  }, [])

  return { isAuthenticated: authenticated, logout }
}
