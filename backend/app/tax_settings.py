"""Read account tax settings with the existing defaults, without creating rows."""
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
        'projected_loan_rate': None, 'tax_withholding_rate': None, 'exit_payoff_lag_days': 0,
    })
