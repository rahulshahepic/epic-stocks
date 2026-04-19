import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../../api.ts'
import type {
  ContentBlob,
  GrantTypeDef,
  BonusScheduleVariant,
  GrantProgramSettings,
  GrantTemplateCreate,
  LoanRateCreate,
  LoanRefinanceCreate,
} from '../../api.ts'
import { useMe } from '../../scaffold/hooks/useMe.ts'
import { resetContentCache } from '../hooks/useContent.ts'

type Tab = 'templates' | 'types' | 'variants' | 'rates' | 'refinances' | 'settings'

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-rose-700 text-white dark:bg-rose-600'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        (props.className ?? '') +
        ' rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
      }
    />
  )
}

export default function Content() {
  const me = useMe()
  const [tab, setTab] = useState<Tab>('templates')
  const [blob, setBlob] = useState<ContentBlob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const reload = async () => {
    setError('')
    try {
      resetContentCache()
      const data = await api.getContent()
      setBlob(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content')
    }
  }

  useEffect(() => { reload() }, [])

  if (!me) return null
  if (!(me.is_admin || me.is_content_admin)) {
    return <Navigate to="/" replace />
  }
  if (!blob) {
    return <p className="text-xs text-stone-600 dark:text-slate-400">Loading content…</p>
  }

  async function wrap(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(successMsg)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Grant-program content</h2>
        <p className="text-xs text-stone-600 dark:text-slate-400">
          Edits here take effect immediately for all users on their next wizard load.
        </p>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-xs text-green-700 dark:text-green-400">{notice}</p>}

      <nav className="flex flex-wrap gap-1 border-b border-stone-200 pb-2 dark:border-slate-700">
        <TabButton active={tab === 'templates'} label="Grant Templates" onClick={() => setTab('templates')} />
        <TabButton active={tab === 'types'} label="Grant Types" onClick={() => setTab('types')} />
        <TabButton active={tab === 'variants'} label="Bonus Variants" onClick={() => setTab('variants')} />
        <TabButton active={tab === 'rates'} label="Loan Rates" onClick={() => setTab('rates')} />
        <TabButton active={tab === 'refinances'} label="Refinance Chains" onClick={() => setTab('refinances')} />
        <TabButton active={tab === 'settings'} label="Program Settings" onClick={() => setTab('settings')} />
      </nav>

      {tab === 'templates' && <TemplatesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'types' && <TypesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'variants' && <VariantsTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'rates' && <RatesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'refinances' && <RefinancesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'settings' && <SettingsTab blob={blob} wrap={wrap} busy={busy} />}
    </div>
  )
}

type WrapFn = (fn: () => Promise<unknown>, successMsg: string) => Promise<void>

// ── Grant Templates ──────────────────────────────────────────────────────

function TemplatesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [draft, setDraft] = useState<GrantTemplateCreate>({
    year: new Date().getFullYear() + 1,
    type: 'Purchase',
    vest_start: '',
    periods: 4,
    exercise_date: '',
    default_catch_up: false,
    show_dp_shares: false,
  })

  return (
    <section className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Year</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Vest start</th>
              <th className="px-2 py-1 text-left">Periods</th>
              <th className="px-2 py-1 text-left">Exercise date</th>
              <th className="px-2 py-1 text-left">Catch-up</th>
              <th className="px-2 py-1 text-left">DP shares</th>
            </tr>
          </thead>
          <tbody>
            {blob.grant_templates.map((t, i) => (
              <tr key={`${t.year}-${t.type}-${i}`} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1">{t.year}</td>
                <td className="px-2 py-1">{t.type}</td>
                <td className="px-2 py-1">{t.vest_start}</td>
                <td className="px-2 py-1">{t.periods}</td>
                <td className="px-2 py-1">{t.exercise_date}</td>
                <td className="px-2 py-1">{t.default_catch_up ? 'yes' : ''}</td>
                <td className="px-2 py-1">{t.show_dp_shares ? 'yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          wrap(() => api.createGrantTemplate(draft), 'Grant template added')
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-2 dark:border-slate-700"
      >
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Year</span>
          <TextInput type="number" value={draft.year} onChange={e => setDraft({ ...draft, year: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Type</span>
          <TextInput value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Vest start</span>
          <TextInput type="date" value={draft.vest_start} onChange={e => setDraft({ ...draft, vest_start: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Periods</span>
          <TextInput type="number" min={1} value={draft.periods} onChange={e => setDraft({ ...draft, periods: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Exercise date</span>
          <TextInput type="date" value={draft.exercise_date} onChange={e => setDraft({ ...draft, exercise_date: e.target.value })} required />
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={draft.default_catch_up ?? false} onChange={e => setDraft({ ...draft, default_catch_up: e.target.checked })} />
          Catch-up
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={draft.show_dp_shares ?? false} onChange={e => setDraft({ ...draft, show_dp_shares: e.target.checked })} />
          DP shares
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Add template
        </button>
      </form>
    </section>
  )
}

// ── Grant Types ──────────────────────────────────────────────────────────

function TypesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [draft, setDraft] = useState<GrantTypeDef>({
    name: '', color_class: 'bg-stone-700 text-white', description: '',
    is_pre_tax_when_zero_price: false, display_order: blob.grant_type_defs.length,
  })

  return (
    <section className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-left">Pre-tax when zero price?</th>
              <th className="px-2 py-1 text-left">Order</th>
              <th className="px-2 py-1 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {blob.grant_type_defs.map(d => (
              <tr key={d.name} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1"><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${d.color_class}`}>{d.name}</span></td>
                <td className="px-2 py-1">{d.description}</td>
                <td className="px-2 py-1">{d.is_pre_tax_when_zero_price ? 'yes' : ''}</td>
                <td className="px-2 py-1">{d.display_order}</td>
                <td className="px-2 py-1">
                  <button
                    onClick={() => wrap(() => api.deleteGrantTypeDef(d.name), 'Grant type removed')}
                    disabled={busy}
                    className="text-xs text-rose-700 underline hover:text-rose-800 disabled:opacity-50"
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          wrap(() => api.createGrantTypeDef(draft), 'Grant type added')
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-2 dark:border-slate-700"
      >
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Name</span>
          <TextInput value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Color class</span>
          <TextInput value={draft.color_class} onChange={e => setDraft({ ...draft, color_class: e.target.value })} required />
        </label>
        <label className="flex flex-col flex-1 min-w-[140px]">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Description</span>
          <TextInput value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} required />
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={draft.is_pre_tax_when_zero_price} onChange={e => setDraft({ ...draft, is_pre_tax_when_zero_price: e.target.checked })} />
          Pre-tax when zero price
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Add type
        </button>
      </form>
    </section>
  )
}

// ── Bonus Variants ───────────────────────────────────────────────────────

function VariantsTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [draft, setDraft] = useState<BonusScheduleVariant>({
    grant_year: new Date().getFullYear(),
    grant_type: 'Bonus',
    variant_code: '',
    periods: 3,
    label: '',
    is_default: false,
  })

  return (
    <section className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Year</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Code</th>
              <th className="px-2 py-1 text-left">Periods</th>
              <th className="px-2 py-1 text-left">Label</th>
              <th className="px-2 py-1 text-left">Default</th>
            </tr>
          </thead>
          <tbody>
            {blob.bonus_schedule_variants.map((v, i) => (
              <tr key={`${v.grant_year}-${v.grant_type}-${v.variant_code}-${i}`} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1">{v.grant_year}</td>
                <td className="px-2 py-1">{v.grant_type}</td>
                <td className="px-2 py-1">{v.variant_code}</td>
                <td className="px-2 py-1">{v.periods}</td>
                <td className="px-2 py-1">{v.label}</td>
                <td className="px-2 py-1">{v.is_default ? 'yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          wrap(() => api.createBonusVariant(draft), 'Bonus variant added')
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-2 dark:border-slate-700"
      >
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Year</span>
          <TextInput type="number" value={draft.grant_year} onChange={e => setDraft({ ...draft, grant_year: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Type</span>
          <TextInput value={draft.grant_type} onChange={e => setDraft({ ...draft, grant_type: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Code</span>
          <TextInput value={draft.variant_code} onChange={e => setDraft({ ...draft, variant_code: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Periods</span>
          <TextInput type="number" min={1} value={draft.periods} onChange={e => setDraft({ ...draft, periods: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Label</span>
          <TextInput value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={draft.is_default} onChange={e => setDraft({ ...draft, is_default: e.target.checked })} />
          Default
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Add variant
        </button>
      </form>
    </section>
  )
}

// ── Loan Rates (grouped by loan_kind) ────────────────────────────────────

function RatesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [kind, setKind] = useState<'interest' | 'tax' | 'purchase_original'>('interest')
  const [draft, setDraft] = useState<LoanRateCreate>({ loan_kind: 'interest', year: new Date().getFullYear(), rate: 0 })

  useEffect(() => {
    setDraft(d => ({ ...d, loan_kind: kind, grant_type: kind === 'tax' ? (d.grant_type ?? 'Bonus') : null, due_date: kind === 'purchase_original' ? (d.due_date ?? '') : null }))
  }, [kind])

  // Render a row for each kind.
  const interestRows = Object.entries(blob.loan_rates.interest)
    .map(([year, rate]) => ({ year, rate }))
    .sort((a, b) => Number(a.year) - Number(b.year))

  const taxRows = Object.entries(blob.loan_rates.tax).flatMap(([gt, byYear]) =>
    Object.entries(byYear).map(([year, rate]) => ({ grant_type: gt, year, rate }))
  ).sort((a, b) => a.grant_type.localeCompare(b.grant_type) || Number(a.year) - Number(b.year))

  const purchaseRows = Object.entries(blob.loan_rates.purchase_original)
    .map(([year, v]) => ({ year, rate: v.rate, due_date: v.due_date }))
    .sort((a, b) => Number(a.year) - Number(b.year))

  return (
    <section className="space-y-3">
      <div className="flex gap-1">
        <TabButton active={kind === 'interest'} label="Interest" onClick={() => setKind('interest')} />
        <TabButton active={kind === 'tax'} label="Tax" onClick={() => setKind('tax')} />
        <TabButton active={kind === 'purchase_original'} label="Purchase (original)" onClick={() => setKind('purchase_original')} />
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[400px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            {kind === 'interest' && <tr><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th></tr>}
            {kind === 'tax' && <tr><th className="px-2 py-1 text-left">Grant type</th><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th></tr>}
            {kind === 'purchase_original' && <tr><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th><th className="px-2 py-1 text-left">Due date</th></tr>}
          </thead>
          <tbody>
            {kind === 'interest' && interestRows.map(r => (
              <tr key={r.year} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1">{r.year}</td>
                <td className="px-2 py-1">{(r.rate * 100).toFixed(3)}%</td>
              </tr>
            ))}
            {kind === 'tax' && taxRows.map(r => (
              <tr key={`${r.grant_type}-${r.year}`} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1">{r.grant_type}</td>
                <td className="px-2 py-1">{r.year}</td>
                <td className="px-2 py-1">{(r.rate * 100).toFixed(3)}%</td>
              </tr>
            ))}
            {kind === 'purchase_original' && purchaseRows.map(r => (
              <tr key={r.year} className="border-t border-stone-100 dark:border-slate-700">
                <td className="px-2 py-1">{r.year}</td>
                <td className="px-2 py-1">{(r.rate * 100).toFixed(3)}%</td>
                <td className="px-2 py-1">{r.due_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          wrap(() => api.createLoanRate(draft), 'Loan rate added')
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-2 dark:border-slate-700"
      >
        {kind === 'tax' && (
          <label className="flex flex-col">
            <span className="text-[10px] text-stone-600 dark:text-slate-400">Grant type</span>
            <TextInput value={draft.grant_type ?? ''} onChange={e => setDraft({ ...draft, grant_type: e.target.value })} required />
          </label>
        )}
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Year</span>
          <TextInput type="number" value={draft.year} onChange={e => setDraft({ ...draft, year: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Rate (decimal)</span>
          <TextInput type="number" step="0.0001" value={draft.rate} onChange={e => setDraft({ ...draft, rate: Number(e.target.value) })} required />
        </label>
        {kind === 'purchase_original' && (
          <label className="flex flex-col">
            <span className="text-[10px] text-stone-600 dark:text-slate-400">Due date</span>
            <TextInput type="date" value={draft.due_date ?? ''} onChange={e => setDraft({ ...draft, due_date: e.target.value })} required />
          </label>
        )}
        <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Add rate
        </button>
      </form>
    </section>
  )
}

// ── Refinance Chains ─────────────────────────────────────────────────────

function RefinancesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [draft, setDraft] = useState<LoanRefinanceCreate>({
    chain_kind: 'purchase', grant_year: 2018, grant_type: 'Purchase',
    orig_loan_year: null, order_idx: 0, date: '', rate: 0, loan_year: 0, due_date: '', orig_due_date: null,
  })

  return (
    <section className="space-y-3">
      <div className="space-y-2 text-xs">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">Purchase chains</h3>
        {Object.entries(blob.loan_refinances.purchase).map(([gy, chain]) => (
          <div key={gy} className="rounded-md border border-stone-200 p-2 dark:border-slate-700">
            <p className="mb-1 font-medium">Grant {gy}</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              {chain.map((r, i) => (
                <li key={i}>{r.date} → {(r.rate * 100).toFixed(3)}%, due {r.due_date}</li>
              ))}
            </ol>
          </div>
        ))}

        <h3 className="font-semibold text-gray-900 dark:text-slate-100">Tax chains</h3>
        {Object.entries(blob.loan_refinances.tax).map(([key, chain]) => (
          <div key={key} className="rounded-md border border-stone-200 p-2 dark:border-slate-700">
            <p className="mb-1 font-medium">{key}</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              {chain.map((r, i) => (
                <li key={i}>{r.date} → {(r.rate * 100).toFixed(3)}%, due {r.due_date} (orig due {r.orig_due_date})</li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          wrap(() => api.createLoanRefinance(draft), 'Refinance added')
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-2 dark:border-slate-700"
      >
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Chain kind</span>
          <select
            value={draft.chain_kind}
            onChange={e => setDraft({ ...draft, chain_kind: e.target.value as 'purchase' | 'tax' })}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="purchase">purchase</option>
            <option value="tax">tax</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Grant year</span>
          <TextInput type="number" value={draft.grant_year} onChange={e => setDraft({ ...draft, grant_year: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Grant type</span>
          <TextInput value={draft.grant_type ?? ''} onChange={e => setDraft({ ...draft, grant_type: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Order</span>
          <TextInput type="number" min={0} value={draft.order_idx} onChange={e => setDraft({ ...draft, order_idx: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Refi date</span>
          <TextInput type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Rate</span>
          <TextInput type="number" step="0.0001" value={draft.rate} onChange={e => setDraft({ ...draft, rate: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Loan year</span>
          <TextInput type="number" value={draft.loan_year} onChange={e => setDraft({ ...draft, loan_year: Number(e.target.value) })} required />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] text-stone-600 dark:text-slate-400">Due date</span>
          <TextInput type="date" value={draft.due_date} onChange={e => setDraft({ ...draft, due_date: e.target.value })} required />
        </label>
        {draft.chain_kind === 'tax' && (
          <label className="flex flex-col">
            <span className="text-[10px] text-stone-600 dark:text-slate-400">Orig due date</span>
            <TextInput type="date" value={draft.orig_due_date ?? ''} onChange={e => setDraft({ ...draft, orig_due_date: e.target.value })} />
          </label>
        )}
        <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Add refinance
        </button>
      </form>
    </section>
  )
}

// ── Program Settings (singleton) ─────────────────────────────────────────

function SettingsTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [form, setForm] = useState<GrantProgramSettings>(blob.grant_program_settings)

  useEffect(() => { setForm(blob.grant_program_settings) }, [blob])

  const update = (patch: Partial<GrantProgramSettings>) => setForm(f => ({ ...f, ...patch }))

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        wrap(() => api.updateGrantProgramSettings(form), 'Program settings saved')
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
    >
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Loan term (years)</span>
        <TextInput type="number" value={form.loan_term_years} onChange={e => update({ loan_term_years: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Latest rate year</span>
        <TextInput type="number" value={form.latest_rate_year} onChange={e => update({ latest_rate_year: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">DP shares start year</span>
        <TextInput type="number" value={form.dp_shares_start_year} onChange={e => update({ dp_shares_start_year: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Federal tax fallback</span>
        <TextInput type="number" step="0.001" value={form.tax_fallback_federal} onChange={e => update({ tax_fallback_federal: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">State tax fallback</span>
        <TextInput type="number" step="0.0001" value={form.tax_fallback_state} onChange={e => update({ tax_fallback_state: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Pre-2022 purchase due (MM-DD)</span>
        <TextInput value={form.default_purchase_due_month_day_pre2022} onChange={e => update({ default_purchase_due_month_day_pre2022: e.target.value })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Post-2022 purchase due (MM-DD)</span>
        <TextInput value={form.default_purchase_due_month_day_post2022} onChange={e => update({ default_purchase_due_month_day_post2022: e.target.value })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Price years start</span>
        <TextInput type="number" value={form.price_years_start} onChange={e => update({ price_years_start: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Price years end</span>
        <TextInput type="number" value={form.price_years_end} onChange={e => update({ price_years_end: Number(e.target.value) })} />
      </label>

      <div className="col-span-full rounded-md border border-stone-200 p-3 text-xs dark:border-slate-700">
        <label className="inline-flex items-start gap-2">
          <input
            type="checkbox"
            checked={!!form.flexible_payoff_enabled}
            onChange={e => update({ flexible_payoff_enabled: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-stone-700 dark:text-slate-200">Flexible loan-payoff methods</span>
            <span className="block text-[11px] text-stone-500 dark:text-slate-400">
              When off, loan-payoff sales are forced to the same-tranche method regardless of user preference.
            </span>
          </span>
        </label>
      </div>

      <div className="col-span-full">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
        >
          Save settings
        </button>
      </div>
    </form>
  )
}
