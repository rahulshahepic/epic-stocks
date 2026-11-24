import type { ExitPreview, SaleEstimate, TimelineEvent } from '../api.ts'
import type { DashboardSnapshot } from './pages/Dashboard.types.ts'
import type { FanPercentiles } from './pages/Retirement.math.ts'

export type DemoProfile = 'early' | 'established' | 'exit'
export const DEMO_DATE = '2026-11-24'
export interface DemoData {
  fictional: true
  version: number
  profile: DemoProfile
  profiles: Record<
    DemoProfile,
    {
      label: string
      tenure: number
      age: number
      other_assets_m: number
      spend_k: number
    }
  >
  as_of: string
  dashboard: DashboardSnapshot
  events: TimelineEvent[]
  exit: ExitPreview | null
  sale: SaleEstimate | null
  assumptions: string
}
export interface DemoSimulation {
  pctRuin: number
  medianFinalM: number
  startingTotal: number
  fan: FanPercentiles[]
}
export async function loadDemo(
  profile: DemoProfile,
  asOf: string,
  signal: AbortSignal,
  saleShares?: number
): Promise<DemoData> {
  const response = await fetch('/api/demo/preview', {
    method: 'POST',
    credentials: 'omit',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile,
      as_of: asOf,
      ...(saleShares == null ? {} : { sale_shares: saleShares })
    })
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : 'The demo could not load. Please retry.'
    )
  }
  return response.json()
}
