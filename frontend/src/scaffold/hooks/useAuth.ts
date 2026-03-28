import { useState, useCallback, useEffect } from 'react'
import { getToken, clearToken } from '../../api.ts'
import { resetMeCache } from './useMe.ts'
import { resetConfigCache } from './useConfig.ts'

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(getToken)

  const isAuthenticated = token !== null

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token') setTokenState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    resetMeCache()
    resetConfigCache()
    setTokenState(null)
    window.location.href = '/login'
  }, [])

  return { isAuthenticated, logout }
}
