import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis } from 'recharts'
import type { SystemMetricPoint } from '../../../api.ts'

export function Sparkline({ data, dataKey, color, formatter }: {
  data: SystemMetricPoint[]
  dataKey: keyof SystemMetricPoint
  color: string
  formatter?: (v: number) => string
}) {
  if (data.length === 0) {
    return <div className="flex h-16 items-center justify-center text-xs text-cs-text-2">collecting…</div>
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
