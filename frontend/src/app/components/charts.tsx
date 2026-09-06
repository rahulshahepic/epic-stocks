import { useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import type { TimelineEvent, PriceEntry } from '../../api.ts'
import { TODAY, filterByDateRange, numericTicks, todayIndex } from './chartAxes.ts'
import type { ChartColors, DateRange } from './chartAxes.ts'
import { fmt$, fmtDate, fmtFullDate, fmtNum, fmtPrice } from '../format.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'

/**
 * Chart primitives shared by the Dashboard and the no-account preview (/try).
 *
 * Dashboard-private until the preview needed the same three charts. They stay
 * purely presentational — everything arrives as props — so a caller holding
 * data in memory (the preview) and one holding data from the API (the
 * dashboard) render identically.
 */

export function RangeControls({ range, setRange, maxDate }: { range: DateRange; setRange: (r: DateRange) => void; maxDate: string }) {
  const isAll = range.mode === 'all'
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setRange({ mode: 'all', start: '', end: '' })}
        aria-pressed={isAll}
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
          isAll
            ? 'bg-cs-brand text-white'
            : 'bg-cs-raised text-cs-text-2 hover:bg-cs-border '
        }`}
      >
        All
      </button>
      <input
        type="date"
        aria-label="Range start date"
        value={range.mode === 'custom' ? range.start : ''}
        onChange={e => setRange({ mode: 'custom', start: e.target.value, end: range.end || maxDate })}
        className="h-6 rounded-md border border-cs-border-strong bg-cs-surface px-1 text-xs text-cs-text"
      />
      <span className="text-xs text-cs-text-2">–</span>
      <input
        type="date"
        aria-label="Range end date"
        value={range.mode === 'custom' ? range.end : ''}
        onChange={e => setRange({ mode: 'custom', start: range.start || '0000-01-01', end: e.target.value })}
        className="h-6 rounded-md border border-cs-border-strong bg-cs-surface px-1 text-xs text-cs-text"
      />
    </div>
  )
}

/** Find the index of the data point closest to today for the ReferenceLine. */
export function DetailCard({ items, onClose }: { items: { label: string; value: string }[]; onClose: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-cs-border bg-cs-raised px-3 py-2 ">
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {items.map(({ label, value }) => (
            <span key={label} className="text-xs text-cs-text-2">
              <span className="font-medium text-cs-text ">{value}</span>{' '}{label}
            </span>
          ))}
        </div>
        <button onClick={onClose} aria-label="Close detail panel" className="ml-2 shrink-0 text-xs text-cs-text-2 hover:text-cs-text-2 ">&times;</button>
      </div>
    </div>
  )
}

export function SharesChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
      .filter(e => e.cum_shares !== 0 || e.event_type === 'Exercise')
    return filtered.map((e, i) => {
      const isPast = !hasFuturePrices || e.date <= TODAY
      return {
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        shares: isPast ? e.cum_shares : null as number | null,
        projected: !isPast ? e.cum_shares : null as number | null,
      }
    }).map((d, i, arr) => {
      if (hasFuturePrices && d.shares !== null && (i === arr.length - 1 || arr[i + 1].projected !== null)) {
        return { ...d, projected: d.shares }
      }
      return d
    })
  }, [events, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#e11d48" strokeWidth={1.5} zIndex={600} />
          )}
          <Line type="monotone" dataKey="shares" stroke="#e11d48" strokeWidth={2} dot={false} name="Shares" connectNulls={false} />
          {hasFuturePrices && (
            <Line type="monotone" dataKey="projected" stroke="#e11d48" strokeWidth={2} dot={false} name="Projected" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'shares', value: fmtNum(sel._event.cum_shares) },
            ...(sel._event.event_type ? [{ label: '', value: sel._event.event_type }] : []),
            ...(sel._event.vested_shares ? [{ label: 'vested', value: fmtNum(sel._event.vested_shares) }] : []),
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Cumulative shares chart: {data.length} data points from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
        </p>
      )}
    </>
  )
}

export function IncomeCapGainsChart({ events, c, range, hasFuturePrices }: { events: TimelineEvent[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const hasDeduction = events.some(e => (e.interest_deduction_applied ?? 0) > 0)

  const data = useMemo(() => {
    const filtered = filterByDateRange(events, range, 'date')
    // Track the portion of income and cap gains attributable solely to future price changes.
    // RSU vests (grant_price=0) produce income; option vests (grant_price>0) produce cap gains.
    // For the future price event: price_cap_gains is entirely price-driven surplus.
    // For future vests after a price change: extra = cumFuturePriceIncrease × shares_vested.
    let cumFuturePriceIncrease = 0
    let cumSurplusIncome = 0
    let cumSurplusCg = 0
    const points = []
    for (const [i, e] of filtered.entries()) {
      if (hasFuturePrices && e.date > TODAY) {
        const vs = (e.vested_shares ?? 0)
        if (e.event_type === 'Share Price') {
          cumFuturePriceIncrease += e.price_increase
          cumSurplusCg += e.price_cap_gains
        } else if (cumFuturePriceIncrease > 0 && vs > 0) {
          if ((e.grant_price ?? 0) === 0) {
            cumSurplusIncome += cumFuturePriceIncrease * vs // RSU: extra shows as income
          } else {
            cumSurplusCg += cumFuturePriceIncrease * vs // option: extra shows as cap gains
          }
        }
      }
      points.push({
        _idx: i,
        _date: e.date,
        _label: fmtDate(e.date),
        _event: e,
        income: e.cum_income - cumSurplusIncome,
        gains: e.cum_cap_gains - cumSurplusCg,
        projExtraIncome: hasFuturePrices && cumSurplusIncome > 0 ? cumSurplusIncome : null as number | null,
        projExtra: hasFuturePrices && cumSurplusCg > 0 ? cumSurplusCg : null as number | null,
      })
    }
    return points
  }, [events, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{' '}
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Capital gains'}{' '}
              <tspan fill="#6ee7b7">&#9632;</tspan>/<tspan fill="#c4b5fd">&#9632;</tspan> Projected
            </text>
          )}
          {!hasFuturePrices && (
            <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
              <tspan fill="#10b981">&#9632;</tspan> Income{' '}
              <tspan fill="#8b5cf6">&#9632;</tspan> {'Capital gains'}
            </text>
          )}
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#8b5cf6" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Single stack: income + certain gains + projected extras (price-driven surplus) */}
          <Area type="monotone" dataKey="income" stackId="main" fill="#34d399" fillOpacity={0.7} stroke="#10b981" name="Income" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtraIncome" stackId="main" fill="#6ee7b7" fillOpacity={0.5} stroke="#6ee7b7" strokeDasharray="6 3" name="Proj Income" dot={false} />
          )}
          <Area type="monotone" dataKey="gains" stackId="main" fill="#a78bfa" fillOpacity={0.7} stroke="#8b5cf6" name="Capital gains" dot={false} />
          {hasFuturePrices && (
            <Area type="monotone" dataKey="projExtra" stackId="main" fill="#c4b5fd" fillOpacity={0.5} stroke="#c4b5fd" strokeDasharray="6 3" name="Projected capital gains" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'income', value: fmt$(sel._event.cum_income) },
            { label: 'capital gains', value: fmt$(sel._event.cum_cap_gains) },
            ...(hasDeduction && (sel._event.interest_deduction_applied ?? 0) > 0
              ? [{ label: 'interest deducted this event', value: fmt$(sel._event.interest_deduction_applied!) }]
              : []),
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Income and capital gains chart: {data.length} data points from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
        </p>
      )}
    </>
  )
}

export function PriceChart({ prices, c, range, hasFuturePrices }: { prices: PriceEntry[]; c: ChartColors; range: DateRange; hasFuturePrices: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)

  const data = useMemo(() => {
    const filtered = filterByDateRange(prices, range, 'effective_date')
    if (filtered.length === 0) return []

    const result = filtered.map((p, i) => {
      const isPast = !hasFuturePrices || p.effective_date <= TODAY
      return {
        _idx: i,
        _date: p.effective_date,
        _label: fmtDate(p.effective_date),
        _price: p.price,
        price: isPast ? p.price : null as number | null,
        projected: !isPast ? p.price : null as number | null,
      }
    })

    if (hasFuturePrices) {
      // Overlap: last past point also gets projected for line continuity
      const lastKnownIdx = result.findIndex(d => d._date > TODAY) - 1
      const overlapIdx = lastKnownIdx >= 0 ? lastKnownIdx : result.length - 1
      if (result[overlapIdx] && result.some(d => d.projected !== null)) {
        result[overlapIdx] = { ...result[overlapIdx], projected: result[overlapIdx].price ?? result[overlapIdx]._price }
      }
    }

    return result
  }, [prices, range, hasFuturePrices])

  const tIdx = todayIndex(data)
  const sel = selected !== null && selected < data.length ? data[selected] : null

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_idx" type="number" domain={[0, Math.max(0, data.length - 1)]} ticks={numericTicks(data.length)} tickFormatter={(i: number) => data[i]?._label ?? ''} tick={{ fontSize: 10, fill: c.axis }} padding={{ right: 10 }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#e11d48" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#e11d48', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#fbbf24" strokeWidth={1.5} zIndex={600} />
          )}
          <Line type="monotone" dataKey="price" stroke="#fbbf24" strokeWidth={2} dot={false} name="Price" connectNulls={false} />
          {hasFuturePrices && (
            <Line type="monotone" dataKey="projected" stroke="#fbbf24" strokeWidth={2} dot={false} name="Projected" strokeDasharray="6 3" opacity={0.5} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: '', value: fmtPrice(sel._price) },
          ]}
        />
      )}
      {/* (D) Screen-reader chart description */}
      {data.length > 0 && (
        <p className="sr-only">
          Share price history: {data.length} entries from {fmtFullDate(data[0]._date)} to {fmtFullDate(data[data.length - 1]._date)}.
          Most recent price: {fmtPrice(data[data.length - 1]._price)}.
        </p>
      )}
    </>
  )
}

export function ChartBox({ title, children, range, setRange, maxDate }: {
  title: string; children: React.ReactNode
  range?: DateRange; setRange?: (r: DateRange) => void; maxDate?: string
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cs-text">{title}</h3>
        {range && setRange && <RangeControls range={range} setRange={setRange} maxDate={maxDate ?? '2099-12-31'} />}
      </div>
      {children}
    </Card>
  )
}
