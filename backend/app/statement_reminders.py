"""Optional year-end statement nudge; all debt state comes from project()."""
from datetime import date, datetime, time, timezone

from scaffold.models import Grant, Loan, LoanPayment, Sale
from scaffold.oauth.models import OAuthGrant
from services.vesting import core_grant
from app.loan_projection import project

STATEMENT_REMINDER = "Loan Interest Statement"
STATEMENT_MESSAGE = (
    "If you have a year-end loan statement, share it with your connected AI assistant "
    "to reconcile accrued interest. Statements are optional; interest keeps calculating automatically. "
    "You can also reconcile with any monthly statement."
)


def statement_reminder_events(user, db, today):
    if user.is_synthetic:
        return []
    # January gives a year-end statement time to arrive, and catches a missed timer.
    year = today.year if today.month == 12 and today.day == 31 else today.year - 1 if today.month == 1 else None
    if year is None or (user.statement_reminder_year or 0) >= year:
        return []
    now = datetime.combine(today, time.min, tzinfo=timezone.utc)
    connections = db.query(OAuthGrant).filter(OAuthGrant.user_id == user.id).all()
    if not any("equity:read" in g.scope.split() and g.session_version == user.session_version
               and g.refresh_token and g.refresh_expires_at
               and g.refresh_expires_at.replace(tzinfo=timezone.utc) > now for g in connections):
        return []
    loans = db.query(Loan).filter(Loan.user_id == user.id).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()
    settled = {s.loan_id for s in sales if s.date <= today}
    projection = project(loans, [core_grant(g) for g in db.query(Grant).filter(Grant.user_id == user.id)], [],
                         today=today, stop=today, withholding_rate=0,
                         loan_payments=db.query(LoanPayment).filter(LoanPayment.user_id == user.id).all(),
                         sales=sales)
    active = [p for p in projection.loans if not p.projected and not p.superseded and not p.prepaid
              and p.loan_id not in settled and p.end == today and p.balance_at(today) > 0]
    rows = {ln.id: ln for ln in loans}
    cutoff = date(year, 12, 31)
    relevant = [p for p in active if p.accrue_from <= cutoff]
    if not active or not relevant or all(any(c.accrued_through >= cutoff for c in rows[p.loan_id].interest_checkpoints)
                                        for p in relevant):
        return []
    return [{"event_type": STATEMENT_REMINDER, "date": today,
             "_statement_reminder_year": year, "reminder_message": STATEMENT_MESSAGE}]
