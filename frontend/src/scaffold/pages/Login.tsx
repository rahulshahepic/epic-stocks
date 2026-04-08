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
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
      return
    }
    api.getProviders().then(setProviders).catch(() => setProviders([]))
  }, [isAuthenticated, navigate])

  // When the browser restores this page from bfcache (user hit Back after being
  // redirected to the IdP), the component state is frozen with loading set to the
  // provider name, leaving the button disabled. Reset it so the user can try again.
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(null)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  async function handleSignIn(providerName: string) {
    setLoading(providerName)
    setError(null)
    try {
      const verifier = generateCodeVerifier()
      const challenge = await generateCodeChallenge(verifier)
      const state = crypto.randomUUID()

      sessionStorage.setItem('pkce_verifier', verifier)
      sessionStorage.setItem('auth_state', state)
      sessionStorage.setItem('auth_provider', providerName)

      const redirectUri = window.location.origin + '/auth/callback'
      const { authorization_url } = await api.getLoginUrl(providerName, challenge, redirectUri, state)
      window.location.href = authorization_url
    } catch (e) {
      setLoading(null)
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-bold text-rose-700 dark:text-rose-400">
          Equity Vesting Tracker
        </h1>
        <p className="mb-8 text-sm text-stone-600 dark:text-slate-400">
          Sign in to manage your equity compensation
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {providers.map(p => (
            <button
              key={p.name}
              onClick={() => handleSignIn(p.name)}
              disabled={loading !== null}
              className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {loading === p.name ? 'Redirecting…' : `Sign in with ${p.label}`}
            </button>
          ))}
          {providers.length === 0 && (
            <p className="text-sm text-stone-600 dark:text-slate-400">No sign-in providers configured.</p>
          )}
        </div>

        <div className="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-left dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-2 text-xs font-medium text-stone-700 dark:text-slate-300">Your data &amp; privacy</p>
          <ul className="space-y-1.5 text-xs text-stone-600 dark:text-slate-400">
            <li>
              <span className="font-medium text-stone-600 dark:text-slate-300">Secure sign-in.</span>{' '}
              We never handle your password — your identity provider verifies you and shares only your name and email with us.
            </li>
            <li>
              <span className="font-medium text-stone-600 dark:text-slate-300">Your data is encrypted with a unique per-user key.</span>{' '}
              Your financial data is stored encrypted using AES-256-GCM with a key unique to your account. You can export your data at any time.
            </li>
            <li>
              <span className="font-medium text-stone-600 dark:text-slate-300">We will never sell your data</span>{' '}
              to any third party, for any reason.
            </li>
          </ul>
        </div>

        <p className="mt-4 text-xs text-stone-600 dark:text-slate-400">
          By using this site, you agree to our{' '}
          <Link
            to="/privacy"
            className="underline hover:text-stone-600 dark:hover:text-slate-300"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
