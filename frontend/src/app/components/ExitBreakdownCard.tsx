import type { ExitSummary } from '../../api.ts'

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n: number | null) {
  return n != null ? n.toLocaleString('en-US') : '—'
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-400'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export default function ExitBreakdownCard({ s }: { s: ExitSummary }) {
  const hasSales = s.prior_sales.length > 0
  const hasDeduction = s.deduction_savings > 0
  const liqNet = Math.max(0, s.gross_vested + s.unvested_cost_proceeds - s.liquidation_tax - s.outstanding_principal)
  const yearsLabel = s.deduction_years.length > 0
    ? s.deduction_years.length === 1
      ? String(s.deduction_years[0])
      : `${s.deduction_years[0]}–${s.deduction_years[s.deduction_years.length - 1]}`
    : ''

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">Exit Breakdown</h3>

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Liquidation Sale</p>
        <Row label={`${fmtNum(s.vested_shares)} vested × ${fmtPrice(s.share_price)}`} value={fmt$(s.gross_vested)} />
        {s.unvested_cost_proceeds > 0 && (
          <Row label="Unvested at cost basis" value={fmt$(s.unvested_cost_proceeds)} />
        )}
        <Row label="Est. tax on liquidation" value={`−${fmt$(s.liquidation_tax)}`} />
        {s.outstanding_principal > 0 && (
          <Row label="Loan principal payoff" value={`−${fmt$(s.outstanding_principal)}`} />
        )}
        <div className="my-1.5 border-t border-stone-200 dark:border-slate-600" />
        <Row label="Net from liquidation" value={fmt$(liqNet)} bold />
      </div>

      {hasSales && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">
            Prior Sales ({s.prior_sales.length})
          </p>
          {s.prior_sales.map((sale, i) => (
            <div key={i} className="space-y-0.5">
              <Row
                label={`${sale.date}  ${fmtNum(sale.shares)} sh × ${fmtPrice(sale.price_per_share)}`}
                value={fmt$(sale.net)}
              />
              <p className="pl-2 text-[10px] text-stone-400 dark:text-slate-500">
                {fmt$(sale.proceeds)} proceeds
                {sale.estimated_tax > 0 ? ` − ${fmt$(sale.estimated_tax)} tax` : ''}
                {sale.loan_payoff > 0 ? ` − ${fmt$(sale.loan_payoff)} loan` : ''}
              </p>
            </div>
          ))}
          <div className="my-1.5 border-t border-stone-200 dark:border-slate-600" />
          <Row label="Net from prior sales" value={fmt$(s.prior_sales_net)} bold />
        </div>
      )}

      {(hasDeduction || s.deduction_excluded_years.length > 0) && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-slate-500">Interest Deduction</p>
          {hasDeduction && (
            <Row label={`Tax savings${yearsLabel ? ` (${yearsLabel})` : ''}`} value={`+${fmt$(s.deduction_savings)}`} />
          )}
          {s.deduction_excluded_years.length > 0 && (
            <p className="text-[10px] text-stone-400 dark:text-slate-500">
              {s.deduction_excluded_years.length <= 5
                ? `Not applied to ${s.deduction_excluded_years.join(', ')}.`
                : `Not applied to ${s.deduction_excluded_years.length} years (${s.deduction_excluded_years[0]}–${s.deduction_excluded_years[s.deduction_excluded_years.length - 1]}).`
              }
              {' '}<a href="/settings" className="underline hover:text-stone-600 dark:hover:text-slate-300">Customize</a>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 border-t-2 border-stone-300 pt-2 dark:border-slate-500">
        <Row label="Total cash at exit" value={fmt$(s.net_cash)} bold />
      </div>
    </div>
  )
}
