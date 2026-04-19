"""Loader + idempotent seeder for the grant-program content tables.

Phase 1 exposes these tables read-only via GET /api/content; Phase 2 will add
write endpoints for content admins.  The seed data here must match the values
previously hardcoded in frontend/src/app/components/ImportWizard.tsx exactly —
the regression test in tests/test_content.py asserts this against golden
fixtures.
"""
from datetime import date as _date

from sqlalchemy import func
from sqlalchemy.orm import Session

from scaffold.models import (
    GrantTemplate,
    GrantTypeDef,
    BonusScheduleVariant,
    LoanRate,
    LoanRefinance,
    GrantProgramSettings,
)


# ── Seed data (mirrors ImportWizard.tsx constants) ──────────────────────────

SEED_GRANT_TYPE_DEFS = [
    # name, color_class, description, is_pre_tax_when_zero_price, display_order
    ('Purchase', 'bg-rose-700 text-white',    'You paid the share price',  False, 0),
    ('Catch-Up', 'bg-sky-700 text-white',     'Zero-basis catch-up grant', True,  1),
    ('Bonus',    'bg-emerald-700 text-white', 'RSU bonus grant',           True,  2),
    ('Free',     'bg-amber-600 text-white',   'Free/other grant',          True,  3),
]

# (year, type, vest_start, periods, exercise_date, default_catch_up)
SEED_GRANT_TEMPLATES = [
    (2018, 'Purchase', '2020-06-15', 6, '2018-12-31', True),
    (2019, 'Purchase', '2021-06-15', 6, '2019-12-31', True),
    (2020, 'Purchase', '2021-09-30', 5, '2020-12-31', True),
    (2020, 'Bonus',    '2021-09-30', 4, '2020-12-31', False),
    (2021, 'Purchase', '2022-09-30', 5, '2021-12-31', True),
    (2021, 'Bonus',    '2022-09-30', 3, '2021-12-31', False),
    (2022, 'Purchase', '2023-09-30', 4, '2022-12-31', False),
    (2022, 'Bonus',    '2023-09-30', 3, '2022-12-31', False),
    (2022, 'Free',     '2027-09-30', 1, '2022-12-31', False),
    (2023, 'Purchase', '2024-09-30', 4, '2023-12-31', False),
    (2023, 'Bonus',    '2024-09-30', 3, '2023-12-31', False),
    (2024, 'Purchase', '2025-09-30', 4, '2024-12-31', False),
    (2024, 'Bonus',    '2025-09-30', 3, '2024-12-31', False),
    (2025, 'Purchase', '2026-09-30', 4, '2025-12-31', False),
    (2025, 'Bonus',    '2026-09-30', 3, '2025-12-31', False),
]

# (grant_year, grant_type, variant_code, periods, label, is_default)
SEED_BONUS_VARIANTS = [
    (2020, 'Bonus', 'A', 2, 'A (2 years)', False),
    (2020, 'Bonus', 'B', 3, 'B (3 years)', False),
    (2020, 'Bonus', 'C', 4, 'C (4 years)', True),
]

# loan_rates: (loan_kind, grant_type_or_None, year, rate, due_date_or_None)
SEED_LOAN_RATES: list[tuple[str, str | None, int, float, str | None]] = []
for _y, _r in [(2020, 0.0086), (2021, 0.0091), (2022, 0.0328), (2023, 0.0437), (2024, 0.037), (2025, 0.0379)]:
    SEED_LOAN_RATES.append(('interest', None, _y, _r, None))
for _y, _r in [(2021, 0.0086), (2022, 0.0187), (2023, 0.0356), (2024, 0.043), (2025, 0.0407)]:
    SEED_LOAN_RATES.append(('tax', 'Catch-Up', _y, _r, None))
for _y, _r in [(2021, 0.0086), (2022, 0.0293), (2023, 0.0385), (2024, 0.037)]:
    SEED_LOAN_RATES.append(('tax', 'Bonus', _y, _r, None))
for _y, _r, _dd in [
    (2018, 0.0307, '2025-07-15'),
    (2019, 0.0307, '2026-07-15'),
    (2020, 0.0038, '2025-07-15'),
    (2021, 0.0086, '2030-07-15'),
    (2022, 0.0187, '2031-06-30'),
    (2023, 0.0356, '2032-06-30'),
    (2024, 0.037,  '2033-06-30'),
    (2025, 0.0406, '2034-06-30'),
]:
    SEED_LOAN_RATES.append(('purchase_original', None, _y, _r, _dd))

# loan refinances: (chain_kind, grant_year, grant_type, orig_loan_year, order_idx,
#                   date, rate, loan_year, due_date, orig_due_date)
SEED_LOAN_REFINANCES: list[tuple] = []
_PURCHASE_CHAINS = {
    2018: [
        ('2020-01-01', 0.0169, 2020, '2025-07-15'),
        ('2020-06-01', 0.0043, 2020, '2025-07-15'),
        ('2021-11-01', 0.0086, 2021, '2027-07-15'),
    ],
    2019: [
        ('2020-06-01', 0.0043, 2020, '2026-07-15'),
        ('2021-11-01', 0.0086, 2021, '2028-07-15'),
    ],
    2020: [
        ('2021-11-01', 0.0086, 2021, '2029-07-15'),
    ],
}
for _gy, _entries in _PURCHASE_CHAINS.items():
    for _idx, (_dt, _rt, _ly, _dd) in enumerate(_entries):
        SEED_LOAN_REFINANCES.append(('purchase', _gy, 'Purchase', None, _idx, _dt, _rt, _ly, _dd, None))
SEED_LOAN_REFINANCES.append(
    ('tax', 2020, 'Bonus', 2021, 0, '2021-11-01', 0.0086, 2021, '2029-07-15', '2024-07-15')
)

SEED_GRANT_PROGRAM_SETTINGS = {
    'id': 1,
    'tax_fallback_federal': 0.37,
    'tax_fallback_state': 0.0765,
    'dp_min_percent': 0.10,
    'dp_min_cap': 20000.0,
}


# ── Seeding (idempotent; runs on every boot) ────────────────────────────────

def seed_content_if_empty(db: Session) -> None:
    """Populate the grant-program tables from SEED_* constants on a fresh DB.

    Idempotent — each table is only seeded if it is empty.  Safe to call on
    every boot; a no-op once a content admin has edited any row.
    """
    if db.query(GrantTypeDef).count() == 0:
        for name, color, desc, is_pre_tax, order in SEED_GRANT_TYPE_DEFS:
            db.add(GrantTypeDef(
                name=name, color_class=color, description=desc,
                is_pre_tax_when_zero_price=is_pre_tax,
                display_order=order, active=True,
            ))

    if db.query(GrantTemplate).count() == 0:
        for idx, (year, typ, vs, periods, ed, dcu) in enumerate(SEED_GRANT_TEMPLATES):
            db.add(GrantTemplate(
                year=year, type=typ, vest_start=vs, periods=periods,
                exercise_date=ed, default_catch_up=dcu,
                show_dp_shares=(typ == 'Purchase' and year >= 2023),
                display_order=idx, active=True, notes=None,
            ))

    if db.query(BonusScheduleVariant).count() == 0:
        for gy, gt, code, periods, label, is_default in SEED_BONUS_VARIANTS:
            db.add(BonusScheduleVariant(
                grant_year=gy, grant_type=gt, variant_code=code,
                periods=periods, label=label, is_default=is_default,
            ))

    if db.query(LoanRate).count() == 0:
        for kind, gt, year, rate, due in SEED_LOAN_RATES:
            db.add(LoanRate(
                loan_kind=kind, grant_type=gt, year=year, rate=rate, due_date=due,
            ))

    if db.query(LoanRefinance).count() == 0:
        for kind, gy, gt, orig_ly, idx, dt, rate, ly, dd, odd in SEED_LOAN_REFINANCES:
            db.add(LoanRefinance(
                chain_kind=kind, grant_year=gy, grant_type=gt,
                orig_loan_year=orig_ly, order_idx=idx,
                date=dt, rate=rate, loan_year=ly, due_date=dd, orig_due_date=odd,
            ))

    if db.query(GrantProgramSettings).count() == 0:
        db.add(GrantProgramSettings(**SEED_GRANT_PROGRAM_SETTINGS))

    db.commit()


# ── Content loader ──────────────────────────────────────────────────────────

def load_content(db: Session) -> dict:
    """Return the full grant-program blob in the shape the frontend consumes."""
    templates = db.query(GrantTemplate).order_by(
        GrantTemplate.display_order, GrantTemplate.id
    ).all()
    type_defs = db.query(GrantTypeDef).order_by(
        GrantTypeDef.display_order, GrantTypeDef.name
    ).all()
    variants = db.query(BonusScheduleVariant).order_by(
        BonusScheduleVariant.grant_year,
        BonusScheduleVariant.grant_type,
        BonusScheduleVariant.variant_code,
    ).all()
    rates = db.query(LoanRate).all()
    refi_entries = db.query(LoanRefinance).order_by(
        LoanRefinance.chain_kind,
        LoanRefinance.grant_year,
        LoanRefinance.grant_type,
        LoanRefinance.order_idx,
    ).all()
    settings_row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()

    # Price year range is derived, not stored. Wizard iterates loan_rates directly
    # to figure out which years have interest/tax loans available, so no upper-bound
    # setting is needed there either.
    max_rate_year = db.query(func.max(LoanRate.year)).scalar()
    min_template_year = db.query(func.min(GrantTemplate.year)).scalar()
    this_year = _date.today().year
    price_years_start = min_template_year if min_template_year is not None else this_year
    price_years_end = (max_rate_year + 1) if max_rate_year is not None else this_year

    # Shape rates as nested dicts to match the frontend constants
    interest_rates: dict[str, float] = {}
    tax_rates: dict[str, dict[str, float]] = {}
    purchase_original: dict[str, dict] = {}
    for r in rates:
        year_str = str(r.year)
        if r.loan_kind == 'interest':
            interest_rates[year_str] = r.rate
        elif r.loan_kind == 'tax':
            bucket = tax_rates.setdefault(r.grant_type or '', {})
            bucket[year_str] = r.rate
        elif r.loan_kind == 'purchase_original':
            purchase_original[year_str] = {'rate': r.rate, 'due_date': r.due_date}

    # Refinance chains keyed the way the wizard expects
    purchase_chains: dict[str, list[dict]] = {}
    tax_chains: dict[str, list[dict]] = {}
    for e in refi_entries:
        entry = {
            'date': e.date,
            'rate': e.rate,
            'loan_year': e.loan_year,
            'due_date': e.due_date,
        }
        if e.chain_kind == 'purchase':
            purchase_chains.setdefault(str(e.grant_year), []).append(entry)
        elif e.chain_kind == 'tax':
            tax_entry = {
                **entry,
                'orig_due_date': e.orig_due_date,
            }
            key = f"{e.grant_year}-{e.grant_type}-{e.orig_loan_year}"
            tax_chains.setdefault(key, []).append(tax_entry)

    defaults = SEED_GRANT_PROGRAM_SETTINGS

    return {
        'grant_templates': [
            {
                'id': t.id,
                'year': t.year,
                'type': t.type,
                'vest_start': t.vest_start,
                'periods': t.periods,
                'exercise_date': t.exercise_date,
                'default_catch_up': bool(t.default_catch_up),
                'show_dp_shares': bool(t.show_dp_shares),
                'display_order': t.display_order,
            }
            for t in templates if t.active
        ],
        'grant_type_defs': [
            {
                'name': td.name,
                'color_class': td.color_class,
                'description': td.description,
                'is_pre_tax_when_zero_price': bool(td.is_pre_tax_when_zero_price),
                'display_order': td.display_order,
            }
            for td in type_defs if td.active
        ],
        'bonus_schedule_variants': [
            {
                'id': v.id,
                'grant_year': v.grant_year,
                'grant_type': v.grant_type,
                'variant_code': v.variant_code,
                'periods': v.periods,
                'label': v.label,
                'is_default': bool(v.is_default),
            }
            for v in variants
        ],
        'loan_rates': {
            'interest': interest_rates,
            'tax': tax_rates,
            'purchase_original': purchase_original,
        },
        'loan_rates_all': [
            {
                'id': r.id,
                'loan_kind': r.loan_kind,
                'grant_type': r.grant_type,
                'year': r.year,
                'rate': r.rate,
                'due_date': r.due_date,
            }
            for r in rates
        ],
        'loan_refinances': {
            'purchase': purchase_chains,
            'tax': tax_chains,
        },
        'loan_refinances_all': [
            {
                'id': e.id,
                'chain_kind': e.chain_kind,
                'grant_year': e.grant_year,
                'grant_type': e.grant_type,
                'orig_loan_year': e.orig_loan_year,
                'order_idx': e.order_idx,
                'date': e.date,
                'rate': e.rate,
                'loan_year': e.loan_year,
                'due_date': e.due_date,
                'orig_due_date': e.orig_due_date,
            }
            for e in refi_entries
        ],
        'grant_program_settings': {
            'tax_fallback_federal': settings_row.tax_fallback_federal if settings_row else defaults['tax_fallback_federal'],
            'tax_fallback_state': settings_row.tax_fallback_state if settings_row else defaults['tax_fallback_state'],
            'dp_min_percent': settings_row.dp_min_percent if settings_row else defaults['dp_min_percent'],
            'dp_min_cap': settings_row.dp_min_cap if settings_row else defaults['dp_min_cap'],
            'flexible_payoff_enabled': bool(settings_row.flexible_payoff_enabled) if settings_row else False,
            # Derived (read-only): computed from grant_templates / loan_rates each call.
            'price_years_start': price_years_start,
            'price_years_end': price_years_end,
        },
    }
