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
import { useConfig } from '../hooks/useConfig.ts'
import campusWatercolor from '../../assets/campus-watercolor.webp'
import gardenMobile480 from '../../assets/campus-garden-mobile-480.webp'
import gardenMobile960 from '../../assets/campus-garden-mobile-960.webp'
import gardenWide800 from '../../assets/campus-garden-wide-800.webp'
import gardenWide1600 from '../../assets/campus-garden-wide-1600.webp'
import { hasTrialPayload } from '../../app/trialImport.ts'
import { platform } from '../../platform/index.ts'

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
  const rawIntent = new URLSearchParams(window.location.search).get('intent')
  const intent = ['/connect-ai', '/import', '/retirement', '/comp-calculator'].includes(rawIntent ?? '') ? rawIntent : null
  const [trialWaiting, setTrialWaiting] = useState(false)
  const [trialExpired, setTrialExpired] = useState(false)
  useEffect(() => { let active = true; void (async () => { const value = await hasTrialPayload(); const expired = await platform.storage.get('trial_preview_expired'); if (active) { setTrialWaiting(value); setTrialExpired(!!expired) } })(); return () => { active = false } }, [])

  useEffect(() => {
    if (isAuthenticated) { const destination = next ?? intent; if (destination) window.location.assign(destination); else navigate('/', { replace: true }); return }
    void stashNext(next ?? intent)
    api.getProviders().then(setProviders).catch(() => setProviders([]))
  }, [isAuthenticated, navigate, next, intent])
  useEffect(() => { const handlePageShow = (e: PageTransitionEvent) => { if (e.persisted) setLoading(null) }; window.addEventListener('pageshow', handlePageShow); return () => window.removeEventListener('pageshow', handlePageShow) }, [])
  const features = config?.ai_connections ? [...FEATURES.slice(0, 2), AI_FEATURE, ...FEATURES.slice(2)] : FEATURES

  async function handleSignIn(providerName: string) {
    setLoading(providerName); setError(null)
    try { await startLogin(providerName) } catch (e) { setLoading(null); setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.') }
  }

  if (trialWaiting || trialExpired || intent) return <main className="mx-auto min-h-screen max-w-md space-y-5 px-4 py-10 text-cs-text">
    <Eyebrow>Epic Stocks · your next step</Eyebrow>
    {trialExpired && <p role="status" className="rounded-xl border border-cs-border p-4 text-sm">Your preview expired after 30 minutes. Choose your files again to make a fresh preview, or sign in and import them from your account.</p>}
    <h1 className="font-serif text-3xl font-semibold">{trialWaiting ? 'Sign in to save your numbers' : intent === '/connect-ai' ? 'Sign in to connect your assistant' : 'Sign in to continue'}</h1>
    <p className="text-sm text-cs-text-2">{trialWaiting ? 'Your preview is waiting on this device. New records will be added to your account; existing records stay as they are.' : 'We’ll bring you straight back to the task you chose.'}</p>
    <DisclaimerNotice />
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="space-y-3">{providers.map(p => <button key={p.name} disabled={loading !== null} onClick={() => void handleSignIn(p.name)} className="min-h-11 w-full rounded-xl bg-cs-brand px-4 py-3 font-semibold text-white disabled:opacity-50">{loading === p.name ? 'Redirecting…' : `Sign in with ${p.label}`}</button>)}{!providers.length && <p>No sign-in providers configured.</p>}</div>
    {trialWaiting ? <Link to="/try" className="inline-block min-h-11 py-2 text-sm text-cs-brand underline">Back to my preview</Link> : <Link to="/login" onClick={() => { void platform.storage.remove('trial_preview_expired'); setTrialExpired(false) }} className="text-sm text-cs-brand underline">Back to the front gate</Link>}
  </main>

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
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                <Link to="/demo" className="inline-flex min-h-11 items-center text-cs-brand underline dark:text-rose-300">Try the demo</Link>
                <Link to="/try" className="inline-flex min-h-11 items-center text-cs-brand underline dark:text-rose-300">Import my files</Link>
                <a href="#sign-in" className="inline-flex min-h-11 items-center text-cs-brand underline dark:text-rose-300">Sign in</a>
              </div>
              <p className="text-xs text-cs-text-2">Try fictional data or preview your Eureka files before signing in.</p>
              <div id="sign-in" className="mt-4 scroll-mt-4">
                <DisclaimerNotice />
                {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
                <div className="mt-3 space-y-2">{providers.map((p, i) => <button key={p.name} onClick={() => handleSignIn(p.name)} disabled={loading !== null} className={`min-h-11 w-full rounded-xl px-4 py-3 text-sm font-semibold shadow-card transition disabled:opacity-50 ${i === 0 ? 'bg-rose-700 text-white hover:bg-rose-800' : 'border border-cs-border-strong bg-cs-surface text-cs-text hover:bg-cs-raised'}`}>{loading === p.name ? 'Redirecting…' : `Sign in with ${p.label}`}</button>)}{providers.length === 0 && <p className="text-center text-sm text-cs-text-2">No sign-in providers configured.</p>}</div>
              </div>
              {next?.startsWith('/oauth/authorize') && <a href={`/reviewer-login?${new URLSearchParams({ next })}`} className="inline-flex min-h-11 items-center text-sm text-cs-brand underline">Directory reviewer sign-in</a>}
              <div className="mt-5 flex items-center gap-2"><img src="/favicon.svg" alt="" aria-hidden="true" className="h-9 w-9 shrink-0" /><span><span className="font-extrabold text-cs-brand dark:text-rose-300">{appName}</span><UnofficialBadge className="mt-0.5" /></span></div>
            </div>
            <figure className="relative z-0 mt-5">
              <picture>
                <source media="(min-width: 640px)" srcSet={`${gardenWide800} 800w, ${gardenWide1600} 1600w`} sizes="(min-width: 1024px) 55vw, 100vw" />
                <img src={gardenMobile480} srcSet={`${gardenMobile480} 480w, ${gardenMobile960} 960w`} sizes="100vw" alt="A garden path leads past a wooden signpost and brass telescope toward a lakeside campus." width="1122" height="1402" className="block aspect-[5/4] w-full object-cover object-center sm:aspect-[3/2]" />
              </picture>
              <figcaption className="bg-cs-raised px-6 py-3 font-serif text-sm italic text-cs-text sm:px-10 sm:text-base">Sapere aude · look up, wander a little, keep good records.</figcaption>
            </figure>
          </div>

          <Eyebrow className="mt-7">What you get with an account</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {features.map(f => <div key={f.title} className="campus-feature-card flex items-center gap-3 rounded-xl border border-cs-border bg-cs-surface px-4 py-3.5 shadow-card"><IconTile tone={f.tone}>{f.icon}</IconTile><div className="min-w-0"><p className="text-sm font-semibold text-cs-text">{f.title}</p><p className="mt-0.5 text-xs leading-snug text-cs-text-2">{f.body}</p></div></div>)}
          </div>
        </section>

        <aside className="lg:sticky lg:top-10">
          <Card className="text-left space-y-2">
            <p className="text-sm font-semibold text-cs-text">Connect an AI assistant</p>
            <a href="/mcp-setup" className="inline-flex min-h-11 items-center text-sm font-semibold text-cs-brand dark:text-rose-300 underline">Open the setup guide</a>
          </Card>
          <Card className="mt-4 text-left"><Eyebrow className="mb-2">A note pinned by the door</Eyebrow><ul className="space-y-1.5 text-xs leading-relaxed text-cs-text-2"><li><span className="font-medium text-cs-text">Secure sign-in.</span> We never handle your password.</li><li><span className="font-medium text-cs-text">Per-user encryption.</span> Financial data is encrypted using AES-256-GCM with a key unique to your account.</li><li><span className="font-medium text-cs-text">We will never sell your data.</span></li></ul></Card>
          <p className="mt-4 text-center text-xs text-cs-text-2">By using this site, you agree to our <Link to="/privacy" className="font-medium text-cs-brand dark:text-rose-300 underline">Privacy Policy</Link>. <span className="mx-1">·</span><ReportProblemLink className="font-medium text-cs-brand dark:text-rose-300" /></p>
        </aside>
      </div>
    </div>
  )
}
