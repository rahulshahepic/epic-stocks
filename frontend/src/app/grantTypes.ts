// Hard-coded grant-type metadata. The core engine (backend/app/core.py, the sales
// engine, the import wizard) all branch on these specific strings, so making the
// list "admin-editable" was theatre — adding a new type here requires code changes.
// Keep this module and backend/app/grant_types.py in sync.

export type GrantTypeName = 'Purchase' | 'Catch-Up' | 'Bonus' | 'Free' | 'Developer Bonus Shares'

export interface GrantTypeMeta {
  name: GrantTypeName
  color_class: string
  description: string
  is_pre_tax_when_zero_price: boolean
  // The grant never carries a purchase price: cost basis is $0 by definition, so
  // the wizard fixes it rather than asking. Types where the basis depends on how
  // the grant was structured (Bonus) leave it to the user.
  always_zero_basis: boolean
  display_order: number
}

export const GRANT_TYPES: GrantTypeMeta[] = [
  { name: 'Purchase',               color_class: 'bg-rose-700 text-white',    description: 'You paid the share price',            is_pre_tax_when_zero_price: false, always_zero_basis: false, display_order: 0 },
  { name: 'Catch-Up',               color_class: 'bg-sky-700 text-white',     description: 'Zero-basis catch-up grant',           is_pre_tax_when_zero_price: true,  always_zero_basis: true,  display_order: 1 },
  { name: 'Bonus',                  color_class: 'bg-emerald-700 text-white', description: 'RSU bonus grant',                     is_pre_tax_when_zero_price: true,  always_zero_basis: false, display_order: 2 },
  { name: 'Free',                   color_class: 'bg-amber-600 text-white',   description: 'Free/other grant',                    is_pre_tax_when_zero_price: true,  always_zero_basis: true,  display_order: 3 },
  { name: 'Developer Bonus Shares', color_class: 'bg-violet-700 text-white',  description: 'Zero-basis developer bonus, 5 years', is_pre_tax_when_zero_price: true,  always_zero_basis: true,  display_order: 4 },
]

export const GRANT_TYPE_NAMES: GrantTypeName[] = GRANT_TYPES.map(t => t.name)

export const GRANT_COLORS: Record<GrantTypeName, string> = Object.fromEntries(
  GRANT_TYPES.map(t => [t.name, t.color_class]),
) as Record<GrantTypeName, string>

export const GRANT_DESCRIPTIONS: Record<GrantTypeName, string> = Object.fromEntries(
  GRANT_TYPES.map(t => [t.name, t.description]),
) as Record<GrantTypeName, string>

export const PRE_TAX_TYPES: ReadonlySet<string> = new Set(
  GRANT_TYPES.filter(t => t.is_pre_tax_when_zero_price).map(t => t.name),
)

export const ZERO_BASIS_TYPES: ReadonlySet<string> = new Set(
  GRANT_TYPES.filter(t => t.always_zero_basis).map(t => t.name),
)

/** Grant types the wizard collects on its bonus step: granted outright, no
 *  purchase loan, cost basis either fixed at $0 or entered by the user. */
export const BONUS_ROW_TYPES = ['Bonus', 'Free', 'Developer Bonus Shares'] as const
export type BonusRowType = (typeof BONUS_ROW_TYPES)[number]
export const isBonusRowType = (t: string): t is BonusRowType =>
  (BONUS_ROW_TYPES as readonly string[]).includes(t)
