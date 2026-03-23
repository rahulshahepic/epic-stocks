import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.ts'
import type { AdminStats, AdminUser, BlockedEmailEntry, ErrorLogEntry, TestNotifyResult } from '../api.ts'

const NOTIFY_TEMPLATES: Record<string, { title: string; body: string }> = {
  custom:        { title: 'Test from admin', body: 'This is a test notification from the Epic Stocks admin panel.' },
  vesting:       { title: 'Equity Tracker', body: 'You have 1 event today: 1 Vesting' },
  exercise:      { title: 'Equity Tracker', body: 'You have 1 event today: 1 Exercise' },
  loan_repayment:{ title: 'Equity Tracker', body: 'You have 1 event today: 1 Loan Repayment' },
}

export default function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [blocked, setBlocked] = useState<BlockedEmailEntry[]>([])
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])
  const [expandedError, setExpandedError] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [blockEmail, setBlockEmail] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [notifyUserId, setNotifyUserId] = useState<number | ''>('')
  const [notifyTemplate, setNotifyTemplate] = useState('custom')
  const [notifyTitle, setNotifyTitle] = useState(NOTIFY_TEMPLATES.custom.title)
  const [notifyBody, setNotifyBody] = useState(NOTIFY_TEMPLATES.custom.body)
  const [notifySending, setNotifySending] = useState(false)
  const [notifyResult, setNotifyResult] = useState<TestNotifyResult | null>(null)

  const loadUsers = useCallback(async (q = '') => {
    try {
      const res = await api.adminUsers(q)
      setUsers(res.users)
      setTotalUsers(res.total)
    } catch {
      // Only set error if not already showing an auth error
      setError(prev => prev || 'Failed to load users')
    }
  }, [])

  const loadErrors = useCallback(async () => {
    try {
      const logs = await api.adminErrors()
      setErrorLogs(Array.isArray(logs) ? logs : [])
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api.adminStats(), api.adminListBlocked()])
      setStats(s)
      setBlocked(b)
      setError('')
      loadUsers()
      loadErrors()
    } catch {
      setError('Failed to load admin data. You may not have admin access.')
    }
  }, [loadUsers, loadErrors])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    loadUsers(search)
  }, [search, loadUsers])

  async function handleBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blockEmail.trim()) return
    try {
      await api.adminBlockEmail(blockEmail.trim(), blockReason.trim())
      setBlockEmail('')
      setBlockReason('')
      load()
    } catch {
      setError('Failed to block email')
    }
  }

  async function handleUnblock(id: number) {
    await api.adminUnblock(id)
    load()
  }

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      return
    }
    try {
      await api.adminDeleteUser(id)
      setConfirmDelete(null)
      setUsers(prev => prev.filter(u => u.id !== id))
      loadUsers(search)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    }
  }

  async function handleTestNotify(e: React.FormEvent) {
    e.preventDefault()
    if (!notifyUserId) return
    setNotifySending(true)
    setNotifyResult(null)
    try {
      const result = await api.adminTestNotify(notifyUserId, notifyTitle, notifyBody)
      setNotifyResult(result)
      loadErrors()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send notification')
    } finally {
      setNotifySending(false)
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDate(iso: string | null) {
    if (!iso) return 'Never'
    return new Date(iso).toLocaleDateString()
  }

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Admin</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Admin</h2>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Stats */}
      {stats && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Overview</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Users</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.total_users}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Active (30d)</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.active_users_30d}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Grants</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.total_grants}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Loans</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.total_loans}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Prices</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.total_prices}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">DB Size</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatBytes(stats.db_size_bytes)}</p>
            </div>
          </div>
        </section>
      )}

      {/* Users */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Users ({totalUsers})</h3>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by email or name..."
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="mt-3 space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between rounded-md border border-gray-100 p-2 text-xs dark:border-gray-700">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                  {u.email}
                  {u.is_admin && (
                    <span className="ml-1.5 inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      Admin
                    </span>
                  )}
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  {u.name ?? 'No name'} · Joined {formatDate(u.created_at)} · Last login {formatDate(u.last_login)}
                </p>
                <p className="text-gray-400 dark:text-gray-500">
                  {u.grant_count} grants · {u.loan_count} loans · {u.price_count} prices
                </p>
              </div>
              <div className="ml-2 flex shrink-0 gap-1">
                <button
                  onClick={() => { setNotifyUserId(u.id); setNotifyResult(null) }}
                  className="rounded px-2 py-1 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600"
                >
                  Notify
                </button>
                {!u.is_admin && (
                  <button
                    onClick={() => handleDelete(u.id)}
                    className={`rounded px-2 py-1 text-xs font-medium text-white ${
                      confirmDelete === u.id ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-400 hover:bg-gray-500'
                    }`}
                  >
                    {confirmDelete === u.id ? 'Confirm Delete' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {search ? 'No users match your search.' : 'No users.'}
            </p>
          )}
        </div>
      </section>

      {/* Blocked Emails */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Blocked Emails</h3>
        <form onSubmit={handleBlock} className="mt-3 space-y-2">
          <input
            type="email"
            value={blockEmail}
            onChange={e => setBlockEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            required
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              placeholder="Reason (optional)"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <button type="submit" className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
              Block
            </button>
          </div>
        </form>

        {blocked.length > 0 && (
          <div className="mt-3 space-y-1">
            {blocked.map(b => (
              <div key={b.id} className="flex items-center justify-between rounded-md border border-gray-100 p-2 text-xs dark:border-gray-700">
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{b.email}</span>
                  {b.reason && <span className="ml-2 text-gray-400">({b.reason})</span>}
                </div>
                <button onClick={() => handleUnblock(b.id)} className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}

        {blocked.length === 0 && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">No blocked emails.</p>
        )}
      </section>

      {/* Error Logs */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Error Logs ({errorLogs.length})
          </h3>
          {errorLogs.length > 0 && (
            <button
              onClick={async () => { await api.adminClearErrors(); setErrorLogs([]) }}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
            >
              Clear all
            </button>
          )}
        </div>
        {errorLogs.length === 0 && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">No errors logged.</p>
        )}
        <div className="mt-3 space-y-2">
          {errorLogs.map(e => (
            <div key={e.id} className="rounded-md border border-gray-100 p-2 text-xs dark:border-gray-700">
              <div
                className="flex cursor-pointer items-start justify-between"
                onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono font-medium text-red-600 dark:text-red-400">
                    {e.error_type}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-gray-400">
                    {e.method} {e.path}
                  </span>
                  {e.user_id && (
                    <span className="ml-2 text-gray-400 dark:text-gray-500">uid:{e.user_id}</span>
                  )}
                  <p className="mt-0.5 truncate text-gray-700 dark:text-gray-300">{e.error_message}</p>
                </div>
                <span className="ml-2 shrink-0 text-gray-400 dark:text-gray-500">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </div>
              {expandedError === e.id && e.traceback && (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-[10px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {e.traceback}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Test Notification</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Send an immediate notification to any user. Respects user preferences — push only goes to active subscriptions, email only if the user has it enabled.
        </p>
        <form onSubmit={handleTestNotify} className="mt-3 space-y-2">
          <select
            aria-label="User"
            value={notifyUserId}
            onChange={e => { setNotifyUserId(e.target.value === '' ? '' : +e.target.value); setNotifyResult(null) }}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Select a user…</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.email}{u.name ? ` (${u.name})` : ''}</option>
            ))}
          </select>
          <select
            aria-label="Template"
            value={notifyTemplate}
            onChange={e => {
              const tpl = e.target.value
              setNotifyTemplate(tpl)
              setNotifyTitle(NOTIFY_TEMPLATES[tpl].title)
              setNotifyBody(NOTIFY_TEMPLATES[tpl].body)
              setNotifyResult(null)
            }}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="custom">Custom</option>
            <option value="vesting">Vesting event</option>
            <option value="exercise">Exercise event</option>
            <option value="loan_repayment">Loan Repayment event</option>
          </select>
          <input
            type="text"
            aria-label="Title"
            value={notifyTitle}
            onChange={e => { setNotifyTitle(e.target.value); setNotifyTemplate('custom') }}
            placeholder="Title"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <textarea
            aria-label="Body"
            value={notifyBody}
            onChange={e => { setNotifyBody(e.target.value); setNotifyTemplate('custom') }}
            placeholder="Body"
            rows={2}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            type="submit"
            disabled={!notifyUserId || notifySending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {notifySending ? 'Sending…' : 'Send Now'}
          </button>
          {notifyResult && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Push: {notifyResult.push_sent} sent{notifyResult.push_failed > 0 ? `, ${notifyResult.push_failed} expired` : ''}.{' '}
              Email: {notifyResult.email_sent ? 'sent' : `not sent${notifyResult.email_skipped_reason ? ` — ${notifyResult.email_skipped_reason}` : ''}`}.
            </p>
          )}
        </form>
      </section>
    </div>
  )
}
