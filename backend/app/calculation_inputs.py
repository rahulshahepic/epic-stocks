"""Account rows or request-local fictional rows, consumed by the same services."""
from dataclasses import dataclass
from datetime import date, datetime

from app.core import compute_timeline, generate_all_events
from services.vesting import core_grant


@dataclass
class CalculationInputs:
    grants: list
    prices: list
    loans: list
    payments: list
    sales: list
    tax: object
    tax_due: dict
    flexible_payoff: bool = False
    account_id: int | None = None
    today: date | None = None

    def source_data(self):
        grants = [core_grant(g) for g in self.grants]
        prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price}
                  for p in self.prices]
        loans = [{"grant_yr": ln.grant_year, "grant_type": ln.grant_type,
                  "loan_type": ln.loan_type, "loan_year": ln.loan_year,
                  "amount": ln.amount, "interest_rate": ln.interest_rate,
                  "due": datetime.combine(ln.due_date, datetime.min.time()),
                  "loan_number": ln.loan_number} for ln in self.loans]
        return (grants, prices, loans, self.loans, prices[0]["price"] if prices else 0,
                {(g.year, g.type): bool(g.election_83b) for g in self.grants},
                {p.effective_date for p in self.prices if p.is_estimate})

    def timeline(self):
        grants, prices, loans, _, initial, _, _ = self.source_data()
        if self.account_id is not None:
            from services.timeline_cache import get_timeline
            return get_timeline(self.account_id, grants, prices, loans, initial)
        # Fictional data never goes through either account cache (including Redis).
        return compute_timeline(generate_all_events(grants, prices, loans), initial)


def load_calculation_inputs(user, db):
    from scaffold.models import Grant, Price, Loan, LoanPayment, Sale
    from app.tax_settings import tax_settings_or_defaults
    from app.routers.events import _tax_due_dates
    from app.routers.loans import _is_flexible_payoff_enabled
    return CalculationInputs(
        grants=db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all(),
        prices=db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all(),
        loans=db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all(),
        payments=db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all(),
        sales=db.query(Sale).filter(Sale.user_id == user.id).all(),
        tax=tax_settings_or_defaults(user, db), tax_due=_tax_due_dates(db),
        flexible_payoff=_is_flexible_payoff_enabled(db), account_id=user.id,
    )
