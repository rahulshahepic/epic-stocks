import { AdminSection } from './AdminSection.tsx'
import type { AdminStats } from '../../../api.ts'
import { formatBytes } from './format.ts'

/** Row counts and database size, as of the last load. */
export function OverviewSection({ stats }: { stats: AdminStats }) {
  return (
    <AdminSection title={<>Overview</>}
    >
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div>
          <span className="text-cs-muted">Users</span>
          <p className="text-lg font-semibold text-cs-text">{stats.total_users}</p>
        </div>
        <div>
          <span className="text-cs-muted">Active (30d)</span>
          <p className="text-lg font-semibold text-cs-text">{stats.active_users_30d}</p>
        </div>
        <div>
          <span className="text-cs-muted">Grants</span>
          <p className="text-lg font-semibold text-cs-text">{stats.total_grants}</p>
        </div>
        <div>
          <span className="text-cs-muted">Loans</span>
          <p className="text-lg font-semibold text-cs-text">{stats.total_loans}</p>
        </div>
        <div>
          <span className="text-cs-muted">Prices</span>
          <p className="text-lg font-semibold text-cs-text">{stats.total_prices}</p>
        </div>
        <div>
          <span className="text-cs-muted">DB Size</span>
          <p className="text-lg font-semibold text-cs-text">{formatBytes(stats.db_size_bytes)}</p>
        </div>
      </div>
    </AdminSection>
  )
}
