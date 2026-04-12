import bisect
from datetime import date, datetime
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, LoanPayment, Sale, TaxSettings, HorizonSettings
from scaffold.auth import get_current_user
from app.timeline_cache import get_timeline
from app.sales_engine import compute_sale_tax
from app.date_utils import to_date as _to_date

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

    election_83b_map = {(g.year, g.type): bool(g.election_83b) for g in grants_db}

    prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]

    loans = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    initial_price = prices[0]["price"] if prices else 0
    return grants, prices, loans, loans_db, initial_price, election_83b_map


def _serialize_event(e):
    return {
        k: v.strftime("%Y-%m-%d") if isinstance(v, datetime) else v
        for k, v in e.items()
        if k != "source"
    }


def _last_vesting_date(timeline: list):
    """Return the date of the last Vesting event, or None if none exist."""
    last = None
    for e in timeline:
        if e.get("event_type") == "Vesting":
            d = _to_date(e["date"])
            if last is None or d > last:
                last = d
    return last


def _enrich_timeline(timeline: list, loans_db: list, loan_payments: list, sales: list,
                     horizon_date=None) -> list:
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

    # Set of loan_ids that were refinanced by another loan (their payoff events become "Refinanced")
    refinanced_loan_ids: set[int] = {ln.refinances_loan_id for ln in loans_db if ln.refinances_loan_id is not None}

    enriched = []
    for e in timeline:
        if e["event_type"] == "Loan Payoff" and e.get("source"):
            idx = e["source"].get("index", -1)
            if 0 <= idx < len(loans_db):
                loan = loans_db[idx]
                if loan.id in refinanced_loan_ids:
                    enriched.append({
                        **e,
                        "event_type": "Refinanced",
                        "loan_db_id": loan.id,
                        "cash_due": 0.0,
                        "covered_by_sale": False,
                        "status": "refinanced",
                        "refinanced": True,
                    })
                else:
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
        edate = _to_date(e["date"])
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
            "sale_id": s.id,
        })

    # Sort: date first, then by event type order
    _TYPE_ORDER = {
        "Share Price": 0, "Exercise": 1, "Down payment exchange": 2,
        "Vesting": 3, "Loan Payoff": 4, "Refinanced": 4, "Early Loan Payment": 5, "Sale": 6,
    }

    def sort_key(e):
        return (_to_date(e["date"]), _TYPE_ORDER.get(e["event_type"], 9))

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

    # Inject virtual Liquidation (projected) event at horizon_date.
    # Only scan events at or before horizon_date so an early exit date correctly
    # uses shares/price as of that date rather than the full vesting schedule.
    if horizon_date is not None:
        liq_price = 0.0
        remaining_shares = 0
        last_cum_income = 0.0
        last_cum_cap_gains = 0.0
        for ev in enriched:
            edate = _to_date(ev["date"])
            if edate > horizon_date:
                break
            p = ev.get("share_price", 0.0)
            if p:
                liq_price = p
            remaining_shares = ev.get("cum_shares", remaining_shares)
            last_cum_income = ev.get("cum_income", last_cum_income)
            last_cum_cap_gains = ev.get("cum_cap_gains", last_cum_cap_gains)
        if remaining_shares > 0 and liq_price > 0:
            enriched.append({
                "date": datetime.combine(horizon_date, datetime.min.time()),
                "event_type": "Liquidation (projected)",
                "grant_year": None,
                "grant_type": None,
                "granted_shares": None,
                "grant_price": None,
                "exercise_price": None,
                "vested_shares": -remaining_shares,
                "price_increase": 0.0,
                "share_price": liq_price,
                "cum_shares": 0,
                "income": 0.0,
                "cum_income": last_cum_income,
                "vesting_cap_gains": 0.0,
                "price_cap_gains": 0.0,
                "total_cap_gains": 0.0,
                "cum_cap_gains": last_cum_cap_gains,
                "gross_proceeds": round(remaining_shares * liq_price, 2),
                "notes": "Projected full liquidation",
                "is_projected": True,
            })
            # Re-sort so the projected event sits in its correct chronological
            # position (it may be before future vesting/loan events).
            enriched.sort(key=sort_key)

    return enriched


def _sort_key(e: dict) -> tuple:
    d = e["date"]
    return (_to_date(d), 0 if e.get("event_type") == "Vesting" else 1)


def _annotate_sale_taxes(enriched: list, timeline: list, ts_dict: dict,
                          lot_order: str = 'lifo',
                          sale_overrides: dict | None = None,
                          sale_loan_map: dict | None = None,
                          sale_lot_overrides: dict | None = None) -> None:
    """
    Compute estimated_tax for each Sale event in place, in chronological order.
    Prior sales are injected as negative vested_shares so lots are consumed correctly.
    """
    from app.sales_engine import build_lots_from_overrides
    # Sort once; insert prior-sale sentinel entries incrementally via bisect.
    sorted_tl = sorted(timeline, key=_sort_key)
    sort_keys: list[tuple] = [_sort_key(e) for e in sorted_tl]

    for e in enriched:
        if e.get("event_type") != "Sale":
            continue
        sale_date = _to_date(e["date"])
        shares = abs(e.get("vested_shares") or 0)
        price_per_share = round(e["gross_proceeds"] / shares, 10) if shares else 0.0
        sale_id = e.get("sale_id")
        effective_ts = (sale_overrides or {}).get(sale_id, ts_dict) if sale_id else ts_dict
        gy, gt = ((sale_loan_map or {}).get(sale_id) or (None, None)) if sale_id else (None, None)
        lot_ovrs = (sale_lot_overrides or {}).get(sale_id) if sale_id else None
        prebuilt = build_lots_from_overrides(sorted_tl, lot_ovrs, sale_date) if lot_ovrs else None
        result = compute_sale_tax(sorted_tl, {"date": sale_date, "shares": shares, "price_per_share": price_per_share}, effective_ts, lot_order=lot_order, grant_year=gy, grant_type=gt, prebuilt_lots=prebuilt)
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]
        # Inject per-lot sentinels so subsequent build_fifo_lots calls consume exactly
        # the lots this sale used (matching lot_order), not just the oldest lots.
        for lot in result.get("lots_consumed", []):
            sentinel = {
                "date": datetime.combine(sale_date, datetime.min.time()),
                "event_type": "Prior Sale Lot",
                "target_vest_date": lot["vest_date"],
                "target_grant_year": lot["grant_year"],
                "target_grant_type": lot["grant_type"],
                "shares_consumed": lot["shares"],
                "vested_shares": 0,
                "grant_price": None,
                "share_price": 0.0,
            }
            key = _sort_key(sentinel)
            idx = bisect.bisect_right(sort_keys, key)
            sorted_tl.insert(idx, sentinel)
            sort_keys.insert(idx, key)

    # Annotate the projected liquidation event (if present)
    for e in enriched:
        if e.get("event_type") != "Liquidation (projected)":
            continue
        liq_date = _to_date(e["date"])
        shares = abs(e.get("vested_shares") or 0)
        if shares == 0:
            continue
        price_per_share = round(e["gross_proceeds"] / shares, 10)
        result = compute_sale_tax(sorted_tl, {"date": liq_date, "shares": shares, "price_per_share": price_per_share}, ts_dict, lot_order=lot_order)
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]


def _build_interest_pool(loans_db: list) -> dict[int, float]:
    """
    Build the deductible investment-interest pool keyed by deductible year.

    Matches the Total Interest card logic:
    - Recorded Interest loans: deductible in due_date.year
    - Projected for any year without a recorded loan: principal × rate
      + compounding on existing interest loans for that grant.
      Projected interest accrues in year yr → deductible in yr+1.
    """
    from collections import defaultdict
    purchase_loans = [l for l in loans_db if l.loan_type == 'Purchase']
    interest_loans  = [l for l in loans_db if l.loan_type == 'Interest']

    # Index: (grant_year, grant_type) -> {loan_year: Loan}
    interest_by_grant: dict = defaultdict(dict)
    for il in interest_loans:
        interest_by_grant[(il.grant_year, il.grant_type)][il.loan_year] = il

    pool: dict[int, float] = {}

    # Recorded interest loans — deductible in due_date.year
    for il in interest_loans:
        pool[il.due_date.year] = pool.get(il.due_date.year, 0.0) + il.amount

    # Projected interest for years without a recorded loan
    for p in purchase_loans:
        due_year = p.due_date.year
        recorded = interest_by_grant[(p.grant_year, p.grant_type)]
        for yr in range(p.loan_year + 1, due_year + 1):
            if yr in recorded:
                continue
            projected = p.amount * p.interest_rate
            for il_yr, il in recorded.items():
                if il_yr < yr:
                    projected += il.amount * il.interest_rate
            deductible_yr = yr + 1
            pool[deductible_yr] = pool.get(deductible_yr, 0.0) + projected

    return pool


# Event types where capital gains are actually realized and taxed.
# Share Price events are mark-to-market (unrealized) — no deduction consumed there.
_TAXABLE_EVENT_TYPES = frozenset({'Vesting', 'Sale', 'Liquidation (projected)'})


def _apply_interest_deduction(enriched: list, loans_db: list, excluded_years: set[int] | None = None) -> None:
    """
    Annotate realized-cap-gains events with an investment-interest deduction offset.

    IRS Form 4952: investment interest paid is deductible against net investment
    income in the year the interest is due.  Only applied at taxable events
    (Vesting, Sale, Liquidation) — not at unrealized Share Price changes.

    Uses full projected interest (matching Total Interest card): recorded Interest
    loans where they exist, projected principal×rate for gaps, with carry-forward.

    excluded_years: if provided, events in these years are skipped (no deduction
    consumed or applied).  Interest due in excluded years is forfeited — if you
    didn't itemize that year, you can't carry that interest forward.

    Modifies events in-place; adds fields:
      interest_deduction_applied      - amount used by this event
      interest_deduction_on_stcg      - portion applied to vesting CG
      interest_deduction_on_ltcg      - portion applied to price CG
      adjusted_total_cap_gains        - total_cap_gains net of deduction
      adjusted_cum_cap_gains          - running cumulative CG net of all deductions
    """
    pool = _build_interest_pool(loans_db)
    sorted_years = sorted(pool.keys())
    year_idx = 0
    available = 0.0
    cum_deduction = 0.0
    excl = excluded_years or set()

    for event in enriched:
        raw_date = event.get('date', '')
        event_year = int(raw_date[:4]) if isinstance(raw_date, str) else raw_date.year

        while year_idx < len(sorted_years) and sorted_years[year_idx] <= event_year:
            yr = sorted_years[year_idx]
            if yr not in excl:
                available += pool[yr]
            year_idx += 1

        ded_stcg = 0.0
        ded_ltcg = 0.0

        if event.get('event_type') in _TAXABLE_EVENT_TYPES and event_year not in excl:
            stcg = max(0.0, event.get('vesting_cap_gains', 0.0))
            ltcg = max(0.0, event.get('price_cap_gains', 0.0))
            if available > 0 and (stcg + ltcg) > 0:
                ded_stcg = min(available, stcg)
                available -= ded_stcg
                ded_ltcg = min(available, ltcg)
                available -= ded_ltcg

        ded_total = ded_stcg + ded_ltcg
        cum_deduction += ded_total

        event['interest_deduction_applied'] = round(ded_total, 2)
        event['interest_deduction_on_stcg'] = round(ded_stcg, 2)
        event['interest_deduction_on_ltcg'] = round(ded_ltcg, 2)
        event['adjusted_total_cap_gains'] = round(event.get('total_cap_gains', 0.0) - ded_total, 2)
        event['adjusted_cum_cap_gains'] = round(event.get('cum_cap_gains', 0.0) - cum_deduction, 2)


@router.get("/preview-deduction")
def preview_deduction(
    enabled: bool = Query(..., description="Whether to apply investment interest deduction"),
    exclude_past: bool = Query(False, description="Auto-exclude years before the current year"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute investment interest deduction impact without saving the setting."""
    grants, prices, loans, loans_db, initial_price, _ = _user_source_data(user, db)
    if not grants and not prices:
        return None
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if not ts_row:
        return None
    db.close()

    excl = set(ts_row.deduction_excluded_years or [])
    if exclude_past and not excl:
        this_year = date.today().year
        vest_years: set[int] = set()
        for g in grants:
            vs = g.get('vest_start')
            periods = g.get('periods', 0)
            if vs and periods:
                start_year = vs.year if hasattr(vs, 'year') else int(str(vs)[:4])
                for i in range(periods):
                    vest_years.add(start_year + i)
        excl = {y for y in vest_years if y < this_year}
    interest_deduction_total = 0.0
    tax_savings_from_deduction = 0.0
    if enabled:
        timeline = get_timeline(user.id, grants, prices, loans, initial_price)
        pool_d = _build_interest_pool(loans_db)
        stcg_rate = ts_row.federal_st_cg_rate + ts_row.niit_rate + ts_row.state_st_cg_rate
        ltcg_rate = ts_row.federal_lt_cg_rate + ts_row.niit_rate + ts_row.state_lt_cg_rate
        sorted_years_d = sorted(pool_d.keys())
        year_idx_d = 0
        available_d = 0.0
        for ev in timeline:
            if ev.get('event_type') not in _TAXABLE_EVENT_TYPES:
                continue
            ev_year = int(ev['date'].year) if hasattr(ev['date'], 'year') else int(str(ev['date'])[:4])
            while year_idx_d < len(sorted_years_d) and sorted_years_d[year_idx_d] <= ev_year:
                yr_d = sorted_years_d[year_idx_d]
                if yr_d not in excl:
                    available_d += pool_d[yr_d]
                year_idx_d += 1
            if ev_year in excl:
                continue
            stcg = max(0.0, ev.get('vesting_cap_gains', 0.0))
            ltcg = max(0.0, ev.get('price_cap_gains', 0.0))
            if available_d > 0 and (stcg + ltcg) > 0:
                ded_s = min(available_d, stcg)
                available_d -= ded_s
                ded_l = min(available_d, ltcg)
                available_d -= ded_l
                interest_deduction_total += ded_s + ded_l
                tax_savings_from_deduction += ded_s * stcg_rate + ded_l * ltcg_rate

    return {
        "interest_deduction_total": round(interest_deduction_total, 2),
        "tax_savings_from_deduction": round(tax_savings_from_deduction, 2),
    }


@router.get("/preview-exit")
def preview_exit(
    date: str = Query(..., description="ISO date to preview as exit date"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute projected liquidation figures for a given exit date without saving it."""
    from datetime import date as date_type
    try:
        preview_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date format")

    grants, prices, loans, loans_db, initial_price, _ = _user_source_data(user, db)
    if not grants and not prices:
        return None

    timeline = get_timeline(user.id, grants, prices, loans, initial_price)
    loan_payments = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    ts_dict = {
        "federal_income_rate": ts_row.federal_income_rate,
        "federal_lt_cg_rate": ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": ts_row.federal_st_cg_rate,
        "niit_rate": ts_row.niit_rate,
        "state_income_rate": ts_row.state_income_rate,
        "state_lt_cg_rate": ts_row.state_lt_cg_rate,
        "state_st_cg_rate": ts_row.state_st_cg_rate,
        "lt_holding_days": ts_row.lt_holding_days,
    } if ts_row else None
    method = ts_row.lot_selection_method if ts_row else 'epic_lifo'
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    db.close()

    enriched = _enrich_timeline(timeline, loans_db, loan_payments, sales, horizon_date=preview_date)
    if ts_dict:
        _annotate_sale_taxes(enriched, timeline, ts_dict, lot_order=lot_order)

    liq = next((e for e in enriched if e.get("event_type") == "Liquidation (projected)"), None)
    if not liq:
        return None

    liq_year = preview_date.year
    settled_ids = {s.loan_id for s in sales if s.loan_id is not None and s.date <= preview_date}
    refinanced_ids = {l.refinances_loan_id for l in loans_db if l.refinances_loan_id is not None}
    early_paid: dict[int, float] = {}
    for lp in loan_payments:
        if lp.date <= preview_date:
            early_paid[lp.loan_id] = early_paid.get(lp.loan_id, 0.0) + lp.amount
    outstanding = sum(
        max(0.0, l.amount - early_paid.get(l.id, 0.0))
        for l in loans_db
        if l.loan_year <= liq_year and l.id not in settled_ids and l.id not in refinanced_ids
    )

    gross = liq.get("gross_proceeds") or 0.0
    tax = liq.get("estimated_tax") or 0.0
    net = max(0.0, gross - outstanding - tax)
    return {
        "date": preview_date.isoformat(),
        "gross_proceeds": round(gross, 2),
        "outstanding_loan_principal": round(outstanding, 2),
        "estimated_tax": round(tax, 2),
        "net_cash": round(net, 2),
        "shares": abs(liq.get("vested_shares") or 0),
        "share_price": liq.get("share_price") or 0.0,
    }


@router.get("/events")
def get_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, loans_db, initial_price, election_83b_map = _user_source_data(user, db)
    if not grants and not prices:
        return []
    timeline = get_timeline(user.id, grants, prices, loans, initial_price)

    loan_payments = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()

    hs_row = db.query(HorizonSettings).filter(HorizonSettings.user_id == user.id).first()
    horizon_date = (hs_row.horizon_date if hs_row and hs_row.horizon_date else None) or _last_vesting_date(timeline)

    enriched = _enrich_timeline(timeline, loans_db, loan_payments, sales, horizon_date=horizon_date)

    # Annotate vesting events with election_83b flag from their grant
    for e in enriched:
        if e["event_type"] == "Vesting":
            e["election_83b"] = election_83b_map.get((e.get("grant_year"), e.get("grant_type")), False)

    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    ts_dict = {
        "federal_income_rate": ts_row.federal_income_rate,
        "federal_lt_cg_rate": ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": ts_row.federal_st_cg_rate,
        "niit_rate": ts_row.niit_rate,
        "state_income_rate": ts_row.state_income_rate,
        "state_lt_cg_rate": ts_row.state_lt_cg_rate,
        "state_st_cg_rate": ts_row.state_st_cg_rate,
        "lt_holding_days": ts_row.lt_holding_days,
    } if ts_row else None

    method = ts_row.lot_selection_method if ts_row else 'epic_lifo'
    lot_order = method if method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    sale_overrides: dict = {}
    sale_loan_map: dict = {}
    sale_lot_overrides: dict = {}
    if ts_row:
        loan_id_to_grant = {ln.id: (ln.grant_year, ln.grant_type) for ln in loans_db}
        for s in sales:
            sale_overrides[s.id] = {
                "federal_income_rate": s.federal_income_rate if s.federal_income_rate is not None else ts_row.federal_income_rate,
                "federal_lt_cg_rate": s.federal_lt_cg_rate if s.federal_lt_cg_rate is not None else ts_row.federal_lt_cg_rate,
                "federal_st_cg_rate": s.federal_st_cg_rate if s.federal_st_cg_rate is not None else ts_row.federal_st_cg_rate,
                "niit_rate": s.niit_rate if s.niit_rate is not None else ts_row.niit_rate,
                "state_income_rate": s.state_income_rate if s.state_income_rate is not None else ts_row.state_income_rate,
                "state_lt_cg_rate": s.state_lt_cg_rate if s.state_lt_cg_rate is not None else ts_row.state_lt_cg_rate,
                "state_st_cg_rate": s.state_st_cg_rate if s.state_st_cg_rate is not None else ts_row.state_st_cg_rate,
                "lt_holding_days": s.lt_holding_days if s.lt_holding_days is not None else ts_row.lt_holding_days,
            }
            if s.loan_id and method == 'same_tranche':
                sale_loan_map[s.id] = loan_id_to_grant.get(s.loan_id, (None, None))
            if s.lot_overrides:
                sale_lot_overrides[s.id] = s.lot_overrides

    # All DB reads are done — release the connection back to the pool before
    # CPU-heavy computation so we don't starve concurrent requests.
    db.close()

    if ts_dict:
        _annotate_sale_taxes(enriched, timeline, ts_dict, lot_order=lot_order,
                             sale_overrides=sale_overrides, sale_loan_map=sale_loan_map,
                             sale_lot_overrides=sale_lot_overrides)

    if ts_row and ts_row.deduct_investment_interest:
        excl = set(ts_row.deduction_excluded_years or [])
        _apply_interest_deduction(enriched, loans_db, excluded_years=excl)

    # Annotate the liquidation event with outstanding loan principal at that date.
    if horizon_date is not None:
        liq_year = horizon_date.year
        settled_ids = {s.loan_id for s in sales if s.loan_id is not None and s.date <= horizon_date}
        refinanced_ids = {l.refinances_loan_id for l in loans_db if l.refinances_loan_id is not None}
        early_paid: dict[int, float] = {}
        for lp in loan_payments:
            if lp.date <= horizon_date:
                early_paid[lp.loan_id] = early_paid.get(lp.loan_id, 0.0) + lp.amount
        outstanding = sum(
            max(0.0, l.amount - early_paid.get(l.id, 0.0))
            for l in loans_db
            if l.loan_year <= liq_year and l.id not in settled_ids and l.id not in refinanced_ids
        )
        for e in enriched:
            if e.get("event_type") == "Liquidation (projected)":
                e["outstanding_loan_principal"] = round(outstanding, 2)

    return [_serialize_event(e) for e in enriched]


@router.get("/dashboard")
def get_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, loans_db, initial_price, _election_83b_map = _user_source_data(user, db)

    today = date.today()
    total_tax_paid = sum(
        ln["amount"] for ln in loans
        if ln["loan_type"] == "Tax" and ln["loan_year"] <= today.year
    )

    sales_db = db.query(Sale).filter(Sale.user_id == user.id).all()
    # Build loan amount + early payment maps for cash received calculation
    loan_payments_db = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).all()
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments_db:
        payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount
    loan_amount_by_id = {ln.id: ln.amount for ln in loans_db}
    # Cash received = all sale proceeds minus loan amounts covered by payoff sales
    cash_received_gross = sum(
        s.shares * s.price_per_share - (
            max(0, loan_amount_by_id.get(s.loan_id, 0) - payments_by_loan.get(s.loan_id, 0))
            if s.loan_id is not None else 0
        )
        for s in sales_db
        if s.date <= today
    )
    sale_taxes = 0.0

    if not grants and not prices:
        return {
            "current_price": 0, "total_shares": 0,
            "total_income": 0, "total_cap_gains": 0,
            "total_loan_principal": 0, "total_tax_paid": 0,
            "cash_received": 0, "next_event": None,
        }

    timeline = get_timeline(user.id, grants, prices, loans, initial_price)

    # Add estimated tax from Sale events (FIFO, chronological order)
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    ts_dict_dash = {
        "federal_income_rate": ts_row.federal_income_rate,
        "federal_lt_cg_rate": ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": ts_row.federal_st_cg_rate,
        "niit_rate": ts_row.niit_rate,
        "state_income_rate": ts_row.state_income_rate,
        "state_lt_cg_rate": ts_row.state_lt_cg_rate,
        "state_st_cg_rate": ts_row.state_st_cg_rate,
        "lt_holding_days": ts_row.lt_holding_days,
    } if ts_row else None

    covered_loan_ids = {s.loan_id for s in sales_db if s.loan_id is not None}

    # All DB reads are done — release the connection before CPU-heavy computation.
    db.close()

    if ts_dict_dash and sales_db:
        sorted_tl_dash = sorted(timeline, key=_sort_key)
        sort_keys_dash: list[tuple] = [_sort_key(e) for e in sorted_tl_dash]
        for s in sorted(sales_db, key=lambda x: x.date):
            if s.date > today:
                continue
            result = compute_sale_tax(sorted_tl_dash, {"date": s.date, "shares": s.shares, "price_per_share": s.price_per_share}, ts_dict_dash)
            total_tax_paid += result["estimated_tax"]
            sale_taxes += result["estimated_tax"]
            sentinel = {
                "date": datetime.combine(s.date, datetime.min.time()),
                "event_type": "Sale",
                "vested_shares": -s.shares,
                "grant_price": None,
                "share_price": 0.0,
            }
            key = _sort_key(sentinel)
            idx = bisect.bisect_right(sort_keys_dash, key)
            sorted_tl_dash.insert(idx, sentinel)
            sort_keys_dash.insert(idx, key)

    # Loan payment by year: payoff_sale vs cash_in (skip refinanced loans — they show as $0 events)
    refinanced_loan_ids_dash: set[int] = {ln.refinances_loan_id for ln in loans_db if ln.refinances_loan_id is not None}
    loan_payment_by_year: dict[str, dict] = {}
    for ln in loans_db:
        if ln.id in refinanced_loan_ids_dash:
            continue
        year = str(ln.due_date.year)
        early_paid = payments_by_loan.get(ln.id, 0.0)
        cash_due = max(0.0, ln.amount - early_paid)
        if year not in loan_payment_by_year:
            loan_payment_by_year[year] = {"year": year, "payoff_sale": 0.0, "cash_in": 0.0}
        if ln.id in covered_loan_ids:
            loan_payment_by_year[year]["payoff_sale"] += cash_due
        else:
            loan_payment_by_year[year]["cash_in"] += cash_due

    last = timeline[-1] if timeline else {}
    next_event = None
    for e in timeline:
        edate = _to_date(e["date"])
        if edate >= today:
            next_event = {"date": edate.isoformat(), "event_type": e["event_type"]}
            break

    # Investment interest deduction — adjust total_cap_gains and estimate tax savings
    interest_deduction_total = 0.0
    tax_savings_from_deduction = 0.0
    if ts_row and ts_row.deduct_investment_interest:
        excl_d = set(ts_row.deduction_excluded_years or [])
        pool_d = _build_interest_pool(loans_db)
        sorted_years_d = sorted(pool_d.keys())
        year_idx_d = 0
        available_d = 0.0
        stcg_rate = ts_row.federal_st_cg_rate + ts_row.niit_rate + ts_row.state_st_cg_rate
        ltcg_rate = ts_row.federal_lt_cg_rate + ts_row.niit_rate + ts_row.state_lt_cg_rate
        for ev in timeline:
            if ev.get('event_type') not in _TAXABLE_EVENT_TYPES:
                continue
            ev_year = int(ev['date'].year) if hasattr(ev['date'], 'year') else int(str(ev['date'])[:4])
            while year_idx_d < len(sorted_years_d) and sorted_years_d[year_idx_d] <= ev_year:
                yr_d = sorted_years_d[year_idx_d]
                if yr_d not in excl_d:
                    available_d += pool_d[yr_d]
                year_idx_d += 1
            if ev_year in excl_d:
                continue
            stcg = max(0.0, ev.get('vesting_cap_gains', 0.0))
            ltcg = max(0.0, ev.get('price_cap_gains', 0.0))
            if available_d > 0 and (stcg + ltcg) > 0:
                ded_s = min(available_d, stcg)
                available_d -= ded_s
                ded_l = min(available_d, ltcg)
                available_d -= ded_l
                interest_deduction_total += ded_s + ded_l
                tax_savings_from_deduction += ded_s * stcg_rate + ded_l * ltcg_rate

    return {
        "current_price": last.get("share_price", initial_price),
        "total_shares": last.get("cum_shares", 0),
        "total_income": last.get("cum_income", 0),
        "total_cap_gains": round(last.get("cum_cap_gains", 0), 2),
        "total_loan_principal": sum(ln["amount"] for ln in loans),
        "total_tax_paid": round(total_tax_paid - tax_savings_from_deduction, 2),
        "cash_received": round(cash_received_gross - sale_taxes + tax_savings_from_deduction, 2),
        "interest_deduction_total": round(interest_deduction_total, 2),
        "tax_savings_from_deduction": round(tax_savings_from_deduction, 2),
        "loan_payment_by_year": sorted(loan_payment_by_year.values(), key=lambda x: x["year"]),
        "next_event": next_event,
    }
