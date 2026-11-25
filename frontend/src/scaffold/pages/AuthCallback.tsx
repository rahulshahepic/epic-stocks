import { claimMeasurement, measurementEvent, measurementToken } from '../onboarding.ts'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReportProblem } from '../components/reportContext.ts'
import { api } from '../../api.ts'
import { clearPendingLogin, completeLogin, readPendingLogin } from '../oidc.ts'
import { takeNext } from '../postLogin.ts'
import { platform } from '../../platform/index.ts'
import { pingConverted, takeStashedTrialPayload } from '../../app/trialImport.ts'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { openReport } = useReportProblem()
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  // The authorization code is single-use. Reading the stored PKCE material is
  // async, so without this guard StrictMode's double-invoked effect can get two
  // exchanges in flight before either clears the material, and the second fails.
  const startedRef = useRef(false)

  // What came back on the URL is fixed for the life of this page, so it is read
  // during render rather than copied into state by an effect.
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const idpError = params.get('error')
  const urlError = idpError
    ? (params.get('error_description') || idpError)
    : (code ? null : 'No authorization code received.')
  const error = urlError ?? exchangeError

  useEffect(() => {
    if (urlError || !code) return
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      const pending = await readPendingLogin()

      if (!state || state !== pending.state) {
        setExchangeError('Invalid state — possible CSRF attempt. Please try signing in again.')
        return
      }

      if (!pending.verifier || !pending.provider) {
        setExchangeError('Session data missing. Please try signing in again.')
        return
      }

      await clearPendingLogin()

      try {
        await completeLogin(pending.provider, code, pending.verifier)
      } catch (e) {
        setExchangeError(e instanceof Error ? e.message : 'Authentication failed. Please try again.')
        return
      }

      // Check if there's a pending invitation to accept
      const inviteToken = await platform.storage.get('invite_token')
      const inviteCode = await platform.storage.get('invite_code')
      if (inviteToken || inviteCode) {
        await platform.storage.remove('invite_token')
        await platform.storage.remove('invite_code')
        try {
          await api.acceptInvite({
            token: inviteToken ?? undefined,
            code: inviteCode ?? undefined,
          })
        } catch {
          // Acceptance failed (expired, already used, etc.) — continue to home
        }
      }

      // A /try session stashed its draft before sending the user here to sign
      // up. Only what is new is added: an account that already has data keeps
      // every row it had, and the Import page can bring in the rest.
      const trialDraft = await takeStashedTrialPayload()
      if (trialDraft) {
        try {
          await claimMeasurement()
          const { changes, blocked } = await api.draftChanges(trialDraft)
          const additions = changes.filter(c => c.action === 'create')
          if (!blocked && additions.length) {
            const preview = await api.previewChanges(additions)
            if (preview.confirm) {
              const token = await measurementToken()
              if (token) await api.applyChanges(additions, preview.confirm, token)
              else await api.applyChanges(additions, preview.confirm)
              pingConverted()
            }
          }
        } catch {
          void measurementEvent('carryover_failed')
          // Save failed — they still have a working account; they can import again.
        }
      }

      // Something sent this user to sign in mid-flow — the OAuth consent
      // screen, today. Return them to it rather than to the dashboard. It is a
      // server-rendered route, so this is a navigation, not a router push.
      const next = await takeNext()
      if (next) {
        window.location.assign(next)
        return
      }

      navigate('/', { replace: true })
    })()
  }, [navigate, code, state, urlError])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
        <div className="w-full max-w-sm text-center">
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
          <a
            href="/login"
            className="text-sm text-cs-brand underline hover:text-rose-800 "
          >
            Back to sign-in
          </a>
          {/* A sign-in that fails here strands someone outside the app entirely. */}
          <p className="mt-4 text-xs text-cs-text-2">
            <button
              type="button"
              onClick={() => openReport({ source: 'manual', errorMessage: error })}
              className="underline hover:text-cs-text"
            >
              Report this
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
        <p className="text-sm text-cs-text-2">Completing sign-in…</p>
      </div>
    </div>
  )
}
