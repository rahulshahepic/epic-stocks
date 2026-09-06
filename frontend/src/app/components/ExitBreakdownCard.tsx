import type { ExitSummary } from '../../api.ts'
import { fmt$, fmtNum, fmtPrice } from '../format.ts'

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-cs-text' : 'text-cs-text-2'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export default function ExitBreakdownCard({ s }: { s: ExitSummary }) {
  const hasSales = s.prior_sales.length > 0
  const hasDeduction = s.deduction_savings > 0
  const liqNet = Math.max(0, s.gross_vested + s.unvested_cost_proceeds - s.liquidation_tax - s.outstanding_principal - s.outstanding_accrued_interest)
  const yearsLabel = s.deduction_years.length > 0
    ? s.deduction_years.length === 1
      ? String(s.deduction_years[0])
      : `${s.deduction_years[0]}–${s.deduction_years[s.deduction_years.length - 1]}`
    : ''

  return (
    <div className="rounded-xl border border-cs-border bg-cs-raised p-4 text-xs ">
      <h3 className="mb-3 text-sm font-semibold text-cs-text">Exit Breakdown</h3>

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-cs-muted">Liquidation Sale</p>
        <Row label={`${fmtNum(s.vested_shares)} vested × ${fmtPrice(s.share_price)}`} value={fmt$(s.gross_vested)} />
        {s.unvested_cost_proceeds > 0 && (
          <Row label="Unvested at cost basis" value={fmt$(s.unvested_cost_proceeds)} />
        )}
        <Row label="Est. tax on liquidation" value={`−${fmt$(s.liquidation_tax)}`} />
        {s.outstanding_principal > 0 && (
          <Row label="Loan principal payoff" value={`−${fmt$(s.outstanding_principal)}`} />
        )}
        {s.outstanding_accrued_interest > 0 && (
          <Row label="Accrued interest (projected)" value={`−${fmt$(s.outstanding_accrued_interest)}`} />
        )}
        <div className="my-1.5 border-t border-cs-border-strong" />
        <Row label="Net from liquidation" value={fmt$(liqNet)} bold />
      </div>

      {hasSales && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-cs-muted">
            Prior Sales ({s.prior_sales.length})
          </p>
          {s.prior_sales.map((sale, i) => (
            <div key={i} className="space-y-0.5">
              <Row
                label={`${sale.date} ${fmtNum(sale.shares)} sh × ${fmtPrice(sale.price_per_share)}`}
                value={fmt$(sale.net)}
              />
              <p className="pl-2 text-[10px] text-cs-muted">
                {fmt$(sale.proceeds)} proceeds
                {sale.estimated_tax > 0 ? ` − ${fmt$(sale.estimated_tax)} tax` : ''}
                {sale.loan_payoff > 0 ? ` − ${fmt$(sale.loan_payoff)} loan` : ''}
              </p>
            </div>
          ))}
          <div className="my-1.5 border-t border-cs-border-strong" />
          <Row label="Net from prior sales" value={fmt$(s.prior_sales_net)} bold />
        </div>
      )}

      {(hasDeduction || s.deduction_excluded_years.length > 0) && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-cs-muted">Interest Deduction</p>
          {hasDeduction && (
            <Row label={`Tax savings${yearsLabel ? ` (${yearsLabel})` : ''}`} value={`+${fmt$(s.deduction_savings)}`} />
          )}
          {s.deduction_excluded_years.length > 0 && (
            <p className="text-[10px] text-cs-muted">
              {s.deduction_excluded_years.length <= 5
                ? `Not applied to ${s.deduction_excluded_years.join(', ')}.`
                : `Not applied to ${s.deduction_excluded_years.length} years (${s.deduction_excluded_years[0]}–${s.deduction_excluded_years[s.deduction_excluded_years.length - 1]}).`
              }
              {' '}<a href="/settings" className="underline hover:text-cs-text">Customize</a>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 border-t-2 border-cs-border-strong pt-2 ">
        <Row label="Total cash at exit" value={fmt$(s.net_cash)} bold />
      </div>
    </div>
  )
}
