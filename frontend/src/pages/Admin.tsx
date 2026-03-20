import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.ts'
import type { AdminStats, AdminUser, BlockedEmailEntry } from '../api.ts'

export default function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [blocked, setBlocked] = useState<BlockedEmailEntry[]>([])
  const [error, setError] = useState('')
  const [blockEmail, setBlockEmail] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

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

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api.adminStats(), api.adminListBlocked()])
      setStats(s)
      setBlocked(b)
      setError('')
      loadUsers()
    } catch {
      setError('Failed to load admin data. You may not have admin access.')
    }
  }, [loadUsers])

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
      loadUsers(search)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
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
              {!u.is_admin && (
                <button
                  onClick={() => handleDelete(u.id)}
                  className={`ml-2 shrink-0 rounded px-2 py-1 text-xs font-medium text-white ${
                    confirmDelete === u.id ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-400 hover:bg-gray-500'
                  }`}
                >
                  {confirmDelete === u.id ? 'Confirm Delete' : 'Delete'}
                </button>
              )}
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
        <form onSubmit={handleBlock} className="mt-3 flex gap-2">
          <input
            type="email"
            value={blockEmail}
            onChange={e => setBlockEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            required
          />
          <input
            type="text"
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button type="submit" className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Block
          </button>
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
    </div>
  )
}
