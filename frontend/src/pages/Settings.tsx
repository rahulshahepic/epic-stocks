import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { api } from '../api.ts'
import type { TaxSettings } from '../api.ts'

export default function Settings() {
  const config = useConfig()
  const { subscribed, loading, supported, subscribe, unsubscribe } = usePush(config?.vapid_public_key ?? '')
  const { logout } = useAuth()

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null)
  const [editingTax, setEditingTax] = useState(false)
  const [taxForm, setTaxForm] = useState<TaxSettings | null>(null)
  const [taxSaving, setTaxSaving] = useState(false)

  const WI_DEFAULTS: TaxSettings = {
    federal_income_rate: 0.37,
    federal_lt_cg_rate: 0.20,
    federal_st_cg_rate: 0.37,
    niit_rate: 0.038,
    state_income_rate: 0.0765,
    state_lt_cg_rate: 0.0536,
    state_st_cg_rate: 0.0765,
    lt_holding_days: 365,
    lot_selection_method: 'lifo',
    prefer_stock_dp: false,
    dp_min_percent: 0.10,
    dp_min_cap: 20000,
  }

  const loadTaxSettings = useCallback(async () => {
    try {
      const ts = await api.getTaxSettings()
      setTaxSettings(ts)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadTaxSettings() }, [loadTaxSettings])

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

      {/* Tax Settings */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Tax Rates (Wisconsin Defaults)</h3>
          {!editingTax && (
            <div className="flex gap-2">
              <button
                onClick={() => { setTaxForm(taxSettings ? { ...taxSettings } : { ...WI_DEFAULTS }); setEditingTax(true) }}
                className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
              >Edit</button>
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Used to estimate tax on share sales. Wisconsin 30% exclusion on qualifying LT gains is baked into state LT rate.
        </p>

        {taxSettings && !editingTax && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[
              ['Federal Income', taxSettings.federal_income_rate],
              ['Federal LT CG', taxSettings.federal_lt_cg_rate],
              ['Federal ST CG', taxSettings.federal_st_cg_rate],
              ['NIIT', taxSettings.niit_rate],
              ['State Income', taxSettings.state_income_rate],
              ['State LT CG', taxSettings.state_lt_cg_rate],
              ['State ST CG', taxSettings.state_st_cg_rate],
            ].map(([label, val]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="font-medium text-gray-700 dark:text-gray-300">{((val as number) * 100).toFixed(2)}%</dd>
              </div>
            ))}
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">LT Threshold</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">{taxSettings.lt_holding_days}d</dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-gray-500 dark:text-gray-400">Lot selection</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {taxSettings.lot_selection_method === 'fifo' ? 'FIFO (oldest first)' :
                 taxSettings.lot_selection_method === 'lifo' ? 'LIFO (newest first)' :
                 'Same tranche'}
              </dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-gray-500 dark:text-gray-400">Prefer stock for DP</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {taxSettings.prefer_stock_dp ? 'Yes — auto-calculate DP shares' : 'No — manual'}
              </dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-gray-500 dark:text-gray-400">Min DP rule</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {taxSettings.dp_min_percent > 0 || taxSettings.dp_min_cap > 0
                  ? `min(${(taxSettings.dp_min_percent * 100).toFixed(0)}%, $${taxSettings.dp_min_cap.toLocaleString()})`
                  : 'None'}
              </dd>
            </div>
          </dl>
        )}

        {editingTax && taxForm && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['Federal Income Rate', 'federal_income_rate'],
                ['Federal LT CG Rate', 'federal_lt_cg_rate'],
                ['Federal ST CG Rate', 'federal_st_cg_rate'],
                ['NIIT Rate', 'niit_rate'],
                ['State Income Rate', 'state_income_rate'],
                ['State LT CG Rate', 'state_lt_cg_rate'],
                ['State ST CG Rate', 'state_st_cg_rate'],
              ] as [string, keyof TaxSettings][]).map(([label, key]) => (
                <label key={key} className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={taxForm[key] as number}
                    onChange={e => setTaxForm(f => f ? { ...f, [key]: +e.target.value } : f)}
                    className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  />
                </label>
              ))}
              <label className="block col-span-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Lot Selection Method</span>
                <select
                  value={taxForm.lot_selection_method}
                  onChange={e => setTaxForm(f => f ? { ...f, lot_selection_method: e.target.value as TaxSettings['lot_selection_method'] } : f)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                >
                  <option value="fifo">FIFO — oldest lots first</option>
                  <option value="lifo">LIFO — newest lots first (lowest cap gains for rising stock)</option>
                  <option value="same_tranche">Same tranche — sell shares from the matching grant only</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">LT Holding Threshold (days)</span>
                <input
                  type="number"
                  value={taxForm.lt_holding_days}
                  onChange={e => setTaxForm(f => f ? { ...f, lt_holding_days: +e.target.value } : f)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
              </label>
              <label className="block col-span-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxForm.prefer_stock_dp}
                  onChange={e => setTaxForm(f => f ? { ...f, prefer_stock_dp: e.target.checked } : f)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  Prefer stock for down payment — auto-calculate DP shares on new purchases
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Min DP % of purchase</span>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={+(taxForm.dp_min_percent * 100).toFixed(2)}
                  onChange={e => setTaxForm(f => f ? { ...f, dp_min_percent: +e.target.value / 100 } : f)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Min DP cap ($)</span>
                <input
                  type="number" step="1000" min="0"
                  value={taxForm.dp_min_cap}
                  onChange={e => setTaxForm(f => f ? { ...f, dp_min_cap: +e.target.value } : f)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setTaxSaving(true)
                  try {
                    const updated = await api.updateTaxSettings(taxForm)
                    setTaxSettings(updated)
                    setEditingTax(false)
                  } catch { /* ignore */ } finally { setTaxSaving(false) }
                }}
                disabled={taxSaving}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {taxSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setTaxForm({ ...WI_DEFAULTS }) }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Reset to WI Defaults
              </button>
              <button
                onClick={() => setEditingTax(false)}
                className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
