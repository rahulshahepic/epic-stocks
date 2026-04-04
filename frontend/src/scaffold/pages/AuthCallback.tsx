import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
    const provider = sessionStorage.getItem('auth_provider')

    if (!state || state !== storedState) {
      setError('Invalid state — possible CSRF attempt. Please try signing in again.')
      return
    }

    if (!verifier || !provider) {
      setError('Session data missing. Please try signing in again.')
      return
    }

    sessionStorage.removeItem('pkce_verifier')
    sessionStorage.removeItem('auth_state')
    sessionStorage.removeItem('auth_provider')

    const redirectUri = window.location.origin + '/auth/callback'

    api.exchangeCode(provider, code, verifier, redirectUri)
      .then(() => {
        // The backend sets the HttpOnly session cookie in the response.
        // No need to store anything client-side.
        navigate('/', { replace: true })
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.')
      })
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm text-center">
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
          <a
            href="/login"
            className="text-sm text-rose-700 underline hover:text-rose-800 dark:text-rose-400"
          >
            Back to sign-in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
        <p className="text-sm text-stone-500 dark:text-slate-400">Completing sign-in…</p>
      </div>
    </div>
  )
}
