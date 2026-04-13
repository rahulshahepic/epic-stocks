import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

interface UnsubscribeStatus {
  valid: boolean
  email: string
  type: string
  already_unsubscribed: boolean
}

export default function Unsubscribe() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const email = searchParams.get('email') ?? ''
  const type = searchParams.get('type') ?? ''

  const [status, setStatus] = useState<UnsubscribeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !email || !type) {
      setError('Invalid unsubscribe link.')
      setLoading(false)
      return
    }
    fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&type=${encodeURIComponent(type)}`)
      .then(r => r.json())
      .then((data: UnsubscribeStatus) => {
        setStatus(data)
        if (!data.valid) setError('This unsubscribe link is invalid or expired.')
        if (data.already_unsubscribed) setDone(true)
      })
      .catch(() => setError('Could not verify unsubscribe link.'))
      .finally(() => setLoading(false))
  }, [token, email, type])

  async function handleUnsubscribe() {
    setProcessing(true)
    setError(null)
    try {
      const resp = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const typeLabel = type === 'invite' ? 'invitation' : 'notification'

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
          <p className="text-sm text-stone-600 dark:text-slate-400">Verifying...</p>
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

        {status?.valid && !done && (
          <div className="rounded-lg border border-stone-200 bg-white p-5 text-left dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-3 text-sm text-stone-700 dark:text-slate-300">
              Unsubscribe <strong>{email}</strong> from {typeLabel} emails?
            </p>
            <p className="mb-4 text-xs text-stone-500 dark:text-slate-400">
              {type === 'invite'
                ? 'You will no longer receive invitation emails from users of this service. You can still be invited by entering a code manually.'
                : 'You will no longer receive event notification emails. You can re-enable them in your account settings.'}
            </p>
            <button
              onClick={handleUnsubscribe}
              disabled={processing}
              className="w-full rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-rose-800 disabled:opacity-50"
            >
              {processing ? 'Processing...' : 'Unsubscribe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
