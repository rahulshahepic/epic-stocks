import bisect
from datetime import date, datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, LoanPayment, Sale, TaxSettings, HorizonSettings
from scaffold.auth import get_current_user
from app.timeline_cache import get_timeline
from app.sales_engine import compute_sale_tax

router = APIRouter(prefix="/api", tags=["events"])


def _to_date(d) -> date:
    """Normalise event date to datetime.date — handles datetime, ISO string, or date."""
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, str):
        return date.fromisoformat(d[:10])
    return d


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
            edate = ev["date"]
            if isinstance(edate, datetime):
                edate = edate.date()
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
    return (d.date() if isinstance(d, datetime) else d, 0 if e.get("event_type") == "Vesting" else 1)


def _annotate_sale_taxes(enriched: list, timeline: list, ts_dict: dict,
                          lot_order: str = 'lifo',
                          sale_overrides: dict | None = None,
                          sale_loan_map: dict | None = None) -> None:
    """
    Compute estimated_tax for each Sale event in place, in chronological order.
    Prior sales are injected as negative vested_shares so lots are consumed correctly.
    """
    # Sort once; insert prior-sale sentinel entries incrementally via bisect.
    sorted_tl = sorted(timeline, key=_sort_key)
    sort_keys: list[tuple] = [_sort_key(e) for e in sorted_tl]

    for e in enriched:
        if e.get("event_type") != "Sale":
            continue
        sale_date = e["date"]
        if isinstance(sale_date, datetime):
            sale_date = sale_date.date()
        shares = abs(e.get("vested_shares") or 0)
        price_per_share = round(e["gross_proceeds"] / shares, 10) if shares else 0.0
        sale_id = e.get("sale_id")
        effective_ts = (sale_overrides or {}).get(sale_id, ts_dict) if sale_id else ts_dict
        gy, gt = ((sale_loan_map or {}).get(sale_id) or (None, None)) if sale_id else (None, None)
        result = compute_sale_tax(sorted_tl, {"date": sale_date, "shares": shares, "price_per_share": price_per_share}, effective_ts, lot_order=lot_order, grant_year=gy, grant_type=gt)
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]
        # Append prior-sale entry in sorted order for the next iteration.
        sentinel = {
            "date": datetime.combine(sale_date, datetime.min.time()),
            "event_type": "Sale",
            "vested_shares": -shares,
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
        liq_date = e["date"]
        if isinstance(liq_date, datetime):
            liq_date = liq_date.date()
        shares = abs(e.get("vested_shares") or 0)
        if shares == 0:
            continue
        price_per_share = round(e["gross_proceeds"] / shares, 10)
        result = compute_sale_tax(sorted_tl, {"date": liq_date, "shares": shares, "price_per_share": price_per_share}, ts_dict, lot_order=lot_order)
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]


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

    lot_order = 'fifo' if ts_row and ts_row.lot_selection_method == 'fifo' else 'lifo'
    sale_overrides: dict = {}
    sale_loan_map: dict = {}
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
            if s.loan_id and ts_row.lot_selection_method == 'same_tranche':
                sale_loan_map[s.id] = loan_id_to_grant.get(s.loan_id, (None, None))

    # All DB reads are done — release the connection back to the pool before
    # CPU-heavy computation so we don't starve concurrent requests.
    db.close()

    if ts_dict:
        _annotate_sale_taxes(enriched, timeline, ts_dict, lot_order=lot_order, sale_overrides=sale_overrides, sale_loan_map=sale_loan_map)

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

    # Build loan payment data for the loan payment chart
    loan_payments_db = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).all()
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments_db:
        payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount
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
        edate = e["date"]
        if isinstance(edate, datetime):
            edate = edate.date()
        elif isinstance(edate, str):
            edate = date.fromisoformat(edate[:10])
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
