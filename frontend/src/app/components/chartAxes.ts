import { useDark } from '../../scaffold/hooks/useDark.ts'

/**
 * Date-range and axis helpers the chart components and their callers share.
 *
 * Split out of charts.tsx so that file exports only components: Vite's fast
 * refresh falls back to a full page reload for any module that mixes the two.
 */

/** Compute ~maxTicks evenly-spaced numeric indices for a dataset of length len. */
export function numericTicks(len: number, maxTicks = 6): number[] {
  if (len === 0) return []
  if (len <= maxTicks) return Array.from({ length: len }, (_, i) => i)
  return Array.from({ length: maxTicks }, (_, k) => Math.round(k * (len - 1) / (maxTicks - 1)))
}

/** @deprecated use numericTicks instead */
export function smartInterval(len: number, maxTicks = 6): number {
  if (len <= maxTicks) return 0
  return Math.ceil(len / maxTicks) - 1
}

export const TODAY = new Date().toISOString().slice(0, 10)

export type RangeMode = 'all' | 'custom'

export interface DateRange {
  mode: RangeMode
  start: string
  end: string
}

export function filterByDateRange<T>(items: T[], range: DateRange, dateKey: keyof T): T[] {
  if (range.mode === 'all') return items
  return items.filter(item => {
    const d = item[dateKey] as string
    return d >= range.start && d <= range.end
  })
}

export function todayIndex(data: { _date: string }[]): number | null {
  for (let i = 0; i < data.length; i++) {
    if (data[i]._date >= TODAY) return i
  }
  return null
}

export interface ChartColors {
  grid: string
  axis: string
  tooltipBg: string
  tooltipText: string
}

export function useChartColors(): ChartColors {
  const dark = useDark()
  return dark
    ? { grid: '#252220', axis: '#A8998F', tooltipBg: '#1C1917', tooltipText: '#F2EDE8' }
    : { grid: '#EAE7E3', axis: '#6B5F58', tooltipBg: '#ffffff', tooltipText: '#1A1411' }
}
