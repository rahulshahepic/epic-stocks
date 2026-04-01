from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, Sale, TaxSettings
from schemas import SaleCreate, SaleUpdate, SaleOut, TaxSettingsRead, TaxSettingsUpdate, TaxBreakdown
from scaffold.auth import get_current_user
from app.sales_engine import compute_sale_tax, build_fifo_lots, compute_grossup_shares, build_lots_from_overrides

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
    "lot_selection_method": "lifo",
    "prefer_stock_dp": 0,
    "dp_min_percent": 0.10,
    "dp_min_cap": 20000.0,
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
    from app.timeline_cache import get_timeline
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
    return get_timeline(user.id, grants, prices, loans, initial_price)


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


# --- Bulk tax computation (one DB round-trip for all sales) ---

@router.get("/tax")
def get_all_sale_taxes(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return {sale_id: TaxBreakdown} for every sale in one shot."""
    sales = db.query(Sale).filter(Sale.user_id == user.id).order_by(Sale.date).all()
    if not sales:
        db.close()
        return {}

    timeline = _build_timeline(user, db)
    ts = _get_or_create_tax_settings(user, db)

    # Build loan_id -> (grant_year, grant_type) for same-tranche resolution
    loan_map: dict[int, tuple] = {}
    if ts.lot_selection_method == 'same_tranche':
        from scaffold.models import Loan as LoanModel
        for ln in db.query(LoanModel).filter(LoanModel.user_id == user.id).all():
            loan_map[ln.id] = (ln.grant_year, ln.grant_type)

    lot_order = ts.lot_selection_method if ts.lot_selection_method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'

    # Snapshot per-sale rate overrides while session is open
    sale_data = []
    for s in sales:
        sale_data.append({
            "id": s.id,
            "date": s.date,
            "shares": s.shares,
            "price_per_share": s.price_per_share,
            "loan_id": s.loan_id,
            "lot_overrides": s.lot_overrides,
            "ts_dict": {
                "federal_income_rate": s.federal_income_rate if s.federal_income_rate is not None else ts.federal_income_rate,
                "federal_lt_cg_rate": s.federal_lt_cg_rate if s.federal_lt_cg_rate is not None else ts.federal_lt_cg_rate,
                "federal_st_cg_rate": s.federal_st_cg_rate if s.federal_st_cg_rate is not None else ts.federal_st_cg_rate,
                "niit_rate": s.niit_rate if s.niit_rate is not None else ts.niit_rate,
                "state_income_rate": s.state_income_rate if s.state_income_rate is not None else ts.state_income_rate,
                "state_lt_cg_rate": s.state_lt_cg_rate if s.state_lt_cg_rate is not None else ts.state_lt_cg_rate,
                "state_st_cg_rate": s.state_st_cg_rate if s.state_st_cg_rate is not None else ts.state_st_cg_rate,
                "lt_holding_days": s.lt_holding_days if s.lt_holding_days is not None else ts.lt_holding_days,
            },
        })

    db.close()  # release connection before CPU work

    result = {}
    # Process chronologically, injecting each sale into the timeline so later
    # sales see correct remaining lots (same logic as _annotate_sale_taxes).
    import bisect
    sort_key = lambda e: (
        e["date"].date() if isinstance(e["date"], datetime) else e["date"],
        0 if e.get("event_type") == "Vesting" else 1,
    )
    sorted_tl = sorted(timeline, key=sort_key)
    sort_keys = [sort_key(e) for e in sorted_tl]

    for s in sale_data:
        gy, gt = (loan_map.get(s["loan_id"]) or (None, None)) if s["loan_id"] and ts.lot_selection_method == 'same_tranche' else (None, None)
        prebuilt = build_lots_from_overrides(sorted_tl, s["lot_overrides"], s["date"]) if s.get("lot_overrides") else None
        breakdown = compute_sale_tax(sorted_tl, {"date": s["date"], "shares": s["shares"], "price_per_share": s["price_per_share"]}, s["ts_dict"], lot_order=lot_order, grant_year=gy, grant_type=gt, prebuilt_lots=prebuilt)
        result[s["id"]] = breakdown

        # Insert this sale into the sorted timeline for subsequent iterations
        sentinel = {
            "date": datetime.combine(s["date"], datetime.min.time()),
            "event_type": "Sale",
            "vested_shares": -s["shares"],
            "grant_price": None,
            "share_price": 0.0,
        }
        key = sort_key(sentinel)
        idx = bisect.bisect_right(sort_keys, key)
        sorted_tl.insert(idx, sentinel)
        sort_keys.insert(idx, key)

    return result


# --- Sales CRUD ---

@router.get("", response_model=list[SaleOut])
def list_sales(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Sale).filter(Sale.user_id == user.id).order_by(Sale.date).all()


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(body: SaleCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from scaffold.epic_mode import is_epic_mode
    from datetime import date as date_type
    if is_epic_mode() and body.loan_id is None and body.date < date_type.today():
        raise HTTPException(status_code=422, detail="Sales cannot be backdated in Epic mode — only future planned sales are allowed")
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
    method = ts.lot_selection_method if ts else 'epic_lifo'
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    gy, gt = None, None
    if method == 'same_tranche' and sale.loan_id:
        linked_loan = db.query(Loan).filter(Loan.id == sale.loan_id).first()
        if linked_loan:
            gy, gt = linked_loan.grant_year, linked_loan.grant_type
    prebuilt = build_lots_from_overrides(timeline, sale.lot_overrides, sale.date) if sale.lot_overrides else None
    return compute_sale_tax(timeline, sale_dict, ts_dict, lot_order=lot_order, grant_year=gy, grant_type=gt, prebuilt_lots=prebuilt)


# --- Estimate ---

@router.get("/lots")
def get_available_lots(
    sale_date: str = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return available share lots as of a given date, grouped by cost basis (descending)."""
    from app.routers.loans import _build_timeline_for_user, _get_lot_selection_method, _get_tax_settings_dict
    from collections import defaultdict

    try:
        as_of = date.fromisoformat(sale_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid sale_date format, expected YYYY-MM-DD")

    method = _get_lot_selection_method(user, db)
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    ts = _get_tax_settings_dict(user, db)
    lt_days = int(ts.get("lt_holding_days", 365))

    timeline = _build_timeline_for_user(user, db)
    lots = build_fifo_lots(timeline, as_of, order=lot_order, lt_holding_days=lt_days)

    by_cost: dict[float, int] = defaultdict(int)
    for lot in lots:
        # lot = [vest_date, shares_remaining, basis_price, grant_year, grant_type, hold_start_date]
        by_cost[lot[2]] += lot[1]

    grouped = [
        {"cost_basis": k, "shares": v}
        for k, v in sorted(by_cost.items(), reverse=True)
        if v > 0
    ]
    return {"lots": grouped, "total_shares": sum(g["shares"] for g in grouped)}


@router.get("/tranche-allocation")
def get_tranche_allocation(
    sale_date: str = Query(...),
    shares: int = Query(default=0),
    method: str = Query(default='epic_lifo'),
    grant_year: Optional[int] = Query(default=None),
    grant_type: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return lot-level allocation for a proposed sale. Read-only, no DB write."""
    from app.routers.loans import _build_timeline_for_user, _get_tax_settings_dict
    from app.date_utils import to_date as _to_date

    try:
        as_of = date.fromisoformat(sale_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid sale_date format, expected YYYY-MM-DD")

    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    ts = _get_tax_settings_dict(user, db)
    lt_days = int(ts.get("lt_holding_days", 365))

    timeline = _build_timeline_for_user(user, db)
    lots = build_fifo_lots(timeline, as_of, order=lot_order, lt_holding_days=lt_days,
                           grant_year=grant_year, grant_type=grant_type)

    remaining = max(0, shares)
    lines = []
    for lot in lots:
        vest_date = lot[0]
        available = lot[1]
        basis = lot[2]
        gy = lot[3]
        gt = lot[4]
        hold_start = _to_date(lot[5]) if len(lot) > 5 else _to_date(vest_date)
        allocated = min(available, remaining)
        remaining -= allocated
        hold_days = (as_of - hold_start).days
        vd = vest_date.isoformat() if hasattr(vest_date, 'isoformat') else str(vest_date)
        hsd = hold_start.isoformat() if hasattr(hold_start, 'isoformat') else str(hold_start)
        lines.append({
            "vest_date": vd,
            "grant_year": gy,
            "grant_type": gt,
            "basis_price": basis,
            "available_shares": available,
            "allocated_shares": allocated,
            "hold_start_date": hsd,
            "is_lt": hold_days >= lt_days,
        })

    return {
        "lines": lines,
        "total_available": sum(l["available_shares"] for l in lines),
        "total_allocated": sum(l["allocated_shares"] for l in lines),
    }


@router.get("/estimate")
def estimate_sale(
    price_per_share: float = Query(...),
    target_net_cash: float = Query(...),
    sale_date: str | None = Query(default=None),
    loan_id: int | None = Query(default=None),
    grant_year: int | None = Query(default=None),
    grant_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stateless estimator: given a desired net cash amount, compute the gross sale
    needed (shares, proceeds, tax). Pure read — no DB write.
    """
    from app.routers.loans import (
        _build_timeline_for_user, _get_tax_settings_dict,
        _get_lot_selection_method, WI_DEFAULTS,
    )

    ts = _get_tax_settings_dict(user, db)
    method = _get_lot_selection_method(user, db)
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    lt_days = int(ts.get("lt_holding_days", 365))

    # Resolve loan balance if a loan_id was provided
    loan_balance = 0.0
    gy, gt = grant_year, grant_type
    if loan_id:
        loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
        if loan:
            from scaffold.models import LoanPayment
            paid = sum(lp.amount for lp in db.query(LoanPayment).filter(LoanPayment.loan_id == loan.id).all())
            loan_balance = round(max(0.0, loan.amount - paid), 2)
            if method == 'same_tranche':
                gy, gt = loan.grant_year, loan.grant_type

    timeline = _build_timeline_for_user(user, db)
    as_of = date.fromisoformat(sale_date) if sale_date else date.today()

    lots = build_fifo_lots(timeline, as_of, order=lot_order,
                           grant_year=gy, grant_type=gt, lt_holding_days=lt_days)
    shares_needed = compute_grossup_shares(lots, target_net_cash, price_per_share, as_of, ts)
    gross_proceeds = round(shares_needed * price_per_share, 2)

    # Compute tax on the estimated sale
    sale_dict = {"date": as_of, "shares": shares_needed, "price_per_share": price_per_share}
    tax_result = compute_sale_tax(timeline, sale_dict, ts, lot_order=lot_order,
                                  grant_year=gy, grant_type=gt)
    estimated_tax = round(tax_result.get("estimated_tax", 0.0), 2)
    net_proceeds = round(gross_proceeds - estimated_tax, 2)

    return {
        "shares_needed": shares_needed,
        "gross_proceeds": gross_proceeds,
        "estimated_tax": estimated_tax,
        "net_proceeds": net_proceeds,
        "covers_loan": net_proceeds >= loan_balance if loan_balance > 0 else None,
        "loan_balance": loan_balance if loan_id else None,
    }


# --- Tax Settings ---

@tax_router.get("", response_model=TaxSettingsRead)
def get_tax_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_or_create_tax_settings(user, db)


@tax_router.put("", response_model=TaxSettingsRead)
def update_tax_settings(body: TaxSettingsUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ts = _get_or_create_tax_settings(user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ts, k, int(v) if k == 'prefer_stock_dp' else v)
    db.commit()
    db.refresh(ts)
    return ts
