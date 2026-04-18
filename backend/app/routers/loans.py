import bisect
import math
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Loan, Sale, LoanPayment, Price, Grant, TaxSettings
from schemas import LoanCreate, LoanUpdate, LoanOut, LoanPaymentCreate, LoanPaymentUpdate, LoanPaymentOut, SaleOut
from scaffold.auth import get_current_user

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
    "prefer_stock_dp": 0,
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
    return ts.lot_selection_method if ts else 'epic_lifo'


def _tax_rate_fields(ts: dict) -> dict:
    """Extract per-sale tax rate fields from a TaxSettings dict."""
    return {k: ts[k] for k in (
        "federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
        "niit_rate", "state_income_rate", "state_lt_cg_rate", "state_st_cg_rate",
        "lt_holding_days",
    )}


def _build_timeline_for_user(user: User, db: Session) -> list:
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


def _is_flexible_payoff_enabled(db: Session) -> bool:
    row = db.execute(text("SELECT value FROM system_settings WHERE key = 'flexible_payoff_enabled'")).scalar()
    return row == "true"


def _has_sufficient_coverage(user: User, loan: Loan, db: Session, timeline: list, price: float, cash_due: float) -> bool:
    """
    Returns True if vested_shares*price + sum(unvested_shares_i * grant_price_i) >= cash_due.
    timeline must already be augmented with prior sales (same as used by _compute_payoff_sale).
    """
    from app.sales_engine import build_fifo_lots

    lots = build_fifo_lots(timeline, loan.due_date, order='fifo')
    vested_coverage = sum(lot[1] for lot in lots) * price

    grants_db = db.query(Grant).filter(Grant.user_id == user.id).all()
    vested_by_grant: dict = {}
    for e in timeline:
        edate = e.get("date")
        if edate is None:
            continue
        if isinstance(edate, datetime):
            edate = edate.date()
        if edate > loan.due_date:
            break
        if e.get("event_type") == "Vesting" and (e.get("vested_shares") or 0) > 0:
            key = (e.get("grant_year"), e.get("grant_type"))
            vested_by_grant[key] = vested_by_grant.get(key, 0) + e["vested_shares"]

    unvested_coverage = 0.0
    for g in grants_db:
        vested = vested_by_grant.get((g.year, g.type), 0)
        unvested = max(0, g.shares - (g.dp_shares or 0) - vested)
        unvested_coverage += unvested * (g.price or 0.0)

    return (vested_coverage + unvested_coverage) >= cash_due


def _price_at_date(timeline: list, as_of) -> float:
    """Return the share price from the timeline at or just before as_of date."""
    if isinstance(as_of, datetime):
        as_of = as_of.date()
    price = 0.0
    for e in timeline:
        edate = e.get("date")
        if edate is None:
            continue
        if isinstance(edate, datetime):
            edate = edate.date()
        if edate <= as_of:
            p = e.get("share_price")
            if p is not None and p > 0:
                price = p
        else:
            break
    return price


def _sort_key_event(e: dict):
    d = e["date"]
    d = d.date() if isinstance(d, datetime) else d
    return (d, 0 if e.get("event_type") == "Vesting" else 1)


def _compute_payoff_sale(loan: Loan, user: User, db: Session) -> dict:
    """Compute the suggested payoff sale for a loan (gross-up shares to cover cash_due after tax)."""
    from app.sales_engine import build_fifo_lots, compute_grossup_shares, compute_sale_tax

    early_paid = sum(
        lp.amount for lp in db.query(LoanPayment).filter(LoanPayment.loan_id == loan.id).all()
    )
    cash_due = max(0.0, loan.amount - early_paid)

    timeline = _build_timeline_for_user(user, db)
    # Use the price at the loan due date, not the final timeline price.
    # Using a far-future price (which may be lower) would compute too many shares.
    price = _price_at_date(timeline, loan.due_date)
    if price <= 0:
        # Fall back to most recent DB price
        latest = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date.desc()).first()
        price = latest.price if latest else 0.0

    ts = _get_tax_settings_dict(user, db)
    lt_days = int(ts.get("lt_holding_days", 365))
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()

    # The tax annotator for Sale events uses lot_selection_method. Mirror that here so
    # our sizing consumes the same lots the actual tax calc will consume.
    tax_method = ts_row.lot_selection_method if ts_row else 'epic_lifo'
    tax_lot_order = tax_method if tax_method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'

    # Inject prior sales (excluding this loan's own payoff sale) as PRECISE lot sentinels —
    # matching what _annotate_sale_taxes does. Using crude negative-shares reducers consumes
    # oldest lots regardless of lot_order, which diverges from the real consumption and
    # produces an undersized payoff when later sales get stuck with higher-basis or STCG lots.
    existing_payoff = db.query(Sale).filter(Sale.loan_id == loan.id).first()
    prior_sales_q = db.query(Sale).filter(
        Sale.user_id == user.id,
        Sale.date <= loan.due_date,
    )
    if existing_payoff:
        prior_sales_q = prior_sales_q.filter(Sale.id != existing_payoff.id)
    prior_sales = sorted(prior_sales_q.all(), key=lambda s: s.date)

    sorted_tl = sorted(timeline, key=_sort_key_event)
    sort_keys: list = [_sort_key_event(e) for e in sorted_tl]
    loan_id_to_grant = {ln.id: (ln.grant_year, ln.grant_type) for ln in db.query(Loan).filter(Loan.user_id == user.id).all()}
    for ps in prior_sales:
        ps_date = ps.date
        ps_gy, ps_gt = (loan_id_to_grant.get(ps.loan_id, (None, None)) if ps.loan_id else (None, None))
        # Tax annotator passes grant_year/grant_type only for same_tranche lot_selection_method;
        # since lot_selection_method doesn't include that value today, leave unrestricted.
        ps_result = compute_sale_tax(
            sorted_tl,
            {"date": ps_date, "shares": ps.shares, "price_per_share": ps.price_per_share},
            ts,
            lot_order=tax_lot_order,
        )
        for lot in ps_result.get("lots_consumed", []):
            sentinel = {
                "date": datetime.combine(ps_date, datetime.min.time()),
                "event_type": "Prior Sale Lot",
                "target_vest_date": lot["vest_date"],
                "target_grant_year": lot["grant_year"],
                "target_grant_type": lot["grant_type"],
                "shares_consumed": lot["shares"],
                "vested_shares": 0,
                "grant_price": None,
                "share_price": 0.0,
            }
            key = _sort_key_event(sentinel)
            idx = bisect.bisect_right(sort_keys, key)
            sorted_tl.insert(idx, sentinel)
            sort_keys.insert(idx, key)

    # Determine lot selection method for this payoff.
    # Default is same-tranche; flexible methods are available when admin has enabled the setting
    # and the user has sufficient total stock coverage (vested at price + unvested at cost basis).
    payoff_method = 'same_tranche'
    if ts_row and _is_flexible_payoff_enabled(db):
        user_method = ts_row.loan_payoff_method
        if user_method != 'same_tranche' and _has_sufficient_coverage(user, loan, db, sorted_tl, price, cash_due):
            payoff_method = user_method

    if payoff_method == 'same_tranche':
        lots = build_fifo_lots(sorted_tl, loan.due_date, order='epic_lifo',
                               grant_year=loan.grant_year, grant_type=loan.grant_type,
                               lt_holding_days=lt_days)
    else:
        order = payoff_method if payoff_method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
        lots = build_fifo_lots(sorted_tl, loan.due_date, order=order, lt_holding_days=lt_days)
    shares = compute_grossup_shares(lots, cash_due, price, loan.due_date, ts)

    # Self-correct against the actual tax calc: if the sized sale's net proceeds don't cover
    # cash_due under the real tax computation (pro-rata LT/ST allocation, lot_selection_method
    # consumption), bump the share count until it does.
    if shares > 0 and price > 0:
        for _ in range(20):
            verify = compute_sale_tax(
                sorted_tl,
                {"date": loan.due_date, "shares": shares, "price_per_share": price},
                ts,
                lot_order=tax_lot_order,
            )
            net = shares * price - verify["estimated_tax"]
            if net >= cash_due:
                break
            shortfall = cash_due - net
            shares += max(1, math.ceil(shortfall / price))

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
    if body.refinances_loan_id is not None:
        ref = db.query(Loan).filter(Loan.id == body.refinances_loan_id, Loan.user_id == user.id).first()
        if not ref:
            raise HTTPException(status_code=400, detail="refinances_loan_id references a loan that does not exist or belongs to another user")
        # Remove any auto-generated payoff sale for the old loan — it never happened
        old_payoff_sale = db.query(Sale).filter(Sale.loan_id == body.refinances_loan_id, Sale.user_id == user.id).first()
        if old_payoff_sale:
            db.delete(old_payoff_sale)
    loan = Loan(**body.model_dump(), user_id=user.id)
    db.add(loan)
    db.commit()
    db.refresh(loan)

    if generate_payoff_sale:
        suggestion = _compute_payoff_sale(loan, user, db)
        if suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
            ts = _get_tax_settings_dict(user, db)
            sale = Sale(
                user_id=user.id,
                date=suggestion["date"],
                shares=suggestion["shares"],
                price_per_share=suggestion["price_per_share"],
                loan_id=loan.id,
                notes=suggestion["notes"],
                **_tax_rate_fields(ts),
            )
            db.add(sale)
            db.commit()

    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return loan


@router.post("/bulk", response_model=list[LoanOut], status_code=201)
def bulk_create_loans(items: list[LoanCreate], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loans = [Loan(**l.model_dump(), user_id=user.id) for l in items]
    db.add_all(loans)
    db.commit()
    for l in loans:
        db.refresh(l)
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
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


@router.post("/{loan_id}/execute-payoff", response_model=SaleOut, status_code=201)
def execute_payoff(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Execute an early loan payoff: compute the suggested sale and persist it.
    Idempotent — if a payoff sale already exists for this loan, returns it unchanged.
    """
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    existing = db.query(Sale).filter(Sale.loan_id == loan.id, Sale.user_id == user.id).first()
    if existing:
        return existing

    suggestion = _compute_payoff_sale(loan, user, db)
    if suggestion["shares"] <= 0 or suggestion["price_per_share"] <= 0:
        raise HTTPException(status_code=400, detail="Loan balance is zero — no sale needed")

    ts = _get_tax_settings_dict(user, db)
    sale = Sale(
        user_id=user.id,
        date=suggestion["date"],
        shares=suggestion["shares"],
        price_per_share=suggestion["price_per_share"],
        loan_id=loan.id,
        notes=suggestion["notes"],
        **{k: ts[k] for k in (
            "federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
            "niit_rate", "state_income_rate", "state_lt_cg_rate", "state_st_cg_rate",
            "lt_holding_days",
        )},
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


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
    if body.refinances_loan_id is not None:
        ref = db.query(Loan).filter(Loan.id == body.refinances_loan_id, Loan.user_id == user.id).first()
        if not ref:
            raise HTTPException(status_code=400, detail="refinances_loan_id references a loan that does not exist or belongs to another user")
        if body.refinances_loan_id == loan_id:
            raise HTTPException(status_code=400, detail="A loan cannot refinance itself")
        # Remove auto-generated payoff sale for the old loan if this is a new refinance link
        if loan.refinances_loan_id != body.refinances_loan_id:
            old_payoff_sale = db.query(Sale).filter(Sale.loan_id == body.refinances_loan_id, Sale.user_id == user.id).first()
            if old_payoff_sale:
                db.delete(old_payoff_sale)
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
        ts = _get_tax_settings_dict(user, db)
        existing_sale = db.query(Sale).filter(Sale.loan_id == loan.id, Sale.user_id == user.id).first()
        if existing_sale:
            existing_sale.date = suggestion["date"]
            existing_sale.shares = suggestion["shares"]
            existing_sale.price_per_share = suggestion["price_per_share"]
            existing_sale.notes = suggestion["notes"]
            for k, v in _tax_rate_fields(ts).items():
                setattr(existing_sale, k, v)
            db.commit()
        elif suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
            db.add(Sale(
                user_id=user.id,
                date=suggestion["date"],
                shares=suggestion["shares"],
                price_per_share=suggestion["price_per_share"],
                loan_id=loan.id,
                notes=suggestion["notes"],
                **_tax_rate_fields(ts),
            ))
            db.commit()

    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return loan


@router.post("/regenerate-all-payoff-sales")
def regenerate_all_payoff_sales(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Recompute payoff sale share counts for all future loans, creating missing sales."""
    from datetime import date as date_type
    today = date_type.today()
    future_loans = db.query(Loan).filter(Loan.user_id == user.id, Loan.due_date >= today).all()
    # Skip refinanced loans — they show as $0 "Refinanced" events
    refinanced_ids = {ln.refinances_loan_id for ln in future_loans if ln.refinances_loan_id is not None}
    ts = _get_tax_settings_dict(user, db)
    updated = 0
    created = 0
    for loan in future_loans:
        if loan.id in refinanced_ids:
            continue
        existing_sale = db.query(Sale).filter(Sale.loan_id == loan.id, Sale.user_id == user.id).first()
        suggestion = _compute_payoff_sale(loan, user, db)
        if existing_sale:
            existing_sale.date = suggestion["date"]
            existing_sale.shares = suggestion["shares"]
            existing_sale.price_per_share = suggestion["price_per_share"]
            existing_sale.notes = suggestion["notes"]
            for k, v in _tax_rate_fields(ts).items():
                setattr(existing_sale, k, v)
            updated += 1
        elif suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
            db.add(Sale(
                user_id=user.id,
                date=suggestion["date"],
                shares=suggestion["shares"],
                price_per_share=suggestion["price_per_share"],
                loan_id=loan.id,
                notes=suggestion["notes"],
                **_tax_rate_fields(ts),
            ))
            created += 1
    db.commit()
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return {"updated": updated, "created": created}


@router.delete("/{loan_id}", status_code=204)
def delete_loan(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)


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
