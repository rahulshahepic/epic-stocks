import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { useConfig } from '../hooks/useConfig.ts'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            el: HTMLElement,
            config: { theme: string; size: string; width: number }
          ) => void
        }
      }
    }
  }
}

export default function Login() {
  const { isAuthenticated, login, loading, error } = useAuth()
  const navigate = useNavigate()
  const btnRef = useRef<HTMLDivElement>(null)
  const config = useConfig()
  const clientId = config?.google_client_id ?? null
  const [gsiError, setGsiError] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    if (!clientId || !btnRef.current) return

    const init = () => {
      if (!window.google) {
        setGsiError('Google Sign-In failed to load. Check your network connection or disable ad blockers.')
        return
      }
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => { await login(response.credential) },
        })
        if (btnRef.current) {
          window.google.accounts.id.renderButton(btnRef.current, {
            theme: 'outline',
            size: 'large',
            width: 300,
          })
        }
      } catch (e) {
        setGsiError(`Google Sign-In init failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (window.google) {
      init()
      return
    }

    // The GSI script is in index.html (async). Listen to the script element's own
    // load/error events — more reliable than window load, which doesn't wait for async scripts.
    const scriptEl = document.querySelector<HTMLScriptElement>('script[src*="accounts.google.com/gsi"]')
    if (scriptEl) {
      scriptEl.addEventListener('load', init, { once: true })
      scriptEl.addEventListener('error', () => {
        setGsiError('Failed to load Google Sign-In script. Check your network or ad blocker.')
      }, { once: true })
      return () => {
        scriptEl.removeEventListener('load', init)
      }
    }

    // Script element not found — GSI was never added to the page
    setGsiError('Google Sign-In script not found. This is a configuration error.')
  }, [clientId, login])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-2xl font-bold text-transparent">
          Equity Vesting Tracker
        </h1>
        <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
          Sign in to manage your equity compensation
        </p>

        {(error || gsiError) && (
          <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {error ?? gsiError}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-400">Signing in...</p>
        ) : clientId === null ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : clientId === '' ? (
          <p className="text-sm text-red-500">
            Server is missing GOOGLE_CLIENT_ID — sign-in is not configured.
          </p>
        ) : gsiError ? null : (
          <div ref={btnRef} className="flex justify-center" />
        )}

        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4 text-left dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">Your data &amp; privacy</p>
          <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
            <li>
              <span className="font-medium text-gray-600 dark:text-gray-300">Why Google Sign-In?</span>{' '}
              We never handle your password — Google verifies your identity and shares only your name and email with us.
            </li>
            <li>
              <span className="font-medium text-gray-600 dark:text-gray-300">Your data is encrypted with a unique per-user key.</span>{' '}
              Your financial data is stored encrypted using AES-256-GCM with a key unique to your account. The operator of this site commits to never reading your data, and the per-user key design makes accidental access hard. You can export your data at any time.
            </li>
            <li>
              <span className="font-medium text-gray-600 dark:text-gray-300">We will never sell your data</span>{' '}
              to any third party, for any reason.
            </li>
          </ul>
        </div>

        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          By using this site, you agree to our{' '}
          <Link
            to="/privacy"
            className="underline hover:text-gray-600 dark:hover:text-gray-300"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
