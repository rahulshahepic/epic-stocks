import math
from datetime import date, datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price
from auth import get_current_user
from core import generate_all_events, compute_timeline

router = APIRouter(prefix="/api", tags=["events"])


def _user_source_data(user: User, db: Session):
    grants_db = db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()
    prices_db = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all()

    grants = [{
        "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
        "vest_start": datetime.combine(g.vest_start, datetime.min.time()),
        "periods": g.periods,
        "exercise_date": datetime.combine(g.exercise_date, datetime.min.time()),
        "dp_shares": g.dp_shares or 0,
    } for g in grants_db]

    prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]

    loans = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    initial_price = prices[0]["price"] if prices else 0
    return grants, prices, loans, initial_price


def _serialize_event(e):
    """Convert datetime fields to ISO strings for JSON response."""
    out = {}
    for k, v in e.items():
        if k == "source":
            continue
        if isinstance(v, datetime):
            out[k] = v.strftime("%Y-%m-%d")
        else:
            out[k] = v
    return out


@router.get("/events")
def get_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, initial_price = _user_source_data(user, db)
    if not grants and not prices:
        return []
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    return [_serialize_event(e) for e in timeline]


@router.get("/dashboard")
def get_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, initial_price = _user_source_data(user, db)

    if not grants and not prices:
        return {
            "current_price": 0, "total_shares": 0,
            "total_income": 0, "total_cap_gains": 0,
            "total_loan_principal": 0, "next_event": None,
        }

    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    last = timeline[-1] if timeline else {}

    current_price = last.get("share_price", initial_price)
    total_shares = last.get("cum_shares", 0)
    total_income = last.get("cum_income", 0)
    total_cap_gains = last.get("cum_cap_gains", 0)

    total_loan_principal = sum(ln["amount"] for ln in loans)

    today = date.today()
    next_event = None
    for e in timeline:
        edate = e["date"]
        if isinstance(edate, datetime):
            edate = edate.date()
        if edate >= today:
            next_event = {"date": edate.isoformat(), "event_type": e["event_type"]}
            break

    return {
        "current_price": current_price,
        "total_shares": total_shares,
        "total_income": total_income,
        "total_cap_gains": total_cap_gains,
        "total_loan_principal": total_loan_principal,
        "next_event": next_event,
    }
