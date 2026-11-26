import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { SectionNavigation } from '../components/SectionNavigation.tsx'
import { api } from '../../api.ts'
import { NotifyModal } from './admin/NotifyModal.tsx'
import { UserDetailModal } from './admin/UserDetailModal.tsx'
import { ToolsSection } from './admin/ToolsSection.tsx'
import { OverviewSection } from './admin/OverviewSection.tsx'
import { SmartTips } from './admin/SmartTips.tsx'
import { Reviewers } from './admin/Reviewers.tsx'
import { AiConnections } from './admin/AiConnections.tsx'
import { TrialFunnel } from './admin/TrialFunnel.tsx'
import { SystemHealth } from './admin/SystemHealth.tsx'
import { DeploymentHealth } from './admin/DeploymentHealth.tsx'
import { EdgeTraffic } from './admin/EdgeTraffic.tsx'
import { Backups } from './admin/Backups.tsx'
import { DatabaseTables } from './admin/DatabaseTables.tsx'
import { EmailLookup } from './admin/EmailLookup.tsx'
import { UsersSection } from './admin/UsersSection.tsx'
import { BlockedEmails } from './admin/BlockedEmails.tsx'
import { ReportsSection } from './admin/ReportsSection.tsx'
import { ErrorLogSection } from './admin/ErrorLogSection.tsx'
import { RotationBanner } from './admin/RotationBanner.tsx'
import { DangerZone } from './admin/DangerZone.tsx'
import type {
  AdminStats, AdminUser, BlockedEmailEntry, ErrorLogEntry, UserReportEntry,
  SystemMetricPoint, DbTableInfo, TipsReport, TrialFunnelReport,
} from '../../api.ts'

const categories = [
  { hash: '#health', label: 'System Health', description: 'Deployments, scheduled jobs, Cloudflare and database size' },
  { hash: '#support', label: 'Reports & Errors', description: 'Problem reports, error logs and import diagnostics' },
  { hash: '#users', label: 'Users & Access', description: 'Accounts, content admin roles and blocked emails' },
  { hash: '#ai-connections', label: 'AI Connections', description: 'Connector settings, approval requests and directory reviewer accounts' },
  { hash: '#usage', label: 'Usage', description: 'Account totals, onboarding metrics and Smart Tips' },
  { hash: '#maintenance', label: 'Maintenance & Backups', description: 'Backups, maintenance mode, key rotation and site-wide switches' },
]

export default function Admin() {
  const { hash } = useLocation()
  const active = categories.find(category => category.hash === hash)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [blocked, setBlocked] = useState<BlockedEmailEntry[]>([])
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])
  const [reports, setReports] = useState<UserReportEntry[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [notifyModal, setNotifyModal] = useState<{ userId: number; userName: string } | null>(null)

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)

  const [metrics, setMetrics] = useState<SystemMetricPoint[]>([])
  const [metricHours, setMetricHours] = useState(72)
  const [dbTables, setDbTables] = useState<DbTableInfo[]>([])
  const [tipsReport, setTipsReport] = useState<TipsReport | null>(null)
  const [funnel, setFunnel] = useState<TrialFunnelReport | null>(null)

  // Danger Zone state
  const [maintenanceActive, setMaintenanceActive] = useState<boolean | null>(null)
  const [epicModeActive, setEpicModeActive] = useState<boolean | null>(null)
  const [flexiblePayoffActive, setFlexiblePayoffActive] = useState<boolean | null>(null)
  const [snapshotExists, setSnapshotExists] = useState(false)

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

  const loadReports = useCallback(async () => {
    try {
      const rs = await api.adminReports()
      setReports(Array.isArray(rs) ? rs : [])
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
      const [s, b, m, rs, em, fp, tr, tf] = await Promise.all([
        api.adminStats(),
        api.adminListBlocked(),
        api.adminGetMaintenance(),
        api.adminRotationStatus(),
        api.adminGetEpicMode(),
        api.adminGetFlexiblePayoff(),
        api.adminTipsReport(),
        api.adminTrialFunnel(),
      ])
      setStats(s)
      setBlocked(b)
      setMaintenanceActive(m.active)
      setSnapshotExists(rs.snapshot_exists)
      setEpicModeActive(em.active)
      setFlexiblePayoffActive(fp.active)
      setTipsReport(tr)
      setFunnel(tf)
      setError('')
      loadUsers()
      loadErrors()
    } catch {
      setError('Failed to load admin data. You may not have admin access.')
    }
  }, [loadUsers, loadErrors])

  // Each loader is async and its first statement is an await, so nothing here
  // sets state before the effect returns. The rule cannot see past the async
  // boundary, and it only started reporting these once the page shrank enough
  // to be analysed at all — the 1,500-line version was skipped.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { load() }, [load])
  useEffect(() => { loadReports() }, [loadReports])
  useEffect(() => { loadMetrics(metricHours) }, [metricHours, loadMetrics])

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => { loadUsers(search) }, [search, loadUsers])
  /* eslint-enable react-hooks/set-state-in-effect */

  function openNotifyModal(u: { id: number; name?: string | null; email: string }) {
    setNotifyModal({ userId: u.id, userName: u.name ?? u.email })
  }

  function openUserDetail(u: AdminUser) {
    setSelectedUser(u)
  }

  // Without this, the page renders immediately with stats/epicModeActive/etc.
  // still null, so e2e's navigateTo() helper — which waits for a "Loading..."
  // placeholder to appear then clear — finds nothing to wait on and returns
  // before load()'s Promise.all resolves. Danger Zone buttons read from state
  // set only once load() finishes (epicModeActive starts null and shows a
  // "Loading" label until then), so a slow load() window left every read of
  // those buttons racing the admin API calls with no synchronization point.
  if (!stats && !error) {
    return <p className="p-6 text-center text-sm text-cs-text-2">Loading...</p>
  }

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-cs-text">Site Admin</h1>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionNavigation
        title="Site Admin"
        categories={categories}
        active={active}
        showBuildVersion
        headerContent={<>
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
          {snapshotExists && <RotationBanner onRestored={() => { setSnapshotExists(false); setMaintenanceActive(false) }} />}
        </>}
      >
        <h2 className="sr-only">{active?.label}</h2>

        {active?.hash === '#health' && <>
          <DeploymentHealth />
          <SystemHealth stats={stats} metrics={metrics} metricHours={metricHours} onWindowChange={setMetricHours} />
          <EdgeTraffic />
          <DatabaseTables dbTables={dbTables} />
        </>}

        {active?.hash === '#support' && <>
          <ReportsSection reports={reports} onReportsChanged={setReports} />
          <ErrorLogSection errorLogs={errorLogs} onCleared={setErrorLogs} />
          <ToolsSection />
        </>}

        {active?.hash === '#users' && <>
          <UsersSection users={users} totalUsers={totalUsers} searchInput={searchInput}
            onSearchInput={setSearchInput} onOpenUser={openUserDetail} />
          <EmailLookup onChanged={load} onError={setError} />
          <BlockedEmails blocked={blocked} onChanged={load} onError={setError} />
        </>}

        {active?.hash === '#ai-connections' && <>
          <AiConnections onError={setError} />
          <Reviewers />
        </>}

        {active?.hash === '#usage' && <>
          {stats && <OverviewSection stats={stats} />}
          {funnel && <TrialFunnel funnel={funnel} />}
          {tipsReport && <SmartTips tipsReport={tipsReport} />}
        </>}

        {active?.hash === '#maintenance' && <Backups />}

        {/* Keep the rotation stream and its controls intact across category changes. */}
        <div hidden={active?.hash !== '#maintenance'}>
          <DangerZone
            maintenanceActive={maintenanceActive} setMaintenanceActive={setMaintenanceActive}
            epicModeActive={epicModeActive} setEpicModeActive={setEpicModeActive}
            flexiblePayoffActive={flexiblePayoffActive} setFlexiblePayoffActive={setFlexiblePayoffActive}
            onSnapshotChanged={setSnapshotExists} onError={setError}
          />
        </div>
      </SectionNavigation>

      {active?.hash === '#users' && selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onChanged={() => loadUsers(search)}
          onNotify={openNotifyModal}
          onError={setError}
        />
      )}

      {active?.hash === '#users' && notifyModal && (
        <NotifyModal
          user={notifyModal}
          onClose={() => setNotifyModal(null)}
          onSent={loadErrors}
          onError={setError}
        />
      )}
    </div>
  )
}
