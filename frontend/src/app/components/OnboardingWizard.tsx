import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api.ts'
import type { TaxSettings } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { TaxRateFields, ratesFromDefaults, DEFAULT_RATES } from '../pages/Sales.tsx'
import type { TaxRates } from '../pages/Sales.tsx'

type Step = 'welcome' | 'grant' | 'price' | 'tax' | 'done'
type GrantType = 'Purchase' | 'Bonus'

const MANUAL_STEPS: Step[] = ['grant', 'price', 'tax', 'done']

function stepNumber(step: Step): number {
  return MANUAL_STEPS.indexOf(step) + 1
}

function StepIndicator({ step }: { step: Step }) {
  if (step === 'welcome') return null
  const current = stepNumber(step)
  const total = MANUAL_STEPS.length
  const labels = ['Add grant', 'Add price', 'Tax rates', 'Done']
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {MANUAL_STEPS.map((s, i) => {
        const num = i + 1
        const done = num < current
        const active = num === current
        return (
          <div key={s} className="flex items-center gap-1.5">
            {i > 0 && <div className={`h-px w-4 shrink-0 ${done ? 'bg-indigo-400' : 'bg-gray-200 dark:bg-gray-700'}`} />}
            <div className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              done
                ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400'
                : active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}>
              <span>{num}</span>
              <span className="hidden sm:inline">{labels[i]}</span>
            </div>
          </div>
        )
      })}
      <span className="ml-auto shrink-0 text-[11px] text-gray-400">Step {current} of {total}</span>
    </div>
  )
}

function Field({
  label, type = 'text', value, onChange, step, min,
}: {
  label: string; type?: string; value: string | number; onChange: (v: string) => void
  step?: string; min?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type={type}
        step={step}
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      />
    </label>
  )
}

export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate()
  const fetchTaxSettings = useCallback(() => api.getTaxSettings(), [])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)

  const [step, setStep] = useState<Step>('welcome')
  const [grantType, setGrantType] = useState<GrantType>('Purchase')
  const [grantForm, setGrantForm] = useState({
    year: new Date().getFullYear(),
    shares: 0,
    price: 0,
    vest_start: '',
    periods: 4,
    exercise_date: '',
  })
  const [priceForm, setPriceForm] = useState({ effective_date: '', price: 0 })
  const [taxRates, setTaxRates] = useState<TaxRates>(DEFAULT_RATES)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Sync tax rates when defaults load
  const [taxSynced, setTaxSynced] = useState(false)
  if (taxSettings && !taxSynced) {
    setTaxRates(ratesFromDefaults(taxSettings))
    setTaxSynced(true)
  }

  async function saveGrant() {
    setSaving(true)
    setError('')
    try {
      if (grantType === 'Purchase') {
        await api.newPurchase({
          year: grantForm.year,
          shares: grantForm.shares,
          price: grantForm.price,
          vest_start: grantForm.vest_start,
          periods: grantForm.periods,
          exercise_date: grantForm.exercise_date,
        })
      } else {
        await api.addBonus({
          year: grantForm.year,
          shares: grantForm.shares,
          price: grantForm.price || undefined,
          vest_start: grantForm.vest_start,
          periods: grantForm.periods,
          exercise_date: grantForm.exercise_date,
        })
      }
      setStep('price')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save grant')
    } finally {
      setSaving(false)
    }
  }

  async function savePrice() {
    setSaving(true)
    setError('')
    try {
      await api.annualPrice({ effective_date: priceForm.effective_date, price: priceForm.price })
      setStep('tax')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save price')
    } finally {
      setSaving(false)
    }
  }

  async function saveTax() {
    setSaving(true)
    setError('')
    try {
      await api.updateTaxSettings(taxRates)
      setStep('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save tax rates')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <StepIndicator step={step} />

      {step === 'welcome' && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-6 dark:border-indigo-800 dark:bg-indigo-950/40">
          <h2 className="text-base font-semibold text-indigo-900 dark:text-indigo-200">
            Let's set up your equity tracker.
          </h2>
          <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-300">
            How would you like to get started?
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => navigate('/import')}
              className="flex flex-col rounded-lg border-2 border-indigo-400 bg-white p-4 text-left hover:border-indigo-600 hover:shadow-md dark:border-indigo-500 dark:bg-gray-900 dark:hover:border-indigo-400"
            >
              <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Import Excel</span>
              <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Upload a spreadsheet with your grant and loan data.
              </span>
            </button>
            <button
              onClick={() => setStep('grant')}
              className="flex flex-col rounded-lg border-2 border-gray-200 bg-white p-4 text-left hover:border-indigo-400 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-500"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enter manually</span>
              <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Add your first grant and share price step by step.
              </span>
            </button>
          </div>
        </div>
      )}

      {step === 'grant' && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add your first grant</h2>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            {(['Purchase', 'Bonus'] as GrantType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setGrantType(t)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  grantType === t
                    ? t === 'Purchase' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year" type="number" value={grantForm.year} onChange={v => setGrantForm(f => ({ ...f, year: +v }))} />
            <Field label="Shares" type="number" value={grantForm.shares} onChange={v => setGrantForm(f => ({ ...f, shares: +v }))} />
            <Field
              label={grantType === 'Bonus' ? 'Cost Basis (optional)' : 'Cost Basis'}
              type="number" step="0.01"
              value={grantForm.price}
              onChange={v => setGrantForm(f => ({ ...f, price: +v }))}
            />
            <Field label="Vest Start" type="date" value={grantForm.vest_start} onChange={v => setGrantForm(f => ({ ...f, vest_start: v }))} />
            <Field label="Vest Periods" type="number" value={grantForm.periods} onChange={v => setGrantForm(f => ({ ...f, periods: +v }))} />
            <Field label="Exercise Date" type="date" value={grantForm.exercise_date} onChange={v => setGrantForm(f => ({ ...f, exercise_date: v }))} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveGrant}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {step === 'price' && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add share prices</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add at least one price so events can be computed. You can add more on the Prices page later.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Effective Date"
              type="date"
              value={priceForm.effective_date}
              onChange={v => setPriceForm(f => ({ ...f, effective_date: v }))}
            />
            <Field
              label="Price per Share"
              type="number"
              step="0.01"
              value={priceForm.price}
              onChange={v => setPriceForm(f => ({ ...f, price: +v }))}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={savePrice}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Next →'}
            </button>
            <button
              onClick={() => setStep('tax')}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {step === 'tax' && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Set tax rates</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Pre-filled with Wisconsin defaults. You can update these on the Settings page anytime.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <TaxRateFields
            rates={taxRates}
            onChange={setTaxRates}
            onReset={() => setTaxRates(ratesFromDefaults(taxSettings))}
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveTax}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Next →'}
            </button>
            <button
              onClick={() => setStep('done')}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/40">
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
            Your dashboard is ready
          </h2>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            You've added a grant
            {priceForm.effective_date ? ', a share price,' : ''}
            {' '}and configured your tax rates. Your events timeline is now computing.
          </p>
          <div className="mt-4 space-y-1 text-xs text-emerald-700 dark:text-emerald-400">
            <p>✓ {grantType} grant — {grantForm.year}, {grantForm.shares.toLocaleString()} shares</p>
            {priceForm.effective_date && (
              <p>✓ Share price — {priceForm.effective_date}: ${priceForm.price.toFixed(2)}</p>
            )}
            <p>✓ Tax rates saved</p>
          </div>
          <button
            onClick={onComplete}
            className="mt-5 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            View dashboard →
          </button>
        </div>
      )}
    </div>
  )
}
