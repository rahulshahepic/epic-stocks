import { measurementEvent } from '../onboarding.ts'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { useTheme } from '../contexts/theme.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import { api } from '../../api.ts'
import type { InvitationEntry, ReceivedInvitation } from '../../api.ts'
import type { Theme } from '../contexts/theme.ts'
import { Card } from '../components/ui/Card.tsx'
import StagingSeedPanel from '../../app/components/StagingSeedPanel.tsx'
import { useMe } from '../hooks/useMe.ts'
import { AiConnectionsSection } from '../components/AiConnectionsSection.tsx'

export default function Settings() {
  const config = useConfig()
  const me = useMe()
  const hasNotificationChannels = !!(config?.email_notifications_available || config?.vapid_public_key)
  const push = usePush(config?.staging_demo ? '' : (config?.vapid_public_key ?? ''), !config?.staging_demo)
  // Whether this device could do push at all, regardless of server config.
  const pushSupported = push.state !== 'unsupported' && push.state !== 'needs-install'
  const { theme, setTheme } = useTheme()
  const { settingsSections } = useAppContext()
  const { hash } = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousHash = useRef(hash)
  const notificationAvailable = !config?.staging_demo && (!!config?.vapid_public_key || pushSupported || !!config?.email_notifications_available)
  const categories = [
    { hash: '#ai-connections', label: 'AI Connections', description: 'Connect an assistant and manage access', available: !!config?.ai_connections },
    { hash: '#tax', label: 'Stock, Tax & Loan Assumptions', description: 'Tax rates, interest deductions and loan payoff', available: !!settingsSections },
    { hash: '#notifications', label: 'Notifications', description: 'Email, push and reminder timing', available: notificationAvailable },
    { hash: '#appearance', label: 'Appearance', description: 'Light, dark or system theme', available: true },
    { hash: '#sharing', label: 'Sharing', description: 'Send invitations and manage shared access', available: !config?.staging_demo },
    { hash: '#account', label: 'Account', description: 'Sign-in sessions and account data', available: true },
  ].filter(category => category.available)
  const categoryHash = hash === '#loans' || hash === '#stock-down-payment' ? '#tax' : hash
  const active = categories.find(category => category.hash === categoryHash)

  const activeHash = active?.hash

  useEffect(() => {
    if (activeHash) {
      panelRef.current?.focus({ preventScroll: true })
    } else if (previousHash.current !== hash) {
      headingRef.current?.focus({ preventScroll: true })
    }
    if (activeHash || previousHash.current !== hash) window.scrollTo(0, 0)
    previousHash.current = hash
  }, [activeHash, hash])

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const summaryChannelEnabled = !!((config?.email_notifications_available && emailEnabled) || (config?.vapid_public_key && (push.state === 'on' || push.otherDevices > 0)))
  const [advanceDays, setAdvanceDays] = useState(0)
  const [advanceDaysLoading, setAdvanceDaysLoading] = useState(false)
  const [pushTestLoading, setPushTestLoading] = useState(false)
  const [pushTestResult, setPushTestResult] = useState<string | null>(null)
  const [notificationPrefsLoaded, setNotificationPrefsLoaded] = useState(false)
  const [notificationPrefsError, setNotificationPrefsError] = useState(false)
  const preferenceRequest = useRef(0)
  const [annualSummary, setAnnualSummary] = useState(false)
  const [summarySaving, setSummarySaving] = useState(false)
  const [summaryError, setSummaryError] = useState(false)
  const [notificationSaveError, setNotificationSaveError] = useState('')

  const loadEmailPref = useCallback(async () => {
    const request = ++preferenceRequest.current
    try {
      const pref = await api.getEmailPref()
      if (request !== preferenceRequest.current) return
      setNotificationPrefsLoaded(true)
      setNotificationPrefsError(false)
      setEmailEnabled(pref.enabled)
      setAnnualSummary(!!pref.annual_summary_enabled)
      setAdvanceDays(pref.advance_days ?? 0)
    } catch {
      if (request === preferenceRequest.current) { setNotificationPrefsLoaded(false); setNotificationPrefsError(true) }
    }
  }, [])

  useEffect(() => {
    if (!config?.staging_demo && (config?.email_notifications_available || config?.vapid_public_key)) loadEmailPref()
  }, [config?.email_notifications_available, config?.vapid_public_key, config?.staging_demo, loadEmailPref])

  async function toggleEmail() {
    setNotificationSaveError('')
    setEmailLoading(true)
    try {
      const pref = await api.setEmailPref(!emailEnabled)
      setEmailEnabled(pref.enabled)
      if (pref.enabled) void measurementEvent('reminder_enabled')
    } catch { setNotificationSaveError('Could not change email notifications. Try again.') } finally { setEmailLoading(false) }
  }

  async function changeAdvanceDays(days: number) {
    setNotificationSaveError('')
    setAdvanceDaysLoading(true)
    try {
      const pref = await api.setAdvanceDays(days)
      setAdvanceDays(pref.advance_days ?? days)
    } catch { setNotificationSaveError('Could not save reminder timing. Try again.') } finally { setAdvanceDaysLoading(false) }
  }

  async function sendTestPush() {
    setPushTestLoading(true)
    setPushTestResult(null)
    try {
      const { sent } = await api.pushTest()
      setPushTestResult(sent > 0 ? 'Test notification sent!' : 'No subscriptions found — enable push first.')
    } catch (e: unknown) {
      setPushTestResult(e instanceof Error ? e.message : 'Failed to send test notification')
    } finally { setPushTestLoading(false) }
  }

  const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'System' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <SettingsNavigation
      categories={categories}
      active={active}
      headingRef={headingRef}
      panelRef={panelRef}
      indexContent={config?.staging_demo && !me?.reviewer_account && <StagingSeedPanel currentScenario={me?.staging_account?.scenario} />}
    >
      {activeHash === '#appearance' && <Card as="section" pad="md">
        <h2 className="text-sm font-medium text-cs-text">Appearance</h2>
        <p className="mt-1 text-xs text-cs-text-2">
          Choose your preferred color scheme.
        </p>
        <div className="mt-3 inline-flex rounded-md border border-cs-border overflow-hidden">
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              aria-label={`${label} theme`}
              className={`min-h-11 px-4 text-sm font-medium transition-colors ${
                theme === value
                  ? 'bg-rose-700 text-white'
                  : 'bg-cs-surface text-cs-text-2 hover:bg-cs-raised'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>}

      {activeHash === '#notifications' && (
        <Card as="section" pad="md">
          <h2 id="notifications" className="scroll-mt-24 text-sm font-medium text-cs-text">Notifications</h2>
          <p className="mt-1 text-xs text-cs-text-2">
            Get notified when you have vesting, exercise, or loan repayment events.
          </p>

          {notificationSaveError && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{notificationSaveError}</p>}
          <div className="mt-3 space-y-3">
            {/* Push — always describes THIS device. A subscription can only be
 created by the device it belongs to, so the account's other devices
 are context, never the state of this toggle. */}
            {!config?.vapid_public_key ? (
              <p className="text-xs text-cs-text-2">
                Push notifications are not configured on this server.
              </p>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-cs-text-2">Push notifications</span>
                  <div className="flex items-center gap-2">
                    {push.state === 'on' && (
                      <span className="text-xs text-green-700 dark:text-green-300">On this device</span>
                    )}
                    {(push.state === 'on' || push.state === 'off') && (
                      <button
                        onClick={push.state === 'on' ? push.disable : push.enable}
                        disabled={push.loading}
                        className={`rounded-md min-h-11 px-3 text-sm font-medium text-white disabled:opacity-50 ${
                          push.state === 'on' ? 'bg-gray-500 hover:bg-gray-600' : 'bg-cs-brand hover:bg-cs-brand-hover'
                        }`}
                      >
                        {push.loading ? 'Loading...' : push.state === 'on' ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>
                </div>

                {push.state === 'blocked' && (
                  <p className="mt-1 text-xs text-cs-text-2">
                    Blocked for this app. Turn notifications back on in your device settings
                    to enable them here.
                  </p>
                )}
                {push.state === 'needs-install' && (
                  <p className="mt-1 text-xs text-cs-text-2">
                    Add this app to your home screen to enable notifications on this device.
                  </p>
                )}
                {push.state === 'unsupported' && (
                  <p className="mt-1 text-xs text-cs-text-2">
                    Not available on this device.
                  </p>
                )}
                {push.otherDevices > 0 && (
                  <p className="mt-1 text-xs text-cs-muted">
                    {push.state === 'on' ? 'Also on' : 'On'} {push.otherDevices} other{' '}
                    {push.otherDevices === 1 ? 'device' : 'devices'}.
                  </p>
                )}
                {push.state !== 'on' && push.intent && !push.offerDismissed && (
                  <button
                    onClick={() => { try { localStorage.setItem('reminder_offer_dismissed', '1') } catch { /* account preference is saved below */ } void push.setIntent(false) }}
                    className="mt-1 text-xs text-cs-text-2 underline hover:text-cs-text"
                  >
                    Stop offering notifications on new devices
                  </button>
                )}
              </div>
            )}

            {/* Email */}
            {config?.email_notifications_available && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-cs-text-2">Email notifications</span>
                <div className="flex items-center gap-2">
                  {emailEnabled && (
                    <span className="text-xs text-green-700 dark:text-green-300">Enabled</span>
                  )}
                  <button
                    onClick={toggleEmail}
                    disabled={emailLoading}
                    className={`rounded-md min-h-11 px-3 text-sm font-medium text-white disabled:opacity-50 ${
                      emailEnabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-cs-brand hover:bg-cs-brand-hover'
                    }`}
                  >
                    {emailLoading ? 'Loading...' : emailEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            )}

            {/* Advance timing — shown when any notification is active */}
            {(push.state === 'on' || emailEnabled) && (
              <div className="flex items-center justify-between border-t border-cs-border pt-3 ">
                <div>
                  <span className="text-xs text-cs-text-2">Notify me</span>
                  <p className="text-[11px] text-cs-text-2">When to send the notification</p>
                </div>
                <select
                  aria-label="Notification timing"
                  value={advanceDays}
                  disabled={advanceDaysLoading}
                  onChange={e => changeAdvanceDays(Number(e.target.value))}
                  className="min-h-11 rounded-md border border-cs-border-strong bg-cs-surface px-2 text-sm text-cs-text"
                >
                  <option value={0}>Day of event</option>
                  <option value={7}>1 week before</option>
                  <option value={3}>3 days before</option>
                </select>
              </div>
            )}

            {/* Test push button */}
            {push.state === 'on' && (
              <div className="flex items-center justify-between border-t border-cs-border pt-3 ">
                <div>
                  <span className="text-xs text-cs-text-2">Test push</span>
                  <p className="text-[11px] text-cs-text-2">Confirm notifications are working</p>
                </div>
                <button
                  onClick={sendTestPush}
                  disabled={pushTestLoading}
                  className="rounded-md bg-cs-raised min-h-11 px-3 text-sm font-medium text-cs-text-2 hover:bg-cs-border disabled:opacity-50"
                >
                  {pushTestLoading ? 'Sending...' : 'Send test'}
                </button>
              </div>
            )}

            <p aria-live="polite" className="text-xs text-cs-text-2">{pushTestResult ?? ''}</p>
          </div>
          {hasNotificationChannels && <>
            {!notificationPrefsLoaded && !notificationPrefsError && <p role="status" className="mt-3 text-xs text-cs-muted">Loading notification preferences…</p>}
            {notificationPrefsError && <p role="alert" className="mt-3 text-xs text-cs-text-2">Could not load notification preferences. <button type="button" onClick={() => void loadEmailPref()} className="underline">Retry notifications</button></p>}
            <label className="mt-3 flex items-start gap-2 text-xs text-cs-text-2">
              <input type="checkbox" checked={annualSummary} disabled={summarySaving || !notificationPrefsLoaded || (!summaryChannelEnabled && !annualSummary)} onChange={async e => {
                const enabled = e.target.checked
                ++preferenceRequest.current
                setSummarySaving(true)
                setSummaryError(false)
                try { setAnnualSummary((await api.setAnnualSummaryPref(enabled)).annual_summary_enabled) }
                catch { setSummaryError(true) }
                finally { setSummarySaving(false) }
              }} />
              Include an annual stock summary in January through my enabled notification channels. No financial amounts in the preview.
            </label>
            {notificationPrefsLoaded && !summaryChannelEnabled && <p className="mt-2 text-xs text-cs-text-2">Turn on email or push notifications to receive the annual summary. Your summary preference is kept, but delivery is paused until a channel is enabled.</p>}
            {summarySaving && <p role="status" className="mt-2 text-xs text-cs-muted">Saving annual-summary preference…</p>}
            {summaryError && <p role="alert" className="mt-2 text-xs text-cs-text-2">Could not save the annual-summary preference. Try again.</p>}
          </>}
        </Card>
      )}

      {activeHash === '#tax' && settingsSections}

      {activeHash === '#ai-connections' && <AiConnectionsSection />}

      {activeHash === '#sharing' && <SharingSection />}

      {activeHash === '#account' && <AccountSettings epicMode={Boolean(config?.epic_mode)} />}
    </SettingsNavigation>
  )
}

function AccountSettings({ epicMode }: { epicMode: boolean }) {
  const { logout, logoutEverywhere } = useAuth()
  const [logoutEverywhereConfirm, setLogoutEverywhereConfirm] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')

  return (
    <Card as="section" pad="md">
      <h2 className="text-sm font-medium text-cs-text">Account</h2>
      <p className="mt-1 text-xs text-cs-text-2">
        Signed in with Google. All your data is stored securely on the server.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={logout}
          className="rounded-md bg-gray-600 min-h-11 px-3 text-sm font-medium text-white hover:bg-gray-700"
        >
          Sign Out
        </button>
        {!logoutEverywhereConfirm ? (
          <button
            onClick={() => setLogoutEverywhereConfirm(true)}
            className="rounded-md border border-cs-border-strong min-h-11 px-3 text-sm font-medium text-cs-text-2 hover:bg-cs-raised "
          >
            Sign Out Everywhere
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={logoutEverywhere}
              className="rounded-md bg-gray-700 min-h-11 px-3 text-sm font-medium text-white hover:bg-gray-800"
            >
              Yes, sign out all devices
            </button>
            <button
              onClick={() => setLogoutEverywhereConfirm(false)}
              className="rounded-md min-h-11 px-3 text-sm text-cs-text-2 hover:text-cs-text-2 "
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {logoutEverywhereConfirm && (
        <p className="mt-2 text-xs text-cs-text-2">
          This invalidates every active session — every browser, every device. You'll need to sign back in on each one.
        </p>
      )}

      {actionError && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{actionError}</p>}
      <div className="mt-4 border-t border-cs-border pt-4 ">
        <p className="text-xs font-medium text-red-700 dark:text-red-400">Danger Zone</p>

        {!epicMode && <div className="mt-3">
          <p className="text-xs text-cs-text-2">
            <span className="font-medium">Reset data</span> — delete all your grants, loans, and prices. Your account stays active.
          </p>
          {!resetConfirm ? (
            <button
              onClick={() => { setActionError(''); setResetConfirm(true) }}
              className="mt-2 rounded-md border border-red-300 min-h-11 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              Reset All Data
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={async () => {
                  setActionError('')
                  setActionLoading(true)
                  try {
                    await api.resetMyData()
                    setResetConfirm(false)
                    window.location.reload()
                  } catch { setActionError('Could not reset your data. Try again.') } finally { setActionLoading(false) }
                }}
                disabled={actionLoading}
                className="rounded-md bg-red-600 min-h-11 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Resetting...' : 'Yes, delete all my data'}
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                className="rounded-md min-h-11 px-3 text-sm text-cs-text-2 hover:text-cs-text-2 "
              >
                Cancel
              </button>
            </div>
          )}
        </div>}

        <div className="mt-4 border-t border-cs-border pt-4 ">
          <p className="text-xs text-cs-text-2">
            <span className="font-medium">Delete account</span> — permanently remove your account and all associated data. This cannot be undone.
          </p>
          {!deleteConfirm ? (
            <button
              onClick={() => { setActionError(''); setDeleteConfirm(true) }}
              className="mt-2 rounded-md border border-red-300 min-h-11 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              Delete Account
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={async () => {
                  setActionError('')
                  setActionLoading(true)
                  try {
                    await api.deleteMyAccount()
                    logout()
                  } catch { setActionError('Could not delete your account. Try again.') } finally { setActionLoading(false) }
                }}
                disabled={actionLoading}
                className="rounded-md bg-red-600 min-h-11 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Deleting...' : 'Yes, delete my account'}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="rounded-md min-h-11 px-3 text-sm text-cs-text-2 hover:text-cs-text-2 "
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

type SettingsCategory = { hash: string; label: string; description: string }

function SettingsNavigation({
  categories, active, headingRef, panelRef, indexContent, children,
}: {
  categories: SettingsCategory[]
  active?: SettingsCategory
  headingRef: React.RefObject<HTMLHeadingElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
  indexContent: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-cs-text outline-none!">Settings</h1>
      {!active && indexContent}
      <div className={active ? 'md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-5' : 'max-w-xl'}>
        <nav aria-label="Settings categories" className={active ? 'hidden md:sticky md:top-28 md:block' : ''}>
          <Card pad="none" className="divide-y divide-cs-border overflow-hidden">
            {categories.map(category => (
              <Link
                key={category.hash}
                to={`/settings${category.hash}`}
                aria-current={active?.hash === category.hash ? 'location' : undefined}
                className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-brand ${active?.hash === category.hash ? 'bg-cs-brand-subtle' : 'hover:bg-cs-raised'}`}
              >
                <span>
                  <span className="block text-sm font-semibold text-cs-text">{category.label}</span>
                  <span className="mt-0.5 block text-xs text-cs-text-2">{category.description}</span>
                </span>
                <span aria-hidden="true" className="text-cs-muted">›</span>
              </Link>
            ))}
          </Card>
        </nav>

        {active && <div className="min-w-0 space-y-2">
          <Link to="/settings" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-cs-brand dark:text-rose-300 md:hidden">
            <span aria-hidden="true">‹</span> Back to Settings
          </Link>
          <div ref={panelRef} tabIndex={-1} role="region" aria-label={active.label} className="min-w-0 space-y-4 outline-none!">
            {children}
          </div>
        </div>}
      </div>

      {import.meta.env.VITE_COMMIT_SHA && import.meta.env.VITE_COMMIT_SHA !== 'dev' && (
        <p className="text-center text-xs text-cs-text-2">
          {import.meta.env.VITE_COMMIT_SHA.slice(0, 7)}
        </p>
      )}
    </div>
  )
}

// ── Sharing section ─────────────────────────────────────────────────────────

function SharingSection() {
  const [sent, setSent] = useState<InvitationEntry[]>([])
  const [received, setReceived] = useState<ReceivedInvitation[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [sending, setSending] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [loadFailed, setLoadFailed] = useState(false)

  const loadSent = useCallback(() => {
    api.getSentInvitations().then(setSent).catch(() => setLoadFailed(true))
  }, [])
  const loadReceived = useCallback(() => {
    api.getReceivedInvitations().then(setReceived).catch(() => setLoadFailed(true))
  }, [])
  useEffect(() => { void loadSent(); void loadReceived() }, [loadSent, loadReceived])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setSending(true); setError(''); setSuccess('')
    try {
      const result = await api.sendInvite(inviteEmail.trim())
      setInviteEmail('')
      if (result.email_sent) {
        setSuccess('Invitation sent! They\'ll receive an email with a link and code.')
      } else {
        setSuccess(result.short_code
          ? `Email could not be sent. Share this code with them instead: ${result.short_code}`
          : 'Email could not be sent. Revoke this invitation and send a new one.')
      }
      loadSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    }
    setSending(false)
  }

  async function handleRevoke(id: number) {
    setError('')
    setSuccess('')
    try {
      await api.revokeInvitation(id)
      void loadSent()
      setSuccess('Access revoked.')
    } catch { setError('Could not revoke access. Try again.') }
  }

  async function handleResend(id: number) {
    setError('')
    setSuccess('')
    try {
      const result = await api.resendInvitation(id)
      void loadSent()
      setSuccess(result.email_sent
        ? 'Invitation resent!'
        : result.short_code
          ? `Email could not be sent. Share the new code: ${result.short_code}`
          : 'Email could not be sent. Revoke this invitation and send a new one.')
    } catch { setError('Could not resend the invitation. Try again.') }
  }

  async function handleAcceptCode(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteCode.trim()) return
    setAccepting(true); setError(''); setSuccess('')
    try {
      const result = await api.acceptInvite({ code: inviteCode.trim() })
      setInviteCode('')
      setSuccess(result.message || 'Invitation accepted!')
      loadReceived()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    }
    setAccepting(false)
  }

  async function handleRemoveAccess(id: number) {
    setError('')
    setSuccess('')
    try {
      await api.removeSharedAccess(id)
      void loadReceived()
      setSuccess('Shared access removed.')
    } catch { setError('Could not remove shared access. Try again.') }
  }

  async function handleToggleNotify(id: number, enabled: boolean) {
    setError('')
    setSuccess('')
    try {
      await api.setSharedNotify(id, enabled)
      void loadReceived()
    } catch { setError('Could not change shared notifications. Try again.') }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      accepted: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
      declined: 'bg-cs-raised text-cs-text-2 ',
      revoked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    }
    return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[status] ?? ''}`}>{status}</span>
  }

  return (
    <Card as="section" pad="md">
      <h2 className="text-sm font-medium text-cs-text">Sharing</h2>
      <p className="mt-1 text-xs text-cs-text-2">
        Invite people to view your equity data, or enter a code you received.
      </p>

      {error && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
      {success && <p role="status" className="mt-2 rounded bg-green-50 p-2 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">{success}</p>}

      {loadFailed && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-cs-text-2">
        <span>Could not load all invitations.</span>
        <button type="button" onClick={() => { setLoadFailed(false); void loadSent(); void loadReceived() }} className="min-h-11 text-cs-brand dark:text-rose-300 underline">Try again</button>
      </div>}

      <label htmlFor="settings-invite-email" className="mt-4 block text-sm font-medium text-cs-text">Email address to invite</label>
      <form onSubmit={handleInvite} className="mt-1 flex gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          id="settings-invite-email"
          placeholder="name@example.com"
          className="min-h-11 min-w-0 flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 text-base text-cs-text"
        />
        <button
          type="submit"
          disabled={sending || !inviteEmail.trim()}
          className="rounded bg-cs-brand min-h-11 px-3 text-sm font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Invite'}
        </button>
      </form>

      {/* Sent invitations */}
      {sent.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-cs-text-2">People I&rsquo;ve shared with</p>
          <div className="space-y-1.5">
            {sent.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded border border-cs-border px-2 py-1.5 text-xs ">
                <div className="min-w-0 flex-1">
                  <span className="break-all font-medium text-cs-text">{inv.invitee_email}</span>
                  {inv.invitee_account_email && inv.invitee_account_email !== inv.invitee_email && (
                    <span className="ml-1 break-all text-cs-muted">(signed in as {inv.invitee_account_email})</span>
                  )}
                  {inv.invitee_name && <span className="ml-1 text-cs-muted">— {inv.invitee_name}</span>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {statusBadge(inv.status)}
                    {inv.status === 'pending' && inv.short_code && (
                      <span className="font-mono text-cs-muted" title="Share this code manually if they didn't get the email">
                        code: {inv.short_code}
                      </span>
                    )}
                    {inv.last_viewed_at && (
                      <span className="text-cs-muted">
                        last viewed {new Date(inv.last_viewed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  {inv.status === 'pending' && (
                    <button onClick={() => handleResend(inv.id)} className="min-h-11 px-1 text-blue-700 hover:text-blue-800 dark:text-blue-400">resend</button>
                  )}
                  {(inv.status === 'pending' || inv.status === 'accepted') && (
                    <button onClick={() => handleRevoke(inv.id)} className="min-h-11 px-1 text-red-700 hover:text-red-800 dark:text-red-400">revoke</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Received invitations */}
      {received.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-cs-text-2">Data shared with me</p>
          <div className="space-y-1.5">
            {received.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded border border-cs-border px-2 py-1.5 text-xs ">
                <div className="min-w-0 break-words">
                  <span className="font-medium text-cs-text">{inv.inviter_name ?? inv.inviter_email}</span>
                  {inv.inviter_name && <span className="ml-1 text-cs-muted">({inv.inviter_email})</span>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <label className="flex items-center gap-1 text-cs-muted">
                    <input
                      type="checkbox"
                      checked={inv.notify_enabled}
                      onChange={e => handleToggleNotify(inv.id, e.target.checked)}
                      className="h-4 w-4"
                    />
                    notify
                  </label>
                  <button onClick={() => handleRemoveAccess(inv.id)} className="min-h-11 px-1 text-red-700 hover:text-red-800 dark:text-red-400">remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <label htmlFor="settings-invite-code" className="mt-4 block text-sm font-medium text-cs-text">Invitation code</label>
      <form onSubmit={handleAcceptCode} className="mt-1 flex gap-2">
        <input
          type="text"
          value={inviteCode}
          onChange={e => setInviteCode(e.target.value)}
          id="settings-invite-code"
          placeholder="ABCD-EFGH"
          className="min-h-11 min-w-0 flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 text-base text-cs-text uppercase tracking-wider"
          maxLength={9}
        />
        <button
          type="submit"
          disabled={accepting || !inviteCode.trim()}
          className="rounded bg-cs-raised min-h-11 px-3 text-sm font-medium text-cs-text hover:bg-cs-border disabled:opacity-50"
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
      </form>
    </Card>
  )
}
