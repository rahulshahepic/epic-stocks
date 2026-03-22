from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price, Sale, TaxSettings
from schemas import SaleCreate, SaleUpdate, SaleOut, TaxSettingsRead, TaxSettingsUpdate, TaxBreakdown
from auth import get_current_user
from sales_engine import compute_sale_tax

router = APIRouter(prefix="/api/sales", tags=["sales"])
tax_router = APIRouter(prefix="/api/tax-settings", tags=["tax-settings"])

WI_DEFAULTS = {
    "federal_income_rate": 0.37,
    "federal_lt_cg_rate": 0.20,
    "federal_st_cg_rate": 0.37,
    "niit_rate": 0.038,
    "state_income_rate": 0.0765,
    "state_lt_cg_rate": 0.0536,
    "state_st_cg_rate": 0.0765,
    "lt_holding_days": 365,
}


def _get_or_create_tax_settings(user: User, db: Session) -> TaxSettings:
    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if not ts:
        ts = TaxSettings(user_id=user.id, **WI_DEFAULTS)
        db.add(ts)
        db.commit()
        db.refresh(ts)
    return ts


def _build_timeline(user: User, db: Session) -> list:
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


def _check_cash_out_allowed(user: User, sale_date, db: Session):
    """
    Block cash-out sale if any loan with due_date <= sale_date has no linked payoff Sale.
    Raises HTTPException 422 if blocked.
    """
    outstanding_loans = db.query(Loan).filter(
        Loan.user_id == user.id,
        Loan.due_date <= sale_date,
    ).all()

    covered_ids = {
        s.loan_id for s in
        db.query(Sale).filter(Sale.user_id == user.id, Sale.loan_id.isnot(None)).all()
    }

    uncovered = [
        ln for ln in outstanding_loans
        if ln.id not in covered_ids
    ]

    if uncovered:
        names = "; ".join(
            f"${ln.amount:,.0f} due {ln.due_date} ({ln.grant_year}/{ln.loan_type})"
            for ln in uncovered[:3]
        )
        suffix = f" (+{len(uncovered) - 3} more)" if len(uncovered) > 3 else ""
        raise HTTPException(
            status_code=422,
            detail=f"Repay loans before taking cash out: {names}{suffix}",
        )


# --- Sales CRUD ---

@router.get("", response_model=list[SaleOut])
def list_sales(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Sale).filter(Sale.user_id == user.id).order_by(Sale.date).all()


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(body: SaleCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.loan_id is not None:
        # Validate loan belongs to this user
        loan = db.query(Loan).filter(Loan.id == body.loan_id, Loan.user_id == user.id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")
        # Prevent duplicate payoff sale for the same loan
        existing = db.query(Sale).filter(Sale.loan_id == body.loan_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="A sale already covers this loan's payoff")
    else:
        # Cash-out sale: enforce loan repayment rule
        _check_cash_out_allowed(user, body.date, db)

    sale = Sale(**body.model_dump(), user_id=user.id)
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.put("/{sale_id}", response_model=SaleOut)
def update_sale(sale_id: int, body: SaleUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.user_id == user.id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    submitted_version = body.version
    if submitted_version is not None and sale.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": sale.version},
        )
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(sale, k, v)
    sale.version = sale.version + 1
    db.commit()
    db.refresh(sale)
    return sale


@router.delete("/{sale_id}", status_code=204)
def delete_sale(sale_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.user_id == user.id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    db.delete(sale)
    db.commit()


@router.get("/{sale_id}/tax", response_model=TaxBreakdown)
def get_sale_tax(sale_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.user_id == user.id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    timeline = _build_timeline(user, db)
    ts = _get_or_create_tax_settings(user, db)

    # Inject prior sales as negative vested_shares events so build_fifo_lots
    # correctly accounts for lots already consumed by earlier sales.
    prior_sales = db.query(Sale).filter(
        Sale.user_id == user.id,
        Sale.date < sale.date,
    ).all()
    for ps in prior_sales:
        timeline.append({
            "date": datetime.combine(ps.date, datetime.min.time()),
            "event_type": "Sale",
            "vested_shares": -ps.shares,
            "grant_price": None,
            "share_price": 0.0,
        })

    # Re-sort: vestings before sales on the same day
    timeline.sort(key=lambda e: (
        e["date"].date() if isinstance(e["date"], datetime) else e["date"],
        0 if e.get("event_type") == "Vesting" else 1,
    ))

    sale_dict = {"date": sale.date, "shares": sale.shares, "price_per_share": sale.price_per_share}
    # Use per-sale overrides when set, otherwise fall back to user's TaxSettings
    ts_dict = {
        "federal_income_rate": sale.federal_income_rate if sale.federal_income_rate is not None else ts.federal_income_rate,
        "federal_lt_cg_rate": sale.federal_lt_cg_rate if sale.federal_lt_cg_rate is not None else ts.federal_lt_cg_rate,
        "federal_st_cg_rate": sale.federal_st_cg_rate if sale.federal_st_cg_rate is not None else ts.federal_st_cg_rate,
        "niit_rate": sale.niit_rate if sale.niit_rate is not None else ts.niit_rate,
        "state_income_rate": sale.state_income_rate if sale.state_income_rate is not None else ts.state_income_rate,
        "state_lt_cg_rate": sale.state_lt_cg_rate if sale.state_lt_cg_rate is not None else ts.state_lt_cg_rate,
        "state_st_cg_rate": sale.state_st_cg_rate if sale.state_st_cg_rate is not None else ts.state_st_cg_rate,
        "lt_holding_days": sale.lt_holding_days if sale.lt_holding_days is not None else ts.lt_holding_days,
    }
    method = ts.lot_selection_method if ts else 'lifo'
    lot_order = 'fifo' if method == 'fifo' else 'lifo'
    gy, gt = None, None
    if method == 'same_tranche' and sale.loan_id:
        linked_loan = db.query(Loan).filter(Loan.id == sale.loan_id).first()
        if linked_loan:
            gy, gt = linked_loan.grant_year, linked_loan.grant_type
    return compute_sale_tax(timeline, sale_dict, ts_dict, lot_order=lot_order, grant_year=gy, grant_type=gt)


# --- Tax Settings ---

@tax_router.get("", response_model=TaxSettingsRead)
def get_tax_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_or_create_tax_settings(user, db)


@tax_router.put("", response_model=TaxSettingsRead)
def update_tax_settings(body: TaxSettingsUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ts = _get_or_create_tax_settings(user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ts, k, v)
    db.commit()
    db.refresh(ts)
    return ts
