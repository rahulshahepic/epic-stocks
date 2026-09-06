import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ReportProblemLink } from '../components/ReportProblem.tsx'
import { api, isLoggedIn } from '../../api.ts'
import type { InviteInfoResult } from '../../api.ts'
import { startLogin } from '../oidc.ts'
import { platform } from '../../platform/index.ts'
import DisclaimerNotice from '../components/DisclaimerNotice.tsx'
import UnofficialBadge from '../components/UnofficialBadge.tsx'
import { useAppContext } from '../contexts/AppContext.tsx'
import { Card } from '../components/ui/Card.tsx'

export default function InviteLanding() {
  const navigate = useNavigate()
  const { appName } = useAppContext()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const code = searchParams.get('code')
  const [info, setInfo] = useState<InviteInfoResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([])

  // With nothing to look up there is no request to wait on and nothing to
  // report but that fact, so both follow from the URL rather than from state.
  const missingInvite = !token && !code
  const [fetching, setFetching] = useState(true)
  const loading = fetching && !missingInvite
  const error = missingInvite ? 'No invitation token or code provided.' : lookupError

  useEffect(() => {
    if (missingInvite) return
    api.getInviteInfo({ token: token ?? undefined, code: code ?? undefined })
      .then(data => {
        setInfo(data)
        if (!data.valid) setLookupError(data.reason ?? 'Invalid invitation')
      })
      .catch(() => setLookupError('Could not verify invitation'))
      .finally(() => setFetching(false))
  }, [token, code, missingInvite])

  // Auto-accepting runs from the moment a valid invitation meets a signed-in
  // visitor until it fails, which is exactly what these three already say — so
  // it is derived rather than tracked, and the failure below ends it by
  // recording the error.
  const accepting = !!info?.valid && isLoggedIn() && !lookupError

  useEffect(() => {
    if (!info?.valid || !isLoggedIn()) return
    api.acceptInvite({ token: token ?? undefined, code: code ?? undefined })
      .then(() => {
        navigate('/', { replace: true })
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : 'Failed to accept invitation'
        if (msg.includes('already')) {
          navigate('/', { replace: true })
        } else {
          setLookupError(msg)
        }
      })
  }, [info, token, code, navigate])

  // If not logged in, store token and show login options
  useEffect(() => {
    if (info?.valid && !isLoggedIn()) {
      if (token) void platform.storage.set('invite_token', token)
      else if (code) void platform.storage.set('invite_code', code)
      api.getProviders().then(setProviders).catch(() => setProviders([]))
    }
  }, [info, token, code])

  async function handleSignIn(providerName: string) {
    setFetching(true)
    try {
      await startLogin(providerName)
    } catch {
      setFetching(false)
      setLookupError('Sign-in failed. Please try again.')
    }
  }

  if (loading || accepting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
          <p className="text-sm text-cs-text-2">
            {accepting ? 'Accepting invitation…' : 'Verifying invitation…'}
          </p>
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

        <DisclaimerNotice className="mb-5" />

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
            <Card pad="md" className="mb-6 text-left">
              <p className="mb-2 text-sm text-cs-text-2">
                <strong>{info.inviter_name}</strong> has invited you to view their equity vesting data.
              </p>
              <p className="text-xs text-cs-muted">
                Sign in with any account to accept this invitation. Your sign-in account does not need to match the email this was sent to.
              </p>
            </Card>

            <div className="space-y-2">
              {providers.map(p => (
                <button
                  key={p.name}
                  onClick={() => handleSignIn(p.name)}
                  className="w-full rounded-lg border border-cs-border-strong bg-cs-surface px-4 py-2.5 text-sm font-medium text-cs-text-2 shadow-sm transition hover:bg-cs-raised "
                >
                  Sign in with {p.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Another pre-login dead end: an invitation that will not open leaves
 someone with no account and nothing to click. */}
        <p className="mt-6 text-xs text-cs-text-2">
          Something not working?{' '}
          <ReportProblemLink className="font-medium text-cs-brand hover:text-cs-brand-hover" />
        </p>
      </div>
    </div>
  )
}
