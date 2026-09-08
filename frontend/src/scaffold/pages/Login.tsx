import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ReportProblemLink } from '../components/ReportProblem.tsx'
import { useAuth } from '../hooks/useAuth.ts'
import { api } from '../../api.ts'
import { startLogin } from '../oidc.ts'
import { safeNext, stashNext } from '../postLogin.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import DisclaimerNotice from '../components/DisclaimerNotice.tsx'
import UnofficialBadge from '../components/UnofficialBadge.tsx'
import { IconTile, Card, Eyebrow } from '../components/ui/Card.tsx'
import { IconTrendUp, IconCompass, IconShield, IconChatSpark } from '../components/ui/icons.tsx'
import { CampusWelcomeScene } from '../components/CampusMotifs.tsx'
import { useConfig } from '../hooks/useConfig.ts'
import campusWatercolor from '../../assets/campus-watercolor.webp'

const FEATURES = [
  { icon: <IconTrendUp />, tone: 'brand' as const, title: 'Built around Epic grants', body: 'Purchase, catch-up, free, and bonus grants, plus stock loans and payoffs.' },
  { icon: <IconCompass />, tone: 'amber' as const, title: 'Plan before you sell', body: 'Project vesting, income, and capital-gains tax on your own numbers.' },
  { icon: <IconShield />, tone: 'emerald' as const, title: 'Your data, not Epic’s', body: 'You enter or import it, it is encrypted per user, and it is never sold.' },
]
const AI_FEATURE = { icon: <IconChatSpark />, tone: 'violet' as const, title: 'Ask ChatGPT or Claude', body: 'Connect your assistant and ask about vesting, tax and total comp using your real figures — and let it keep your salary and retirement numbers current.' }

export default function Login() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { appName, appTagline } = useAppContext()
  const config = useConfig()
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const next = safeNext(new URLSearchParams(window.location.search).get('next'))

  useEffect(() => {
    if (isAuthenticated) { if (next) window.location.assign(next); else navigate('/', { replace: true }); return }
    void stashNext(next)
    api.getProviders().then(setProviders).catch(() => setProviders([]))
  }, [isAuthenticated, navigate, next])
  useEffect(() => { const handlePageShow = (e: PageTransitionEvent) => { if (e.persisted) setLoading(null) }; window.addEventListener('pageshow', handlePageShow); return () => window.removeEventListener('pageshow', handlePageShow) }, [])
  const features = config?.ai_connections ? [...FEATURES.slice(0, 2), AI_FEATURE, ...FEATURES.slice(2)] : FEATURES

  async function handleSignIn(providerName: string) {
    setLoading(providerName); setError(null)
    try { await startLogin(providerName) } catch (e) { setLoading(null); setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.') }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-cs-base px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <div className="mx-auto grid w-full max-w-[86rem] gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,.85fr)] lg:items-start xl:gap-16">
        <section className="min-w-0">
          <div className="relative overflow-hidden rounded-[2rem] border border-cs-border bg-cs-surface shadow-card lg:min-h-[36rem]">
            <div className="absolute inset-x-0 top-0 h-44 overflow-hidden opacity-30"><img src={campusWatercolor} alt="" aria-hidden="true" className="h-full w-full object-cover" /></div>
            <div className="relative z-10 px-6 pb-2 pt-9 sm:px-10 lg:px-12 lg:pt-12">
              <span className="campus-sticker ml-0">Verona · unofficial</span>
              <h1 className="mt-6 max-w-2xl font-serif text-4xl font-semibold leading-[1.08] tracking-tight text-cs-text sm:text-5xl xl:text-6xl">Know what your Epic stock is actually worth.</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-cs-text-2 sm:text-lg">{appTagline}</p>
              <div className="mt-5 flex items-center gap-2"><span className="campus-wordmark flex h-9 w-9 items-center justify-center bg-cs-brand text-sm font-extrabold text-white">E</span><span><span className="font-extrabold text-cs-brand">{appName}</span><UnofficialBadge className="mt-0.5" /></span></div>
            </div>
            <CampusWelcomeScene className="relative z-0 -mb-2 mt-2 w-full text-cs-text" />
          </div>

          <Eyebrow className="mt-7">What you get with an account</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {features.map(f => <div key={f.title} className="campus-feature-card flex items-center gap-3 rounded-xl border border-cs-border bg-cs-surface px-4 py-3.5 shadow-card"><IconTile tone={f.tone}>{f.icon}</IconTile><div className="min-w-0"><p className="text-sm font-semibold text-cs-text">{f.title}</p><p className="mt-0.5 text-xs leading-snug text-cs-text-2">{f.body}</p></div></div>)}
          </div>
        </section>

        <aside className="lg:sticky lg:top-10">
          <Card className="border-t-4 border-t-cs-brand p-5 sm:p-6">
            <Eyebrow>Front gate</Eyebrow>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-cs-text">Come on in.</h2>
            <p className="mt-2 text-sm leading-relaxed text-cs-text-2">Sign in to your encrypted account, or wander around with your own files first. Nothing here needs to look like a bank portal.</p>
            <DisclaimerNotice className="mt-5" />
            {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
            <div className="mt-5 space-y-2">{providers.map((p, i) => <button key={p.name} onClick={() => handleSignIn(p.name)} disabled={loading !== null} className={`w-full rounded-xl px-4 py-3 text-sm font-semibold shadow-card transition disabled:opacity-50 ${i === 0 ? 'bg-cs-brand text-white hover:bg-cs-brand-hover' : 'border border-cs-border-strong bg-cs-surface text-cs-text hover:bg-cs-raised'}`}>{loading === p.name ? 'Redirecting…' : `Sign in with ${p.label}`}</button>)}{providers.length === 0 && <p className="text-center text-sm text-cs-text-2">No sign-in providers configured.</p>}</div>
            <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-cs-border" /><span className="text-xs font-medium uppercase tracking-wide text-cs-text-2">or</span><span className="h-px flex-1 bg-cs-border" /></div>
            <Link to="/try" className="campus-wayfinder block rounded-xl border border-cs-border-strong bg-cs-surface p-4 text-left shadow-card transition hover:bg-cs-raised"><p className="text-sm font-semibold text-cs-text">See it first, without an account →</p><p className="mt-1 text-xs leading-snug text-cs-text-2">Drop in your Epic share summary and loan statement. The files are read and thrown away.</p></Link>
          </Card>
          <Card className="mt-4 text-left"><Eyebrow className="mb-2">A note pinned by the door</Eyebrow><ul className="space-y-1.5 text-xs leading-relaxed text-cs-text-2"><li><span className="font-medium text-cs-text">Secure sign-in.</span> We never handle your password.</li><li><span className="font-medium text-cs-text">Per-user encryption.</span> Financial data is encrypted using AES-256-GCM with a key unique to your account.</li><li><span className="font-medium text-cs-text">We will never sell your data.</span></li></ul></Card>
          <p className="mt-4 text-center text-xs text-cs-text-2">By using this site, you agree to our <Link to="/privacy" className="font-medium text-cs-brand underline">Privacy Policy</Link>. <span className="mx-1">·</span><ReportProblemLink className="font-medium text-cs-brand" /></p>
        </aside>
      </div>
    </div>
  )
}
