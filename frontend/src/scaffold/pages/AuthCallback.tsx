import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken } from '../../api.ts'
import { api } from '../../api.ts'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const idpError = params.get('error')
    const idpErrorDesc = params.get('error_description')

    if (idpError) {
      setError(idpErrorDesc || idpError)
      return
    }

    if (!code) {
      setError('No authorization code received.')
      return
    }

    const storedState = sessionStorage.getItem('auth_state')
    const verifier = sessionStorage.getItem('pkce_verifier')

    if (!state || state !== storedState) {
      setError('Invalid state — possible CSRF attempt. Please try signing in again.')
      return
    }

    if (!verifier) {
      setError('PKCE verifier missing. Please try signing in again.')
      return
    }

    sessionStorage.removeItem('pkce_verifier')
    sessionStorage.removeItem('auth_state')

    const redirectUri = window.location.origin + '/auth/callback'

    api.exchangeCode(code, verifier, redirectUri)
      .then(({ access_token }) => {
        setToken(access_token)
        navigate('/', { replace: true })
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.')
      })
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
        <div className="w-full max-w-sm text-center">
          <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
          <a
            href="/login"
            className="text-sm text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
          >
            Back to sign-in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-indigo-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Completing sign-in…</p>
      </div>
    </div>
  )
}
