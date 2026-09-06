import type { SaleEntry, TaxSettings } from '../../api.ts'

/**
 * The per-sale tax-rate overrides, and how they fall back to the account's
 * settings. Lived in Sales.tsx, which Loans.tsx then had to import a page from;
 * they are also why fast refresh could not hot-swap the sales page.
 */

export type TaxRates = {
  federal_income_rate: number
  federal_lt_cg_rate: number
  federal_st_cg_rate: number
  niit_rate: number
  state_income_rate: number
  state_lt_cg_rate: number
  state_st_cg_rate: number
  lt_holding_days: number
}

export const DEFAULT_RATES: TaxRates = {
  federal_income_rate: 0.37,
  federal_lt_cg_rate: 0.20,
  federal_st_cg_rate: 0.37,
  niit_rate: 0.038,
  state_income_rate: 0.0765,
  state_lt_cg_rate: 0.0536,
  state_st_cg_rate: 0.0765,
  lt_holding_days: 365,
}

export function ratesFromDefaults(ts: TaxSettings | null | undefined): TaxRates {
  if (!ts) return DEFAULT_RATES
  return {
    federal_income_rate: ts.federal_income_rate,
    federal_lt_cg_rate: ts.federal_lt_cg_rate,
    federal_st_cg_rate: ts.federal_st_cg_rate,
    niit_rate: ts.niit_rate,
    state_income_rate: ts.state_income_rate,
    state_lt_cg_rate: ts.state_lt_cg_rate,
    state_st_cg_rate: ts.state_st_cg_rate,
    lt_holding_days: ts.lt_holding_days,
  }
}

export function ratesFromSale(sale: SaleEntry, defaults: TaxSettings | null | undefined): TaxRates {
  const d = ratesFromDefaults(defaults)
  return {
    federal_income_rate: sale.federal_income_rate ?? d.federal_income_rate,
    federal_lt_cg_rate: sale.federal_lt_cg_rate ?? d.federal_lt_cg_rate,
    federal_st_cg_rate: sale.federal_st_cg_rate ?? d.federal_st_cg_rate,
    niit_rate: sale.niit_rate ?? d.niit_rate,
    state_income_rate: sale.state_income_rate ?? d.state_income_rate,
    state_lt_cg_rate: sale.state_lt_cg_rate ?? d.state_lt_cg_rate,
    state_st_cg_rate: sale.state_st_cg_rate ?? d.state_st_cg_rate,
    lt_holding_days: sale.lt_holding_days ?? d.lt_holding_days,
  }
}
