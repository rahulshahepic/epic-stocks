import { useState, useCallback, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../../api.ts'
import type { TaxSettings } from '../../api.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { FIELD_INPUT_CLASS } from '../../scaffold/components/ui/Field.tsx'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import EquityTerms from './EquityTerms.tsx'

const WI_TAX_DEFAULTS = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
  lot_selection_method: 'epic_lifo',
  deduct_investment_interest: false,
  investment_interest_method: 'accrual',
  deduction_excluded_years: null,
  tax_withholding_rate: null,
} satisfies Partial<TaxSettings>

export default function AppSettingsSections() {
  const config = useConfig()
  const { hash } = useLocation()
  const sections = [
    { id: 'tax', label: 'Taxes' },
    { id: 'loans', label: 'Loans' },
    ...(!config?.epic_mode ? [{ id: 'stock-down-payment', label: 'Stock down payment' }] : []),
  ]
  const section = sections.find(({ id }) => hash === `#${id}`)?.id ?? 'tax'

  return (
    <>
      <h2 className="text-base font-semibold text-cs-text">Stock, Tax &amp; Loan Assumptions</h2>
      <nav aria-label="Stock, tax and loan settings" className="flex flex-wrap gap-2">
        {sections.map(({ id, label }) => (
          <Link key={id} to={`/settings#${id}`} aria-current={section === id ? 'location' : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border border-cs-border px-3 text-sm font-medium ${section === id ? 'bg-cs-brand-subtle text-cs-brand dark:text-rose-300' : 'bg-cs-surface text-cs-text hover:bg-cs-raised'}`}
          >{label}</Link>
        ))}
      </nav>
      <AssumptionsEditor key={section} section={section} />
    </>
  )
}

function AssumptionsEditor({ section }: { section: string }) {
  const isTax = section === 'tax'
  const isLoan = section === 'loans'
  const isDownPayment = section === 'stock-down-payment'
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null)
  const [editingTax, setEditingTax] = useState(false)
  const [editingDp, setEditingDp] = useState(false)
  const [taxForm, setTaxForm] = useState<TaxSettings | null>(null)
  const [taxSaving, setTaxSaving] = useState(false)
  const [confirmSettings, setConfirmSettings] = useState(false)
  const [taxError, setTaxError] = useState('')
  const [loadError, setLoadError] = useState(false)

  const loadTaxSettings = useCallback(async () => {
    setLoadError(false)
    try {
      const ts = await api.getTaxSettings()
      setTaxSettings(ts)
    } catch { setLoadError(true) }
  }, [])

  useEffect(() => { loadTaxSettings() }, [loadTaxSettings])
  if (!taxSettings) {
    return <Card as="section" pad="md">
      {loadError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-cs-text-2">
        <p>Could not load your assumptions.</p>
        <button type="button" onClick={() => void loadTaxSettings()} className="min-h-11 text-cs-brand dark:text-rose-300 underline">Try again</button>
      </div> : <p role="status" className="text-sm text-cs-text-2">Loading assumptions…</p>}
    </Card>
  }

  return (
    <>
      {/* Stock Down Payment Preference */}
      {isDownPayment && (
        <Card as="section" pad="md">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-cs-text">Stock down payment</h2>
            {!editingDp && (
              <button
                onClick={() => { setTaxForm({ ...taxSettings }); setTaxError(''); setEditingDp(true) }}
                className="min-h-11 rounded-md border border-cs-border px-3 text-sm font-medium text-cs-brand dark:text-rose-300 hover:bg-cs-raised"
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
              {taxError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{taxError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    setTaxSaving(true)
                    setTaxError('')
                    try {
                      const updated = await api.updateTaxSettings({ prefer_stock_dp: taxForm.prefer_stock_dp })
                      setTaxSettings(updated)
                      setEditingDp(false)
                    } catch { setTaxError('Could not save your down payment preference. Try again.') } finally { setTaxSaving(false) }
                  }}
                  disabled={taxSaving}
                  className="min-h-11 rounded-md bg-cs-brand px-3 text-sm font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
                >
                  {taxSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingDp(false)}
                  className="min-h-11 rounded-md px-3 text-sm text-cs-text-2 hover:bg-cs-raised"
                  disabled={taxSaving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tax Rates */}
      {!isDownPayment && <Card as="section" id={section} pad="md">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-cs-text">{isTax ? 'Taxes' : 'Loan assumptions'}</h2>
          {!editingTax && (
            <button
              onClick={() => { setTaxForm({ ...taxSettings }); setConfirmSettings(false); setTaxError(''); setEditingTax(true) }}
              className="min-h-11 rounded-md border border-cs-border px-3 text-sm font-medium text-cs-brand dark:text-rose-300 hover:bg-cs-raised"
            >Edit</button>
          )}
        </div>
        <p className="mt-1 text-sm text-cs-text-2">
          {isTax
            ? 'Set the rates used to estimate your taxes. The Wisconsin default for long-term gains includes the 30% exclusion.'
            : 'Set the rates and timing used to project loan balances and payoff sales. A planned payoff stays an estimate until you record it.'}
        </p>
        <div className="mt-3">
          <EquityTerms
            terms={isTax ? ['tax', 'short_term', 'long_term', 'lot_selection', 'form_4952', 'election_83b'] : ['lot_selection', 'capitalised_interest']}
            title="Understand these settings"
          />
        </div>

        {taxSettings && !editingTax && (
          <dl className="mt-3 space-y-2 text-xs [&>div]:gap-4 [&_dd]:max-w-[55%] [&_dd]:text-right">
            {isTax && <>
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
            </>}
            {isLoan && taxSettings.flexible_payoff_enabled && (
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
            {isTax && <>
              <div className="flex justify-between col-span-2 border-t border-cs-border pt-2 ">
                <dt className="text-cs-text-2">Investment interest deduction</dt>
                <dd className="font-medium text-cs-text-2">
                  {taxSettings.deduct_investment_interest
                    ? (taxSettings.deduction_excluded_years?.length
                      ? `Enabled (excl. ${[...taxSettings.deduction_excluded_years].sort((a, b) => a - b).join(', ')})`
                      : 'Enabled (all years)')
                    : 'Disabled'}
                </dd>
              </div>
              <div className="flex justify-between col-span-2">
                <dt className="text-cs-text-2">Investment interest method</dt>
                <dd className="font-medium text-cs-text-2">
                  {taxSettings.investment_interest_method === 'cash' ? 'Cash' : 'Accrual'}
                </dd>
              </div>
              <div className="flex justify-between col-span-2 border-t border-cs-border pt-2 ">
                <dt className="text-cs-text-2">Withholding on zero-basis vests</dt>
                <dd className="font-medium text-cs-text-2">{((taxSettings.tax_withholding_rate ?? 0.52) * 100).toFixed(2)}%</dd>
              </div>
            </>}
            {isLoan && <>
              <div className="flex justify-between col-span-2">
                <dt className="text-cs-text-2">Future interest-loan rate</dt>
                <dd className="font-medium text-cs-text-2">
                  {(() => {
                    const r = taxSettings.projected_loan_rate ?? taxSettings.default_projected_loan_rate
                    return r == null ? '—' : `${(r * 100).toFixed(2)}%${taxSettings.projected_loan_rate == null ? ' (latest on record)' : ''}`
                  })()}
                </dd>
              </div>
              <div className="flex justify-between col-span-2">
                <dt className="text-cs-text-2">Loan payoff after exit</dt>
                <dd className="font-medium text-cs-text-2">{taxSettings.exit_payoff_lag_days ?? 0}d</dd>
              </div>
            </>}
          </dl>
        )}

        {editingTax && taxForm && (
          <div className="mt-3 space-y-3" onChangeCapture={() => setConfirmSettings(false)}>
            <div className="grid grid-cols-2 gap-3 [&>label]:min-w-0">
              {isTax && <>
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
                    <span className="text-xs text-cs-text-2">{label} (%)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={+((taxForm[key] as number) * 100).toFixed(6)}
                      onChange={e => setTaxForm(f => f ? { ...f, [key]: +e.target.value / 100 } : f)}
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
                    <option value="epic_lifo">Epic LIFO — prefer long-term gains (recommended default)</option>
                    <option value="fifo">FIFO — oldest lots first</option>
                    <option value="lifo">LIFO — newest lots first</option>
                    <option value="manual_tranche">Manual — pick lots yourself</option>
                  </select>
                  <p className="mt-1 text-[11px] text-cs-text-2">Recommended starting choice: Epic LIFO selects newer lots while preferring long-term gains. FIFO sells the oldest lots, LIFO the newest regardless of holding period, and Manual lets you choose each lot. Match the method your actual sale will use.</p>
                  <p className="mt-1 text-[11px] text-cs-text-2">
                    Applies to manual sales only.{taxSettings?.flexible_payoff_enabled ? ' See Loans for the payoff lot method.' : ' Loan payoff sales use same-tranche selection by default.'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    The IRS may require a consistent lot selection method election at the time of sale. Consult a tax advisor before changing this.
                  </p>
                </label>
              </>}
              {isLoan && taxSettings.flexible_payoff_enabled && (
                <label className="block col-span-2">
                  <span className="text-xs text-cs-text-2">Loan Payoff Lot Method</span>
                  <select
                    value={taxForm.loan_payoff_method}
                    onChange={e => setTaxForm(f => f ? { ...f, loan_payoff_method: e.target.value as TaxSettings['loan_payoff_method'] } : f)}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="epic_lifo">Epic LIFO — prefer long-term gains (recommended default)</option>
                    <option value="lifo">LIFO — newest lots first</option>
                    <option value="fifo">FIFO — oldest lots first</option>
                    <option value="same_tranche">Same Tranche — shares from originating grant only</option>
                  </select>
                  <p className="mt-1 text-[11px] text-cs-text-2">Recommended starting choice when flexible repayment is enabled: Epic LIFO. Same Tranche restricts sales to the loan’s grant; FIFO and LIFO choose the oldest or newest lots. This changes the planned sale, never an actual repayment.</p>
                  <p className="mt-1 text-[11px] text-cs-text-2">
                    Applies to loan payoff sales when you have sufficient stock coverage (vested value + unvested cost basis ≥ loan balance). Falls back to same-tranche if coverage is insufficient.
                  </p>
                </label>
              )}
              {isTax && <>
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
                        Recommended starting choice: leave this off until you have checked your eligibility.{' '}
                        If you itemize deductions, your loan interest may be deductible against
                        capital gains. Only applies to years where you itemize — not years you take the
                        standard deduction. Consult a tax advisor; this is an estimate only.
                      </p>
                    </div>
                  </label>
                  <label className="mt-3 block">
                    <span className="text-xs text-cs-text-2">Investment interest method</span>
                    <select
                      value={taxForm.investment_interest_method ?? 'accrual'}
                      onChange={e => {
                        const method = e.target.value === 'cash' ? 'cash' : 'accrual'
                        setTaxForm(f => f ? { ...f, investment_interest_method: method } : f)
                      }}
                      className={FIELD_INPUT_CLASS}
                      aria-describedby="investment-interest-method-help"
                    >
                      <option value="accrual">Accrual · as interest accrues</option>
                      <option value="cash">Cash · when interest is paid</option>
                    </select>
                  </label>
                  <p id="investment-interest-method-help" className="mt-1 text-[11px] text-cs-text-2">
                    For projections. Choose the method that matches your tax treatment.
                  </p>
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
                <label className="block">
                  <span className="text-xs text-cs-text-2">Tax withholding on zero-basis vests (%)</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="52"
                    value={taxForm.tax_withholding_rate == null ? '' : +(taxForm.tax_withholding_rate * 100).toFixed(4)}
                    onChange={e => setTaxForm(f => f ? { ...f, tax_withholding_rate: e.target.value === '' ? null : +e.target.value / 100 } : f)}
                    className={FIELD_INPUT_CLASS}
                  />
                </label>
              </>}
              {isLoan && <>
                <label className="block">
                  <span className="text-xs text-cs-text-2">Future interest-loan rate (%)</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={taxSettings?.default_projected_loan_rate != null ? (taxSettings.default_projected_loan_rate * 100).toFixed(2) : ''}
                    value={taxForm.projected_loan_rate == null ? '' : +(taxForm.projected_loan_rate * 100).toFixed(4)}
                    onChange={e => setTaxForm(f => f ? { ...f, projected_loan_rate: e.target.value === '' ? null : +e.target.value / 100 } : f)}
                    className={FIELD_INPUT_CLASS}
                  />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs text-cs-text-2">Loan payoff after exit (days)</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={taxForm.exit_payoff_lag_days ?? 0}
                    onChange={e => setTaxForm(f => f ? { ...f, exit_payoff_lag_days: +e.target.value } : f)}
                    className={FIELD_INPUT_CLASS}
                  />
                  <p className="mt-1 text-[11px] text-cs-text-2">
                    Interest keeps accruing until the loans are settled after you leave.
                  </p>
                </label>
              </>}
            </div>
            {confirmSettings && <p role="status" className="rounded-lg border border-amber-400 p-3 text-sm text-cs-text-2">
              {isTax ? 'Review these changes before saving. They update the app’s tax and investment interest estimates.' : 'Review these changes before saving. They update projected loan balances and planned payoff sales.'}
            </p>}
            {taxError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{taxError}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  const changes = Object.fromEntries(Object.entries(taxForm).filter(([key, value]) =>
                    JSON.stringify(value) !== JSON.stringify(taxSettings[key as keyof TaxSettings])))
                  if (Object.keys(changes).length === 0) { setEditingTax(false); return }
                  if (!confirmSettings) { setConfirmSettings(true); return }
                  setTaxSaving(true)
                  setTaxError('')
                  try {
                    const updated = await api.updateTaxSettings(changes)
                    setTaxSettings(updated)
                    setEditingTax(false)
                    setConfirmSettings(false)
                  } catch (error) { setTaxError(error instanceof Error ? error.message : 'Could not save these assumptions.') } finally { setTaxSaving(false) }
                }}
                disabled={taxSaving}
                className="min-h-11 rounded-md bg-cs-brand px-3 text-sm font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
              >
                {taxSaving ? 'Saving...' : confirmSettings ? 'Confirm and save assumptions' : 'Save'}
              </button>
              {isTax && <button
                onClick={() => {
                  setTaxForm({ ...taxSettings, ...WI_TAX_DEFAULTS })
                  setConfirmSettings(false)
                }}
                disabled={taxSaving}
                className="min-h-11 rounded-md border border-cs-border-strong bg-cs-surface px-3 text-sm font-medium text-cs-text-2 hover:bg-cs-raised"
              >
                Reset tax defaults
              </button>}
              <button
                onClick={() => { setEditingTax(false); setConfirmSettings(false) }}
                className="min-h-11 rounded-md px-3 text-sm text-cs-text-2 hover:bg-cs-raised"
                disabled={taxSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>}
    </>
  )
}
