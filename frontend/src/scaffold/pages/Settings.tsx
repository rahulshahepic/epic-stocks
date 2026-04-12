import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { useTheme } from '../contexts/ThemeContext.tsx'
import { api } from '../../api.ts'
import type { TaxSettings, HorizonSettings, InvitationEntry, ReceivedInvitation } from '../../api.ts'
import type { Theme } from '../contexts/ThemeContext.tsx'

export default function Settings() {
  const config = useConfig()
  const { subscribed, loading, supported, subscribe, unsubscribe } = usePush(config?.vapid_public_key ?? '')
  const { logout } = useAuth()
  const { theme, setTheme } = useTheme()

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [advanceDays, setAdvanceDays] = useState(0)
  const [advanceDaysLoading, setAdvanceDaysLoading] = useState(false)
  const [pushTestLoading, setPushTestLoading] = useState(false)
  const [pushTestResult, setPushTestResult] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null)
  const [editingTax, setEditingTax] = useState(false)
  const [editingDp, setEditingDp] = useState(false)
  const [taxForm, setTaxForm] = useState<TaxSettings | null>(null)
  const [taxSaving, setTaxSaving] = useState(false)

  const [horizonSettings, setHorizonSettings] = useState<HorizonSettings | null>(null)
  const [editingHorizon, setEditingHorizon] = useState(false)
  const [horizonForm, setHorizonForm] = useState<HorizonSettings>({ horizon_date: null })
  const [horizonSaving, setHorizonSaving] = useState(false)

  const WI_DEFAULTS: TaxSettings = {
    federal_income_rate: 0.37,
    federal_lt_cg_rate: 0.20,
    federal_st_cg_rate: 0.37,
    niit_rate: 0.038,
    state_income_rate: 0.0765,
    state_lt_cg_rate: 0.0536,
    state_st_cg_rate: 0.0765,
    lt_holding_days: 365,
    lot_selection_method: 'epic_lifo',
    loan_payoff_method: 'epic_lifo',
    flexible_payoff_enabled: false,
    prefer_stock_dp: false,
    dp_min_percent: 0.10,
    dp_min_cap: 20000,
    deduct_investment_interest: false,
    deduction_excluded_years: null,
    taxable_years: [],
  }

  const loadTaxSettings = useCallback(async () => {
    try {
      const ts = await api.getTaxSettings()
      setTaxSettings(ts)
    } catch { /* ignore */ }
  }, [])

  const loadHorizonSettings = useCallback(async () => {
    try {
      const hs = await api.getHorizonSettings()
      setHorizonSettings(hs)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadTaxSettings() }, [loadTaxSettings])
  useEffect(() => { loadHorizonSettings() }, [loadHorizonSettings])

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
      <h2 className="text-lg font-semibold text-stone-900 dark:text-slate-100">Settings</h2>

      {/* Display Settings */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Display</h3>
        <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
          Choose your preferred color scheme.
        </p>
        <div className="mt-3 inline-flex rounded-md border border-stone-200 dark:border-slate-700 overflow-hidden">
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              aria-label={`${label} theme`}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                theme === value
                  ? 'bg-rose-700 text-white'
                  : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Notifications */}
      {(!!config?.vapid_public_key || supported || config?.email_notifications_available) && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Notifications</h3>
          <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
            Get notified when you have vesting, exercise, or loan repayment events.
          </p>

          <div className="mt-3 space-y-3">
            {/* Push */}
            {!supported && config?.vapid_public_key ? (
              <p className="text-xs text-stone-600 dark:text-slate-400">
                Push notifications are not supported in this browser.
              </p>
            ) : supported && !config?.vapid_public_key ? (
              <p className="text-xs text-stone-600 dark:text-slate-400">
                Push notifications are not configured on this server.
              </p>
            ) : supported && config?.vapid_public_key ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-700 dark:text-slate-300">Push notifications</span>
                <div className="flex items-center gap-2">
                  {subscribed && (
                    <span className="text-xs text-green-700 dark:text-green-300">Enabled</span>
                  )}
                  <button
                    onClick={subscribed ? unsubscribe : subscribe}
                    disabled={loading}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                      subscribed ? 'bg-gray-500 hover:bg-gray-600' : 'bg-rose-700 hover:bg-rose-800'
                    }`}
                  >
                    {loading ? 'Loading...' : subscribed ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Email */}
            {config?.email_notifications_available && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-700 dark:text-slate-300">Email notifications</span>
                <div className="flex items-center gap-2">
                  {emailEnabled && (
                    <span className="text-xs text-green-700 dark:text-green-300">Enabled</span>
                  )}
                  <button
                    onClick={toggleEmail}
                    disabled={emailLoading}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                      emailEnabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-rose-700 hover:bg-rose-800'
                    }`}
                  >
                    {emailLoading ? 'Loading...' : emailEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            )}

            {/* Advance timing — shown when any notification is active */}
            {(subscribed || emailEnabled) && (
              <div className="flex items-center justify-between border-t border-stone-100 pt-3 dark:border-slate-800">
                <div>
                  <span className="text-xs text-stone-700 dark:text-slate-300">Notify me</span>
                  <p className="text-[11px] text-stone-600 dark:text-slate-400">When to send the notification</p>
                </div>
                <select
                  aria-label="Notification timing"
                  value={advanceDays}
                  disabled={advanceDaysLoading}
                  onChange={e => changeAdvanceDays(Number(e.target.value))}
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value={0}>Day of event</option>
                  <option value={7}>1 week before</option>
                  <option value={3}>3 days before</option>
                </select>
              </div>
            )}

            {/* Test push button */}
            {subscribed && (
              <div className="flex items-center justify-between border-t border-stone-100 pt-3 dark:border-slate-800">
                <div>
                  <span className="text-xs text-stone-700 dark:text-slate-300">Test push</span>
                  <p className="text-[11px] text-stone-600 dark:text-slate-400">Confirm notifications are working</p>
                </div>
                <button
                  onClick={sendTestPush}
                  disabled={pushTestLoading}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {pushTestLoading ? 'Sending...' : 'Send test'}
                </button>
              </div>
            )}

            <p aria-live="polite" className="text-xs text-stone-600 dark:text-slate-400">{pushTestResult ?? ''}</p>
          </div>
        </section>
      )}

      {/* Down Payment Settings */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Down Payment</h3>
          {!editingDp && (
            <button
              onClick={() => { setTaxForm(taxSettings ? { ...taxSettings } : { ...WI_DEFAULTS }); setEditingDp(true) }}
              className="text-xs text-rose-700 hover:text-rose-800 dark:text-rose-400"
            >Edit</button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
          Controls how down payment shares are calculated when adding a new purchase.
        </p>

        {taxSettings && !editingDp && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between col-span-2">
              <dt className="text-stone-600 dark:text-slate-400">Prefer stock for DP</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">
                {taxSettings.prefer_stock_dp ? 'Yes — auto-calculate DP shares' : 'No — manual'}
              </dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-stone-600 dark:text-slate-400">Min DP rule</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">
                {taxSettings.dp_min_percent > 0 || taxSettings.dp_min_cap > 0
                  ? `min(${(taxSettings.dp_min_percent * 100).toFixed(0)}%, $${taxSettings.dp_min_cap.toLocaleString()})`
                  : 'None'}
              </dd>
            </div>
          </dl>
        )}

        {editingDp && taxForm && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxForm.prefer_stock_dp}
                  onChange={e => setTaxForm(f => f ? { ...f, prefer_stock_dp: e.target.checked } : f)}
                  className="rounded border-gray-300 dark:border-slate-600"
                />
                <span className="text-xs text-stone-700 dark:text-slate-300">
                  Prefer stock for down payment — auto-calculate DP shares on new purchases
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-stone-600 dark:text-slate-400">Min DP % of purchase</span>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={+(taxForm.dp_min_percent * 100).toFixed(2)}
                  onChange={e => setTaxForm(f => f ? { ...f, dp_min_percent: +e.target.value / 100 } : f)}
                  className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </label>
              <label className="block">
                <span className="text-xs text-stone-600 dark:text-slate-400">Min DP cap ($)</span>
                <input
                  type="number" step="1000" min="0"
                  value={taxForm.dp_min_cap}
                  onChange={e => setTaxForm(f => f ? { ...f, dp_min_cap: +e.target.value } : f)}
                  className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
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
                    setEditingDp(false)
                  } catch { /* ignore */ } finally { setTaxSaving(false) }
                }}
                disabled={taxSaving}
                className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {taxSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditingDp(false)}
                className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:text-stone-700 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Tax Rates */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Tax Rates</h3>
          {!editingTax && (
            <button
              onClick={() => { setTaxForm(taxSettings ? { ...taxSettings } : { ...WI_DEFAULTS }); setEditingTax(true) }}
              className="text-xs text-rose-700 hover:text-rose-800 dark:text-rose-400"
            >Edit</button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
          Wisconsin defaults. Used to estimate tax on share sales. 30% exclusion on qualifying LT gains is baked into state LT rate.
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
                <dt className="text-stone-600 dark:text-slate-400">{label}</dt>
                <dd className="font-medium text-stone-700 dark:text-slate-300">{((val as number) * 100).toFixed(2)}%</dd>
              </div>
            ))}
            <div className="flex justify-between">
              <dt className="text-stone-600 dark:text-slate-400">LT Threshold</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">{taxSettings.lt_holding_days}d</dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-stone-600 dark:text-slate-400">Manual sale lots</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">
                {taxSettings.lot_selection_method === 'fifo' ? 'FIFO (oldest first)' :
                 taxSettings.lot_selection_method === 'lifo' ? 'LIFO (newest first)' :
                 taxSettings.lot_selection_method === 'manual_tranche' ? 'Manual (pick lots)' :
                 'Epic LIFO (prefer LT gains)'}
              </dd>
            </div>
            {taxSettings.flexible_payoff_enabled && (
              <div className="flex justify-between col-span-2">
                <dt className="text-stone-600 dark:text-slate-400">Loan payoff lots</dt>
                <dd className="font-medium text-stone-700 dark:text-slate-300">
                  {taxSettings.loan_payoff_method === 'fifo' ? 'FIFO (oldest first)' :
                   taxSettings.loan_payoff_method === 'lifo' ? 'LIFO (newest first)' :
                   taxSettings.loan_payoff_method === 'same_tranche' ? 'Same Tranche' :
                   'Epic LIFO (prefer LT gains)'}
                </dd>
              </div>
            )}
            <div className="flex justify-between col-span-2 border-t border-stone-100 pt-2 dark:border-slate-800">
              <dt className="text-stone-600 dark:text-slate-400">Investment interest deduction</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">
                {taxSettings.deduct_investment_interest
                  ? (taxSettings.deduction_excluded_years?.length
                    ? `Enabled (excl. ${taxSettings.deduction_excluded_years.sort((a, b) => a - b).join(', ')})`
                    : 'Enabled (all years)')
                  : 'Disabled'}
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
                  <span className="text-xs text-stone-600 dark:text-slate-400">{label}</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={taxForm[key] as number}
                    onChange={e => setTaxForm(f => f ? { ...f, [key]: +e.target.value } : f)}
                    className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  />
                </label>
              ))}
              <label className="block col-span-2">
                <span className="text-xs text-stone-600 dark:text-slate-400">Manual Sale Lot Method</span>
                <select
                  value={taxForm.lot_selection_method}
                  onChange={e => setTaxForm(f => f ? { ...f, lot_selection_method: e.target.value as TaxSettings['lot_selection_method'] } : f)}
                  className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="epic_lifo">Epic LIFO — LIFO, prefer long-term gains (default)</option>
                  <option value="fifo">FIFO — oldest lots first</option>
                  <option value="lifo">LIFO — newest lots first</option>
                  <option value="manual_tranche">Manual — pick lots yourself</option>
                </select>
                <p className="mt-1 text-[11px] text-stone-600 dark:text-slate-400">
                  Applies to manual sales only.{taxSettings?.flexible_payoff_enabled ? ' See Loan Payoff Lot Method below for payoff sales.' : ' Loan payoff sales use same-tranche selection by default.'}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                  The IRS may require a consistent lot selection method election at the time of sale. Consult a tax advisor before changing this.
                </p>
              </label>
              {taxSettings?.flexible_payoff_enabled && (
                <label className="block col-span-2">
                  <span className="text-xs text-stone-600 dark:text-slate-400">Loan Payoff Lot Method</span>
                  <select
                    value={taxForm.loan_payoff_method}
                    onChange={e => setTaxForm(f => f ? { ...f, loan_payoff_method: e.target.value as TaxSettings['loan_payoff_method'] } : f)}
                    className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="epic_lifo">Epic LIFO — LIFO, prefer long-term gains (default)</option>
                    <option value="lifo">LIFO — newest lots first</option>
                    <option value="fifo">FIFO — oldest lots first</option>
                    <option value="same_tranche">Same Tranche — shares from originating grant only</option>
                  </select>
                  <p className="mt-1 text-[11px] text-stone-600 dark:text-slate-400">
                    Applies to loan payoff sales when you have sufficient stock coverage (vested value + unvested cost basis ≥ loan balance). Falls back to same-tranche if coverage is insufficient.
                  </p>
                </label>
              )}
              <label className="block">
                <span className="text-xs text-stone-600 dark:text-slate-400">LT Holding Threshold (days)</span>
                <input
                  type="number"
                  value={taxForm.lt_holding_days}
                  onChange={e => setTaxForm(f => f ? { ...f, lt_holding_days: +e.target.value } : f)}
                  className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </label>
              <div className="col-span-2 rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taxForm.deduct_investment_interest}
                    onChange={e => setTaxForm(f => f ? { ...f, deduct_investment_interest: e.target.checked } : f)}
                    className="mt-0.5 rounded border-gray-300 dark:border-slate-600"
                  />
                  <div>
                    <span className="text-xs font-medium text-stone-700 dark:text-slate-300">
                      Estimate investment interest deduction (Form 4952)
                    </span>
                    <p className="mt-1 text-[11px] text-stone-600 dark:text-slate-400">
                      If you itemize deductions, your loan interest may be deductible against
                      capital gains. Only applies to years where you itemize — not years you take the
                      standard deduction. Consult a tax advisor; this is an estimate only.
                    </p>
                  </div>
                </label>
                {taxForm.deduct_investment_interest && taxSettings && taxSettings.taxable_years.length > 0 && (
                  <details className="mt-2 ml-6">
                    <summary className="cursor-pointer text-[11px] font-medium text-rose-700 dark:text-rose-400">
                      Customize by year
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {taxSettings.taxable_years.map(yr => {
                        const excluded = taxForm.deduction_excluded_years ?? []
                        const isIncluded = !excluded.includes(yr)
                        return (
                          <label key={yr} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={e => {
                                setTaxForm(f => {
                                  if (!f) return f
                                  const prev = f.deduction_excluded_years ?? []
                                  const next = e.target.checked
                                    ? prev.filter(y => y !== yr)
                                    : [...prev, yr].sort((a, b) => a - b)
                                  return { ...f, deduction_excluded_years: next.length ? next : null }
                                })
                              }}
                              className="rounded border-gray-300 dark:border-slate-600"
                            />
                            <span className="text-xs text-stone-700 dark:text-slate-300">{yr}</span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-stone-500 dark:text-slate-500">
                      Uncheck years where you took the standard deduction.
                    </p>
                  </details>
                )}
              </div>
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
                className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {taxSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setTaxForm({ ...WI_DEFAULTS }) }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Reset to WI Defaults
              </button>
              <button
                onClick={() => setEditingTax(false)}
                className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:text-stone-700 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Exit Planning */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Exit Planning</h3>
          {!editingHorizon && (
            <button
              onClick={() => { setHorizonForm({ horizon_date: horizonSettings?.horizon_date ?? null }); setEditingHorizon(true) }}
              className="text-xs text-rose-700 hover:text-rose-800 dark:text-rose-400"
            >Edit</button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
          Set an exit date to project a full liquidation in your timeline. Defaults to your last vesting date if not set.
        </p>

        {!editingHorizon && (
          <dl className="mt-3 text-xs">
            <div className="flex justify-between">
              <dt className="text-stone-600 dark:text-slate-400">Exit date</dt>
              <dd className="font-medium text-stone-700 dark:text-slate-300">
                {horizonSettings?.horizon_date ?? 'Last vesting date (auto)'}
              </dd>
            </div>
          </dl>
        )}

        {editingHorizon && (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs text-stone-600 dark:text-slate-400">Exit date</span>
              <input
                type="date"
                value={horizonForm.horizon_date ?? ''}
                onChange={e => setHorizonForm({ horizon_date: e.target.value || null })}
                className="mt-0.5 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setHorizonSaving(true)
                  try {
                    const updated = await api.updateHorizonSettings(horizonForm)
                    setHorizonSettings(updated)
                    setEditingHorizon(false)
                  } catch { /* ignore */ } finally { setHorizonSaving(false) }
                }}
                disabled={horizonSaving}
                className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {horizonSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={async () => {
                  setHorizonSaving(true)
                  try {
                    const updated = await api.updateHorizonSettings({ horizon_date: null })
                    setHorizonSettings(updated)
                    setHorizonForm({ horizon_date: null })
                    setEditingHorizon(false)
                  } catch { /* ignore */ } finally { setHorizonSaving(false) }
                }}
                disabled={horizonSaving}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Use last vesting date
              </button>
              <button
                onClick={() => setEditingHorizon(false)}
                className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:text-stone-700 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Sharing */}
      <SharingSection />

      {/* Account Management */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Account</h3>
        <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
          Signed in with Google. All your data is stored securely on the server.
        </p>
        <button
          onClick={logout}
          className="mt-3 rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
        >
          Sign Out
        </button>

        <div className="mt-4 border-t border-stone-200 pt-4 dark:border-slate-700">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">Danger Zone</p>

          {!config?.epic_mode && <div className="mt-3">
            <p className="text-xs text-stone-700 dark:text-slate-300">
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
                  className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:text-stone-700 dark:hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>}

          <div className="mt-4 border-t border-stone-100 pt-4 dark:border-slate-800">
            <p className="text-xs text-stone-700 dark:text-slate-300">
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
                  className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:text-stone-700 dark:hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {import.meta.env.VITE_COMMIT_SHA && import.meta.env.VITE_COMMIT_SHA !== 'dev' && (
        <p className="text-center text-xs text-stone-600 dark:text-slate-400">
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
      await api.sendInvite(inviteEmail.trim())
      setInviteEmail('')
      setSuccess('Invitation sent!')
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
      declined: 'bg-stone-100 text-stone-600 dark:bg-slate-700 dark:text-slate-400',
      revoked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    }
    return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[status] ?? ''}`}>{status}</span>
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-sm font-medium text-stone-900 dark:text-slate-100">Sharing</h3>
      <p className="mt-1 text-xs text-stone-600 dark:text-slate-400">
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
          className="flex-1 rounded border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        />
        <button
          type="submit"
          disabled={sending || !inviteEmail.trim()}
          className="rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Invite'}
        </button>
      </form>

      {/* Sent invitations */}
      {sent.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-stone-700 dark:text-slate-300">People I&rsquo;ve shared with</p>
          <div className="space-y-1.5">
            {sent.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded border border-stone-100 px-2 py-1.5 text-xs dark:border-slate-700">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-stone-800 dark:text-slate-200">{inv.invitee_email}</span>
                  {inv.invitee_account_email && inv.invitee_account_email !== inv.invitee_email && (
                    <span className="ml-1 text-stone-500 dark:text-slate-400">(signed in as {inv.invitee_account_email})</span>
                  )}
                  {inv.invitee_name && <span className="ml-1 text-stone-500 dark:text-slate-400">— {inv.invitee_name}</span>}
                  <div className="mt-0.5 flex items-center gap-2">
                    {statusBadge(inv.status)}
                    {inv.last_viewed_at && (
                      <span className="text-stone-400 dark:text-slate-500">
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
          <p className="mb-1 text-xs font-medium text-stone-700 dark:text-slate-300">Data shared with me</p>
          <div className="space-y-1.5">
            {received.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded border border-stone-100 px-2 py-1.5 text-xs dark:border-slate-700">
                <div>
                  <span className="font-medium text-stone-800 dark:text-slate-200">{inv.inviter_name ?? inv.inviter_email}</span>
                  {inv.inviter_name && <span className="ml-1 text-stone-500 dark:text-slate-400">({inv.inviter_email})</span>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <label className="flex items-center gap-1 text-stone-500 dark:text-slate-400">
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
          className="flex-1 rounded border border-stone-300 bg-white px-2 py-1.5 text-xs uppercase tracking-wider dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          maxLength={9}
        />
        <button
          type="submit"
          disabled={accepting || !inviteCode.trim()}
          className="rounded bg-stone-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-slate-600 dark:hover:bg-slate-500"
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
      </form>
    </section>
  )
}
