from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Loan, Sale, LoanPayment, Price, Grant, TaxSettings
from schemas import LoanCreate, LoanUpdate, LoanOut, LoanPaymentCreate, LoanPaymentUpdate, LoanPaymentOut
from auth import get_current_user

router = APIRouter(prefix="/api/loans", tags=["loans"])
lp_router = APIRouter(prefix="/api/loan-payments", tags=["loan-payments"])

WI_DEFAULTS = {
    "federal_income_rate": 0.37,
    "federal_lt_cg_rate": 0.20,
    "federal_st_cg_rate": 0.37,
    "niit_rate": 0.038,
    "state_income_rate": 0.0765,
    "state_lt_cg_rate": 0.0536,
    "state_st_cg_rate": 0.0765,
    "lt_holding_days": 365,
    "lot_selection_method": "lifo",
    "prefer_stock_dp": False,
    "dp_min_percent": 0.10,
    "dp_min_cap": 20000.0,
}


def _get_tax_settings_dict(user: User, db: Session) -> dict:
    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if ts:
        return {
            "federal_income_rate": ts.federal_income_rate,
            "federal_lt_cg_rate": ts.federal_lt_cg_rate,
            "federal_st_cg_rate": ts.federal_st_cg_rate,
            "niit_rate": ts.niit_rate,
            "state_income_rate": ts.state_income_rate,
            "state_lt_cg_rate": ts.state_lt_cg_rate,
            "state_st_cg_rate": ts.state_st_cg_rate,
            "lt_holding_days": ts.lt_holding_days,
        }
    return WI_DEFAULTS


def _get_lot_selection_method(user: User, db: Session) -> str:
    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    return ts.lot_selection_method if ts else 'lifo'


def _build_timeline_for_user(user: User, db: Session) -> list:
    from core import generate_all_events, compute_timeline
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

    if not grants and not prices:
        return []
    initial_price = prices[0]["price"] if prices else 0
    events = generate_all_events(grants, prices, loans)
    return compute_timeline(events, initial_price)


def _current_price_from_timeline(timeline: list) -> float:
    """Return the most recent share_price from the timeline."""
    price = 0.0
    for e in timeline:
        p = e.get("share_price")
        if p is not None:
            price = p
    return price


def _compute_payoff_sale(loan: Loan, user: User, db: Session) -> dict:
    """Compute the suggested payoff sale for a loan (gross-up shares to cover cash_due after tax)."""
    from sales_engine import build_fifo_lots, compute_grossup_shares

    early_paid = sum(
        lp.amount for lp in db.query(LoanPayment).filter(LoanPayment.loan_id == loan.id).all()
    )
    cash_due = max(0.0, loan.amount - early_paid)

    timeline = _build_timeline_for_user(user, db)
    price = _current_price_from_timeline(timeline)
    if price <= 0:
        # Fall back to most recent DB price
        latest = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date.desc()).first()
        price = latest.price if latest else 0.0

    # Inject prior sales (excluding this loan's own payoff sale) so build_fifo_lots
    # sees the same consumed-lot state as compute_sale_tax does in get_sale_tax.
    existing_payoff = db.query(Sale).filter(Sale.loan_id == loan.id).first()
    prior_sales_q = db.query(Sale).filter(
        Sale.user_id == user.id,
        Sale.date <= loan.due_date,
    )
    if existing_payoff:
        prior_sales_q = prior_sales_q.filter(Sale.id != existing_payoff.id)
    for ps in prior_sales_q.all():
        timeline.append({
            "date": datetime.combine(ps.date, datetime.min.time()),
            "event_type": "Sale",
            "vested_shares": -ps.shares,
            "grant_price": None,
            "share_price": 0.0,
        })
    timeline.sort(key=lambda e: (
        e["date"].date() if isinstance(e["date"], datetime) else e["date"],
        0 if e.get("event_type") == "Vesting" else 1,
    ))

    ts = _get_tax_settings_dict(user, db)
    method = _get_lot_selection_method(user, db)
    lot_order = 'fifo' if method == 'fifo' else 'lifo'
    gy = loan.grant_year if method == 'same_tranche' else None
    gt = loan.grant_type if method == 'same_tranche' else None
    lots = build_fifo_lots(timeline, loan.due_date, order=lot_order, grant_year=gy, grant_type=gt)
    shares = compute_grossup_shares(lots, cash_due, price, loan.due_date, ts)

    loan_label = loan.loan_number or f"{loan.grant_year}/{loan.loan_type}"
    return {
        "date": loan.due_date,
        "shares": shares,
        "price_per_share": price,
        "loan_id": loan.id,
        "notes": f"Auto-generated payoff sale for loan {loan_label}",
        "cash_due": round(cash_due, 2),
    }


# --- Loans CRUD ---

@router.get("", response_model=list[LoanOut])
def list_loans(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.grant_year, Loan.loan_type).all()


@router.post("", response_model=LoanOut, status_code=201)
def create_loan(
    body: LoanCreate,
    generate_payoff_sale: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loan = Loan(**body.model_dump(), user_id=user.id)
    db.add(loan)
    db.commit()
    db.refresh(loan)

    if generate_payoff_sale:
        suggestion = _compute_payoff_sale(loan, user, db)
        if suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
            sale = Sale(
                user_id=user.id,
                date=suggestion["date"],
                shares=suggestion["shares"],
                price_per_share=suggestion["price_per_share"],
                loan_id=loan.id,
                notes=suggestion["notes"],
            )
            db.add(sale)
            db.commit()

    return loan


@router.post("/bulk", response_model=list[LoanOut], status_code=201)
def bulk_create_loans(items: list[LoanCreate], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loans = [Loan(**l.model_dump(), user_id=user.id) for l in items]
    db.add_all(loans)
    db.commit()
    for l in loans:
        db.refresh(l)
    return loans


@router.get("/{loan_id}", response_model=LoanOut)
def get_loan(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.get("/{loan_id}/payoff-sale-suggestion")
def get_payoff_sale_suggestion(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return _compute_payoff_sale(loan, user, db)


@router.put("/{loan_id}", response_model=LoanOut)
def update_loan(
    loan_id: int,
    body: LoanUpdate,
    regenerate_payoff_sale: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    submitted_version = body.version
    if submitted_version is not None and loan.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": loan.version},
        )
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(loan, k, v)
    loan.version = loan.version + 1
    db.commit()
    db.refresh(loan)

    if regenerate_payoff_sale:
        suggestion = _compute_payoff_sale(loan, user, db)
        existing_sale = db.query(Sale).filter(Sale.loan_id == loan.id, Sale.user_id == user.id).first()
        if existing_sale:
            existing_sale.date = suggestion["date"]
            existing_sale.shares = suggestion["shares"]
            existing_sale.price_per_share = suggestion["price_per_share"]
            existing_sale.notes = suggestion["notes"]
            db.commit()
        elif suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
            db.add(Sale(
                user_id=user.id,
                date=suggestion["date"],
                shares=suggestion["shares"],
                price_per_share=suggestion["price_per_share"],
                loan_id=loan.id,
                notes=suggestion["notes"],
            ))
            db.commit()

    return loan


@router.delete("/{loan_id}", status_code=204)
def delete_loan(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()


# --- Loan Payments CRUD ---

@lp_router.get("", response_model=list[LoanPaymentOut])
def list_loan_payments(
    loan_id: Optional[int] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(LoanPayment).filter(LoanPayment.user_id == user.id)
    if loan_id is not None:
        q = q.filter(LoanPayment.loan_id == loan_id)
    return q.order_by(LoanPayment.date).all()


@lp_router.post("", response_model=LoanPaymentOut, status_code=201)
def create_loan_payment(body: LoanPaymentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Validate loan belongs to user
    loan = db.query(Loan).filter(Loan.id == body.loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    lp = LoanPayment(**body.model_dump(), user_id=user.id)
    db.add(lp)
    db.commit()
    db.refresh(lp)
    return lp


@lp_router.put("/{lp_id}", response_model=LoanPaymentOut)
def update_loan_payment(
    lp_id: int, body: LoanPaymentUpdate,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    lp = db.query(LoanPayment).filter(LoanPayment.id == lp_id, LoanPayment.user_id == user.id).first()
    if not lp:
        raise HTTPException(status_code=404, detail="Loan payment not found")
    submitted_version = body.version
    if submitted_version is not None and lp.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": lp.version},
        )
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(lp, k, v)
    lp.version = lp.version + 1
    db.commit()
    db.refresh(lp)
    return lp


@lp_router.delete("/{lp_id}", status_code=204)
def delete_loan_payment(lp_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lp = db.query(LoanPayment).filter(LoanPayment.id == lp_id, LoanPayment.user_id == user.id).first()
    if not lp:
        raise HTTPException(status_code=404, detail="Loan payment not found")
    db.delete(lp)
    db.commit()
