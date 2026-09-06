import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetchRaw } from '../../api.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import UnofficialBadge from '../components/UnofficialBadge.tsx'
import { Card } from '../components/ui/Card.tsx'

interface UnsubscribeStatus {
  valid: boolean
  email: string
  type: string
  already_unsubscribed: boolean
}

export default function Unsubscribe() {
  const { appName } = useAppContext()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const email = searchParams.get('email') ?? ''
  const type = searchParams.get('type') ?? ''

  const [status, setStatus] = useState<UnsubscribeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Fallback: whether the user is logged in when their token is invalid
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token || !email || !type) {
      setError('Invalid unsubscribe link.')
      setLoading(false)
      return
    }
    apiFetchRaw(`/api/unsubscribe?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&type=${encodeURIComponent(type)}`)
      .then(r => r.json())
      .then((data: UnsubscribeStatus) => {
        setStatus(data)
        if (data.already_unsubscribed) setDone(true)
        if (!data.valid) {
          // Token expired — check if the user is already logged in so we can
          // offer a one-click authenticated unsubscribe instead.
          apiFetchRaw('/api/me').then(r => setIsLoggedIn(r.ok)).catch(() => setIsLoggedIn(false))
        }
      })
      .catch(() => setError('Could not verify unsubscribe link.'))
      .finally(() => setLoading(false))
  }, [token, email, type])

  async function handleUnsubscribe() {
    setProcessing(true)
    setError(null)
    try {
      const resp = await apiFetchRaw('/api/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token, email, type }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.detail ?? `Error ${resp.status}`)
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unsubscribe.')
    } finally {
      setProcessing(false)
    }
  }

  async function handleAuthUnsubscribe() {
    setProcessing(true)
    setError(null)
    try {
      const resp = await apiFetchRaw(`/api/unsubscribe/self?type=${encodeURIComponent(type)}`, {
        method: 'POST',
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.detail ?? `Error ${resp.status}`)
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unsubscribe.')
    } finally {
      setProcessing(false)
    }
  }

  const typeLabel = type === 'invite' ? 'invitation' : 'notification'

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
          <p className="text-sm text-cs-text-2">Verifying...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-1 text-2xl font-bold text-cs-brand">
          {appName}
        </h1>
        <UnofficialBadge className="mb-4" />

        {done && (
          <div className="mb-4 rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
            <p className="font-medium">You have been unsubscribed.</p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">
              {type === 'invite'
                ? `${email} will no longer receive invitation emails from this service.`
                : `${email} will no longer receive notification emails from this service.`}
            </p>
          </div>
        )}

        {error && !done && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Token is valid — normal one-click unsubscribe */}
        {status?.valid && !done && (
          <Card pad="lg" className="text-left">
            <p className="mb-3 text-sm text-cs-text-2">
              Unsubscribe <strong>{email}</strong> from {typeLabel} emails?
            </p>
            <p className="mb-4 text-xs text-cs-muted">
              {type === 'invite'
                ? 'You will no longer receive invitation emails from users of this service. You can still be invited by entering a code manually.'
                : 'You will no longer receive event notification emails. You can re-enable them in your account settings.'}
            </p>
            <button
              onClick={handleUnsubscribe}
              disabled={processing}
              className="w-full rounded-lg bg-cs-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-cs-brand-hover disabled:opacity-50"
            >
              {processing ? 'Processing...' : 'Unsubscribe'}
            </button>
          </Card>
        )}

        {/* Token is invalid — offer fallback based on auth state */}
        {status && !status.valid && !done && (
          <Card pad="lg" className="text-left">
            <p className="mb-2 text-sm font-medium text-cs-text-2">
              This unsubscribe link has expired.
            </p>
            {isLoggedIn === null && (
              <p className="text-xs text-cs-muted">Checking your session…</p>
            )}
            {isLoggedIn === true && (
              <>
                <p className="mb-4 text-xs text-cs-muted">
                  You're logged in — you can still unsubscribe directly.
                </p>
                <button
                  onClick={handleAuthUnsubscribe}
                  disabled={processing}
                  className="w-full rounded-lg bg-cs-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-cs-brand-hover disabled:opacity-50"
                >
                  {processing ? 'Processing…' : `Unsubscribe from ${typeLabel} emails`}
                </button>
              </>
            )}
            {isLoggedIn === false && (
              <>
                <p className="mb-4 text-xs text-cs-muted">
                  Log in to manage your {typeLabel} email preferences.
                </p>
                <a
                  href="/login"
                  className="block w-full rounded-lg bg-cs-brand px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm transition hover:bg-rose-800"
                >
                  Log in to manage preferences
                </a>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
