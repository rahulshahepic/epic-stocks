import { useState } from 'react'
import { apiFetchRaw } from '../../../api.ts'
import { AdminSection } from './AdminSection.tsx'

type TestUser = { id: number; login: string; label: string; scenario: string; status: string; expires_at: string }
async function request(path: string, body?: unknown) {
  const response = await apiFetchRaw(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  const value = await response.json()
  if (!response.ok) throw new Error(value.detail ?? 'Test user request failed')
  return value
}
export function TestUsers() {
  const [rows, setRows] = useState<TestUser[]>([])
  const [label, setLabel] = useState('')
  const [scenario, setScenario] = useState('established')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [secret, setSecret] = useState<{ login: string; password: string } | null>(null)
  const [pending, setPending] = useState<{ row: TestUser; action: string; confirm: string } | null>(null)
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Test user request failed') }
    finally { setBusy(false) }
  }
  async function load() { setRows(await request('/api/admin/test-users')) }
  async function access(row?: TestUser) {
    const value = await request('/api/admin/test-users/access', { label: row?.label ?? label, scenario: row?.scenario ?? scenario, days, test_user_id: row?.id })
    setSecret({ login: value.login, password: value.password }); await load()
  }
  async function preview(row: TestUser, action: string) {
    const value = await request(`/api/admin/test-users/${row.id}/manage`, { action })
    setPending({ row, action, confirm: value.confirm })
  }
  return <AdminSection title="Internal test users">
    <p className="my-3 text-sm text-cs-text-2">Fictional accounts the operator signs in as to validate production workflows (export, deletion, AI connections) without borrowing a directory reviewer identity. Separate from reviewer accounts in storage, sign-in and this list. Passwords appear once. Rotation and extension invalidate existing sessions. Resets happen only after confirmation.</p>
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label>Purpose<input aria-label="Test user purpose label" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Audit validation" className="block min-h-11 rounded border border-cs-border bg-cs-surface p-2" /></label>
      <label>Scenario<select aria-label="Test user scenario" value={scenario} onChange={e => setScenario(e.target.value)} className="block min-h-11 rounded border border-cs-border bg-cs-surface p-2">{['established', 'early', 'exit', 'empty'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Access days<input type="number" min={1} max={90} value={days} onChange={e => setDays(Number(e.target.value))} className="block min-h-11 w-20 rounded border border-cs-border bg-cs-surface p-2" /></label>
      <button disabled={busy} onClick={() => void run(() => access())} className="min-h-11 rounded bg-cs-brand px-3 text-white">Provision test user</button>
      <button disabled={busy} onClick={() => void run(load)} className="min-h-11 px-3 underline">Load test users</button>
    </div>
    {error && <p role="alert" className="mt-3 text-red-700 dark:text-red-300">{error}</p>}
    {secret && <div role="status" className="my-3 rounded border border-cs-border p-3"><p>Copy to a secure store now. Do not put this password in GitHub or an issue.</p><p className="break-all">Login: {secret.login}</p><label>Password<input readOnly value={secret.password} className="my-2 block w-full rounded border border-cs-border bg-cs-surface p-2 font-mono" /></label><button onClick={() => setSecret(null)} className="min-h-11 underline">Hide credential</button></div>}
    {pending && <div role="alert" className="my-3 rounded border border-cs-border p-3"><p>Confirm {pending.action} of {pending.row.login}? This affects only this fictional test account. Reset deletes all its testing modifications.</p><button disabled={busy} className="min-h-11 px-3 text-red-700 dark:text-red-300 underline" onClick={() => void run(async () => { await request(`/api/admin/test-users/${pending.row.id}/manage`, { action: pending.action, confirm: pending.confirm }); setPending(null); await load() })}>Confirm {pending.action}</button><button onClick={() => setPending(null)} className="min-h-11 px-3 underline">Cancel</button></div>}
    <ul className="mt-3 space-y-3">{rows.map(row => <li key={row.id} className="rounded border border-cs-border p-3 text-sm"><p className="break-all font-medium">{row.login}</p><p>INTERNAL TEST · {row.label} · {row.scenario} · {row.status} · expires {row.expires_at.slice(0, 10)}</p><div className="flex flex-wrap gap-2"><button disabled={busy} className="min-h-11 underline" onClick={() => void run(() => access(row))}>Rotate / extend</button>{['reset', 'revoke', 'delete'].map(action => <button key={action} disabled={busy} className="min-h-11 px-2 underline" onClick={() => void run(() => preview(row, action))}>{action}</button>)}</div></li>)}</ul>
  </AdminSection>
}
