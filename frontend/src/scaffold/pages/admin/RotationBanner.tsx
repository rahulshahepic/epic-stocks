import { useState } from 'react'
import { api } from '../../../api.ts'

/**
 * Shown when a key rotation left a snapshot on disk: the database may hold keys
 * wrapped with the new master while the app still runs the old one.
 */
export function RotationBanner({ onRestored }: { onRestored: () => void }) {
  const [restoring, setRestoring] = useState(false)
  return (
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
            onRestored()
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
  )
}
