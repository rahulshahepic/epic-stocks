import { AppContext } from '../scaffold/contexts/AppContext.tsx'
import AppSettingsSections from './components/AppSettingsSections.tsx'

// ── Helpers reused for privacy policy content ────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-stone-700 dark:text-slate-300">{children}</p>
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-slate-300">{children}</ul>
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 font-medium text-stone-800 dark:text-slate-200">{title}</h3>
      {children}
    </div>
  )
}

// ── Privacy: what data this app collects ─────────────────────────────────────

const PrivacyDataCollected = (
  <>
    <Sub title="Financial data (entered by you)">
      <P>You manually enter the following, which is stored in the application database:</P>
      <Ul>
        <li>Equity grants — year, type, share count, exercise price, vesting schedule</li>
        <li>Stock loans — loan type, amount, interest rate, due date, optional loan number</li>
        <li>Share prices — effective date and price per share</li>
        <li>Sales / dispositions — date, share count, sale price, optional notes, optional per-sale tax-rate overrides, optional manual lot allocations</li>
        <li>Loan payments — early cash payments you record against a loan (date, amount, optional notes)</li>
        <li>Tax settings — federal and state income, long- and short-term capital gains rates, NIIT, long-term holding period, lot-selection method, loan-payoff method, and the investment-interest deduction toggle</li>
      </Ul>
    </Sub>
    <Sub title="Profile and saved preferences (entered by you)">
      <P>The Retirement Simulator and other personalisation features also save the following per-user data:</P>
      <Ul>
        <li>Date of birth — used by the Retirement Simulator to time Social Security claim eligibility and Medicare (age 65). Optional.</li>
        <li>Retirement scenario inputs — your saved retirement plan: portfolio amounts, allocation, default/min spend, health-insurance estimate, refill tax drag, return scenario, simulation horizon, retirement date, your Social Security FRA monthly benefit and claim age, and (optionally, with the spouse toggle) your spouse's date of birth, FRA monthly benefit, and claim age</li>
        <li>Dashboard preferences — date mode, date range, and which sections are expanded</li>
        <li>Notification preferences — email-notification opt-in, advance-warning days, registered Web Push subscriptions, and per-inviter notification opt-ins on shared accounts</li>
        <li>Optimization tip acceptance — which optimization tips you have accepted on the Dashboard</li>
      </Ul>
    </Sub>
    <Sub title="Computed data (never stored)">
      <P>
        The event timeline (vesting events, income, capital gains) is computed from your
        grants, loans, and prices on every request. Computed events are never written to
        the database — they exist only in memory during your request.
      </P>
    </Sub>
    <Sub title="What we don't collect">
      <Ul>
        <li>Passwords (authentication is handled entirely by your identity provider)</li>
        <li>Analytics or usage tracking</li>
        <li>Cookies beyond the authentication session token</li>
        <li>Data from other users</li>
        <li>Any identity provider data beyond the profile fields listed above</li>
      </Ul>
    </Sub>
  </>
)

// ── Privacy: third-party infrastructure ──────────────────────────────────────

const PrivacyThirdParties = (
  <>
    <P>The site operator uses the following infrastructure:</P>
    <Ul>
      <li><strong>Identity providers (Google, Microsoft, etc.)</strong> — verify your identity. Your provider receives your credentials; we receive only your profile fields.</li>
      <li><strong>Hetzner</strong> — VPS hosting. The app and database run on Hetzner hardware.</li>
      <li><strong>Cloudflare</strong> — DDoS protection and DNS. HTTPS traffic passes through Cloudflare's network.</li>
      <li><strong>Porkbun</strong> — domain registrar. No access to application data.</li>
      <li><strong>Resend</strong> — email notifications and invitation emails (if enabled). Notification content contains no financial data — only an event count and a login link. Invitation emails contain the inviter's display name and a one-time token — no financial data.</li>
      <li><strong>Push notifications</strong> — delivered via Web Push through your browser's push service. Content contains no financial data.</li>
    </Ul>
    <P>
      <strong>None of these services receive or can access your financial data</strong> for
      any purpose, and we do not sell your data to any of them.
    </P>
  </>
)

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/comp-calculator', label: 'Comp Calc' },
  { to: '/retirement', label: 'Retirement' },
  { to: '/events', label: 'Events' },
  { to: '/grants', label: 'Grants' },
  { to: '/sales', label: 'Sales' },
  { to: '/loans', label: 'Loans' },
  { to: '/prices', label: 'Prices' },
  { to: '/import', label: 'Import' },
]

// ── Admin notify templates ────────────────────────────────────────────────────

const NOTIFY_TEMPLATES = {
  custom:        { label: 'Custom',              title: 'Test from admin',  body: 'This is a test notification from the Equity Tracker admin panel.' },
  vesting:       { label: 'Vesting event',        title: 'Equity Tracker',  body: 'You have 1 event today: 1 Vesting' },
  exercise:      { label: 'Exercise event',       title: 'Equity Tracker',  body: 'You have 1 event today: 1 Exercise' },
  loan_repayment:{ label: 'Loan Repayment event', title: 'Equity Tracker',  body: 'You have 1 event today: 1 Loan Repayment' },
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppContext.Provider value={{
      appName: 'Equity Tracker',
      appTagline: 'Sign in to manage your equity compensation',
      navItems: NAV_ITEMS,
      viewerHiddenRoutes: new Set(['/import', '/wizard']),
      epicModeHiddenRoutes: new Set(['/import']),
      settingsSections: <AppSettingsSections />,
      privacyLastUpdated: '2026-05-08',
      privacyDataCollected: PrivacyDataCollected,
      privacyThirdParties: PrivacyThirdParties,
      notifyTemplates: NOTIFY_TEMPLATES,
    }}>
      {children}
    </AppContext.Provider>
  )
}
