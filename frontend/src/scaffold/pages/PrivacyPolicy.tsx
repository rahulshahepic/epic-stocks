import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../contexts/AppContext.tsx'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
 return (
 <section className="mb-8">
 <h2 className="mb-3 text-lg font-semibold text-cs-text">{title}</h2>
 {children}
 </section>
 )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
 return (
 <div className="mb-4">
 <h3 className="mb-2 font-medium text-cs-text">{title}</h3>
 {children}
 </div>
 )
}

function P({ children }: { children: React.ReactNode }) {
 return <p className="mb-3 text-sm leading-relaxed text-cs-text-2">{children}</p>
}

function Ul({ children }: { children: React.ReactNode }) {
 return <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-cs-text-2">{children}</ul>
}

export default function PrivacyPolicy() {
 const navigate = useNavigate()
 const { appName, privacyLastUpdated, privacyDataCollected, privacyThirdParties } = useAppContext()
 return (
 <div className="min-h-screen bg-cs-base px-4 py-10">
 <div className="mx-auto max-w-2xl">
 <div className="mb-6">
 <button
 onClick={() => navigate(-1)}
 className="text-sm text-cs-brand hover:text-cs-brand-hover dark:hover:text-rose-300"
 >
 ← Back
 </button>
 </div>

 <h1 className="mb-1 text-2xl font-bold text-cs-text">Privacy Policy</h1>
 <p className="mb-8 text-xs text-cs-text-2">Last updated: {privacyLastUpdated}</p>

 <div className="rounded-lg bg-cs-surface p-6 shadow-sm md:p-8">
 <P>
 {appName} is open-source software. This policy explains what data the application
 collects, how it's stored, and who can access it.
 </P>

 <div className="mb-6 rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
 <p className="text-sm font-medium text-rose-800 dark:text-rose-300">
 Your data is never sold. Ever.
 </p>
 <p className="mt-1 text-sm text-cs-brand">
 We do not sell, rent, or trade your personal or financial data to any third party for
 any purpose, commercial or otherwise.
 </p>
 </div>

 <Section title="How Sign-In Works">
 <P>
 We use third-party identity providers (such as Google or Microsoft) so that we{' '}
 <strong>never handle your password</strong>. When you click a sign-in button, your
 credentials go directly to that provider — we never see them. The provider then
 tells us who you are by sharing a small set of profile fields:
 </P>
 <Ul>
 <li><strong>Email address</strong> — your unique identifier in this app</li>
 <li><strong>Display name</strong> — shown in the UI</li>
 <li><strong>Profile picture URL</strong> — shown in the UI (if provided)</li>
 <li><strong>Subject ID</strong> — a stable ID that links your provider account</li>
 </Ul>
 <P>
 We do not receive or store your password, contacts, calendar, or any other data
 from your identity provider beyond the profile fields listed above.
 </P>
 </Section>

 {privacyDataCollected && (
 <Section title="What We Collect">
 {privacyDataCollected}
 </Section>
 )}

 <Section title="Data Isolation">
 <P>
 Every database query is filtered by your authenticated user ID. You can only read,
 modify, or delete your own data. The source code is open for you to verify this:{' '}
 <a
 href="https://github.com/rahulshahepic/epic-stocks"
 target="_blank"
 rel="noopener noreferrer"
 className="text-cs-brand hover:text-cs-brand-hover dark:hover:text-rose-300"
 >
 github.com/rahulshahepic/epic-stocks
 </a>
 .
 </P>
 <P>
 The one exception is the <strong>sharing feature</strong>: if you choose to invite
 someone, they can view (but never modify) your financial data. See "People you invite"
 below for details.
 </P>
 </Section>

 <Section title="Who Can Access Your Data">
 <SubSection title="You">
 <P>You have full access to your own data. You can:</P>
 <Ul>
 <li>View, create, update, and delete all your grants, loans, and prices</li>
 <li>Export all your data to Excel at any time</li>
 <li>Sign out everywhere — invalidate every active session for your account on every browser and device in one action (Settings › Account)</li>
 <li>Reset your data — delete all grants, loans, and prices while keeping your account (Settings › Danger Zone)</li>
 <li>Delete your account — permanently remove your account and all associated data (Settings › Danger Zone)</li>
 </Ul>
 <P>Both data-deletion actions are self-service, immediate, and irreversible.</P>
 </SubSection>
 <SubSection title="People you invite">
 <P>
 You can invite others by email to view your data. <strong>This is entirely
 optional</strong> — no one can see your data unless you explicitly invite them. Before
 sharing, understand what this means:
 </P>
 <Ul>
 <li><strong>What they see:</strong> your Dashboard, Events timeline, Grants, Loans, Prices, and Sales — everything on those pages, in read-only form.</li>
 <li><strong>What they cannot do:</strong> modify your data in any way, see optimization Tips, use What If scenarios (exit date, deduction toggle), or change your settings.</li>
 <li><strong>You are sharing real financial data.</strong> Share prices, grant details, loan balances, and tax information will be visible to anyone you invite. Only invite people you trust with this information.</li>
 <li><strong>You control access.</strong> You can revoke an invitation at any time from Settings. The invited person can also remove their own access.</li>
 <li><strong>Invitations expire.</strong> Unused invitation links expire after 7 days. You can resend to extend.</li>
 <li><strong>Sign-in flexibility:</strong> The invited person signs in with any configured provider (Google, Microsoft, etc.) — it does not need to match the email the invitation was sent to. You will see both the email you invited and the account they actually signed in with.</li>
 </Ul>
 <P>
 <strong>Risk to understand:</strong> once someone accepts your invitation, they can view
 your data whenever they want until you revoke access. You can see the last time they
 viewed your data in Settings, but you cannot control what they do with the information
 they see (e.g., screenshot it, write it down, or share it further). Treat this like
 handing someone a copy of your financial statement.
 </P>
 </SubSection>
 <SubSection title="The site operator">
 <P>
 The person running this server has technical access to the server environment.
 Your core financial data — grants, loans, prices, sales, loan payments, and tax
 rates — is encrypted with AES-256-GCM before being written to the database. Each
 user gets a unique key, and that key is itself encrypted with a master key stored
 only on the server. Saved preferences (retirement scenario inputs, dashboard
 preferences) and your date of birth are stored as plain values rather than
 per-field encrypted, and rely on the database's own access controls. The operator
 holds the master key.
 </P>
 <P>
 If you are uncomfortable with this, you can self-host your own instance — you
 control the database and the key.
 </P>
 </SubSection>
 {privacyThirdParties && (
 <SubSection title="Third-party services">
 {privacyThirdParties}
 </SubSection>
 )}
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
 and in the{' '}
 <a
 href="https://github.com/rahulshahepic/epic-stocks/blob/main/PRIVACY.md"
 target="_blank"
 rel="noopener noreferrer"
 className="text-cs-brand hover:text-cs-brand-hover dark:hover:text-rose-300"
 >
 <code className="rounded bg-cs-raised px-1 text-xs ">PRIVACY.md</code>
 </a>{' '}
 file in the repository with an updated date.
 </P>
 </Section>

 <Section title="Contact">
 <P>
 This is an open-source project. For privacy questions or concerns, open an issue on{' '}
 <a
 href="https://github.com/rahulshahepic/epic-stocks/issues"
 target="_blank"
 rel="noopener noreferrer"
 className="text-cs-brand hover:text-cs-brand-hover dark:hover:text-rose-300"
 >
 the GitHub repository
 </a>
 .
 </P>
 </Section>
 </div>
 </div>
 </div>
 )
}
