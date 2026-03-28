import { useState, useCallback, useEffect } from 'react'
import { clearToken, isLoggedIn } from '../../api.ts'
import { resetMeCache } from './useMe.ts'
import { resetConfigCache } from './useConfig.ts'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean>(isLoggedIn)

  // Sync across tabs: if the legacy localStorage token changes, re-evaluate.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token') setAuthenticated(isLoggedIn())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const logout = useCallback(async () => {
    clearToken()
    resetMeCache()
    resetConfigCache()
    // Clear server-side session cookie.
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthenticated(false)
    window.location.href = '/login'
  }, [])

  return { isAuthenticated: authenticated, logout }
}
