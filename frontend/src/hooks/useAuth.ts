import { useState, useCallback, useEffect } from 'react'
import { getToken, setToken, clearToken, api } from '../api.ts'

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(getToken)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAuthenticated = token !== null

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token') setTokenState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const login = useCallback(async (googleIdToken: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await api.loginGoogle(googleIdToken)
      setToken(resp.access_token)
      setTokenState(resp.access_token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setTokenState(null)
  }, [])

  return { isAuthenticated, login, logout, loading, error }
}
