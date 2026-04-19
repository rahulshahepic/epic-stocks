import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../../api.ts'
import type {
  ContentBlob,
  GrantTemplate,
  BonusScheduleVariant,
  GrantProgramSettings,
  GrantTemplateCreate,
  LoanRateCreate,
  LoanRateRow,
  LoanRefinanceCreate,
  LoanRefinanceRow,
} from '../../api.ts'
import { GRANT_TYPE_NAMES, type GrantTypeName } from '../grantTypes.ts'
import { useMe } from '../../scaffold/hooks/useMe.ts'
import { resetContentCache } from '../hooks/useContent.ts'

type Tab = 'templates' | 'variants' | 'rates' | 'refinances' | 'settings'
type WrapFn = (fn: () => Promise<unknown>, successMsg: string) => Promise<void>
type Mode = 'add' | 'edit'

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
        ' w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
      }
    />
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-stone-600 hover:text-gray-600 dark:hover:text-slate-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

function GrantTypeSelect({ value, onChange, nullable = false, required = true }: {
  value: string | null
  onChange: (v: string | null) => void
  nullable?: boolean
  required?: boolean
}) {
  const hasLegacy = value != null && value !== '' && !GRANT_TYPE_NAMES.includes(value as GrantTypeName)
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
      required={required && !nullable}
      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
    >
      {nullable && <option value="">(none)</option>}
      {!nullable && (value === '' || value == null) && <option value="" disabled>Select…</option>}
      {GRANT_TYPE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
      {hasLegacy && <option value={value!}>{value} (legacy)</option>}
    </select>
  )
}

function FormActions({ mode, busy, onCancel, onDelete }: { mode: Mode; busy: boolean; onCancel: () => void; onDelete?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3">
      <button type="submit" disabled={busy} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">Save</button>
      <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
      {mode === 'edit' && onDelete && (
        <button type="button" onClick={onDelete} disabled={busy} className="ml-auto rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950">Delete</button>
      )}
    </div>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800">
      + {label}
    </button>
  )
}

function RowCount({ n, noun }: { n: number; noun: string }) {
  return <p className="text-xs text-stone-600 dark:text-slate-400">{n} {noun}{n === 1 ? '' : 's'}</p>
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
    <div className="space-y-4 text-stone-800 dark:text-slate-200">
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
        <TabButton active={tab === 'variants'} label="Bonus Variants" onClick={() => setTab('variants')} />
        <TabButton active={tab === 'rates'} label="Loan Rates" onClick={() => setTab('rates')} />
        <TabButton active={tab === 'refinances'} label="Refinance Chains" onClick={() => setTab('refinances')} />
        <TabButton active={tab === 'settings'} label="Program Settings" onClick={() => setTab('settings')} />
      </nav>

      {tab === 'templates' && <TemplatesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'variants' && <VariantsTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'rates' && <RatesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'refinances' && <RefinancesTab blob={blob} wrap={wrap} busy={busy} />}
      {tab === 'settings' && <SettingsTab blob={blob} wrap={wrap} busy={busy} />}
    </div>
  )
}

// ── Grant Templates ──────────────────────────────────────────────────────

type TemplateDraft = GrantTemplateCreate & { id?: number }

function TemplatesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [modal, setModal] = useState<{ mode: Mode; draft: TemplateDraft } | null>(null)

  const openAdd = () => setModal({
    mode: 'add',
    draft: {
      year: new Date().getFullYear() + 1,
      type: GRANT_TYPE_NAMES[0],
      vest_start: '',
      periods: 4,
      exercise_date: '',
      default_catch_up: false,
      show_dp_shares: false,
      display_order: blob.grant_templates.length,
    },
  })
  const openEdit = (t: GrantTemplate) => setModal({ mode: 'edit', draft: { ...t } })
  const close = () => setModal(null)
  const patch = (p: Partial<TemplateDraft>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } })

  const handleSave = async () => {
    if (!modal) return
    const { id: _id, ...data } = modal.draft
    if (modal.mode === 'add') {
      await wrap(() => api.createGrantTemplate(data), 'Grant template added')
    } else {
      await wrap(() => api.updateGrantTemplate(modal.draft.id!, data), 'Grant template saved')
    }
    close()
  }
  const handleDelete = async () => {
    if (!modal || modal.mode !== 'edit' || modal.draft.id == null) return
    await wrap(() => api.deleteGrantTemplate(modal.draft.id!), 'Grant template removed')
    close()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RowCount n={blob.grant_templates.length} noun="template" />
        <AddButton onClick={openAdd} label="Add template" />
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Year</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Vest start</th>
              <th className="px-2 py-1 text-left">Periods</th>
            </tr>
          </thead>
          <tbody>
            {blob.grant_templates.map(t => (
              <tr
                key={t.id}
                onClick={() => openEdit(t)}
                className="cursor-pointer border-t border-stone-100 hover:bg-stone-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <td className="px-2 py-1">{t.year}</td>
                <td className="px-2 py-1">{t.type}</td>
                <td className="px-2 py-1">{t.vest_start}</td>
                <td className="px-2 py-1">{t.periods}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Add grant template' : `Edit ${modal.draft.year} ${modal.draft.type}`}
          onClose={close}
        >
          <form onSubmit={e => { e.preventDefault(); handleSave() }} className="space-y-3">
            <Field label="Year"><TextInput type="number" value={modal.draft.year} onChange={e => patch({ year: Number(e.target.value) })} required /></Field>
            <Field label="Type"><GrantTypeSelect value={modal.draft.type} onChange={v => patch({ type: v ?? '' })} /></Field>
            <Field label="Vest start"><TextInput type="date" value={modal.draft.vest_start} onChange={e => patch({ vest_start: e.target.value })} required /></Field>
            <Field label="Periods"><TextInput type="number" min={1} value={modal.draft.periods} onChange={e => patch({ periods: Number(e.target.value) })} required /></Field>
            <Field label="Exercise date"><TextInput type="date" value={modal.draft.exercise_date} onChange={e => patch({ exercise_date: e.target.value })} required /></Field>
            <Field label="Display order"><TextInput type="number" value={modal.draft.display_order ?? 0} onChange={e => patch({ display_order: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!modal.draft.default_catch_up} onChange={e => patch({ default_catch_up: e.target.checked })} />
              Default catch-up
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!modal.draft.show_dp_shares} onChange={e => patch({ show_dp_shares: e.target.checked })} />
              Show DP shares (Purchase only)
            </label>
            <FormActions mode={modal.mode} busy={busy} onCancel={close} onDelete={handleDelete} />
          </form>
        </Modal>
      )}
    </section>
  )
}

// ── Bonus Variants ───────────────────────────────────────────────────────

type VariantDraft = Omit<BonusScheduleVariant, 'id'> & { id?: number }

function VariantsTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [modal, setModal] = useState<{ mode: Mode; draft: VariantDraft } | null>(null)

  const openAdd = () => setModal({
    mode: 'add',
    draft: {
      grant_year: new Date().getFullYear(),
      grant_type: GRANT_TYPE_NAMES[0],
      variant_code: '',
      periods: 3,
      label: '',
      is_default: false,
    },
  })
  const openEdit = (v: BonusScheduleVariant) => setModal({ mode: 'edit', draft: { ...v } })
  const close = () => setModal(null)
  const patch = (p: Partial<VariantDraft>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } })

  const handleSave = async () => {
    if (!modal) return
    const { id: _id, ...data } = modal.draft
    if (modal.mode === 'add') {
      await wrap(() => api.createBonusVariant(data), 'Bonus variant added')
    } else {
      await wrap(() => api.updateBonusVariant(modal.draft.id!, data), 'Bonus variant saved')
    }
    close()
  }
  const handleDelete = async () => {
    if (!modal || modal.mode !== 'edit' || modal.draft.id == null) return
    await wrap(() => api.deleteBonusVariant(modal.draft.id!), 'Bonus variant removed')
    close()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RowCount n={blob.bonus_schedule_variants.length} noun="variant" />
        <AddButton onClick={openAdd} label="Add variant" />
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Year</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Code</th>
              <th className="px-2 py-1 text-left">Periods</th>
              <th className="px-2 py-1 text-left">Default</th>
            </tr>
          </thead>
          <tbody>
            {blob.bonus_schedule_variants.map(v => (
              <tr
                key={v.id}
                onClick={() => openEdit(v)}
                className="cursor-pointer border-t border-stone-100 hover:bg-stone-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <td className="px-2 py-1">{v.grant_year}</td>
                <td className="px-2 py-1">{v.grant_type}</td>
                <td className="px-2 py-1">{v.variant_code}</td>
                <td className="px-2 py-1">{v.periods}</td>
                <td className="px-2 py-1">{v.is_default ? 'yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Add bonus variant' : `Edit variant ${modal.draft.variant_code}`}
          onClose={close}
        >
          <form onSubmit={e => { e.preventDefault(); handleSave() }} className="space-y-3">
            <Field label="Grant year"><TextInput type="number" value={modal.draft.grant_year} onChange={e => patch({ grant_year: Number(e.target.value) })} required /></Field>
            <Field label="Grant type"><GrantTypeSelect value={modal.draft.grant_type} onChange={v => patch({ grant_type: v ?? '' })} /></Field>
            <Field label="Variant code"><TextInput value={modal.draft.variant_code} onChange={e => patch({ variant_code: e.target.value })} required /></Field>
            <Field label="Periods"><TextInput type="number" min={1} value={modal.draft.periods} onChange={e => patch({ periods: Number(e.target.value) })} required /></Field>
            <Field label="Label"><TextInput value={modal.draft.label} onChange={e => patch({ label: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={modal.draft.is_default} onChange={e => patch({ is_default: e.target.checked })} />
              Default variant for this year/type
            </label>
            <FormActions mode={modal.mode} busy={busy} onCancel={close} onDelete={handleDelete} />
          </form>
        </Modal>
      )}
    </section>
  )
}

// ── Loan Rates ───────────────────────────────────────────────────────────

type RateDraft = LoanRateCreate & { id?: number }

function RatesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [kind, setKind] = useState<'interest' | 'tax' | 'purchase_original'>('interest')
  const [modal, setModal] = useState<{ mode: Mode; draft: RateDraft } | null>(null)

  const rows = blob.loan_rates_all
    .filter(r => r.loan_kind === kind)
    .sort((a, b) => (a.grant_type ?? '').localeCompare(b.grant_type ?? '') || a.year - b.year)

  const openAdd = () => setModal({
    mode: 'add',
    draft: {
      loan_kind: kind,
      year: new Date().getFullYear(),
      rate: 0,
      grant_type: kind === 'tax' ? 'Bonus' : null,
      due_date: kind === 'purchase_original' ? '' : null,
    },
  })
  const openEdit = (r: LoanRateRow) => setModal({ mode: 'edit', draft: { ...r } })
  const close = () => setModal(null)
  const patch = (p: Partial<RateDraft>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } })

  const handleSave = async () => {
    if (!modal) return
    const { id: _id, ...data } = modal.draft
    if (modal.mode === 'add') {
      await wrap(() => api.createLoanRate(data), 'Loan rate added')
    } else {
      await wrap(() => api.updateLoanRate(modal.draft.id!, data), 'Loan rate saved')
    }
    close()
  }
  const handleDelete = async () => {
    if (!modal || modal.mode !== 'edit' || modal.draft.id == null) return
    await wrap(() => api.deleteLoanRate(modal.draft.id!), 'Loan rate removed')
    close()
  }

  const draftKind = modal?.draft.loan_kind ?? kind

  return (
    <section className="space-y-3">
      <div className="flex gap-1">
        <TabButton active={kind === 'interest'} label="Interest" onClick={() => setKind('interest')} />
        <TabButton active={kind === 'tax'} label="Tax" onClick={() => setKind('tax')} />
        <TabButton active={kind === 'purchase_original'} label="Purchase (original)" onClick={() => setKind('purchase_original')} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <RowCount n={rows.length} noun="rate" />
        <AddButton onClick={openAdd} label="Add rate" />
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[360px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            {kind === 'interest' && <tr><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th></tr>}
            {kind === 'tax' && <tr><th className="px-2 py-1 text-left">Grant type</th><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th></tr>}
            {kind === 'purchase_original' && <tr><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-left">Rate</th><th className="px-2 py-1 text-left">Due date</th></tr>}
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                onClick={() => openEdit(r)}
                className="cursor-pointer border-t border-stone-100 hover:bg-stone-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {kind === 'tax' && <td className="px-2 py-1">{r.grant_type}</td>}
                <td className="px-2 py-1">{r.year}</td>
                <td className="px-2 py-1">{(r.rate * 100).toFixed(3)}%</td>
                {kind === 'purchase_original' && <td className="px-2 py-1">{r.due_date}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'add' ? `Add ${draftKind} rate` : `Edit ${draftKind} rate ${modal.draft.year}`}
          onClose={close}
        >
          <form onSubmit={e => { e.preventDefault(); handleSave() }} className="space-y-3">
            <Field label="Kind">
              <input
                value={draftKind}
                disabled
                className="w-full rounded-md border border-gray-300 bg-stone-100 px-2 py-1.5 text-xs text-stone-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
              />
            </Field>
            {draftKind === 'tax' && (
              <Field label="Grant type">
                <GrantTypeSelect value={modal.draft.grant_type ?? ''} onChange={v => patch({ grant_type: v })} />
              </Field>
            )}
            <Field label="Year"><TextInput type="number" value={modal.draft.year} onChange={e => patch({ year: Number(e.target.value) })} required /></Field>
            <Field label="Rate (decimal, e.g. 0.0379)">
              <TextInput type="number" step="0.0001" value={modal.draft.rate} onChange={e => patch({ rate: Number(e.target.value) })} required />
            </Field>
            {draftKind === 'purchase_original' && (
              <Field label="Due date">
                <TextInput type="date" value={modal.draft.due_date ?? ''} onChange={e => patch({ due_date: e.target.value })} required />
              </Field>
            )}
            <FormActions mode={modal.mode} busy={busy} onCancel={close} onDelete={handleDelete} />
          </form>
        </Modal>
      )}
    </section>
  )
}

// ── Refinance Chains ─────────────────────────────────────────────────────

type RefiDraft = LoanRefinanceCreate & { id?: number }

function RefinancesTab({ blob, wrap, busy }: { blob: ContentBlob; wrap: WrapFn; busy: boolean }) {
  const [modal, setModal] = useState<{ mode: Mode; draft: RefiDraft } | null>(null)

  const openAdd = () => setModal({
    mode: 'add',
    draft: {
      chain_kind: 'purchase',
      grant_year: new Date().getFullYear(),
      grant_type: 'Purchase',
      orig_loan_year: null,
      order_idx: 0,
      date: '',
      rate: 0,
      loan_year: new Date().getFullYear(),
      due_date: '',
      orig_due_date: null,
    },
  })
  const openEdit = (r: LoanRefinanceRow) => setModal({ mode: 'edit', draft: { ...r } })
  const close = () => setModal(null)
  const patch = (p: Partial<RefiDraft>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } })

  const handleSave = async () => {
    if (!modal) return
    const { id: _id, ...data } = modal.draft
    if (modal.mode === 'add') {
      await wrap(() => api.createLoanRefinance(data), 'Refinance added')
    } else {
      await wrap(() => api.updateLoanRefinance(modal.draft.id!, data), 'Refinance saved')
    }
    close()
  }
  const handleDelete = async () => {
    if (!modal || modal.mode !== 'edit' || modal.draft.id == null) return
    await wrap(() => api.deleteLoanRefinance(modal.draft.id!), 'Refinance removed')
    close()
  }

  const sorted = [...blob.loan_refinances_all].sort((a, b) =>
    a.chain_kind.localeCompare(b.chain_kind)
    || a.grant_year - b.grant_year
    || (a.grant_type ?? '').localeCompare(b.grant_type ?? '')
    || (a.orig_loan_year ?? 0) - (b.orig_loan_year ?? 0)
    || a.order_idx - b.order_idx
  )

  const isTax = modal?.draft.chain_kind === 'tax'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RowCount n={sorted.length} noun="refinance" />
        <AddButton onClick={openAdd} label="Add refinance" />
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-slate-700">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1 text-left">Chain</th>
              <th className="px-2 py-1 text-left">Grant</th>
              <th className="px-2 py-1 text-left">#</th>
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-left">Rate</th>
              <th className="px-2 py-1 text-left">Due</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr
                key={r.id}
                onClick={() => openEdit(r)}
                className="cursor-pointer border-t border-stone-100 hover:bg-stone-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <td className="px-2 py-1">{r.chain_kind}</td>
                <td className="px-2 py-1">{r.grant_year} {r.grant_type}{r.chain_kind === 'tax' && r.orig_loan_year != null ? ` / orig ${r.orig_loan_year}` : ''}</td>
                <td className="px-2 py-1">{r.order_idx}</td>
                <td className="px-2 py-1">{r.date}</td>
                <td className="px-2 py-1">{(r.rate * 100).toFixed(3)}%</td>
                <td className="px-2 py-1">{r.due_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Add refinance' : `Edit refinance ${modal.draft.date}`}
          onClose={close}
        >
          <form onSubmit={e => { e.preventDefault(); handleSave() }} className="space-y-3">
            <Field label="Chain kind">
              <select
                value={modal.draft.chain_kind}
                disabled={modal.mode === 'edit'}
                onChange={e => patch({ chain_kind: e.target.value as 'purchase' | 'tax' })}
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:bg-stone-100 disabled:text-stone-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-800"
              >
                <option value="purchase">purchase</option>
                <option value="tax">tax</option>
              </select>
            </Field>
            <Field label="Grant year"><TextInput type="number" value={modal.draft.grant_year} onChange={e => patch({ grant_year: Number(e.target.value) })} required /></Field>
            <Field label="Grant type"><GrantTypeSelect value={modal.draft.grant_type ?? ''} onChange={v => patch({ grant_type: v })} /></Field>
            {isTax && (
              <Field label="Original loan year">
                <TextInput type="number" value={modal.draft.orig_loan_year ?? ''} onChange={e => patch({ orig_loan_year: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Order"><TextInput type="number" min={0} value={modal.draft.order_idx} onChange={e => patch({ order_idx: Number(e.target.value) })} required /></Field>
            <Field label="Refi date"><TextInput type="date" value={modal.draft.date} onChange={e => patch({ date: e.target.value })} required /></Field>
            <Field label="Rate (decimal)"><TextInput type="number" step="0.0001" value={modal.draft.rate} onChange={e => patch({ rate: Number(e.target.value) })} required /></Field>
            <Field label="Loan year"><TextInput type="number" value={modal.draft.loan_year} onChange={e => patch({ loan_year: Number(e.target.value) })} required /></Field>
            <Field label="Due date"><TextInput type="date" value={modal.draft.due_date} onChange={e => patch({ due_date: e.target.value })} required /></Field>
            {isTax && (
              <Field label="Original due date">
                <TextInput type="date" value={modal.draft.orig_due_date ?? ''} onChange={e => patch({ orig_due_date: e.target.value === '' ? null : e.target.value })} />
              </Field>
            )}
            <FormActions mode={modal.mode} busy={busy} onCancel={close} onDelete={handleDelete} />
          </form>
        </Modal>
      )}
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
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Federal tax fallback</span>
        <TextInput type="number" step="0.001" value={form.tax_fallback_federal} onChange={e => update({ tax_fallback_federal: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">State tax fallback</span>
        <TextInput type="number" step="0.0001" value={form.tax_fallback_state} onChange={e => update({ tax_fallback_state: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Min DP % of purchase</span>
        <TextInput type="number" step="0.01" value={form.dp_min_percent} onChange={e => update({ dp_min_percent: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-stone-700 dark:text-slate-300">Min DP cap ($)</span>
        <TextInput type="number" step="1000" value={form.dp_min_cap} onChange={e => update({ dp_min_cap: Number(e.target.value) })} />
      </label>

      <div className="col-span-full rounded-md border border-stone-200 p-3 text-[11px] text-stone-600 dark:border-slate-700 dark:text-slate-400">
        <span className="font-medium text-stone-700 dark:text-slate-200">Derived price years: </span>
        <span className="font-mono">{form.price_years_start}</span>–<span className="font-mono">{form.price_years_end}</span>
        {' '}(from the Grant Templates and Loan Rates tabs; updates automatically).
      </div>

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
