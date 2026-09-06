import { AdminSection } from './AdminSection.tsx'
import { useState } from 'react'
import { api } from '../../../api.ts'
import type { EmailLookupResult } from '../../../api.ts'

/** Trace one address: which account holds it, and what has been sent to it. */
export function EmailLookup({ onChanged, onError }: {
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [emailLookup, setEmailLookup] = useState('')
  const [emailLookupResult, setEmailLookupResult] = useState<EmailLookupResult | null>(null)
  const [emailLookupLoading, setEmailLookupLoading] = useState(false)

  async function handleEmailLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!emailLookup.trim()) return
    setEmailLookupLoading(true)
    setEmailLookupResult(null)
    try {
      setEmailLookupResult(await api.adminEmailLookup(emailLookup.trim()))
    } catch {
      onError('Email lookup failed')
    } finally {
      setEmailLookupLoading(false)
    }
  }

  return (
    <AdminSection title={<>Email Lookup</>}
    >
      <form onSubmit={handleEmailLookup} className="mt-2 flex gap-2">
        <input
          type="email"
          value={emailLookup}
          onChange={e => setEmailLookup(e.target.value)}
          placeholder="Search by exact email..."
          className="min-w-0 flex-1 rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          required
        />
        <button
          type="submit"
          disabled={emailLookupLoading}
          className="shrink-0 rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
        >
          {emailLookupLoading ? '...' : 'Lookup'}
        </button>
      </form>

      {emailLookupResult && (
        <div className="mt-3 rounded-md border border-cs-border p-3 text-xs ">
          <p className="font-medium text-cs-text">{emailLookupResult.email}</p>
          <div className="mt-2 space-y-1 text-cs-text-2">
            <p>Account: {emailLookupResult.has_account
              ? <span className="text-green-600 dark:text-green-400">Yes — {emailLookupResult.user_name ?? 'No name'} (id:{emailLookupResult.user_id})</span>
              : <span className="text-cs-muted">No account</span>}
            </p>
            <p>Email notifications: {emailLookupResult.email_notifications_enabled === null
              ? 'N/A' : emailLookupResult.email_notifications_enabled
                ? <span className="text-green-600 dark:text-green-400">Enabled</span>
                : <span className="text-red-500">Disabled</span>}
            </p>
            <p>Invitation opt-out: {emailLookupResult.invitation_opt_out
              ? <span className="text-red-500">Yes</span>
              : <span className="text-green-600 dark:text-green-400">No</span>}
            {emailLookupResult.invitation_opt_out && emailLookupResult.opt_out_id && (
              <button
                onClick={async () => {
                  await api.adminClearOptOut(emailLookupResult.opt_out_id!)
                  handleEmailLookup({ preventDefault: () => {} } as React.FormEvent)
                }}
                className="ml-2 text-rose-600 hover:text-rose-800 underline "
              >clear</button>
            )}
            </p>
            <p>Blocked from receiving: {emailLookupResult.blocked_from_receiving
              ? <span className="text-red-500">Yes{emailLookupResult.blocked_reason ? ` — ${emailLookupResult.blocked_reason}` : ''}</span>
              : <span className="text-green-600 dark:text-green-400">No</span>}
            {emailLookupResult.blocked_from_receiving && emailLookupResult.blocked_id && (
              <button
                onClick={async () => {
                  await api.adminUnblock(emailLookupResult.blocked_id!)
                  handleEmailLookup({ preventDefault: () => {} } as React.FormEvent)
                  onChanged()
                }}
                className="ml-2 text-rose-600 hover:text-rose-800 underline "
              >unblock</button>
            )}
            </p>
            {emailLookupResult.has_account && (
              <>
                <p>Sending blocked: {emailLookupResult.sending_blocked
                  ? <span className="text-red-500">Yes{emailLookupResult.sending_block_reason ? ` — ${emailLookupResult.sending_block_reason}` : ''}</span>
                  : <span className="text-green-600 dark:text-green-400">No</span>}
                {emailLookupResult.sending_blocked && emailLookupResult.user_id && (
                  <button
                    onClick={async () => {
                      await api.adminUnblockSending(emailLookupResult.user_id!)
                      handleEmailLookup({ preventDefault: () => {} } as React.FormEvent)
                    }}
                    className="ml-2 text-rose-600 hover:text-rose-800 underline "
                  >unblock</button>
                )}
                </p>
                <p>Invitations sent: {emailLookupResult.invitations_sent} · Received: {emailLookupResult.invitations_received}</p>
                {emailLookupResult.email_notifications_enabled === false && emailLookupResult.user_id && (
                  <button
                    onClick={async () => {
                      await api.adminReenableEmail(emailLookupResult.user_id!)
                      handleEmailLookup({ preventDefault: () => {} } as React.FormEvent)
                    }}
                    className="mt-1 text-rose-600 hover:text-rose-800 underline "
                  >Re-enable email notifications</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  )
}
