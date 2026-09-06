import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { useTheme } from '../contexts/theme.ts'
import { useAppContext } from '../contexts/AppContext.tsx'
import { api } from '../../api.ts'
import type { InvitationEntry, ReceivedInvitation } from '../../api.ts'
import type { Theme } from '../contexts/theme.ts'
import { Card } from '../components/ui/Card.tsx'

export default function Settings() {
  const config = useConfig()
  const push = usePush(config?.vapid_public_key ?? '')
  // Whether this device could do push at all, regardless of server config.
  const pushSupported = push.state !== 'unsupported' && push.state !== 'needs-install'
  const { logout, logoutEverywhere } = useAuth()
  const [logoutEverywhereConfirm, setLogoutEverywhereConfirm] = useState(false)
  const { theme, setTheme } = useTheme()
  const { settingsSections } = useAppContext()

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [advanceDays, setAdvanceDays] = useState(0)
  const [advanceDaysLoading, setAdvanceDaysLoading] = useState(false)
  const [pushTestLoading, setPushTestLoading] = useState(false)
  const [pushTestResult, setPushTestResult] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const loadEmailPref = useCallback(async () => {
    try {
      const pref = await api.getEmailPref()
      setEmailEnabled(pref.enabled)
      setAdvanceDays(pref.advance_days ?? 0)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (config?.email_notifications_available) loadEmailPref()
  }, [config?.email_notifications_available, loadEmailPref])

  async function toggleEmail() {
    setEmailLoading(true)
    try {
      const pref = await api.setEmailPref(!emailEnabled)
      setEmailEnabled(pref.enabled)
    } catch { /* ignore */ } finally { setEmailLoading(false) }
  }

  async function changeAdvanceDays(days: number) {
    setAdvanceDaysLoading(true)
    try {
      const pref = await api.setAdvanceDays(days)
      setAdvanceDays(pref.advance_days ?? days)
    } catch { /* ignore */ } finally { setAdvanceDaysLoading(false) }
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
    { value: 'auto', label: 'Auto' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-cs-text">Settings</h2>

      {/* Display Settings */}
      <Card as="section" pad="md">
        <h3 className="text-sm font-medium text-cs-text">Display</h3>
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
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                theme === value
                  ? 'bg-cs-brand text-white'
                  : 'bg-cs-surface text-cs-text-2 hover:bg-cs-raised'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Notifications */}
      {(!!config?.vapid_public_key || pushSupported || config?.email_notifications_available) && (
        <Card as="section" pad="md">
          <h3 className="text-sm font-medium text-cs-text">Notifications</h3>
          <p className="mt-1 text-xs text-cs-text-2">
            Get notified when you have vesting, exercise, or loan repayment events.
          </p>

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
                        className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
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
                {push.state !== 'on' && push.intent && (
                  <button
                    onClick={() => push.setIntent(false)}
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
                    className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
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
                  className="rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text"
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
                  className="rounded-md bg-cs-raised px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-border disabled:opacity-50"
                >
                  {pushTestLoading ? 'Sending...' : 'Send test'}
                </button>
              </div>
            )}

            <p aria-live="polite" className="text-xs text-cs-text-2">{pushTestResult ?? ''}</p>
          </div>
        </Card>
      )}

      {/* App-specific settings injected here */}
      {settingsSections}

      {/* Sharing */}
      <SharingSection />

      {/* Account Management */}
      <Card as="section" pad="md">
        <h3 className="text-sm font-medium text-cs-text">Account</h3>
        <p className="mt-1 text-xs text-cs-text-2">
          Signed in with Google. All your data is stored securely on the server.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={logout}
            className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
          >
            Sign Out
          </button>
          {!logoutEverywhereConfirm ? (
            <button
              onClick={() => setLogoutEverywhereConfirm(true)}
              className="rounded-md border border-cs-border-strong px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised "
            >
              Sign Out Everywhere
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={logoutEverywhere}
                className="rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Yes, sign out all devices
              </button>
              <button
                onClick={() => setLogoutEverywhereConfirm(false)}
                className="rounded-md px-3 py-1.5 text-xs text-cs-text-2 hover:text-cs-text-2 "
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

        <div className="mt-4 border-t border-cs-border pt-4 ">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">Danger Zone</p>

          {!config?.epic_mode && <div className="mt-3">
            <p className="text-xs text-cs-text-2">
              <span className="font-medium">Reset data</span> — delete all your grants, loans, and prices. Your account stays active.
            </p>
            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Reset All Data
              </button>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={async () => {
                    setActionLoading(true)
                    try {
                      await api.resetMyData()
                      setResetConfirm(false)
                      window.location.reload()
                    } catch { /* ignore */ } finally { setActionLoading(false) }
                  }}
                  disabled={actionLoading}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Resetting...' : 'Yes, delete all my data'}
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-cs-text-2 hover:text-cs-text-2 "
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
                onClick={() => setDeleteConfirm(true)}
                className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Delete Account
              </button>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={async () => {
                    setActionLoading(true)
                    try {
                      await api.deleteMyAccount()
                      logout()
                    } catch { /* ignore */ } finally { setActionLoading(false) }
                  }}
                  disabled={actionLoading}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Deleting...' : 'Yes, delete my account'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-cs-text-2 hover:text-cs-text-2 "
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

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

  const loadSent = useCallback(() => { api.getSentInvitations().then(setSent).catch(() => {}) }, [])
  const loadReceived = useCallback(() => { api.getReceivedInvitations().then(setReceived).catch(() => {}) }, [])

  useEffect(() => { loadSent(); loadReceived() }, [loadSent, loadReceived])

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
    await api.revokeInvitation(id)
    loadSent()
  }

  async function handleResend(id: number) {
    await api.resendInvitation(id)
    loadSent()
    setSuccess('Invitation resent!')
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
    await api.removeSharedAccess(id)
    loadReceived()
  }

  async function handleToggleNotify(id: number, enabled: boolean) {
    await api.setSharedNotify(id, enabled)
    loadReceived()
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
      <h3 className="text-sm font-medium text-cs-text">Sharing</h3>
      <p className="mt-1 text-xs text-cs-text-2">
        Invite people to view your equity data, or enter a code you received.
      </p>

      {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
      {success && <p className="mt-2 rounded bg-green-50 p-2 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">{success}</p>}

      {/* Invite someone */}
      <form onSubmit={handleInvite} className="mt-3 flex gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          placeholder="Email address to invite"
          className="flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text"
        />
        <button
          type="submit"
          disabled={sending || !inviteEmail.trim()}
          className="rounded bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
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
                  <span className="font-medium text-cs-text">{inv.invitee_email}</span>
                  {inv.invitee_account_email && inv.invitee_account_email !== inv.invitee_email && (
                    <span className="ml-1 text-cs-muted">(signed in as {inv.invitee_account_email})</span>
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
                    <button onClick={() => handleResend(inv.id)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">resend</button>
                  )}
                  {(inv.status === 'pending' || inv.status === 'accepted') && (
                    <button onClick={() => handleRevoke(inv.id)} className="text-red-600 hover:text-red-800 dark:text-red-400">revoke</button>
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
                <div>
                  <span className="font-medium text-cs-text">{inv.inviter_name ?? inv.inviter_email}</span>
                  {inv.inviter_name && <span className="ml-1 text-cs-muted">({inv.inviter_email})</span>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <label className="flex items-center gap-1 text-cs-muted">
                    <input
                      type="checkbox"
                      checked={inv.notify_enabled}
                      onChange={e => handleToggleNotify(inv.id, e.target.checked)}
                      className="h-3 w-3"
                    />
                    notify
                  </label>
                  <button onClick={() => handleRemoveAccess(inv.id)} className="text-red-600 hover:text-red-800 dark:text-red-400">remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enter invitation code */}
      <form onSubmit={handleAcceptCode} className="mt-4 flex gap-2">
        <input
          type="text"
          value={inviteCode}
          onChange={e => setInviteCode(e.target.value)}
          placeholder="Enter invitation code (e.g. ABCD-EFGH)"
          className="flex-1 rounded border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text uppercase tracking-wider"
          maxLength={9}
        />
        <button
          type="submit"
          disabled={accepting || !inviteCode.trim()}
          className="rounded bg-cs-raised px-3 py-1.5 text-xs font-medium text-cs-text hover:bg-cs-border disabled:opacity-50"
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
      </form>
    </Card>
  )
}
