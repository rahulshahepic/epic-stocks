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


# --- Sales CRUD ---

@router.get("", response_model=list[SaleOut])
def list_sales(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Sale).filter(Sale.user_id == user.id).order_by(Sale.date).all()


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(body: SaleCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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

    sale_dict = {"date": sale.date, "shares": sale.shares, "price_per_share": sale.price_per_share}
    ts_dict = {
        "federal_income_rate": ts.federal_income_rate,
        "federal_lt_cg_rate": ts.federal_lt_cg_rate,
        "federal_st_cg_rate": ts.federal_st_cg_rate,
        "niit_rate": ts.niit_rate,
        "state_income_rate": ts.state_income_rate,
        "state_lt_cg_rate": ts.state_lt_cg_rate,
        "state_st_cg_rate": ts.state_st_cg_rate,
        "lt_holding_days": ts.lt_holding_days,
    }
    return compute_sale_tax(timeline, sale_dict, ts_dict)


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
