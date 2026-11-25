import dictionary from '../../../backend/app/financial_terms.json'
export const EQUITY_TERMS = dictionary.terms
export type EquityTerm = keyof typeof EQUITY_TERMS
