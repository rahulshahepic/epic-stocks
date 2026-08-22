import type { ReactNode } from 'react'
import { Card } from './Card.tsx'

/**
 * Shared chart container: title + optional right-aligned controls (range
 * pickers, legends) above the chart body. Used across Dashboard and
 * Retirement so every chart on the site shares one card treatment.
 */
export function ChartCard({
  title,
  controls,
  legend,
  children,
}: {
  title: string
  controls?: ReactNode
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <Card padded={false} className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cs-text">{title}</h3>
        {controls}
      </div>
      {legend && <div className="mb-2">{legend}</div>}
      {children}
    </Card>
  )
}
