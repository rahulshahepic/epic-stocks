/**
 * Number, currency, percent and date formatting for the whole app.
 *
 * Every page used to carry its own `fmt$`/`fmtPrice`/`fmtNum`/`fmtPct`, and they
 * had drifted: some rounded to whole dollars, some to cents, some returned
 * "$NaN" for a figure that had not loaded yet. One copy each, here.
 */

const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})

const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

const GROUPED = new Intl.NumberFormat('en-US')

/** Dollars, no cents: "$1,235". Non-finite input renders as an em dash. */
export function fmt$(n: number): string {
  if (!isFinite(n)) return '—'
  return USD_WHOLE.format(n)
}

/** Dollars with cents: "$1,234.57". Used for per-share prices and loan amounts. */
export function fmtPrice(n: number): string {
  if (!isFinite(n)) return '—'
  return USD_CENTS.format(n)
}

/** Compact dollars for chart axes and the retirement projections: "$12.3M", "$450K". */
export function fmt$M(millions: number, digits = 2): string {
  if (!isFinite(millions)) return '—'
  const a = Math.abs(millions)
  if (a === 0) return '$0'
  if (a >= 100) return `$${millions.toFixed(0)}M`
  if (a >= 10) return `$${millions.toFixed(1)}M`
  if (a >= 1) return `$${millions.toFixed(digits)}M`
  if (a >= 0.001) return `$${(millions * 1000).toFixed(0)}K`
  return `$${(millions * 1_000_000).toFixed(0)}`
}

/** Grouped integer: "558,500". Null (a figure that isn't there) renders as an em dash. */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return GROUPED.format(n)
}

/** A rate held as a decimal, shown as a percentage: fmtPct(0.0307) === "3.07%". */
export function fmtPct(rate: number, digits = 2): string {
  if (!isFinite(rate)) return '—'
  return (rate * 100).toFixed(digits) + '%'
}

/** Chart axis label: "2021-03-01" → "03/21". */
export function fmtDate(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(2, 4)}`
}

/** "2021-03-01" → "Mar 1, 2021". */
export function fmtFullDate(d: string): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "2021-03-01" → "Mar 2021", for rows where the day carries no meaning. */
export function fmtMonthYear(d: string): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}
