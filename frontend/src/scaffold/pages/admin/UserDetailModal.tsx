import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api.ts'
import type { AdminUser, UserDetail } from '../../../api.ts'
import { formatDate } from './format.ts'

/**
 * One user's record, and the actions an admin can take on it. Fetches its own
 * detail for the user it is given, so the page only has to say who is open.
 */
export function UserDetailModal({ user, onClose, onChanged, onNotify, onError }: {
  user: AdminUser
  onClose: () => void
  /** An action changed the user, so the list behind the dialog is now stale. */
  onChanged: () => void
  onNotify: (u: { id: number; name: string | null; email: string }) => void
  onError: (message: string) => void
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  // UserDetail does not carry this flag, so it is seeded from the row and
  // kept in step here rather than by refetching the whole list.
  const [isContentAdmin, setIsContentAdmin] = useState(user.is_content_admin)

  const reload = useCallback(async () => {
    try {
      setDetail(await api.adminUserDetail(user.id))
    } catch {
      onError('Failed to load user details')
    }
    // onError is a setState, stable for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setAction('')
    api.adminUserDetail(user.id)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) onError('Failed to load user details') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => onClose()}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-cs-surface p-5 shadow-xl " onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-cs-text">
              {user.email}
            </h3>
            <p className="text-xs text-cs-text-2">
              {user.name ?? 'No name'}
              {user.is_admin && (
                <span className="ml-1.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-cs-brand dark:bg-rose-900/40 dark:text-rose-300">
                  Admin
                </span>
              )}
            </p>
          </div>
          <button onClick={() => onClose()} aria-label="Close" className="text-cs-text-2 hover:text-cs-text-2 ">✕</button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
          </div>
        )}

        {detail && (
          <div className="space-y-4 text-xs">
            {/* User Info */}
            <div className="grid grid-cols-2 gap-2 text-cs-text-2">
              <p>Joined: {formatDate(detail.created_at)}</p>
              <p>Last login: {formatDate(detail.last_login)}</p>
              <p>{detail.grant_count} grants · {detail.loan_count} loans · {detail.price_count} prices</p>
              <p>{detail.push_subscriptions} push subscription{detail.push_subscriptions !== 1 ? 's' : ''}</p>
            </div>

            {/* Email & Notification Status */}
            <div className="rounded-md border border-cs-border p-3 ">
              <h4 className="mb-2 text-xs font-semibold text-cs-text">Email & Notifications</h4>
              <div className="space-y-1 text-cs-text-2">
                <p>Email notifications: {detail.email_notifications_enabled === null
                  ? 'Not configured'
                  : detail.email_notifications_enabled
                    ? <span className="text-green-600 dark:text-green-400">Enabled</span>
                    : <span className="text-red-500">Disabled (unsubscribed)</span>}
                {detail.email_notifications_enabled === false && (
                  <button
                    onClick={async () => {
                      setAction('reenable-email')
                      await api.adminReenableEmail(detail.id)
                      await reload()
                      setAction('')
                    }}
                    disabled={!!action}
                    className="ml-2 text-rose-600 hover:text-rose-800 underline "
                  >re-enable</button>
                )}
                </p>
                <p>Invitation opt-out: {detail.invitation_opt_out
                  ? <span className="text-red-500">Yes</span>
                  : <span className="text-green-600 dark:text-green-400">No</span>}
                {detail.invitation_opt_out && (
                  <button
                    onClick={async () => {
                      setAction('clear-optout')
                      await api.adminClearOptOutByEmail(detail.email)
                      await reload()
                      setAction('')
                    }}
                    disabled={!!action}
                    className="ml-2 text-rose-600 hover:text-rose-800 underline "
                  >clear</button>
                )}
                </p>
                <p>Sending invitations: {detail.sending_blocked
                  ? <span className="text-red-500">Blocked{detail.sending_block_reason ? ` — ${detail.sending_block_reason}` : ''}</span>
                  : <span className="text-green-600 dark:text-green-400">Allowed</span>}
                </p>
              </div>
            </div>

            {/* Invitations Sent */}
            {detail.invitations_sent.length > 0 && (
              <div className="rounded-md border border-cs-border p-3 ">
                <h4 className="mb-2 text-xs font-semibold text-cs-text">
                  Invitations Sent ({detail.invitations_sent.length})
                </h4>
                <div className="space-y-1">
                  {detail.invitations_sent.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between text-cs-text-2">
                      <span className="truncate">{inv.invitee_email}</span>
                      <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        inv.status === 'accepted' ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : inv.status === 'pending' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-cs-raised text-cs-text-2 '
                      }`}>{inv.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invitations Received */}
            {detail.invitations_received.length > 0 && (
              <div className="rounded-md border border-cs-border p-3 ">
                <h4 className="mb-2 text-xs font-semibold text-cs-text">
                  Viewing Data From ({detail.invitations_received.length})
                </h4>
                <div className="space-y-1">
                  {detail.invitations_received.map(inv => (
                    <div key={inv.id} className="text-cs-text-2">
                      {inv.inviter_name ?? inv.inviter_email}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="rounded-md border border-cs-border p-3 ">
              <h4 className="mb-2 text-xs font-semibold text-cs-text">Actions</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { onNotify({ id: detail.id, name: detail.name, email: detail.email }) }}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700"
                >
                  Send Notification
                </button>

                {detail.sending_blocked ? (
                  <button
                    onClick={async () => {
                      setAction('unblock-sending')
                      await api.adminUnblockSending(detail.id)
                      await reload()
                      setAction('')
                    }}
                    disabled={!!action}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                  >
                    Unblock Sending
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      const reason = prompt('Reason for blocking (optional):')
                      if (reason === null) return
                      setAction('block-sending')
                      await api.adminBlockSending(detail.id, reason)
                      await reload()
                      setAction('')
                    }}
                    disabled={!!action}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                  >
                    Block Sending
                  </button>
                )}

                {(detail.invitations_sent.some(i => i.status === 'pending' || i.status === 'accepted') ||
                  detail.invitations_received.length > 0) && (
                  <button
                    onClick={async () => {
                      if (!confirm('Reset all invitations? This revokes sent invitations and removes shared access.')) return
                      setAction('reset-invitations')
                      try {
                        const result = await api.adminResetInvitations(detail.id)
                        alert(`Revoked ${result.revoked_sent} sent, removed ${result.access_removed} received.`)
                        await reload()
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'Failed to reset invitations')
                      } finally {
                        setAction('')
                      }
                    }}
                    disabled={!!action}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                  >
                    Reset Invitations
                  </button>
                )}

                {!detail.is_admin && (
                  <button
                    onClick={async () => {
                      setAction('toggle-content-admin')
                      try {
                        await api.setContentAdmin(detail.id, !isContentAdmin)
                        setIsContentAdmin(v => !v)
                        await reload()
                        onChanged()
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'Failed to toggle content admin')
                      } finally {
                        setAction('')
                      }
                    }}
                    disabled={!!action}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50"
                  >
                    {isContentAdmin ? 'Revoke Content Admin' : 'Make Content Admin'}
                  </button>
                )}

                {!detail.is_admin && (
                  <button
                    onClick={async () => {
                      if (confirmDelete !== detail.id) {
                        setConfirmDelete(detail.id)
                        return
                      }
                      try {
                        await api.adminDeleteUser(detail.id)
                        onClose()
                        setConfirmDelete(null)
                        onChanged()
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'Failed to delete user')
                      }
                    }}
                    className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
                      confirmDelete === detail.id ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-400 hover:bg-gray-500'
                    }`}
                  >
                    {confirmDelete === detail.id ? 'Confirm Delete' : 'Delete User'}
                  </button>
                )}
              </div>
              {action && (
                <p className="mt-2 text-xs text-cs-muted">Processing...</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
