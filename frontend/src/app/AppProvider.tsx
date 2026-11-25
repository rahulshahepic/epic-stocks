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
    <Sub title="Problem reports (sent by you, only when you choose to)">
      <P>
        A report you send with <strong>Report a problem</strong> stores what you typed,
        the page you were on, the kind of failure that prompted it, the error text the
        app had already shown you, the build version, and a reference id pointing at the
        matching server-side error log. The optional email field is stored only if you
        fill it in, so you can be reached about what you reported.
      </P>
      <P>
        Identifying details are opt-in: the "include details that identify me" box starts
        unticked, and only ticking it attaches your account, your browser's user-agent,
        and a short trail of the last few pages you visited and requests that failed.
        Leave it off and the report is stored with no account attached, even if you were
        signed in. No financial data is ever included — reports about a failed import
        carry only the rule ids that fired, never the finding text, which quotes figures
        from your own statement. The dialog shows you the whole payload before it sends.
      </P>
      <P>
        A one-way hash of your IP address is kept with each report to rate-limit abuse of
        an endpoint that has to work without a login. The report does not store the raw address; separate server and proxy access logs depend on operator configuration.
      </P>
    </Sub>
    <Sub title="Anonymous counts (no account needed)">
      <P>
        Import measurement is off until you opt in on the upload form. If enabled, a random key in this tab joins an import attempt’s parse, preview, sign-in, confirmed save and reminder steps for up to 24 hours. The server stores only a hash of that key, stage flags, timing and fixed error categories. At sign-in it uses a per-attempt keyed digest to prevent another account claiming the same attempt; no account ID, email, IP, device details, file text, document fingerprint or financial values are kept in measurement tables. This is temporary attempt linkage, not a profile across visits or attempts.
        Turning counting off stops future events and deletes the temporary key. Do Not Track is respected. Keys stop working after 24 hours and expired rows are deleted on the next scheduled cleanup (normally within 15 minutes). Anonymous daily start-day cohorts remain for 180 days; opting out does not subtract already aggregated counts. Admins and a separately consented admin AI connection can see aggregate reports and manage collection, never individual attempt keys. Legacy unlinked request totals are retained separately under the same aggregate retention limit.

      </P>
    </Sub>
    <Sub title="What we don't collect">
      <Ul>
        <li>Passwords (authentication is handled entirely by your identity provider)</li>
        <li>Per-person or cross-visit analytics profiles, cross-site tracking, or third-party analytics services. Optional temporary attempt measurement is described above</li>
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
      <li><strong>Cloudflare</strong> — DDoS protection and DNS. When used as a TLS-terminating proxy, Cloudflare can process request contents as well as connection metadata.</li>
      <li><strong>Porkbun</strong> — domain registrar. No access to application data.</li>
      <li><strong>Resend</strong> — email notifications and invitation emails (if enabled). Notification content contains no financial data — only an event count and a login link. Invitation emails contain the inviter's display name and a one-time token — no financial data.</li>
      <li><strong>Push notifications</strong> — delivered via Web Push through your browser's push service. Content contains no financial data.</li>
    </Ul>
    <P>
      Hosting providers and a TLS-terminating proxy can have technical access to request
      contents or server data. Email and push messages omit financial amounts. We do not sell your data.
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
  { to: '/planning', label: 'Planning' },
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
      privacyLastUpdated: '2026-11-24',
      privacyDataCollected: PrivacyDataCollected,
      privacyThirdParties: PrivacyThirdParties,
      notifyTemplates: NOTIFY_TEMPLATES,
    }}>
      {children}
    </AppContext.Provider>
  )
}
