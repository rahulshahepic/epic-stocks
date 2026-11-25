import { useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  ChartBox, DetailCard, IncomeCapGainsChart, PriceChart, SharesChart,
} from '../../components/charts.tsx'
import {
  filterByDateRange, numericTicks, smartInterval, todayIndex,
  type ChartColors, type DateRange,
} from '../../components/chartAxes.ts'
import { fmt$, fmtDate, fmtFullDate } from '../../format.ts'
import type {
  PriceEntry, TimelineEvent,
} from '../../../api.ts'
import type { DashboardChartsData } from '../Dashboard.types.ts'

function TaxChart({ rows, c, range }: {
  rows: DashboardChartsData['charts']['tax']; c: ChartColors; range: DateRange
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const data = useMemo(() => filterByDateRange(rows, range, 'date').map((row, i) => ({
    _idx: i, _date: row.date, _label: fmtDate(row.date),
    taxSure: row.projected ? null : row.estimated, taxFuture: row.projected ? row.estimated : null, taxPaid: row.paid || null,
  })), [rows, range])
  const hasProjections = rows.some(row => row.projected)
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
          <text x="50%" y={16} textAnchor="middle" fontSize={10} fill={c.axis}>
            <tspan fill="#fb923c">&#9632;</tspan> Est. Tax{' '}
            {hasProjections && <><tspan fill="#fed7aa">&#9632;</tspan> +Projected{' '}</>}
            <tspan fill="#ef4444">&#9632;</tspan> Paid
          </text>
          {tIdx !== null && <ReferenceLine x={tIdx} stroke="#60a5fa" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#60a5fa', position: 'top' }} />}
          {selected !== null && selected < data.length && (
            <ReferenceLine x={selected} stroke="#fb923c" strokeWidth={1.5} zIndex={600} />
          )}
          {/* Server-estimated liability and recorded payments. */}
          <Area type="monotone" dataKey="taxSure" stackId="tax" fill="#fb923c" fillOpacity={0.7} stroke="#ea580c" name="Est. Tax" dot={false} />
          {hasProjections && <Area type="monotone" dataKey="taxFuture" fill="#fed7aa" fillOpacity={0.5} stroke="#fed7aa" strokeDasharray="6 3" name="Projected tax" dot={false} />}
          {/* Paid area overlaid (not stacked) — fills the tax-loan-covered region */}
          <Area type="monotone" dataKey="taxPaid" fill="#fca5a5" fillOpacity={0.45} stroke="#ef4444" strokeWidth={2} dot={false} name="Tax Paid" connectNulls />
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: fmtFullDate(sel._date) },
            { label: 'estimated tax', value: fmt$(sel.taxSure ?? sel.taxFuture ?? 0) },
            ...(sel.taxPaid ? [{ label: 'tax paid', value: fmt$(sel.taxPaid) }] : []),
          ]}
        />
      )}
    </>
  )
}

function InterestChart({ rows, c, range }: { rows: DashboardChartsData['charts']['interest']; c: ChartColors; range: DateRange }) {
  const [selected, setSelected] = useState<number | null>(null)
  const data = useMemo(() => rows.map(row => ({
    _date: row.date, _label: row.date.slice(0, 4), guaranteed: row.recorded, projected: row.projected || null,
  })), [rows])

  if (data.length === 0) return null

  const displayed = filterByDateRange(data, range, '_date')
  const tIdx = todayIndex(displayed)
  const sel = selected !== null && selected < displayed.length ? displayed[selected] : null
  const hasProjected = displayed.some(d => d.projected !== null && d.projected > 0)

  return (
    <>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span className="text-[#fb7185]">&#9632;</span> Recorded{' '}
        {hasProjected && <><span className="text-[#fda4af]">&#9632;</span> + Projected interest</>}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={displayed} onClick={(state) => {
          if (state?.activeTooltipIndex != null) setSelected(Number(state.activeTooltipIndex))
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="_label" tick={{ fontSize: 10, fill: c.axis }} interval={smartInterval(displayed.length)} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          {tIdx !== null && <ReferenceLine x={displayed[tIdx]._label} stroke="#f59e0b" strokeDasharray="4 4" zIndex={600} label={{ value: 'Today', fontSize: 10, fill: '#f59e0b', position: 'top' }} />}
          {selected !== null && selected < displayed.length && (
            <ReferenceLine x={displayed[selected]._label} stroke="#fb7185" strokeWidth={1.5} zIndex={600} />
          )}
          <Area type="monotone" dataKey="guaranteed" stackId="i" fill="#fb7185" fillOpacity={0.7} stroke="#e11d48" name="Recorded" dot={false} />
          {hasProjected && (
            <Area type="monotone" dataKey="projected" stackId="i" fill="#fda4af" fillOpacity={0.4} stroke="#fda4af" strokeDasharray="6 3" name="Projected interest" dot={false} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {sel && (
        <DetailCard
          onClose={() => setSelected(null)}
          items={[
            { label: '', value: String(sel._label) },
            { label: 'cumulative interest', value: fmt$(sel.guaranteed + (sel.projected ?? 0)) },
            ...(sel.projected ? [{ label: 'of which est.', value: fmt$(sel.projected) }] : []),
          ]}
        />
      )}
    </>
  )
}

function LoanChart({ loanPaymentByYear, c, range, setRange, maxDate }: {
  loanPaymentByYear: { year: string; payoff_sale: number; cash_in: number }[]
  c: ChartColors
  range: DateRange; setRange: (r: DateRange) => void; maxDate: string
}) {
  if (!loanPaymentByYear || loanPaymentByYear.length === 0) return null
  const displayed = range.mode === 'all' ? loanPaymentByYear
    : loanPaymentByYear.filter(d => {
      const y = d.year + '-01-01'
      return y >= range.start && y <= range.end
    })
  return (
    <ChartBox title="Loan Payments by Due Year" range={range} setRange={setRange} maxDate={maxDate}>
      <div className="mb-2 text-center text-[10px]" style={{ color: c.axis }}>
        <span className="text-[#4ade80]">&#9632;</span> Payoff sale{' '}
        <span className="text-[#fb923c]">&#9632;</span> Cash in
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={displayed}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: c.axis }} />
          <YAxis tick={{ fontSize: 10, fill: c.axis }} />
          <Bar dataKey="payoff_sale" stackId="a" fill="#4ade80" name="Payoff sale" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cash_in" stackId="a" fill="#fb923c" name="Cash in" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** Every chart on the dashboard, in the order they appear. */
export function DashboardCharts({
  events, prices, dash, c,
  range, setRange, rangeInterest, setRangeInterest, rangeLoan, setRangeLoan,
  maxDate, hasFuturePrices,
}: {
  events: TimelineEvent[] | null
  prices: PriceEntry[] | null
  dash: DashboardChartsData
  c: ChartColors
  range: DateRange
  setRange: (r: DateRange) => void
  rangeInterest: DateRange
  setRangeInterest: (r: DateRange) => void
  rangeLoan: DateRange
  setRangeLoan: (r: DateRange) => void
  maxDate: string
  hasFuturePrices: boolean
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {events && events.length > 0 && (
        <ChartBox className="md:col-span-2" title="Shares Over Time" range={range} setRange={setRange} maxDate={maxDate}>
          <SharesChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {events?.some(e => e.cum_income !== 0 || e.cum_cap_gains !== 0) && (
        <ChartBox title="Income vs capital gains" range={range} setRange={setRange} maxDate={maxDate}>
          <IncomeCapGainsChart events={events} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {prices && prices.length > 0 && (
        <ChartBox title="Share Price History" range={range} setRange={setRange} maxDate={maxDate}>
          <PriceChart prices={prices} c={c} range={range} hasFuturePrices={hasFuturePrices} />
        </ChartBox>
      )}
      {dash.charts.tax.some(row => row.estimated !== 0 || row.paid !== 0) && (
        <ChartBox title="Estimated Tax Liability" range={range} setRange={setRange} maxDate={maxDate}>
          <TaxChart rows={dash.charts.tax} c={c} range={range} />
        </ChartBox>
      )}
      {dash.charts.interest.some(row => row.recorded !== 0 || row.projected !== 0) && (
        <ChartBox title="Interest Over Time" range={rangeInterest} setRange={setRangeInterest} maxDate={maxDate}>
          <InterestChart rows={dash.charts.interest} c={c} range={rangeInterest} />
        </ChartBox>
      )}
      {dash.loan_payment_by_year && dash.loan_payment_by_year.length > 0 && (
        <LoanChart loanPaymentByYear={dash.loan_payment_by_year} c={c} range={rangeLoan} setRange={setRangeLoan} maxDate={maxDate} />
      )}
    </div>
  )
}
