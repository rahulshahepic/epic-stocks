import { useState, useCallback } from 'react'
import { isLoggedIn } from '../../api.ts'
import { resetMeCache } from './useMe.ts'
import { resetConfigCache } from './useConfig.ts'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean>(isLoggedIn)

  const logout = useCallback(async () => {
    resetMeCache()
    resetConfigCache()
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setAuthenticated(false)
    window.location.href = '/login'
  }, [])

  return { isAuthenticated: authenticated, logout }
}
