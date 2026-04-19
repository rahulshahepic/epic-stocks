"""Hard-coded grant-type metadata.

The core engine, sales engine, import/export, and every test fixture branch on
these specific type strings, so the old `grant_type_defs` DB table never really
made the list editable. Keep this module and frontend/src/app/grantTypes.ts in sync.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class GrantTypeMeta:
    name: str
    color_class: str
    description: str
    is_pre_tax_when_zero_price: bool
    display_order: int


GRANT_TYPES: list[GrantTypeMeta] = [
    GrantTypeMeta('Purchase', 'bg-rose-700 text-white',    'You paid the share price',  False, 0),
    GrantTypeMeta('Catch-Up', 'bg-sky-700 text-white',     'Zero-basis catch-up grant', True,  1),
    GrantTypeMeta('Bonus',    'bg-emerald-700 text-white', 'RSU bonus grant',           True,  2),
    GrantTypeMeta('Free',     'bg-amber-600 text-white',   'Free/other grant',          True,  3),
]

GRANT_TYPE_NAMES: list[str] = [t.name for t in GRANT_TYPES]

PRE_TAX_TYPES: frozenset[str] = frozenset(t.name for t in GRANT_TYPES if t.is_pre_tax_when_zero_price)
