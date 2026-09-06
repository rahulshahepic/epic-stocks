import { useState, useCallback, useEffect } from 'react'
import { api } from '../../api.ts'
import type { TaxSettings } from '../../api.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { FIELD_INPUT_CLASS } from '../../scaffold/components/ui/Field.tsx'
import { Card } from '../../scaffold/components/ui/Card.tsx'

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
  deduct_investment_interest: false,
  deduction_excluded_years: null,
  taxable_years: [],
}

export default function AppSettingsSections() {
  const config = useConfig()
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null)
  const [editingTax, setEditingTax] = useState(false)
  const [editingDp, setEditingDp] = useState(false)
  const [taxForm, setTaxForm] = useState<TaxSettings | null>(null)
  const [taxSaving, setTaxSaving] = useState(false)

  const loadTaxSettings = useCallback(async () => {
    try {
      const ts = await api.getTaxSettings()
      setTaxSettings(ts)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadTaxSettings() }, [loadTaxSettings])

  return (
    <>
      {/* Stock Down Payment Preference */}
      {!config?.epic_mode && (
        <Card as="section" pad="md">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-cs-text">Stock down payment</h3>
            {!editingDp && (
              <button
                onClick={() => { setTaxForm(taxSettings ? { ...taxSettings } : { ...WI_DEFAULTS }); setEditingDp(true) }}
                className="text-xs text-cs-brand hover:text-cs-brand-hover "
              >Edit</button>
            )}
          </div>
          <p className="mt-1 text-xs text-cs-text-2">
            Whether to auto-calculate the minimum stock exchange on new purchases.
          </p>

          {taxSettings && !editingDp && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between col-span-2">
                <dt className="text-cs-text-2">Prefer stock for DP</dt>
                <dd className="font-medium text-cs-text-2">
                  {taxSettings.prefer_stock_dp ? 'Yes — auto-calculate DP shares' : 'No — manual'}
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
                    className="rounded border-cs-border-strong"
                  />
                  <span className="text-xs text-cs-text-2">
                    Prefer stock for down payment — auto-calculate DP shares on new purchases
                  </span>
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
                  className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
                >
                  {taxSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingDp(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-cs-text-2 hover:text-cs-text-2 "
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tax Rates */}
      <Card as="section" pad="md">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-cs-text">Tax Rates</h3>
          {!editingTax && (
            <button
              onClick={() => { setTaxForm(taxSettings ? { ...taxSettings } : { ...WI_DEFAULTS }); setEditingTax(true) }}
              className="text-xs text-cs-brand hover:text-cs-brand-hover "
            >Edit</button>
          )}
        </div>
        <p className="mt-1 text-xs text-cs-text-2">
          Wisconsin defaults. Used to estimate tax on share sales. 30% exclusion on qualifying long-term gains is baked into the state long-term rate.
        </p>

        {taxSettings && !editingTax && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[
              ['Federal income', taxSettings.federal_income_rate],
              ['Federal long-term capital gains', taxSettings.federal_lt_cg_rate],
              ['Federal short-term capital gains', taxSettings.federal_st_cg_rate],
              ['Net investment income tax', taxSettings.niit_rate],
              ['State income', taxSettings.state_income_rate],
              ['State long-term capital gains', taxSettings.state_lt_cg_rate],
              ['State short-term capital gains', taxSettings.state_st_cg_rate],
            ].map(([label, val]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-cs-text-2">{label}</dt>
                <dd className="font-medium text-cs-text-2">{((val as number) * 100).toFixed(2)}%</dd>
              </div>
            ))}
            <div className="flex justify-between">
              <dt className="text-cs-text-2">Long-term threshold</dt>
              <dd className="font-medium text-cs-text-2">{taxSettings.lt_holding_days}d</dd>
            </div>
            <div className="flex justify-between col-span-2">
              <dt className="text-cs-text-2">Manual sale lots</dt>
              <dd className="font-medium text-cs-text-2">
                {taxSettings.lot_selection_method === 'fifo' ? 'FIFO (oldest first)' :
                  taxSettings.lot_selection_method === 'lifo' ? 'LIFO (newest first)' :
                    taxSettings.lot_selection_method === 'manual_tranche' ? 'Manual (pick lots)' :
                      'Epic LIFO (prefer long-term gains)'}
              </dd>
            </div>
            {taxSettings.flexible_payoff_enabled && (
              <div className="flex justify-between col-span-2">
                <dt className="text-cs-text-2">Loan payoff lots</dt>
                <dd className="font-medium text-cs-text-2">
                  {taxSettings.loan_payoff_method === 'fifo' ? 'FIFO (oldest first)' :
                    taxSettings.loan_payoff_method === 'lifo' ? 'LIFO (newest first)' :
                      taxSettings.loan_payoff_method === 'same_tranche' ? 'Same Tranche' :
                        'Epic LIFO (prefer long-term gains)'}
                </dd>
              </div>
            )}
            <div className="flex justify-between col-span-2 border-t border-cs-border pt-2 ">
              <dt className="text-cs-text-2">Investment interest deduction</dt>
              <dd className="font-medium text-cs-text-2">
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
                ['Federal income rate', 'federal_income_rate'],
                ['Federal long-term capital gains rate', 'federal_lt_cg_rate'],
                ['Federal short-term capital gains rate', 'federal_st_cg_rate'],
                ['Net investment income tax rate', 'niit_rate'],
                ['State income rate', 'state_income_rate'],
                ['State long-term capital gains rate', 'state_lt_cg_rate'],
                ['State short-term capital gains rate', 'state_st_cg_rate'],
              ] as [string, keyof TaxSettings][]).map(([label, key]) => (
                <label key={key} className="block">
                  <span className="text-xs text-cs-text-2">{label}</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={taxForm[key] as number}
                    onChange={e => setTaxForm(f => f ? { ...f, [key]: +e.target.value } : f)}
                    className={FIELD_INPUT_CLASS}
                  />
                </label>
              ))}
              <label className="block col-span-2">
                <span className="text-xs text-cs-text-2">Manual Sale Lot Method</span>
                <select
                  value={taxForm.lot_selection_method}
                  onChange={e => setTaxForm(f => f ? { ...f, lot_selection_method: e.target.value as TaxSettings['lot_selection_method'] } : f)}
                  className={FIELD_INPUT_CLASS}
                >
                  <option value="epic_lifo">Epic LIFO — LIFO, prefer long-term gains (default)</option>
                  <option value="fifo">FIFO — oldest lots first</option>
                  <option value="lifo">LIFO — newest lots first</option>
                  <option value="manual_tranche">Manual — pick lots yourself</option>
                </select>
                <p className="mt-1 text-[11px] text-cs-text-2">
                  Applies to manual sales only.{taxSettings?.flexible_payoff_enabled ? ' See Loan Payoff Lot Method below for payoff sales.' : ' Loan payoff sales use same-tranche selection by default.'}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                  The IRS may require a consistent lot selection method election at the time of sale. Consult a tax advisor before changing this.
                </p>
              </label>
              {taxSettings?.flexible_payoff_enabled && (
                <label className="block col-span-2">
                  <span className="text-xs text-cs-text-2">Loan Payoff Lot Method</span>
                  <select
                    value={taxForm.loan_payoff_method}
                    onChange={e => setTaxForm(f => f ? { ...f, loan_payoff_method: e.target.value as TaxSettings['loan_payoff_method'] } : f)}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="epic_lifo">Epic LIFO — LIFO, prefer long-term gains (default)</option>
                    <option value="lifo">LIFO — newest lots first</option>
                    <option value="fifo">FIFO — oldest lots first</option>
                    <option value="same_tranche">Same Tranche — shares from originating grant only</option>
                  </select>
                  <p className="mt-1 text-[11px] text-cs-text-2">
                    Applies to loan payoff sales when you have sufficient stock coverage (vested value + unvested cost basis ≥ loan balance). Falls back to same-tranche if coverage is insufficient.
                  </p>
                </label>
              )}
              <label className="block">
                <span className="text-xs text-cs-text-2">Long-term holding threshold (days)</span>
                <input
                  type="number"
                  value={taxForm.lt_holding_days}
                  onChange={e => setTaxForm(f => f ? { ...f, lt_holding_days: +e.target.value } : f)}
                  className={FIELD_INPUT_CLASS}
                />
              </label>
              <div className="col-span-2 rounded-md border border-cs-border p-3 ">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taxForm.deduct_investment_interest}
                    onChange={e => setTaxForm(f => f ? { ...f, deduct_investment_interest: e.target.checked } : f)}
                    className="mt-0.5 rounded border-cs-border-strong"
                  />
                  <div>
                    <span className="text-xs font-medium text-cs-text-2">
                      Estimate investment interest deduction (Form 4952)
                    </span>
                    <p className="mt-1 text-[11px] text-cs-text-2">
                      If you itemize deductions, your loan interest may be deductible against
                      capital gains. Only applies to years where you itemize — not years you take the
                      standard deduction. Consult a tax advisor; this is an estimate only.
                    </p>
                  </div>
                </label>
                {taxForm.deduct_investment_interest && taxSettings && taxSettings.taxable_years.length > 0 && (
                  <details className="mt-2 ml-6">
                    <summary className="cursor-pointer text-[11px] font-medium text-cs-brand">
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
                              className="rounded border-cs-border-strong"
                            />
                            <span className="text-xs text-cs-text-2">{yr}</span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-cs-muted ">
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
                className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
              >
                {taxSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setTaxForm({ ...WI_DEFAULTS }) }}
                className="rounded-md border border-cs-border-strong px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised bg-cs-surface "
              >
                Reset to WI Defaults
              </button>
              <button
                onClick={() => setEditingTax(false)}
                className="rounded-md px-3 py-1.5 text-xs text-cs-text-2 hover:text-cs-text-2 "
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
