"""Read account tax settings with the existing defaults, without creating rows."""
from datetime import date
from types import SimpleNamespace

from scaffold.models import TaxSettings


def tax_settings_or_defaults(user, db):
    settings = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if settings is not None:
        return settings
    from app.routers.loans import _get_tax_settings_dict
    return SimpleNamespace(**{
        **_get_tax_settings_dict(user, db),
        'loan_payoff_method': 'epic_lifo', 'lot_selection_method': 'lifo',
        'deduct_investment_interest': False, 'deduction_excluded_years': None,
        'investment_interest_method': 'accrual',
        'projected_loan_rate': None, 'tax_withholding_rate': None, 'exit_payoff_lag_days': 0,
    })



def investment_interest_years(vest_years, loans, *, today: date | None = None) -> set[int]:
    """Years a loan may accrue or be repaid, plus the existing vest years."""
    years = set(vest_years)
    current_year = (today or date.today()).year
    for loan in loans:
        drawn = loan.disbursed_on.year if loan.disbursed_on else loan.loan_year
        through = max(current_year, loan.loan_year, loan.due_date.year)
        years.update(range(min(drawn, loan.loan_year), through + 1))
    return years
