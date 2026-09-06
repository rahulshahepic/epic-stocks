import { AdminSection } from './AdminSection.tsx'
import type { AdminUser } from '../../../api.ts'
import { formatDate } from './format.ts'

/** The user list and its search box. */
export function UsersSection({ users, totalUsers, searchInput, onSearchInput, onOpenUser }: {
  users: AdminUser[]
  totalUsers: number
  searchInput: string
  onSearchInput: (v: string) => void
  onOpenUser: (u: AdminUser) => void
}) {
  return (
    <AdminSection title={<>Users ({totalUsers})</>}
    >
      <input
        type="text"
        value={searchInput}
        onChange={e => onSearchInput(e.target.value)}
        placeholder="Search by email or name..."
        className="mt-2 w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
      />
      <div className="mt-3 space-y-2">
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => onOpenUser(u)}
            className="flex w-full items-center justify-between rounded-md border border-cs-border p-2 text-left text-xs transition-colors hover:bg-cs-raised "
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-cs-text">
                {u.email}
                {u.is_admin && (
                  <span className="ml-1.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-cs-brand dark:bg-rose-900/40 dark:text-rose-300">
                    Admin
                  </span>
                )}
                {!u.is_admin && u.is_content_admin && (
                  <span className="ml-1.5 inline-block rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    Content admin
                  </span>
                )}
              </p>
              <p className="text-cs-muted">
                {u.name ?? 'No name'} · Joined {formatDate(u.created_at)} · Last login {formatDate(u.last_login)}
              </p>
              <p className="text-cs-text-2">
                {u.grant_count} grants · {u.loan_count} loans · {u.price_count} prices
              </p>
            </div>
            <span className="ml-2 shrink-0 text-cs-muted">&#9656;</span>
          </button>
        ))}
        {users.length === 0 && (
          <p className="text-xs text-cs-text-2">
            {searchInput ? 'No users match your search.' : 'No users.'}
          </p>
        )}
      </div>
    </AdminSection>
  )
}
