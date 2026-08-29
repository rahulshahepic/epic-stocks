import { useState, useCallback } from 'react'
import { apiFetchRaw, isLoggedIn } from '../../api.ts'
import { platform } from '../../platform/index.ts'
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
    await apiFetchRaw('/api/auth/logout', { method: 'POST' }).catch(() => {})
    await platform.auth.clearSession()
    setAuthenticated(false)
    platform.auth.onUnauthorized()
  }, [])

  const logoutEverywhere = useCallback(async () => {
    clearLocalSessionState()
    await apiFetchRaw('/api/auth/logout-everywhere', { method: 'POST' }).catch(() => {})
    await platform.auth.clearSession()
    setAuthenticated(false)
    platform.auth.onUnauthorized()
  }, [])

  return { isAuthenticated: authenticated, logout, logoutEverywhere }
}
