import { Link } from 'react-router-dom'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 font-medium text-gray-800 dark:text-gray-200">{title}</h3>
      {children}
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{children}</p>
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">{children}</ul>
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <Link
            to="/login"
            className="text-sm text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Back to sign in
          </Link>
        </div>

        <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-white">Privacy Policy</h1>
        <p className="mb-8 text-xs text-gray-500 dark:text-gray-400">Last updated: 2026-03-21</p>

        <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-900 md:p-8">
          <P>
            Equity Vesting Tracker ("Epic Stocks") is open-source software. This policy explains what
            data the application collects, how it's stored, and who can access it.
          </P>

          <div className="mb-6 rounded-md border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/50">
            <p className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
              Your data is never sold. Ever.
            </p>
            <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-400">
              We do not sell, rent, or trade your personal or financial data to any third party for
              any purpose, commercial or otherwise.
            </p>
          </div>

          <Section title="Why Google Sign-In?">
            <P>
              We use Google Sign-In so that we <strong>never handle your password</strong>. When you
              click "Sign in with Google", your credentials go directly to Google — we never see
              them. Google then tells us who you are by sharing a small set of profile fields:
            </P>
            <Ul>
              <li><strong>Email address</strong> — your unique identifier in this app</li>
              <li><strong>Display name</strong> — shown in the UI</li>
              <li><strong>Profile picture URL</strong> — shown in the UI</li>
              <li><strong>Google subject ID</strong> — a stable ID that links your Google account</li>
            </Ul>
            <P>
              We do not receive or store your Google password, contacts, calendar, or any other
              Google data beyond the four fields above.
            </P>
          </Section>

          <Section title="What We Collect">
            <SubSection title="Financial data (entered by you)">
              <P>You manually enter the following, which is stored in the application database:</P>
              <Ul>
                <li>Equity grants — year, type, share count, exercise price, vesting schedule</li>
                <li>Stock loans — loan type, amount, interest rate, due date</li>
                <li>Share prices — effective date and price per share</li>
              </Ul>
            </SubSection>
            <SubSection title="Computed data (never stored)">
              <P>
                The event timeline (vesting events, income, capital gains) is computed from your
                grants, loans, and prices on every request. Computed events are never written to
                the database — they exist only in memory during your request.
              </P>
            </SubSection>
            <SubSection title="What we don't collect">
              <Ul>
                <li>Passwords (authentication is handled entirely by Google)</li>
                <li>Analytics or usage tracking</li>
                <li>Cookies beyond the authentication session token</li>
                <li>Data from other users</li>
                <li>Any Google account data beyond the profile fields listed above</li>
              </Ul>
            </SubSection>
          </Section>

          <Section title="Data Isolation">
            <P>
              Every database query is filtered by your authenticated user ID. You can only read,
              modify, or delete your own data. There are no API endpoints that expose one user's
              data to another user. The source code is open for you to verify this.
            </P>
          </Section>

          <Section title="Who Can Access Your Data">
            <SubSection title="You">
              <P>You have full access to your own data. You can:</P>
              <Ul>
                <li>View, create, update, and delete all your grants, loans, and prices</li>
                <li>Export all your data to Excel at any time</li>
                <li>Reset your data — delete all grants, loans, and prices while keeping your account (Settings › Danger Zone)</li>
                <li>Delete your account — permanently remove your account and all associated data (Settings › Danger Zone)</li>
              </Ul>
              <P>Both actions are self-service, immediate, and irreversible.</P>
            </SubSection>
            <SubSection title="The site operator">
              <P>
                The person running this server has technical access to the server environment. If
                column-level encryption is enabled (<code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">ENCRYPTION_MASTER_KEY</code>), your financial data
                is encrypted with AES-256-GCM before being written to the database. The operator
                holds the master key.
              </P>
              <P>
                If you are uncomfortable with this, you can self-host your own instance — you
                control the database and the key.
              </P>
            </SubSection>
            <SubSection title="Third-party services">
              <P>The site operator uses the following infrastructure:</P>
              <Ul>
                <li><strong>Google OAuth</strong> — verifies your identity. Google receives your credentials; we receive only your profile fields.</li>
                <li><strong>Hetzner</strong> — VPS hosting. The app and database run on Hetzner hardware.</li>
                <li><strong>Cloudflare</strong> — DDoS protection and DNS. HTTPS traffic passes through Cloudflare's network.</li>
                <li><strong>Porkbun</strong> — domain registrar. No access to application data.</li>
                <li><strong>Resend</strong> — email notifications (if enabled). Notification content contains no financial data — only an event count and a login link.</li>
                <li><strong>Push notifications</strong> — delivered via Web Push through your browser's push service. Content contains no financial data.</li>
              </Ul>
              <P>
                <strong>None of these services receive or can access your financial data</strong> for
                any purpose, and we do not sell your data to any of them.
              </P>
            </SubSection>
          </Section>

          <Section title="Data Retention and Portability">
            <P>
              Your data persists until you explicitly delete it. You can export all your data at any
              time using the Excel export feature. Account deletion is immediate and irreversible.
            </P>
          </Section>

          <Section title="Changes to This Policy">
            <P>
              This policy may be updated as the application evolves. Changes will be reflected here
              and in the <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">PRIVACY.md</code> file in the repository with an updated date.
            </P>
          </Section>

          <Section title="Contact">
            <P>
              This is an open-source project. For privacy questions or concerns, open an issue on
              the GitHub repository.
            </P>
          </Section>
        </div>
      </div>
    </div>
  )
}
