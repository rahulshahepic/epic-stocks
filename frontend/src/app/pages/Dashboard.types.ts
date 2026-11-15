import type { DashboardData, TimelineEvent } from '../../api.ts'

export interface CardValues {
  current_price: number | null
  total_shares: number
  total_income: number
  total_cap_gains: number
  total_loan_principal: number
  total_tax_paid: number
  cash_received: number
  total_interest: number
  interest_deduction_total: number
  tax_savings_from_deduction: number
  price_is_estimate: boolean
  next_event: { date: string; event_type: string } | null
  next_event_detail: TimelineEvent | null
  total_stock_value: number | null
  vested_stock_value: number | null
  purchased_unvested_stock_value: number
  net_equity: number | null
  accrued_unbooked_interest: number
  total_cost_basis: number
  unvested_shares: number
}
export interface GrantHolding {
  year: number; type: string; exerciseDate: string; costBasis: number
  vestedShares: number; unvestedShares: number; vestedValue: number | null
  unvestedValue: number; totalValue: number | null; totalTax: number; totalLoan: number
}
export interface ActiveLoan {
  id: number; grantYear: number; grantType: string; loanType: string
  loanYear: number; dueDate: string; balance: number; interestRate: number
}
export interface Breakdowns {
  cash: {
    sales: {id: number; date: string; shares: number; price: number; proceeds: number; tax: number; loanPayoff: number; loanLabel: string | null; net: number}[]
    totals: {proceeds: number; tax: number; loanPayoff: number; net: number}
  }
  income: {groups: {key: string; year: number; type: string; income: number; events: number}[]; total: number}
  capGains: {vestingGroups: {key: string; year: number; type: string; amount: number}[]; vestingTotal: number; priceTotal: number; total: number}
  interest: {rows: {id: string; label: string; amount: number; note?: string}[]; total: number}
  tax: {taxLoans: number; vestingIncomeTax: number; cgTaxFromSales: number; deductionSavings: number; total: number}
}
export interface DashboardSnapshot extends DashboardData {
  as_of: string
  cards: CardValues
  grant_holdings: GrantHolding[]
  active_loans: ActiveLoan[]
  breakdowns: Breakdowns
  charts: {tax: {date: string; estimated: number; paid: number; projected: boolean}[]; interest: {date: string; recorded: number; projected: number}[]}
}
