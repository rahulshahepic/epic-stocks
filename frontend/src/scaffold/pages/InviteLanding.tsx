import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, isLoggedIn } from '../../api.ts'
import type { InviteInfoResult } from '../../api.ts'

export default function InviteLanding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const code = searchParams.get('code')
  const [info, setInfo] = useState<InviteInfoResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([])

  useEffect(() => {
    if (!token && !code) {
      setError('No invitation token or code provided.')
      setLoading(false)
      return
    }
    api.getInviteInfo({ token: token ?? undefined, code: code ?? undefined })
      .then(data => {
        setInfo(data)
        if (!data.valid) setError(data.reason ?? 'Invalid invitation')
      })
      .catch(() => setError('Could not verify invitation'))
      .finally(() => setLoading(false))
  }, [token, code])

  // If logged in and info is valid, auto-accept
  useEffect(() => {
    if (!info?.valid || !isLoggedIn()) return
    setAccepting(true)
    api.acceptInvite({ token: token ?? undefined, code: code ?? undefined })
      .then(() => {
        navigate('/', { replace: true })
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : 'Failed to accept invitation'
        if (msg.includes('already')) {
          navigate('/', { replace: true })
        } else {
          setError(msg)
          setAccepting(false)
        }
      })
  }, [info, token, code, navigate])

  // If not logged in, store token and show login options
  useEffect(() => {
    if (info?.valid && !isLoggedIn()) {
      if (token) sessionStorage.setItem('invite_token', token)
      else if (code) sessionStorage.setItem('invite_code', code)
      api.getProviders().then(setProviders).catch(() => setProviders([]))
    }
  }, [info, token, code])

  async function handleSignIn(providerName: string) {
    setLoading(true)
    try {
      const array = new Uint8Array(64)
      crypto.getRandomValues(array)
      const verifier = btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      const data = new TextEncoder().encode(verifier)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      const state = crypto.randomUUID()

      sessionStorage.setItem('pkce_verifier', verifier)
      sessionStorage.setItem('auth_state', state)
      sessionStorage.setItem('auth_provider', providerName)

      const redirectUri = window.location.origin + '/auth/callback'
      const { authorization_url } = await api.getLoginUrl(providerName, challenge, redirectUri, state)
      window.location.href = authorization_url
    } catch {
      setLoading(false)
      setError('Sign-in failed. Please try again.')
    }
  }

  if (loading || accepting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
          <p className="text-sm text-stone-600 dark:text-slate-400">
            {accepting ? 'Accepting invitation…' : 'Verifying invitation…'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-bold text-rose-700 dark:text-rose-400">
          Equity Vesting Tracker
        </h1>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
            <p className="mt-2">
              <a href="/login" className="underline hover:text-red-800 dark:hover:text-red-300">
                Go to sign-in
              </a>
            </p>
          </div>
        )}

        {info?.valid && !isLoggedIn() && (
          <>
            <div className="mb-6 rounded-lg border border-stone-200 bg-white p-4 text-left dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-2 text-sm text-stone-700 dark:text-slate-300">
                <strong>{info.inviter_name}</strong> has invited you to view their equity vesting data.
              </p>
              <p className="text-xs text-stone-500 dark:text-slate-400">
                Sign in with any account to accept this invitation. Your sign-in account does not need to match the email this was sent to.
              </p>
            </div>

            <div className="space-y-2">
              {providers.map(p => (
                <button
                  key={p.name}
                  onClick={() => handleSignIn(p.name)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Sign in with {p.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
