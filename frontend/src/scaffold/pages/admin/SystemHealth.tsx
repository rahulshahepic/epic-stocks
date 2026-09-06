import { AdminSection } from './AdminSection.tsx'
import type { AdminStats, SystemMetricPoint } from '../../../api.ts'
import { Sparkline } from './Sparkline.tsx'
import { formatBytes } from './format.ts'

/** Time windows the System Health charts can be scoped to. */
const METRIC_WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '72h', hours: 72 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

/** CPU, memory and disk now, plus their history over the chosen window. */
export function SystemHealth({ stats, metrics, metricHours, onWindowChange }: {
  stats: AdminStats | null
  metrics: SystemMetricPoint[]
  metricHours: number
  onWindowChange: (hours: number) => void
}) {
  const ramPercent = stats?.ram_used_mb && stats?.ram_total_mb
    ? Math.round((stats.ram_used_mb / stats.ram_total_mb) * 100)
    : null
  return (
    <AdminSection title={<>System Health</>}
      action={(
        <div className="flex gap-1">
          {METRIC_WINDOWS.map(w => (
            <button
              key={w.hours}
              onClick={() => onWindowChange(w.hours)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                metricHours === w.hours
                  ? 'bg-cs-brand text-white'
                  : 'text-cs-muted hover:text-cs-text dark:hover:text-gray-100'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
    >

      {/* Current readings */}
      {stats && (
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-cs-muted">CPU</span>
            <p className="text-lg font-semibold text-cs-text">
              {stats.cpu_percent != null ? `${stats.cpu_percent.toFixed(0)}%` : '—'}
            </p>
          </div>
          <div>
            <span className="text-cs-muted">RAM</span>
            <p className="text-lg font-semibold text-cs-text">
              {ramPercent != null ? `${ramPercent}%` : '—'}
            </p>
            {stats.ram_used_mb != null && stats.ram_total_mb != null && (
              <p className="text-cs-text-2">
                {(stats.ram_used_mb / 1024).toFixed(1)} / {(stats.ram_total_mb / 1024).toFixed(1)} GB
              </p>
            )}
          </div>
          <div>
            <span className="text-cs-muted">DB</span>
            <p className="text-lg font-semibold text-cs-text">{formatBytes(stats.db_size_bytes)}</p>
          </div>
        </div>
      )}

      {/* Sparklines */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="mb-1 text-xs text-cs-muted">CPU %</p>
          <Sparkline
            data={metrics}
            dataKey="cpu_percent"
            color="#6366f1"
            formatter={v => `${v.toFixed(1)}%`}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-cs-muted">RAM %</p>
          <Sparkline
            data={metrics.map(m => ({ ...m, ram_percent: Math.round((m.ram_used_mb / m.ram_total_mb) * 100) }))}
            dataKey={'ram_percent' as keyof SystemMetricPoint}
            color="#10b981"
            formatter={v => `${v.toFixed(0)}%`}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-cs-muted">DB size</p>
          <Sparkline
            data={metrics}
            dataKey="db_size_bytes"
            color="#f59e0b"
            formatter={v => formatBytes(v)}
          />
        </div>
        {metrics.some(m => m.cache_l1_hits != null) && (
          <div>
            <p className="mb-1 text-xs text-cs-muted">Cache hit rate</p>
            <Sparkline
              data={metrics.map((m, i) => {
                const prev = i > 0 ? metrics[i - 1] : null
                // Use per-interval deltas so restarts and zero-traffic points don't flatten the chart.
                // Negative deltas (counter reset on restart) are clamped to 0.
                const dl1 = Math.max(0, (m.cache_l1_hits ?? 0) - (prev?.cache_l1_hits ?? 0))
                const dl2 = Math.max(0, (m.cache_l2_hits ?? 0) - (prev?.cache_l2_hits ?? 0))
                const dm = Math.max(0, (m.cache_misses ?? 0) - (prev?.cache_misses ?? 0))
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
    </AdminSection>
  )
}
