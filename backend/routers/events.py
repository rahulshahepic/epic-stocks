from datetime import date, datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price, LoanPayment, Sale
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
    return grants, prices, loans, loans_db, initial_price


def _serialize_event(e):
    return {
        k: v.strftime("%Y-%m-%d") if isinstance(v, datetime) else v
        for k, v in e.items()
        if k != "source"
    }


def _enrich_timeline(timeline: list, loans_db: list, loan_payments: list, sales: list) -> list:
    """
    Enrich Loan Payoff events with cash_due / covered_by_sale.
    Inject Early Loan Payment events for user-recorded LoanPayments.
    """
    # Build lookup: loan_id → sum of early payments
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments:
        payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount

    # Set of loan_ids covered by a linked sale
    covered_loan_ids = {s.loan_id for s in sales if s.loan_id is not None}

    enriched = []
    for e in timeline:
        if e["event_type"] == "Loan Payoff" and e.get("source"):
            idx = e["source"].get("index", -1)
            if 0 <= idx < len(loans_db):
                loan = loans_db[idx]
                early_paid = payments_by_loan.get(loan.id, 0.0)
                cash_due = round(max(0.0, loan.amount - early_paid), 2)
                enriched.append({
                    **e,
                    "loan_db_id": loan.id,
                    "cash_due": cash_due,
                    "covered_by_sale": loan.id in covered_loan_ids,
                    "status": "covered" if loan.id in covered_loan_ids else "planned",
                })
            else:
                enriched.append(e)
        else:
            enriched.append(e)

    # Determine current price/shares/income/cap_gains at a given date from the timeline
    # (used for injected events that need a share_price reference)
    last_price = 0.0
    last_cum_shares = 0
    last_cum_income = 0.0
    last_cum_cap_gains = 0.0
    date_to_price: dict = {}
    date_to_shares: dict = {}
    date_to_cum_income: dict = {}
    date_to_cum_cap_gains: dict = {}
    for e in timeline:
        edate = e["date"]
        if isinstance(edate, datetime):
            edate = edate.date()
        last_price = e.get("share_price", last_price)
        last_cum_shares = e.get("cum_shares", last_cum_shares)
        last_cum_income = e.get("cum_income", last_cum_income)
        last_cum_cap_gains = e.get("cum_cap_gains", last_cum_cap_gains)
        date_to_price[edate] = last_price
        date_to_shares[edate] = last_cum_shares
        date_to_cum_income[edate] = last_cum_income
        date_to_cum_cap_gains[edate] = last_cum_cap_gains

    def price_at(d: date) -> float:
        result = 0.0
        for k in sorted(date_to_price.keys()):
            if k <= d:
                result = date_to_price[k]
            else:
                break
        return result

    def shares_at(d: date) -> int:
        result = 0
        for k in sorted(date_to_shares.keys()):
            if k <= d:
                result = date_to_shares[k]
            else:
                break
        return result

    def cum_income_at(d: date) -> float:
        result = 0.0
        for k in sorted(date_to_cum_income.keys()):
            if k <= d:
                result = date_to_cum_income[k]
            else:
                break
        return result

    def cum_cap_gains_at(d: date) -> float:
        result = 0.0
        for k in sorted(date_to_cum_cap_gains.keys()):
            if k <= d:
                result = date_to_cum_cap_gains[k]
            else:
                break
        return result

    # Inject LoanPayment records as "Early Loan Payment" events
    for lp in loan_payments:
        sp = price_at(lp.date)
        cs = shares_at(lp.date)
        enriched.append({
            "date": datetime.combine(lp.date, datetime.min.time()),
            "event_type": "Early Loan Payment",
            "grant_year": None,
            "grant_type": None,
            "granted_shares": None,
            "grant_price": None,
            "exercise_price": None,
            "vested_shares": None,
            "price_increase": 0.0,
            "share_price": sp,
            "cum_shares": cs,
            "income": 0.0,
            "cum_income": 0.0,
            "vesting_cap_gains": 0.0,
            "price_cap_gains": 0.0,
            "total_cap_gains": 0.0,
            "cum_cap_gains": 0.0,
            "loan_id": lp.loan_id,
            "amount": round(lp.amount, 2),
            "notes": lp.notes,
        })

    # Inject Sale records as "Sale" events with negative vested_shares
    for s in sales:
        sd = s.date
        sp = price_at(sd)
        cs = shares_at(sd)
        enriched.append({
            "date": datetime.combine(sd, datetime.min.time()),
            "event_type": "Sale",
            "grant_year": None,
            "grant_type": None,
            "granted_shares": None,
            "grant_price": None,
            "exercise_price": None,
            "vested_shares": -s.shares,
            "price_increase": 0.0,
            "share_price": sp,
            "cum_shares": cs,  # adjusted below after sort
            "income": 0.0,
            "cum_income": cum_income_at(sd),
            "vesting_cap_gains": 0.0,
            "price_cap_gains": 0.0,
            "total_cap_gains": 0.0,
            "cum_cap_gains": cum_cap_gains_at(sd),
            "gross_proceeds": round(s.shares * s.price_per_share, 2),
            "notes": s.notes,
        })

    # Sort: date first, then by event type order
    _TYPE_ORDER = {
        "Share Price": 0, "Exercise": 1, "Down payment exchange": 2,
        "Vesting": 3, "Loan Payoff": 4, "Early Loan Payment": 5, "Sale": 6,
    }

    def sort_key(e):
        d = e["date"]
        if isinstance(d, datetime):
            d = d.date()
        return (d, _TYPE_ORDER.get(e["event_type"], 9))

    enriched.sort(key=sort_key)

    # Adjust cum_shares for all events to account for cumulative shares sold.
    # Sale events reduce cum_shares; all subsequent events reflect the reduced total.
    cumulative_sold = 0
    for e in enriched:
        if e["event_type"] == "Sale":
            sold = abs(e.get("vested_shares") or 0)
            e["cum_shares"] = e["cum_shares"] - cumulative_sold - sold
            cumulative_sold += sold
        else:
            e["cum_shares"] = e["cum_shares"] - cumulative_sold

    return enriched


@router.get("/events")
def get_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, loans_db, initial_price = _user_source_data(user, db)
    if not grants and not prices:
        return []
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)

    loan_payments = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()

    enriched = _enrich_timeline(timeline, loans_db, loan_payments, sales)
    return [_serialize_event(e) for e in enriched]


@router.get("/dashboard")
def get_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, loans_db, initial_price = _user_source_data(user, db)

    today = date.today()
    total_tax_paid = sum(
        ln["amount"] for ln in loans
        if ln["loan_type"] == "Tax" and ln["due"].date() <= today
    )

    # Cash received from cash-out sales (no loan_id)
    sales_db = db.query(Sale).filter(Sale.user_id == user.id).all()
    cash_received = round(sum(
        s.shares * s.price_per_share for s in sales_db
        if s.loan_id is None and s.date <= today
    ), 2)

    if not grants and not prices:
        return {
            "current_price": 0, "total_shares": 0,
            "total_income": 0, "total_cap_gains": 0,
            "total_loan_principal": 0, "total_tax_paid": 0,
            "cash_received": 0, "next_event": None,
        }

    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)

    # Build loan payment data for the loan payment chart
    loan_payments_db = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).all()
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments_db:
        payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount
    covered_loan_ids = {s.loan_id for s in sales_db if s.loan_id is not None}

    # Loan payment by year: same_tranche_sale vs cash_in
    loan_payment_by_year: dict[str, dict] = {}
    for i, ln in enumerate(loans_db):
        year = str(ln.due_date.year)
        early_paid = payments_by_loan.get(ln.id, 0.0)
        cash_due = max(0.0, ln.amount - early_paid)
        if year not in loan_payment_by_year:
            loan_payment_by_year[year] = {"year": year, "same_tranche_sale": 0.0, "cash_in": 0.0}
        if ln.id in covered_loan_ids:
            loan_payment_by_year[year]["same_tranche_sale"] += cash_due
        else:
            loan_payment_by_year[year]["cash_in"] += cash_due

    last = timeline[-1] if timeline else {}
    next_event = None
    for e in timeline:
        edate = e["date"]
        if isinstance(edate, datetime):
            edate = edate.date()
        if edate >= today:
            next_event = {"date": edate.isoformat(), "event_type": e["event_type"]}
            break

    return {
        "current_price": last.get("share_price", initial_price),
        "total_shares": last.get("cum_shares", 0),
        "total_income": last.get("cum_income", 0),
        "total_cap_gains": last.get("cum_cap_gains", 0),
        "total_loan_principal": sum(ln["amount"] for ln in loans),
        "total_tax_paid": total_tax_paid,
        "cash_received": cash_received,
        "loan_payment_by_year": sorted(loan_payment_by_year.values(), key=lambda x: x["year"]),
        "next_event": next_event,
    }
