import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ReportProblemLink } from '../components/ReportProblem.tsx'
import { useAuth } from '../hooks/useAuth.ts'
import { api } from '../../api.ts'
import { startLogin } from '../oidc.ts'
import { safeNext, stashNext } from '../postLogin.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import { HeroIllustration } from '../components/ui/icons.tsx'
import DisclaimerNotice from '../components/DisclaimerNotice.tsx'
import UnofficialBadge from '../components/UnofficialBadge.tsx'
import { IconTile, Card, Eyebrow } from '../components/ui/Card.tsx'
import { IconTrendUp, IconCompass, IconShield, IconChatSpark } from '../components/ui/icons.tsx'
import { useConfig } from '../hooks/useConfig.ts'

const FEATURES = [
  {
    icon: <IconTrendUp />,
    tone: 'brand' as const,
    title: 'Built around Epic grants',
    body: 'Purchase, catch-up, free, and bonus grants, plus stock loans and payoffs.',
  },
  {
    icon: <IconCompass />,
    tone: 'amber' as const,
    title: 'Plan before you sell',
    body: 'Project vesting, income, and capital-gains tax on your own numbers.',
  },
  {
    icon: <IconShield />,
    tone: 'emerald' as const,
    title: 'Your data, not Epic’s',
    body: 'You enter or import it, it is encrypted per user, and it is never sold.',
  },
]

/**
 * The one thing on this page nobody arrives expecting, so it is on the page
 * rather than waiting in Settings for someone to find it. Slotted third, above
 * the privacy line that closes the list. Hidden when the deployment has AI
 * connections switched off — advertising a feature an admin turned off is
 * worse than not mentioning it.
 */
const AI_FEATURE = {
  icon: <IconChatSpark />,
  tone: 'violet' as const,
  title: 'Ask ChatGPT or Claude',
  body: 'Connect your assistant and ask about vesting, tax and total comp using your real figures — and let it keep your salary and retirement numbers current.',
}

export default function Login() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { appName, appTagline } = useAppContext()
  const config = useConfig()
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Where to go once signed in. Set when something bounced the user here
  // mid-flow — today that is the OAuth consent screen, which is a server route
  // and so needs a navigation rather than a router push.
  const next = safeNext(new URLSearchParams(window.location.search).get('next'))

  useEffect(() => {
    if (isAuthenticated) {
      if (next) window.location.assign(next)
      else navigate('/', { replace: true })
      return
    }
    void stashNext(next)
    api.getProviders().then(setProviders).catch(() => setProviders([]))
  }, [isAuthenticated, navigate, next])

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

  // Slotted above the privacy line, which is the natural closer for the list.
  const features = config?.ai_connections
    ? [...FEATURES.slice(0, 2), AI_FEATURE, ...FEATURES.slice(2)]
    : FEATURES

  async function handleSignIn(providerName: string) {
    setLoading(providerName)
    setError(null)
    try {
      await startLogin(providerName)
    } catch (e) {
      setLoading(null)
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-cs-base px-4 py-10">
      <div className="w-full max-w-sm">
        <Card pad="none" className="overflow-hidden">
          <HeroIllustration className="h-40 w-full" />
        </Card>

        <div className="mt-7 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-cs-text">
            <span className="text-cs-brand">{appName}</span>
          </h1>
          <UnofficialBadge className="mt-2" />
          <p className="mx-auto mt-2 max-w-[26rem] text-sm leading-relaxed text-cs-text-2">
            {appTagline}
          </p>
        </div>

        <DisclaimerNotice className="mt-6" />

        <Eyebrow className="mt-7">What you get with an account</Eyebrow>
        <div className="mt-2.5 space-y-2.5">
          {features.map(f => (
            <div key={f.title} className="flex items-center gap-3 rounded-xl border border-cs-border bg-cs-surface px-3.5 py-3 shadow-card">
              <IconTile tone={f.tone}>{f.icon}</IconTile>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-cs-text">{f.title}</p>
                <p className="text-xs leading-snug text-cs-text-2">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700 shadow-card dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-7 space-y-2">
          {providers.map((p, i) => (
            <button
              key={p.name}
              onClick={() => handleSignIn(p.name)}
              disabled={loading !== null}
              className={`w-full rounded-xl px-4 py-3 text-sm font-semibold shadow-card transition disabled:opacity-50 ${
                i === 0
                  ? 'bg-cs-brand text-white hover:bg-cs-brand-hover'
                  : 'border border-cs-border-strong bg-cs-surface text-cs-text hover:bg-cs-raised'
              }`}
            >
              {loading === p.name ? 'Redirecting…' : `Sign in with ${p.label}`}
            </button>
          ))}
          {providers.length === 0 && (
            <p className="text-center text-sm text-cs-text-2">No sign-in providers configured.</p>
          )}
        </div>

        {/* The other way in. It was a sentence under the buttons, which reads
            as a footnote — the two paths are a real choice, so it looks like
            one. */}
        <div className="mt-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-cs-border" />
          <span className="text-xs font-medium uppercase tracking-wide text-cs-muted">or</span>
          <span className="h-px flex-1 bg-cs-border" />
        </div>

        <Link
          to="/try"
          className="mt-5 block rounded-xl border border-cs-border-strong bg-cs-surface p-3.5 text-left shadow-card transition hover:bg-cs-raised"
        >
          <p className="text-sm font-semibold text-cs-text">
            See it first, without an account
          </p>
          <p className="mt-0.5 text-xs leading-snug text-cs-text-2">
            Drop in your Epic share summary and loan statement for a read-only
            preview of your position. The files are read and thrown away —
            nothing is stored.
          </p>
        </Link>

        <Card className="mt-6 text-left">
          <Eyebrow className="mb-2">Your data &amp; privacy</Eyebrow>
          <ul className="space-y-1.5 text-xs leading-relaxed text-cs-text-2">
            <li>
              <span className="font-medium text-cs-text">Secure sign-in.</span>{' '}
              We never handle your password — your identity provider verifies you and shares only your name and email with us.
            </li>
            <li>
              <span className="font-medium text-cs-text">Your data is encrypted with a unique per-user key.</span>{' '}
              Your financial data is stored encrypted using AES-256-GCM with a key unique to your account. You can export your data at any time.
            </li>
            <li>
              <span className="font-medium text-cs-text">We will never sell your data</span>{' '}
              to any third party, for any reason.
            </li>
          </ul>
        </Card>

        <p className="mt-4 text-center text-xs text-cs-text-2">
          By using this site, you agree to our{' '}
          <Link
            to="/privacy"
            className="font-medium text-cs-brand underline decoration-cs-brand/40 underline-offset-2 hover:text-cs-brand-hover"
          >
            Privacy Policy
          </Link>
          .
        </p>

        {/* Someone who cannot get past this screen has no other way to say so. */}
        <p className="mt-3 text-center text-xs text-cs-text-2">
          Can't sign in, or something looks wrong?{' '}
          <ReportProblemLink className="font-medium text-cs-brand hover:text-cs-brand-hover" />
        </p>
      </div>
    </div>
  )
}
