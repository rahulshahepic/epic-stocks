import { useState, useEffect, useCallback, useRef } from 'react'
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis } from 'recharts'
import { api } from '../../api.ts'
import { useConfig } from '../hooks/useConfig.ts'
import type {
  AdminStats, AdminUser, BlockedEmailEntry, ErrorLogEntry, TestNotifyResult,
  SystemMetricPoint, DbTableInfo, RotationEvent,
} from '../../api.ts'

const NOTIFY_TEMPLATES: Record<string, { title: string; body: string }> = {
  custom:        { title: 'Test from admin', body: 'This is a test notification from the Epic Stocks admin panel.' },
  vesting:       { title: 'Equity Tracker', body: 'You have 1 event today: 1 Vesting' },
  exercise:      { title: 'Equity Tracker', body: 'You have 1 event today: 1 Exercise' },
  loan_repayment:{ title: 'Equity Tracker', body: 'You have 1 event today: 1 Loan Repayment' },
}

const METRIC_WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '72h', hours: 72 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

function Sparkline({ data, dataKey, color, formatter }: {
  data: SystemMetricPoint[]
  dataKey: keyof SystemMetricPoint
  color: string
  formatter?: (v: number) => string
}) {
  if (data.length === 0) {
    return <div className="flex h-16 items-center justify-center text-xs text-gray-400 dark:text-slate-500">collecting…</div>
  }
  return (
    <ResponsiveContainer width="100%" height={64}>
      <LineChart data={data}>
        <XAxis dataKey="timestamp" hide />
        <YAxis domain={['auto', 'auto']} hide />
        <Tooltip
          contentStyle={{ fontSize: 10, padding: '2px 6px' }}
          labelFormatter={(label) => new Date(label as string).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC'}
          formatter={(v) => [formatter ? formatter(v as number) : String(v), '']}
        />
        <Line
          type="monotone"
          dataKey={dataKey as string}
          stroke={color}
          dot={data.length === 1 ? { r: 3, fill: color } : false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function Admin() {
  const config = useConfig()
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
  const [notifyModal, setNotifyModal] = useState<{ userId: number; userName: string } | null>(null)
  const [notifyTemplate, setNotifyTemplate] = useState('custom')
  const [notifyTitle, setNotifyTitle] = useState(NOTIFY_TEMPLATES.custom.title)
  const [notifyBody, setNotifyBody] = useState(NOTIFY_TEMPLATES.custom.body)
  const [notifySending, setNotifySending] = useState(false)
  const [notifyResult, setNotifyResult] = useState<TestNotifyResult | null>(null)

  // Metrics state
  const [metrics, setMetrics] = useState<SystemMetricPoint[]>([])
  const [metricHours, setMetricHours] = useState(72)
  const [dbTables, setDbTables] = useState<DbTableInfo[]>([])

  // Danger Zone state
  const [maintenanceActive, setMaintenanceActive] = useState<boolean | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [epicModeActive, setEpicModeActive] = useState<boolean | null>(null)
  const [epicModeLoading, setEpicModeLoading] = useState(false)
  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotationConfirm, setRotationConfirm] = useState(false)
  const [rotationRunning, setRotationRunning] = useState(false)
  const [rotationLog, setRotationLog] = useState<RotationEvent[]>([])
  const rotationLogRef = useRef<HTMLDivElement>(null)
  const [snapshotExists, setSnapshotExists] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const loadUsers = useCallback(async (q = '') => {
    try {
      const res = await api.adminUsers(q)
      setUsers(res.users)
      setTotalUsers(res.total)
    } catch {
      setError(prev => prev || 'Failed to load users')
    }
  }, [])

  const loadErrors = useCallback(async () => {
    try {
      const logs = await api.adminErrors()
      setErrorLogs(Array.isArray(logs) ? logs : [])
    } catch { /* ignore */ }
  }, [])

  const loadMetrics = useCallback(async (hours: number) => {
    try {
      const [m, t] = await Promise.all([api.adminMetrics(hours), api.adminDbTables()])
      setMetrics(m)
      setDbTables(t)
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const [s, b, m, rs, em] = await Promise.all([
        api.adminStats(),
        api.adminListBlocked(),
        api.adminGetMaintenance(),
        api.adminRotationStatus(),
        api.adminGetEpicMode(),
      ])
      setStats(s)
      setBlocked(b)
      setMaintenanceActive(m.active)
      setSnapshotExists(rs.snapshot_exists)
      setEpicModeActive(em.active)
      setError('')
      loadUsers()
      loadErrors()
    } catch {
      setError('Failed to load admin data. You may not have admin access.')
    }
  }, [loadUsers, loadErrors])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadMetrics(metricHours) }, [metricHours, loadMetrics])

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => { loadUsers(search) }, [search, loadUsers])

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
    if (!notifyModal) return
    setNotifySending(true)
    setNotifyResult(null)
    try {
      const result = await api.adminTestNotify(notifyModal.userId, notifyTitle, notifyBody)
      setNotifyResult(result)
      loadErrors()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send notification')
    } finally {
      setNotifySending(false)
    }
  }

  function openNotifyModal(u: AdminUser) {
    setNotifyModal({ userId: u.id, userName: u.name ?? u.email })
    setNotifyTemplate('custom')
    setNotifyTitle(NOTIFY_TEMPLATES.custom.title)
    setNotifyBody(NOTIFY_TEMPLATES.custom.body)
    setNotifyResult(null)
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDate(iso: string | null) {
    if (!iso) return 'Never'
    const d = new Date(iso)
    return d.toLocaleDateString('en-CA', { timeZone: 'UTC' }) + ' UTC'
  }

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Admin</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  const ramPercent = stats?.ram_used_mb && stats?.ram_total_mb
    ? Math.round((stats.ram_used_mb / stats.ram_total_mb) * 100)
    : null

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Admin</h2>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Stats */}
      {stats && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">Overview</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div>
              <span className="text-gray-500 dark:text-slate-400">Users</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{stats.total_users}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">Active (30d)</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{stats.active_users_30d}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">Grants</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{stats.total_grants}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">Loans</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{stats.total_loans}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">Prices</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{stats.total_prices}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">DB Size</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{formatBytes(stats.db_size_bytes)}</p>
            </div>
          </div>
        </section>
      )}

      {/* System Health */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">System Health</h3>
          <div className="flex gap-1">
            {METRIC_WINDOWS.map(w => (
              <button
                key={w.hours}
                onClick={() => setMetricHours(w.hours)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  metricHours === w.hours
                    ? 'bg-rose-700 text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-gray-100'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Current readings */}
        {stats && (
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-gray-500 dark:text-slate-400">CPU</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                {stats.cpu_percent != null ? `${stats.cpu_percent.toFixed(0)}%` : '—'}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">RAM</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                {ramPercent != null ? `${ramPercent}%` : '—'}
              </p>
              {stats.ram_used_mb != null && stats.ram_total_mb != null && (
                <p className="text-gray-400 dark:text-slate-500">
                  {(stats.ram_used_mb / 1024).toFixed(1)} / {(stats.ram_total_mb / 1024).toFixed(1)} GB
                </p>
              )}
            </div>
            <div>
              <span className="text-gray-500 dark:text-slate-400">DB</span>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{formatBytes(stats.db_size_bytes)}</p>
            </div>
          </div>
        )}

        {/* Sparklines */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">CPU %</p>
            <Sparkline
              data={metrics}
              dataKey="cpu_percent"
              color="#6366f1"
              formatter={v => `${v.toFixed(1)}%`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">RAM %</p>
            <Sparkline
              data={metrics.map(m => ({ ...m, ram_percent: Math.round((m.ram_used_mb / m.ram_total_mb) * 100) }))}
              dataKey={'ram_percent' as keyof SystemMetricPoint}
              color="#10b981"
              formatter={v => `${v.toFixed(0)}%`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">DB size</p>
            <Sparkline
              data={metrics}
              dataKey="db_size_bytes"
              color="#f59e0b"
              formatter={v => formatBytes(v)}
            />
          </div>
          {metrics.some(m => m.cache_l1_hits != null) && (
            <div>
              <p className="mb-1 text-xs text-gray-500 dark:text-slate-400">Cache hit rate</p>
              <Sparkline
                data={metrics.map((m, i) => {
                  const prev = i > 0 ? metrics[i - 1] : null
                  // Use per-interval deltas so restarts and zero-traffic points don't flatten the chart.
                  // Negative deltas (counter reset on restart) are clamped to 0.
                  const dl1 = Math.max(0, (m.cache_l1_hits ?? 0) - (prev?.cache_l1_hits ?? 0))
                  const dl2 = Math.max(0, (m.cache_l2_hits ?? 0) - (prev?.cache_l2_hits ?? 0))
                  const dm  = Math.max(0, (m.cache_misses   ?? 0) - (prev?.cache_misses   ?? 0))
                  const total = dl1 + dl2 + dm
                  return { ...m, cache_hit_rate: total > 0 ? Math.round((dl1 + dl2) / total * 100) : null }
                })}
                dataKey={'cache_hit_rate' as keyof SystemMetricPoint}
                color="#8b5cf6"
                formatter={v => `${v.toFixed(0)}%`}
              />
            </div>
          )}
        </div>
      </section>

      {/* Database Breakdown */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">Database Tables</h3>
        {dbTables.length === 0 ? (
          <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
            Table breakdown is only available on PostgreSQL.
          </p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="pb-1.5 font-medium">Table</th>
                    <th className="pb-1.5 text-right font-medium">Size</th>
                    <th className="pb-1.5 text-right font-medium">~Rows</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {dbTables.map(t => (
                    <tr key={t.table_name}>
                      <td className="py-1.5 font-mono text-gray-900 dark:text-slate-100">{t.table_name}</td>
                      <td className="py-1.5 text-right text-gray-700 dark:text-slate-300">{formatBytes(t.size_bytes)}</td>
                      <td className="py-1.5 text-right text-gray-500 dark:text-slate-400">
                        {t.row_estimate < 0 ? '?' : t.row_estimate.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
              PostgreSQL baseline (~7–8 MB) is included in DB size — system catalogs, template databases, and WAL overhead.
              Row counts are pg_class estimates; they may lag until after a VACUUM ANALYZE.
            </p>
          </>
        )}
      </section>

      {/* Users */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">Users ({totalUsers})</h3>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by email or name..."
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="mt-3 space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between rounded-md border border-gray-100 p-2 text-xs dark:border-slate-700">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-slate-100">
                  {u.email}
                  {u.is_admin && (
                    <span className="ml-1.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                      Admin
                    </span>
                  )}
                </p>
                <p className="text-gray-500 dark:text-slate-400">
                  {u.name ?? 'No name'} · Joined {formatDate(u.created_at)} · Last login {formatDate(u.last_login)}
                </p>
                <p className="text-gray-400 dark:text-slate-500">
                  {u.grant_count} grants · {u.loan_count} loans · {u.price_count} prices
                </p>
              </div>
              <div className="ml-2 flex shrink-0 gap-1">
                <button
                  onClick={() => openNotifyModal(u)}
                  className="rounded px-2 py-1 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700"
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
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {search ? 'No users match your search.' : 'No users.'}
            </p>
          )}
        </div>
      </section>

      {/* Blocked Emails */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">Blocked Emails</h3>
        <form onSubmit={handleBlock} className="mt-3 space-y-2">
          <input
            type="email"
            value={blockEmail}
            onChange={e => setBlockEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            required
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              placeholder="Reason (optional)"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button type="submit" className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
              Block
            </button>
          </div>
        </form>

        {blocked.length > 0 && (
          <div className="mt-3 space-y-1">
            {blocked.map(b => (
              <div key={b.id} className="flex items-center justify-between rounded-md border border-gray-100 p-2 text-xs dark:border-slate-700">
                <div>
                  <span className="font-medium text-gray-900 dark:text-slate-100">{b.email}</span>
                  {b.reason && <span className="ml-2 text-gray-400">({b.reason})</span>}
                </div>
                <button onClick={() => handleUnblock(b.id)} className="rounded px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}

        {blocked.length === 0 && (
          <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">No blocked emails.</p>
        )}
      </section>

      {/* Error Logs */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">
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
          <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">No errors logged.</p>
        )}
        <div className="mt-3 space-y-2">
          {errorLogs.map(e => (
            <div key={e.id} className="rounded-md border border-gray-100 p-2 text-xs dark:border-slate-700">
              <div
                className="flex cursor-pointer items-start justify-between"
                onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono font-medium text-red-600 dark:text-red-400">
                    {e.error_type}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-slate-400">
                    {e.method} {e.path}
                  </span>
                  {e.user_id && (
                    <span className="ml-2 text-gray-400 dark:text-slate-500">uid:{e.user_id}</span>
                  )}
                  <p className="mt-0.5 truncate text-gray-700 dark:text-slate-300">{e.error_message}</p>
                </div>
                <span className="ml-2 shrink-0 text-gray-400 dark:text-slate-500">
                  {new Date(e.timestamp).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC
                </span>
              </div>
              {expandedError === e.id && e.traceback && (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-stone-50 p-2 font-mono text-[10px] text-stone-700 dark:bg-slate-800 dark:text-slate-300">
                  {e.traceback}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Interrupted rotation recovery banner */}
      {snapshotExists && (
        <div className="rounded-lg border border-red-400 bg-red-50 p-4 dark:border-red-600 dark:bg-red-950">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            Key rotation was interrupted
          </p>
          <p className="mt-1 text-xs text-red-700 dark:text-red-300">
            A rotation snapshot exists on disk. The database may have keys wrapped with the new
            master key while the app is still using the old one. Financial data is inaccessible
            until you restore from the snapshot or complete the rotation.
          </p>
          <button
            disabled={restoring}
            onClick={async () => {
              setRestoring(true)
              try {
                const res = await api.adminRotationRestore()
                setSnapshotExists(false)
                setMaintenanceActive(false)
                alert(`Restored ${res.restored} user key(s) from snapshot. Maintenance mode cleared.`)
              } catch (e) {
                alert(`Restore failed: ${e instanceof Error ? e.message : String(e)}`)
              } finally {
                setRestoring(false)
              }
            }}
            className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {restoring ? 'Restoring…' : 'Restore from snapshot'}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      <section className="rounded-lg border border-red-200 bg-white p-4 dark:border-red-900/60 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">⚠ Danger Zone</h3>

        {/* Maintenance Mode Toggle */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 dark:text-slate-100">Maintenance Mode</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Financial data becomes unavailable; auth and admin remain accessible.
              </p>
            </div>
            <button
              disabled={maintenanceActive === null || maintenanceLoading}
              onClick={async () => {
                setMaintenanceLoading(true)
                try {
                  const res = await api.adminSetMaintenance(!maintenanceActive)
                  setMaintenanceActive(res.active)
                } catch {
                  setError('Failed to toggle maintenance mode')
                } finally {
                  setMaintenanceLoading(false)
                }
              }}
              className={`ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                maintenanceActive
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {maintenanceLoading
                ? '…'
                : maintenanceActive === null
                ? 'Loading'
                : maintenanceActive
                ? 'Disable Maintenance'
                : 'Enable Maintenance'}
            </button>
          </div>
          {maintenanceActive && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              Site is currently in maintenance mode. Users see a 503 page.
            </p>
          )}
        </div>

        <hr className="my-4 border-red-100 dark:border-red-900/40" />

        {/* Epic Mode Toggle */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 dark:text-slate-100">Epic Mode</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Users can view their data but cannot add or edit grants, prices, or loans.
              </p>
            </div>
            <button
              disabled={epicModeActive === null || epicModeLoading}
              onClick={async () => {
                setEpicModeLoading(true)
                try {
                  const res = await api.adminSetEpicMode(!epicModeActive)
                  setEpicModeActive(res.active)
                } catch {
                  setError('Failed to toggle Epic Mode')
                } finally {
                  setEpicModeLoading(false)
                }
              }}
              className={`ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                epicModeActive
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-rose-700 hover:bg-rose-800'
              }`}
            >
              {epicModeLoading
                ? '…'
                : epicModeActive === null
                ? 'Loading'
                : epicModeActive
                ? 'Disable Epic Mode'
                : 'Enable Epic Mode'}
            </button>
          </div>
          {epicModeActive && (
            <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-400">
              Epic Mode is active. Grant/price/loan writes are blocked for all users.
            </p>
          )}
        </div>

        <hr className="my-4 border-red-100 dark:border-red-900/40" />

        {/* Encryption Key Rotation */}
        <div>
          <button
            onClick={() => { setRotationOpen(o => !o); setRotationConfirm(false) }}
            className="text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
          >
            {rotationOpen ? 'Hide' : 'Rotate Encryption Master Key'}
          </button>

          {rotationOpen && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-gray-600 dark:text-slate-400">
                Generates a new master key, re-wraps all user encryption keys, and saves
                the new key to disk. Triggers a brief maintenance window automatically.
                No deploy needed — the new key is live immediately.
              </p>

              {rotationLog.length > 0 && (
                <div
                  ref={rotationLogRef}
                  className="max-h-48 overflow-y-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800"
                >
                  {rotationLog.map((e, i) => (
                    <div
                      key={i}
                      className={
                        e.step === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : e.step === 'rollback'
                          ? 'text-amber-600 dark:text-amber-400'
                          : e.step === 'done'
                          ? 'text-green-600 dark:text-green-400 font-semibold'
                          : 'text-gray-700 dark:text-slate-300'
                      }
                    >
                      {e.step === 'done' || e.step === 'persist' || e.step === 'smoke'
                        ? '✓ '
                        : e.step === 'error'
                        ? '✗ '
                        : e.step === 'rollback'
                        ? '↩ '
                        : '› '}
                      {e.msg}
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const lastStep = rotationLog[rotationLog.length - 1]?.step
                if (lastStep === 'done') {
                  return (
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">
                      Rotation complete. New key is live — no deploy needed.
                    </p>
                  )
                }
                if (lastStep === 'error') {
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Rotation failed — all changes were rolled back, no data was modified.
                      </p>
                      <button
                        onClick={() => { setRotationLog([]); setRotationConfirm(false) }}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        Try Again
                      </button>
                    </div>
                  )
                }
                if (rotationRunning) return null
                if (!rotationConfirm) {
                  return (
                    <button
                      onClick={() => setRotationConfirm(true)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Rotate Master Key
                    </button>
                  )
                }
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-700 dark:text-slate-300">Are you sure?</span>
                    <button
                      onClick={async () => {
                        setRotationConfirm(false)
                        setRotationRunning(true)
                        setRotationLog([])
                        try {
                          await api.adminRotateKey(event => {
                            setRotationLog(prev => {
                              const next = [...prev, event]
                              setTimeout(() => {
                                rotationLogRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })
                              }, 0)
                              return next
                            })
                          })
                        } catch (err) {
                          setRotationLog(prev => [
                            ...prev,
                            { step: 'error', msg: err instanceof Error ? err.message : 'Unknown error' },
                          ])
                        } finally {
                          setRotationRunning(false)
                          // Refresh maintenance + snapshot status
                          api.adminRotationStatus().then(rs => {
                            setMaintenanceActive(rs.maintenance_active)
                            setSnapshotExists(rs.snapshot_exists)
                          }).catch(() => {})
                        }
                      }}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Yes, Rotate
                    </button>
                    <button
                      onClick={() => setRotationConfirm(false)}
                      className="text-xs text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      </section>

      {import.meta.env.VITE_COMMIT_SHA && import.meta.env.VITE_COMMIT_SHA !== 'dev' && (
        <p className="text-center text-xs text-gray-400 dark:text-slate-600">
          {import.meta.env.VITE_COMMIT_SHA.slice(0, 7)}
        </p>
      )}

      {/* Notify Modal */}
      {notifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  Notify — {notifyModal.userName}
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-500">
                  Email from: {config?.resend_from || <span className="text-red-500">RESEND_FROM not set</span>}
                </p>
              </div>
              <button
                onClick={() => setNotifyModal(null)}
                aria-label="Close dialog"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleTestNotify} className="space-y-2">
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
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <textarea
                aria-label="Body"
                value={notifyBody}
                onChange={e => { setNotifyBody(e.target.value); setNotifyTemplate('custom') }}
                placeholder="Body"
                rows={2}
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={notifySending}
                  className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  {notifySending ? 'Sending…' : 'Send'}
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyModal(null)}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
              {notifyResult && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Push: {notifyResult.push_sent} sent{notifyResult.push_failed > 0 ? `, ${notifyResult.push_failed} expired` : ''}.{' '}
                  Email: {notifyResult.email_sent ? 'sent' : `not sent${notifyResult.email_skipped_reason ? ` — ${notifyResult.email_skipped_reason}` : ''}`}.
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
