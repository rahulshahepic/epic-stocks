"""Versioned fictional profiles. No account, key, session, storage or real prices."""
from datetime import date
from types import SimpleNamespace as Row

from app.calculation_inputs import CalculationInputs
from scaffold.models import TaxSettings
from services.vesting import default_split

PROFILES = {
    'early': {'label': 'Early career', 'tenure': 3, 'age': 28, 'other_assets_m': 0.05, 'spend_k': 40},
    'established': {'label': 'Established', 'tenure': 10, 'age': 38, 'other_assets_m': 0.4, 'spend_k': 65},
    'exit': {'label': 'Planning an exit', 'tenure': 20, 'age': 50, 'other_assets_m': 1.2, 'spend_k': 90},
}
VERSION = 2
AS_OF = date(2026, 11, 24)


def profile_inputs(profile: str) -> CalculationInputs:
    info = PROFILES[profile]
    first_year = AS_OF.year - info['tenure'] + 1
    grants, loans, prices, tax_due = [], [], [], {}
    # Invented round-number history, followed by explicitly estimated prices.
    for year in range(first_year, 2043):
        prices.append(Row(id=year, effective_date=date(year, 1, 1),
                          price=100 + 25 * (year - first_year),
                          is_estimate=year > AS_OF.year, expected_announcement_date=None,
                          announced_date=None))
    for year in range(first_year, AS_OF.year + 1):
        for kind, shares, periods, cost in [('Purchase', 200, 5, prices[year-first_year].price),
                                             ('Bonus', 60, 3, 0)]:
            first = date(year + 1, 1, 1)
            schedule = default_split(kind, year, shares, first, periods)
            grants.append(Row(year=year, type=kind, shares=shares, price=cost,
                              vest_start=first, periods=periods, exercise_date=date(year, 1, 1),
                              dp_shares=0, election_83b=kind == 'Purchase',
                              vesting=[Row(date=d, shares=n) for d, n in schedule]))
            tax_due[(year, kind)] = date(year + 8, 1, 1)
            if kind == 'Purchase' and year >= AS_OF.year - 2:
                loans.append(Row(id=year, grant_year=year, grant_type=kind, loan_type='Purchase',
                                 loan_year=year, amount=shares * cost, interest_rate=0.03,
                                 due_date=date(year+8, 1, 1), disbursed_on=date(year, 1, 1),
                                 loan_number=f'fictional-{year}', refinances_loan_id=None,
                                 interest_checkpoints=[]))
    tax = Row(**{c.name: c.default.arg if c.default is not None else None
                 for c in TaxSettings.__table__.columns if c.name not in {'id', 'user_id'}})
    return CalculationInputs(grants, prices, loans, [], [], tax, tax_due, today=AS_OF)
