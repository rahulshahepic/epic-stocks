import { AppContext } from '../scaffold/contexts/AppContext.tsx'
import AppSettingsSections from './components/AppSettingsSections.tsx'

// ── Helpers reused for privacy policy content ────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
 return <p className="mb-3 text-sm leading-relaxed text-cs-text-2">{children}</p>
}

function Ul({ children }: { children: React.ReactNode }) {
 return <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-cs-text-2">{children}</ul>
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
 return (
 <div className="mb-4">
 <h3 className="mb-2 font-medium text-cs-text">{title}</h3>
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
 <Sub title="Anonymous counts (no account needed)">
 <P>
 The no-account preview at <strong>/try</strong> keeps three running totals per
 calendar day: how many previews were computed, how many people pressed save, and
 how many accounts were created carrying preview data. That is the entire record —
 three numbers against a date. No IP address, no browser or device details, no
 identifier of any kind, and nothing that could group one visitor's actions
 together or link them to an account. They exist so the feature can be judged on
 whether it helps anyone.
 </P>
 </Sub>
 <Sub title="What we don't collect">
 <Ul>
 <li>Passwords (authentication is handled entirely by your identity provider)</li>
 <li>Per-person analytics or usage tracking — no profiles, no sessions, no journeys, no third-party analytics service. The only counting we do is the anonymous daily totals described above</li>
 <li>The files you upload to the preview — they are read, computed from, and discarded; nothing from them is stored unless you sign up and save</li>
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

// ── Affiliation disclaimer ───────────────────────────────────────

// The app is named after an employer that has nothing to do with it, so the
// name never appears without the badge, and every page reachable before sign-in
// carries the full notice. People arrive here from an invitation email and are
// asked to sign in with a work account — they have to be able to tell whose app
// this is before they do.

const NAME_BADGE = 'Unofficial'

const DISCLAIMER_TITLE = 'Unofficial — this is not an Epic site'

const DISCLAIMER_SHORT =
 'An independent project — not affiliated with or endorsed by Epic Systems Corporation.'

const DisclaimerBody = (
 <>
 <p>
 Epic Stocks is an independent, personal project: a tool Epic employees can use to track
 their own equity. It is not built, endorsed, or supported by Epic Systems Corporation,
 and Epic is not responsible for it.
 </p>
 <p>
 Every figure here is an estimate, computed from data you entered or imported yourself.
 Your official grant, loan, and share-price records are the ones Epic gives you — not
 these.
 </p>
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
 custom: { label: 'Custom', title: 'Test from admin', body: 'This is a test notification from the Epic Stocks admin panel.' },
 vesting: { label: 'Vesting event', title: 'Epic Stocks', body: 'You have 1 event today: 1 Vesting' },
 exercise: { label: 'Exercise event', title: 'Epic Stocks', body: 'You have 1 event today: 1 Exercise' },
 loan_repayment:{ label: 'Loan Repayment event', title: 'Epic Stocks', body: 'You have 1 event today: 1 Loan Repayment' },
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
 return (
 <AppContext.Provider value={{
 appName: 'Epic Stocks',
 appTagline: 'For Epic employees tracking their own equity — grants, vesting, stock loans, and taxes in one place.',
 appNameBadge: NAME_BADGE,
 appDisclaimerTitle: DISCLAIMER_TITLE,
 appDisclaimerBody: DisclaimerBody,
 appDisclaimerShort: DISCLAIMER_SHORT,
 navItems: NAV_ITEMS,
 viewerHiddenRoutes: new Set(['/import', '/wizard']),
 epicModeHiddenRoutes: new Set(['/import']),
 settingsSections: <AppSettingsSections />,
 privacyLastUpdated: '2026-08-29',
 privacyDataCollected: PrivacyDataCollected,
 privacyThirdParties: PrivacyThirdParties,
 notifyTemplates: NOTIFY_TEMPLATES,
 }}>
 {children}
 </AppContext.Provider>
 )
}
