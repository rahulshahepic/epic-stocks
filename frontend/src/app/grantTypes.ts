// Hard-coded grant-type metadata. The core engine (backend/app/core.py, the sales
// engine, the import wizard) all branch on these specific strings, so making the
// list "admin-editable" was theatre — adding a new type here requires code changes.
// Keep this module and backend/app/grant_types.py in sync.

export type GrantTypeName = 'Purchase' | 'Catch-Up' | 'Bonus' | 'Free'

export interface GrantTypeMeta {
  name: GrantTypeName
  color_class: string
  description: string
  is_pre_tax_when_zero_price: boolean
  display_order: number
}

export const GRANT_TYPES: GrantTypeMeta[] = [
  { name: 'Purchase', color_class: 'bg-rose-700 text-white',    description: 'You paid the share price',  is_pre_tax_when_zero_price: false, display_order: 0 },
  { name: 'Catch-Up', color_class: 'bg-sky-700 text-white',     description: 'Zero-basis catch-up grant', is_pre_tax_when_zero_price: true,  display_order: 1 },
  { name: 'Bonus',    color_class: 'bg-emerald-700 text-white', description: 'RSU bonus grant',           is_pre_tax_when_zero_price: true,  display_order: 2 },
  { name: 'Free',     color_class: 'bg-amber-600 text-white',   description: 'Free/other grant',          is_pre_tax_when_zero_price: true,  display_order: 3 },
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
