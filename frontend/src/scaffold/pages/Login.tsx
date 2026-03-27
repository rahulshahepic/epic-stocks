import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'
import { api } from '../../api.ts'

function generateCodeVerifier(): string {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export default function Login() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  async function handleSignIn() {
    setLoading(true)
    setError(null)
    try {
      const verifier = generateCodeVerifier()
      const challenge = await generateCodeChallenge(verifier)
      const state = crypto.randomUUID()

      sessionStorage.setItem('pkce_verifier', verifier)
      sessionStorage.setItem('auth_state', state)

      const redirectUri = window.location.origin + '/auth/callback'
      const { authorization_url } = await api.getLoginUrl(challenge, redirectUri, state)
      window.location.href = authorization_url
    } catch (e) {
      setLoading(false)
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-2xl font-bold text-transparent">
          Equity Vesting Tracker
        </h1>
        <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
          Sign in to manage your equity compensation
        </p>

        {error && (
          <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-750"
        >
          {loading ? 'Redirecting…' : 'Sign in'}
        </button>

        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4 text-left dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">Your data &amp; privacy</p>
          <ul className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
            <li>
              <span className="font-medium text-gray-600 dark:text-gray-300">Secure sign-in.</span>{' '}
              We never handle your password — your identity provider verifies you and shares only your name and email with us.
            </li>
            <li>
              <span className="font-medium text-gray-600 dark:text-gray-300">Your data is encrypted with a unique per-user key.</span>{' '}
              Your financial data is stored encrypted using AES-256-GCM with a key unique to your account. You can export your data at any time.
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
