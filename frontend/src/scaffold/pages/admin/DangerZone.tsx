import { useRef, useState } from 'react'
import { api } from '../../../api.ts'
import type { RotationEvent } from '../../../api.ts'

/**
 * The switches that change how the whole app behaves, and the master-key
 * rotation. The values themselves come from the page — they are part of the
 * load that gates its "Loading…" screen — but every in-flight flag and the
 * rotation's own log live here.
 */
export function DangerZone({
  maintenanceActive, setMaintenanceActive,
  epicModeActive, setEpicModeActive,
  flexiblePayoffActive, setFlexiblePayoffActive,
  onSnapshotChanged, onError,
}: {
  maintenanceActive: boolean | null
  setMaintenanceActive: (v: boolean) => void
  epicModeActive: boolean | null
  setEpicModeActive: (v: boolean) => void
  flexiblePayoffActive: boolean | null
  setFlexiblePayoffActive: (v: boolean) => void
  onSnapshotChanged: (exists: boolean) => void
  onError: (message: string) => void
}) {
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [epicModeLoading, setEpicModeLoading] = useState(false)
  const [flexiblePayoffLoading, setFlexiblePayoffLoading] = useState(false)
  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotationConfirm, setRotationConfirm] = useState(false)
  const [rotationRunning, setRotationRunning] = useState(false)
  const [rotationLog, setRotationLog] = useState<RotationEvent[]>([])
  const rotationLogRef = useRef<HTMLDivElement>(null)

  return (
    <section className="rounded-lg border border-red-200 bg-cs-surface p-4 dark:border-red-900/60 ">
      <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">⚠ Danger Zone</h3>

      {/* Maintenance Mode Toggle */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-cs-text">Maintenance Mode</p>
            <p className="text-xs text-cs-muted">
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
                onError('Failed to toggle maintenance mode')
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
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
            Site is currently in maintenance mode. Users see a 503 page.
          </p>
        )}
      </div>

      <hr className="my-4 border-red-100 dark:border-red-900/40" />

      {/* Epic Mode Toggle */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-cs-text">Epic Mode</p>
            <p className="text-xs text-cs-muted">
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
                onError('Failed to toggle Epic Mode')
              } finally {
                setEpicModeLoading(false)
              }
            }}
            className={`ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
              epicModeActive
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-cs-brand hover:bg-cs-brand-hover'
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
          <p className="mt-1.5 text-xs text-cs-brand">
            Epic Mode is active. Grant/price/loan writes are blocked for all users.
          </p>
        )}
      </div>

      <hr className="my-4 border-red-100 dark:border-red-900/40" />

      {/* Flexible Loan Payoff Methods */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-cs-text">Flexible Loan Payoff Methods</p>
            <p className="text-xs text-cs-muted">
              When enabled, users with sufficient stock coverage can choose Epic LIFO, LIFO, FIFO, or manual lot
              selection for payoff sales instead of the default same-tranche method.
            </p>
          </div>
          <button
            disabled={flexiblePayoffActive === null || flexiblePayoffLoading}
            onClick={async () => {
              setFlexiblePayoffLoading(true)
              try {
                const res = await api.adminSetFlexiblePayoff(!flexiblePayoffActive)
                setFlexiblePayoffActive(res.active)
              } catch {
                onError('Failed to toggle flexible payoff')
              } finally {
                setFlexiblePayoffLoading(false)
              }
            }}
            className={`ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
              flexiblePayoffActive
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-cs-brand hover:bg-cs-brand-hover'
            }`}
          >
            {flexiblePayoffLoading
              ? '…'
              : flexiblePayoffActive === null
                ? 'Loading'
                : flexiblePayoffActive
                  ? 'Disable'
                  : 'Enable'}
          </button>
        </div>
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
            <p className="text-xs text-cs-text-2">
              Generates a new master key, re-wraps all user encryption keys, and saves
              the new key to disk. Triggers a brief maintenance window automatically.
              No deploy needed — the new key is live immediately.
            </p>

            {rotationLog.length > 0 && (
              <div
                ref={rotationLogRef}
                className="max-h-48 overflow-y-auto rounded-md border border-cs-border bg-cs-raised p-2 text-xs font-mono "
              >
                {rotationLog.map((e, i) => (
                  <div
                    key={i}
                    className={
                      e.step === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : e.step === 'rollback'
                          ? 'text-amber-700 dark:text-amber-300'
                          : e.step === 'done'
                            ? 'text-green-700 dark:text-green-300 font-semibold'
                            : 'text-cs-text-2'
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
                  <p className="text-xs font-medium text-green-700 dark:text-green-300">
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
                  <span className="text-xs text-cs-text-2">Are you sure?</span>
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
                          onSnapshotChanged(rs.snapshot_exists)
                        }).catch(() => {})
                      }
                    }}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Yes, Rotate
                  </button>
                  <button
                    onClick={() => setRotationConfirm(false)}
                    className="text-xs text-cs-muted hover:text-cs-text-2 "
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
  )
}
