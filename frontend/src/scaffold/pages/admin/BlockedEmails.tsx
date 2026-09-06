import { AdminSection } from './AdminSection.tsx'
import { useState } from 'react'
import { api } from '../../../api.ts'
import type { BlockedEmailEntry } from '../../../api.ts'

/** Addresses no invitation may be sent to, and the form for adding one. */
export function BlockedEmails({ blocked, onChanged, onError }: {
  blocked: BlockedEmailEntry[]
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [blockEmail, setBlockEmail] = useState('')
  const [blockReason, setBlockReason] = useState('')

  async function handleBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blockEmail.trim()) return
    try {
      await api.adminBlockEmail(blockEmail.trim(), blockReason.trim())
      setBlockEmail('')
      setBlockReason('')
      onChanged()
    } catch {
      onError('Failed to block email')
    }
  }

  async function handleUnblock(id: number) {
    await api.adminUnblock(id)
    onChanged()
  }

  return (
    <AdminSection title={<>Blocked Emails</>}
    >
      <form onSubmit={handleBlock} className="mt-3 space-y-2">
        <input
          type="email"
          value={blockEmail}
          onChange={e => setBlockEmail(e.target.value)}
          placeholder="email@example.com"
          className="w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          required
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            placeholder="Reason (optional)"
            className="min-w-0 flex-1 rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          />
          <button type="submit" className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Block
          </button>
        </div>
      </form>

      {blocked.length > 0 && (
        <div className="mt-3 space-y-1">
          {blocked.map(b => (
            <div key={b.id} className="flex items-center justify-between rounded-md border border-cs-border p-2 text-xs ">
              <div>
                <span className="font-medium text-cs-text">{b.email}</span>
                {b.reason && <span className="ml-2 text-cs-text-2">({b.reason})</span>}
              </div>
              <button onClick={() => handleUnblock(b.id)} className="rounded px-2 py-1 text-xs text-cs-brand hover:bg-rose-50 dark:hover:bg-rose-900/30">
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}

      {blocked.length === 0 && (
        <p className="mt-3 text-xs text-cs-text-2">No blocked emails.</p>
      )}
    </AdminSection>
  )
}
