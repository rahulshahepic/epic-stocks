from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, Sale, TaxSettings, GrantProgramSettings
from schemas import SaleCreate, SaleUpdate, SaleOut, TaxSettingsRead, TaxSettingsUpdate, TaxBreakdown
from scaffold.auth import get_current_user
from scaffold.quota import check_row_quota
from app.sales_engine import compute_sale_tax, build_fifo_lots, compute_grossup_shares
from app.sale_tax import compute_all_sale_taxes
from scaffold.crud import apply_update, get_owned, version_conflict


def _flexible_payoff_enabled(db: Session) -> bool:
    row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
    return bool(row.flexible_payoff_enabled) if row else False

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
}


def _get_or_create_tax_settings(user: User, db: Session) -> TaxSettings:
    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if not ts:
        ts = TaxSettings(user_id=user.id, **WI_DEFAULTS)
        db.add(ts)
        db.flush()
    return ts


def _build_timeline(user: User, db: Session) -> list:
    from services.timeline_cache import get_timeline
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
    from app.loan_state import refinanced_loan_ids
    from scaffold.models import LoanPayment
    loans = db.query(Loan).filter(Loan.user_id == user.id).all()
    superseded = refinanced_loan_ids(loans, sale_date)
    covered_ids = {s.loan_id for s in db.query(Sale).filter(
        Sale.user_id == user.id, Sale.date <= sale_date, Sale.loan_id.isnot(None)).all()}
    paid = {}
    for payment in db.query(LoanPayment).filter(
            LoanPayment.user_id == user.id, LoanPayment.date <= sale_date).all():
        paid[payment.loan_id] = paid.get(payment.loan_id, 0) + payment.amount
    uncovered = [ln for ln in loans if ln.due_date <= sale_date
                 and ln.id not in superseded and ln.id not in covered_ids
                 and ln.amount > paid.get(ln.id, 0)]

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

def _sale_specs_for_user(user: User, db: Session) -> tuple[list, dict, TaxSettings, bool]:
    """Snapshot every sale plus the ingredients compute_all_sale_taxes needs,
    before closing the DB session for CPU-heavy work."""
    ts = _get_or_create_tax_settings(user, db)
    flexible_enabled = _flexible_payoff_enabled(db)
    sales_db = db.query(Sale).filter(Sale.user_id == user.id).order_by(Sale.date).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).all()
    loan_grant_by_id = {ln.id: (ln.grant_year, ln.grant_type) for ln in loans_db}
    specs = [{
        "id": s.id, "date": s.date, "shares": s.shares, "price_per_share": s.price_per_share,
        "loan_id": s.loan_id, "lot_overrides": s.lot_overrides,
        "rates": {
            "federal_income_rate": s.federal_income_rate if s.federal_income_rate is not None else ts.federal_income_rate,
            "federal_lt_cg_rate": s.federal_lt_cg_rate if s.federal_lt_cg_rate is not None else ts.federal_lt_cg_rate,
            "federal_st_cg_rate": s.federal_st_cg_rate if s.federal_st_cg_rate is not None else ts.federal_st_cg_rate,
            "niit_rate": s.niit_rate if s.niit_rate is not None else ts.niit_rate,
            "state_income_rate": s.state_income_rate if s.state_income_rate is not None else ts.state_income_rate,
            "state_lt_cg_rate": s.state_lt_cg_rate if s.state_lt_cg_rate is not None else ts.state_lt_cg_rate,
            "state_st_cg_rate": s.state_st_cg_rate if s.state_st_cg_rate is not None else ts.state_st_cg_rate,
            "lt_holding_days": s.lt_holding_days if s.lt_holding_days is not None else ts.lt_holding_days,
        },
    } for s in sales_db]
    return specs, loan_grant_by_id, ts, flexible_enabled


@router.get("/tax")
def get_all_sale_taxes(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return {sale_id: TaxBreakdown} for every sale in one shot — via the
    same compute_all_sale_taxes /api/events and /api/sales/{id}/tax use, so
    this can never disagree with either about the same sale."""
    specs, loan_grant_by_id, ts, flexible_enabled = _sale_specs_for_user(user, db)
    if not specs:
        db.close()
        return {}
    timeline = _build_timeline(user, db)
    db.close()  # release connection before CPU work

    results, _ = compute_all_sale_taxes(
        timeline, specs, loan_grant_by_id, ts.loan_payoff_method, ts.lot_selection_method, flexible_enabled,
    )
    return results


def sale_aware_timeline(user: User, db: Session, as_of: date, exclude_sale_id=None):
    """Remaining lots after every earlier sale, including manual allocations."""
    specs, grants, settings, flexible = _sale_specs_for_user(user, db)
    specs = [s for s in specs if s["date"] <= as_of and s["id"] != exclude_sale_id]
    _, timeline = compute_all_sale_taxes(
        _build_timeline(user, db), specs, grants, settings.loan_payoff_method,
        settings.lot_selection_method, flexible,
    )
    return timeline


def _remaining_holdings(user: User, db: Session, as_of: date) -> list[dict]:
    """Authoritative vested shares by grant after DP exchanges and every sale."""
    specs, loan_grants, settings, flexible = _sale_specs_for_user(user, db)
    specs = [spec for spec in specs if spec["date"] <= as_of]
    timeline = _build_timeline(user, db)
    _, final_timeline = compute_all_sale_taxes(
        timeline, specs, loan_grants, settings.loan_payoff_method,
        settings.lot_selection_method, flexible,
    )
    lots = build_fifo_lots(final_timeline, as_of, order="fifo")
    by_grant: dict[tuple[int | None, str | None], int] = {}
    for lot in lots:
        key = (lot[3], lot[4])
        by_grant[key] = by_grant.get(key, 0) + int(lot[1])
    return [
        {"grant_year": year, "grant_type": grant_type, "vested_shares": shares}
        for (year, grant_type), shares in sorted(
            by_grant.items(), key=lambda item: (item[0][0] or 0, item[0][1] or ""),
        )
    ]


@router.get("/holdings")
def get_remaining_holdings(
    as_of: date = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _remaining_holdings(user, db, as_of)


def _validate_payoff_coverage(
    user: User,
    db: Session,
    *,
    loan: Loan,
    sale_values: dict,
    exclude_sale_id: int | None = None,
) -> None:
    """A linked sale means payoff, so its after-tax proceeds must cover debt."""
    from scaffold.models import LoanPayment

    sale_date = sale_values["date"]
    from app.loan_state import refinanced_loan_ids
    loans = db.query(Loan).filter(Loan.user_id == user.id).all()
    if loan.id in refinanced_loan_ids(loans, sale_date):
        return
    paid = sum(
        payment.amount for payment in db.query(LoanPayment).filter(
            LoanPayment.loan_id == loan.id,
            LoanPayment.user_id == user.id,
            LoanPayment.date <= sale_date,
        ).all()
    )
    balance = round(max(0.0, loan.amount - paid), 2)
    if balance <= 0:
        return

    specs, loan_grants, settings, flexible = _sale_specs_for_user(user, db)
    specs = [spec for spec in specs if spec["id"] != exclude_sale_id]
    rates = {
        field: sale_values.get(field)
        if sale_values.get(field) is not None else getattr(settings, field)
        for field in (
            "federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
            "niit_rate", "state_income_rate", "state_lt_cg_rate",
            "state_st_cg_rate", "lt_holding_days",
        )
    }
    candidate_id = -1
    specs.append({
        "id": candidate_id,
        "date": sale_date,
        "shares": sale_values["shares"],
        "price_per_share": sale_values["price_per_share"],
        "loan_id": loan.id,
        "lot_overrides": sale_values.get("lot_overrides"),
        "rates": rates,
    })
    results, _ = compute_all_sale_taxes(
        _build_timeline(user, db), specs, loan_grants,
        settings.loan_payoff_method, settings.lot_selection_method, flexible,
    )
    net = round(
        sale_values["shares"] * sale_values["price_per_share"]
        - results[candidate_id]["estimated_tax"],
        2,
    )
    if net < balance:
        raise HTTPException(
            status_code=422,
            detail=(
                f"After-tax sale proceeds (${net:,.2f}) do not cover the "
                f"remaining loan balance (${balance:,.2f})"
            ),
        )


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
        loan = get_owned(db, Loan, body.loan_id, user, "Loan")
        # Prevent duplicate payoff sale for the same loan
        existing = db.query(Sale).filter(Sale.loan_id == body.loan_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="A sale already covers this loan's payoff")
        _validate_payoff_coverage(
            user, db, loan=loan, sale_values=body.model_dump(),
        )
    else:
        # Cash-out sale: enforce loan repayment rule
        _check_cash_out_allowed(user, body.date, db)

    check_row_quota(db, Sale, user.id)
    sale = Sale(**body.model_dump(), user_id=user.id)
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.put("/{sale_id}", response_model=SaleOut)
def update_sale(sale_id: int, body: SaleUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = get_owned(db, Sale, sale_id, user, "Sale")
    stale = version_conflict(sale, body.version)
    if stale:
        return stale
    # Only when the edit actually moves the sale later. The check asks whether a
    # loan already due by that date is still uncovered, so re-running it on a
    # sale whose date is unchanged would block editing the notes on a historical
    # sale over a loan the user has no intention of touching.
    new_date = body.date or sale.date
    if sale.loan_id is None and new_date > sale.date:
        _check_cash_out_allowed(user, new_date, db)
    elif sale.loan_id is not None and any(
        field in body.model_fields_set
        for field in ("date", "shares", "price_per_share", "lot_overrides")
    ):
        loan = get_owned(db, Loan, sale.loan_id, user, "Loan")
        values = {
            field: getattr(sale, field)
            for field in (
                "date", "shares", "price_per_share", "lot_overrides",
                "federal_income_rate", "federal_lt_cg_rate",
                "federal_st_cg_rate", "niit_rate", "state_income_rate",
                "state_lt_cg_rate", "state_st_cg_rate", "lt_holding_days",
            )
        }
        values.update(body.model_dump(exclude_unset=True))
        _validate_payoff_coverage(
            user, db, loan=loan, sale_values=values, exclude_sale_id=sale.id,
        )
    # Once the user changes what the sale says, it is theirs — the regenerator
    # must stop rewriting it. Rate overrides and notes are not part of the
    # computed figure, so they do not claim the row.
    if any(
        f in body.model_fields_set and getattr(body, f) != getattr(sale, f)
        for f in ("date", "shares", "price_per_share", "lot_overrides")
    ):
        sale.is_generated = False
    apply_update(sale, body)
    db.commit()
    db.refresh(sale)
    return sale


@router.delete("/{sale_id}", status_code=204)
def delete_sale(sale_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = get_owned(db, Sale, sale_id, user, "Sale")
    db.delete(sale)
    db.commit()


@router.get("/{sale_id}/tax", response_model=TaxBreakdown)
def get_sale_tax(sale_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The tax working for one sale — via the same compute_all_sale_taxes
    /api/events and the bulk /api/sales/tax use, computed against every one
    of the account's sales in chronological order, so this can never
    disagree with the timeline about the same sale."""
    get_owned(db, Sale, sale_id, user, "Sale")  # 404s if missing or not theirs
    specs, loan_grant_by_id, ts, flexible_enabled = _sale_specs_for_user(user, db)
    timeline = _build_timeline(user, db)
    db.close()

    results, _ = compute_all_sale_taxes(
        timeline, specs, loan_grant_by_id, ts.loan_payoff_method, ts.lot_selection_method, flexible_enabled,
    )
    return results[sale_id]


# --- Estimate ---

@router.get("/lots")
def get_available_lots(
    sale_date: str = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return available share lots as of a given date, grouped by cost basis (descending)."""
    from app.routers.loans import _get_lot_selection_method, _get_tax_settings_dict
    from collections import defaultdict

    try:
        as_of = date.fromisoformat(sale_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid sale_date format, expected YYYY-MM-DD") from None

    method = _get_lot_selection_method(user, db)
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    ts = _get_tax_settings_dict(user, db)
    lt_days = int(ts.get("lt_holding_days", 365))

    timeline = sale_aware_timeline(user, db, as_of)
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
    shares: int = Query(default=0, ge=0, le=10_000_000),
    method: str = Query(default='epic_lifo'),
    grant_year: Optional[int] = Query(default=None),
    grant_type: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return lot-level allocation for a proposed sale. Read-only, no DB write."""
    from app.routers.loans import _get_tax_settings_dict
    from app.date_utils import to_date as _to_date

    try:
        as_of = date.fromisoformat(sale_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid sale_date format, expected YYYY-MM-DD") from None

    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    ts = _get_tax_settings_dict(user, db)
    lt_days = int(ts.get("lt_holding_days", 365))

    timeline = sale_aware_timeline(user, db, as_of)
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
    price_per_share: float = Query(..., gt=0, le=1_000_000, allow_inf_nan=False),
    target_net_cash: float | None = Query(default=None, gt=0, le=100_000_000, allow_inf_nan=False),
    shares: int | None = Query(default=None, gt=0, le=10_000_000),
    sale_date: date | None = Query(default=None),
    loan_id: int | None = Query(default=None),
    grant_year: int | None = Query(default=None),
    grant_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stateless estimator: compute proceeds and tax for a sale.
    Provide either `shares` (exact share count) or `target_net_cash` (gross-up to cover net amount).
    Pure read — no DB write.
    """
    from app.routers.loans import (
        _get_tax_settings_dict,
        _get_lot_selection_method,
    )

    ts = _get_tax_settings_dict(user, db)
    method = _get_lot_selection_method(user, db)
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    lt_days = int(ts.get("lt_holding_days", 365))

    # Resolve loan balance if a loan_id was provided
    loan_balance = 0.0
    gy, gt = grant_year, grant_type
    if loan_id:
        loan = get_owned(db, Loan, loan_id, user, "Loan")
        from scaffold.models import LoanPayment
        as_of = sale_date or date.today()
        paid = sum(lp.amount for lp in db.query(LoanPayment).filter(
            LoanPayment.loan_id == loan.id, LoanPayment.date <= as_of,
        ).all())
        loan_balance = round(max(0.0, loan.amount - paid), 2)
        if method == 'same_tranche':
            gy, gt = loan.grant_year, loan.grant_type

    as_of = sale_date or date.today()
    timeline = sale_aware_timeline(user, db, as_of)

    lots = build_fifo_lots(timeline, as_of, order=lot_order,
                           grant_year=gy, grant_type=gt, lt_holding_days=lt_days)
    if shares is not None:
        shares_needed = shares
    else:
        shares_needed = compute_grossup_shares(lots, target_net_cash or 0.0, price_per_share, as_of, ts)
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
    ts = _get_or_create_tax_settings(user, db)
    result = TaxSettingsRead.model_validate(ts)
    result.flexible_payoff_enabled = _flexible_payoff_enabled(db)
    # Compute taxable years from grants so the frontend can show per-year toggles
    grants = db.query(Grant).filter(Grant.user_id == user.id).all()
    years: set[int] = set()
    for g in grants:
        if g.vest_start and g.periods:
            for i in range(g.periods):
                vest_year = g.vest_start.year + i
                years.add(vest_year)
    result.taxable_years = sorted(years)
    return result


@tax_router.put("", response_model=TaxSettingsRead)
def update_tax_settings(body: TaxSettingsUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ts = _get_or_create_tax_settings(user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ts, k, int(v) if k == 'prefer_stock_dp' else v)
    db.commit()
    db.refresh(ts)
    # Rates and lot method feed straight into how payoff sales are sized
    # (_compute_payoff_sale reads this same TaxSettings row) — refresh existing
    # future payoff sales so they aren't left sized for a method or rate that
    # no longer applies. Same reasoning as the price-change refresh.
    from app.routers.loans import _regenerate_future_payoff_sales
    _regenerate_future_payoff_sales(user, db, create_missing=False)
    return ts
