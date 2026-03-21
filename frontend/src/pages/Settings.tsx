import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { api } from '../api.ts'

export default function Settings() {
  const config = useConfig()
  const { subscribed, loading, supported, subscribe, unsubscribe } = usePush(config?.vapid_public_key ?? '')
  const { logout } = useAuth()

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const loadEmailPref = useCallback(async () => {
    try {
      const { enabled } = await api.getEmailPref()
      setEmailEnabled(enabled)
    } catch {
      // not available
    }
  }, [])

  useEffect(() => {
    if (config?.email_notifications_available) {
      loadEmailPref()
    }
  }, [config?.email_notifications_available, loadEmailPref])

  async function toggleEmail() {
    setEmailLoading(true)
    try {
      const { enabled } = await api.setEmailPref(!emailEnabled)
      setEmailEnabled(enabled)
    } catch {
      // ignore
    } finally {
      setEmailLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>

      {/* Push Notifications */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Push Notifications</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Get notified on days when you have vesting, exercise, or loan repayment events.
        </p>

        {!supported ? (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            Push notifications are not supported in this browser.
          </p>
        ) : !config?.vapid_public_key ? (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            Push notifications are not configured on this server.
          </p>
        ) : (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={subscribed ? unsubscribe : subscribe}
              disabled={loading}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                subscribed
                  ? 'bg-gray-500 hover:bg-gray-600'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {loading ? 'Loading...' : subscribed ? 'Disable Notifications' : 'Enable Notifications'}
            </button>
            {subscribed && (
              <span className="text-xs text-green-600 dark:text-green-400">Notifications enabled</span>
            )}
          </div>
        )}
      </section>

      {/* Email Notifications — only if SMTP configured */}
      {config?.email_notifications_available && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Email Notifications</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Receive an email on days when you have vesting, exercise, or loan repayment events.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={toggleEmail}
              disabled={emailLoading}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                emailEnabled
                  ? 'bg-gray-500 hover:bg-gray-600'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {emailLoading ? 'Loading...' : emailEnabled ? 'Disable Email' : 'Enable Email'}
            </button>
            {emailEnabled && (
              <span className="text-xs text-green-600 dark:text-green-400">Email notifications enabled</span>
            )}
          </div>
        </section>
      )}

      {/* Account */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Account</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Signed in with Google. All your data is stored securely on the server.
        </p>
        <button
          onClick={logout}
          className="mt-3 rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
        >
          Sign Out
        </button>
      </section>

      {/* Data Management */}
      <section className="rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-red-700 dark:text-red-400">Danger Zone</h3>

        {/* Reset Data */}
        <div className="mt-3">
          <p className="text-xs text-gray-700 dark:text-gray-300">
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
                className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Delete Account */}
        <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
          <p className="text-xs text-gray-700 dark:text-gray-300">
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
                className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
