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
    # The grant never carries a purchase price: cost basis is $0 by definition, so
    # the wizard fixes it rather than asking. Types where the basis depends on how
    # the grant was structured (Bonus) leave it to the user.
    always_zero_basis: bool
    display_order: int


GRANT_TYPES: list[GrantTypeMeta] = [
    GrantTypeMeta('Purchase',                'bg-rose-700 text-white',    'You paid the share price',            False, False, 0),
    GrantTypeMeta('Catch-Up',                'bg-sky-700 text-white',     'Zero-basis catch-up grant',           True,  True,  1),
    GrantTypeMeta('Bonus',                   'bg-emerald-700 text-white', 'RSU bonus grant',                     True,  False, 2),
    GrantTypeMeta('Free',                    'bg-amber-600 text-white',   'Free/other grant',                    True,  True,  3),
    GrantTypeMeta('Developer Bonus Shares',  'bg-violet-700 text-white',  'Zero-basis developer bonus, 5 years', True,  True,  4),
]

GRANT_TYPE_NAMES: list[str] = [t.name for t in GRANT_TYPES]

PRE_TAX_TYPES: frozenset[str] = frozenset(t.name for t in GRANT_TYPES if t.is_pre_tax_when_zero_price)

ZERO_BASIS_TYPES: frozenset[str] = frozenset(t.name for t in GRANT_TYPES if t.always_zero_basis)

# Template types that can generate tax loans in their own right. Catch-Up is not
# one: it has no template of its own, it rides on a Purchase template carrying
# default_catch_up.
TAX_LOAN_TEMPLATE_TYPES: frozenset[str] = frozenset({'Bonus', 'Free', 'Developer Bonus Shares'})

TAX_LOAN_TEMPLATE_TYPES_TEXT: str = "/".join(sorted(TAX_LOAN_TEMPLATE_TYPES))
