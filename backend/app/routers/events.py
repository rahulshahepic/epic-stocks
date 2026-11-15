from app.loan_state import refinanced_loan_ids as _refinanced_loan_ids
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, LoanPayment, Sale, TaxSettings
from scaffold.auth import get_current_user
from services.timeline_cache import get_timeline
from app.sales_engine import compute_sale_tax
from app.date_utils import to_date as _to_date
from services.vesting import core_grant

router = APIRouter(prefix="/api", tags=["events"])


def _user_source_data(user: User, db: Session):
    grants_db = db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()
    prices_db = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all()

    grants = [core_grant(g) for g in grants_db]

    election_83b_map = {(g.year, g.type): bool(g.election_83b) for g in grants_db}

    prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]

    loans = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    estimated_price_dates = {p.effective_date for p in prices_db if p.is_estimate}

    initial_price = prices[0]["price"] if prices else 0
    return grants, prices, loans, loans_db, initial_price, election_83b_map, estimated_price_dates


def _tax_due_dates(db: Session) -> dict:
    from scaffold.models import GrantTemplate
    out = {}
    for t in db.query(GrantTemplate).filter(GrantTemplate.default_tax_due_date.isnot(None)).all():
        try:
            out[(t.year, t.type)] = date.fromisoformat(t.default_tax_due_date)
        except (TypeError, ValueError):
            continue
    return out


def _projection_settings(ts_row) -> dict:
    from app.loan_projection import DEFAULT_WITHHOLDING_RATE
    if ts_row is None:
        return {"assumed_rate": None, "withholding_rate": DEFAULT_WITHHOLDING_RATE, "lag_days": 0}
    w = ts_row.tax_withholding_rate
    return {
        "assumed_rate": ts_row.projected_loan_rate,
        "withholding_rate": DEFAULT_WITHHOLDING_RATE if w is None else w,
        "lag_days": int(ts_row.exit_payoff_lag_days or 0),
    }


def _project(grants, prices, loans_db, loan_payments, sales, settings: dict, tax_due: dict,
             stop: date | None = None, today: date | None = None, settle_on: date | None = None):
    """The one projection of unbooked interest and tax loans (app/loan_projection.py)."""
    from app.loan_projection import project
    return project(
        loans_db, grants, prices, today=today or date.today(), stop=stop,
        assumed_rate=settings["assumed_rate"], withholding_rate=settings["withholding_rate"],
        tax_due_dates=tax_due, loan_payments=loan_payments, sales=sales, settle_on=settle_on,
    )


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



def _live_loans(loans_db, as_of) -> list:
    """The loans that still carry debt as of a date — see `refinanced_loan_ids`.

    Pass the same date the figure is reported for. The dashboard's totals are a
    picture of today, so they pass `today` and agree with
    `_compute_outstanding_principal`; passing None here would drop a loan whose
    refinance has not happened yet while the outstanding figure still counts it.
    """
    superseded = _refinanced_loan_ids(loans_db, as_of)
    return [l for l in loans_db
            if l.id not in superseded and (as_of is None or l.loan_year <= as_of.year)]


def _compute_outstanding_principal(loans_db, loan_payments, sales, as_of_date) -> float:
    """Outstanding loan principal as of a date, excluding settled/refinanced loans."""
    year = as_of_date.year
    settled_ids = {s.loan_id for s in sales if s.loan_id is not None and s.date <= as_of_date}
    refinanced_ids = _refinanced_loan_ids(loans_db, as_of_date)
    early_paid: dict[int, float] = {}
    for lp in loan_payments:
        if lp.date <= as_of_date:
            early_paid[lp.loan_id] = early_paid.get(lp.loan_id, 0.0) + lp.amount
    return sum(
        max(0.0, l.amount - early_paid.get(l.id, 0.0))
        for l in loans_db
        if l.loan_year <= year and l.id not in settled_ids and l.id not in refinanced_ids
    )


def _compute_unvested_cost(grants, as_of_date) -> float:
    """Proceeds from selling unvested shares at cost basis (grant price)."""
    total_cost = 0.0
    for g in grants:
        total = g['shares']
        vested = sum(n for d, n in g['vesting'] if d.date() <= as_of_date)
        unvested = total - vested
        if unvested > 0 and (g['price'] or 0) > 0:
            total_cost += unvested * g['price']
    return total_cost


def _build_exit_summary(enriched, grants, loans_db, loan_payments, sales_db,
                        horizon_date, ts_dict, deduction_enabled, excluded_years,
                        projection=None, exit_projection=None) -> dict:
    """Build a comprehensive exit breakdown for the liquidation detail card.

    Every loan is paid at the exit: the real rows' principal, plus what the
    projection says the statements have not booked — Interest loans
    capitalised each 31 December, interest accrued since then (through the
    exit plus the payoff lag) and projected Tax loans. A projected payoff
    falling before the exit with no real loan to carry its sale is paid from
    the exit proceeds.
    """
    from app.loan_projection import outstanding_at_stop
    liq = next((e for e in enriched if e.get("event_type") == "Liquidation (projected)"), None)
    if not liq:
        return {}

    vested_shares = abs(liq.get("vested_shares") or 0)
    share_price = liq.get("share_price") or 0.0
    gross_vested = liq.get("gross_proceeds") or 0.0
    unvested_cost = round(_compute_unvested_cost(grants, horizon_date), 2)
    liq_tax = liq.get("estimated_tax") or 0.0
    outstanding = round(_compute_outstanding_principal(loans_db, loan_payments, sales_db, horizon_date), 2)

    # Per-sale breakdown from enriched events
    loan_amount_by_id = {l.id: l.amount for l in loans_db}
    early_paid_by_loan: dict[int, float] = {}
    for lp in loan_payments:
        early_paid_by_loan[lp.loan_id] = early_paid_by_loan.get(lp.loan_id, 0.0) + lp.amount
    sale_db_by_id = {s.id: s for s in sales_db}
    prior_sales = []
    for e in enriched:
        if e.get("event_type") != "Sale":
            continue
        edate = _to_date(e["date"])
        if edate > horizon_date:
            continue
        sid = e.get("sale_id")
        s = sale_db_by_id.get(sid) if sid else None
        proceeds = e.get("gross_proceeds") or 0.0
        tax = e.get("estimated_tax") or 0.0
        loan_payoff = 0.0
        if s and s.loan_id is not None:
            loan_payoff = max(0.0, loan_amount_by_id.get(s.loan_id, 0) - early_paid_by_loan.get(s.loan_id, 0.0))
            if projection is not None:
                loan_payoff += projection.extra_for(s.loan_id)
        prior_sales.append({
            "date": edate.isoformat(),
            "shares": abs(e.get("vested_shares") or 0),
            "price_per_share": round(proceeds / abs(e.get("vested_shares") or 1), 2),
            "proceeds": round(proceeds, 2),
            "estimated_tax": round(tax, 2),
            "loan_payoff": round(loan_payoff, 2),
            "net": round(proceeds - tax - loan_payoff, 2),
        })
    prior_sales_net = round(sum(s["net"] for s in prior_sales), 2)

    # Ordinary income: zero-basis grants at vest, or at grant (Exercise) for
    # those with an 83(b) election. Shown for reference; the cash side of
    # it is the Tax loans, which the payoffs and the exit already pay.
    income_tax = round(sum(
        e.get("income", 0.0) * (ts_dict["federal_income_rate"] + ts_dict["state_income_rate"])
        for e in enriched
        if e.get("event_type") in ("Vesting", "Exercise") and _to_date(e["date"]) <= horizon_date
    ), 2) if ts_dict else 0.0

    deduction_savings = 0.0
    deduction_years: list[int] = []
    interest_deducted = 0.0
    if deduction_enabled and ts_dict:
        interest_deducted, deduction_savings = _deduction_totals(enriched, ts_dict, horizon_date)
        deduction_years = sorted({_to_date(e["date"]).year for e in enriched
                                  if _to_date(e["date"]) <= horizon_date
                                  and e.get("interest_deduction_applied", 0.0) > 0})

    at_exit = outstanding_at_stop(exit_projection) if exit_projection is not None else {
        "projected_principal": 0.0, "projected_interest": 0.0, "accrued": 0.0, "real_interest": 0.0}
    accrued_interest = round(at_exit["projected_interest"] + at_exit["accrued"], 2)
    projected_loans = at_exit["projected_principal"]
    unfunded = 0.0
    if projection is not None:
        unfunded = round(sum(p.extra for p in projection.orphan_payoffs()
                             if date.today() <= p.date <= horizon_date), 2)
    interest_paid_total = 0.0
    if exit_projection is not None:
        interest_paid_total = round(sum(p.interest_paid for p in exit_projection.payoffs
                                        if date.today() <= p.date), 2)
    liq_net = round(max(0.0, gross_vested + unvested_cost - liq_tax - outstanding
                        - projected_loans - accrued_interest - unfunded), 2)
    net_cash = round(prior_sales_net + liq_net + deduction_savings, 2)

    return {
        "vested_shares": vested_shares,
        "share_price": share_price,
        "gross_vested": round(gross_vested, 2),
        "unvested_cost_proceeds": unvested_cost,
        "liquidation_tax": round(liq_tax, 2),
        "outstanding_principal": outstanding,
        "outstanding_accrued_interest": accrued_interest,
        "outstanding_projected_loans": projected_loans,
        "projected_payoffs_before_exit": unfunded,
        "interest_paid_through_exit": interest_paid_total,
        "interest_deducted": interest_deducted,
        "prior_sales": prior_sales,
        "prior_sales_net": prior_sales_net,
        "income_tax": income_tax,
        "deduction_savings": deduction_savings,
        "deduction_years": deduction_years,
        "deduction_excluded_years": sorted(excluded_years) if deduction_enabled and excluded_years else [],
        "net_cash": net_cash,
    }


def _enrich_timeline(timeline: list, loans_db: list, loan_payments: list, sales: list,
                     horizon_date=None, projection=None, today: date | None = None) -> list:
    """
    Enrich Loan Payoff events with cash_due / covered_by_sale.
    Inject Early Loan Payment events for user-recorded LoanPayments.

    With a `projection`, a payoff's cash_due also carries what the statements
    have not booked yet — projected Interest loans, interest accrued since the
    last 31 December and projected Tax loans due the same day — and a projected
    payoff with no real loan to carry it gets its own event.
    """
    today = today or date.today()
    # Build lookup: loan_id → sum of early payments
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments:
        payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount

    # Set of loan_ids covered by a linked sale
    covered_loan_ids = {s.loan_id for s in sales if s.loan_id is not None}

    # Set of loan_ids that were refinanced by another loan (their payoff events become "Refinanced")
    # None: a loan the schedule replaces before maturity never reaches its own
    # payoff date, whichever side of today the refinance falls on.
    refinanced_loan_ids: set[int] = _refinanced_loan_ids(loans_db, None)

    enriched = []
    for e in timeline:
        if e["event_type"] == "Loan Payoff" and e.get("source"):
            idx = e["source"].get("index", -1)
            if 0 <= idx < len(loans_db):
                loan = loans_db[idx]
                if loan.id in refinanced_loan_ids:
                    pass  # Loan was replaced by a later refinance — no event on the old due date
                else:
                    early_paid = payments_by_loan.get(loan.id, 0.0)
                    cash_due = max(0.0, loan.amount - early_paid)
                    extra = {}
                    po = projection.payoff_for(loan.id) if projection else None
                    if po is not None:
                        cash_due += po.extra
                        extra = {"projected_interest": po.projected_interest,
                                 "projected_accrued_interest": po.accrued,
                                 "projected_tax_loans": po.projected_principal}
                    covered = loan.id in covered_loan_ids
                    status = "covered" if covered else "planned"
                    if not covered and loan.due_date < today:
                        # Not settled automatically: Epic often extends these.
                        status = "past_due_unconfirmed"
                    enriched.append({
                        **e,
                        **extra,
                        "loan_db_id": loan.id,
                        "cash_due": round(cash_due, 2),
                        "covered_by_sale": covered,
                        "status": status,
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

    if projection is not None:
        for po in projection.orphan_payoffs():
            if po.date < today:
                continue
            enriched.append({
                "date": datetime.combine(po.date, datetime.min.time()),
                "event_type": "Loan Payoff",
                "grant_year": po.group[0], "grant_type": po.group[1],
                "granted_shares": None, "grant_price": None, "exercise_price": None,
                "vested_shares": None, "price_increase": 0.0,
                "share_price": price_at(po.date), "cum_shares": shares_at(po.date),
                "income": 0.0, "cum_income": cum_income_at(po.date),
                "vesting_cap_gains": 0.0, "price_cap_gains": 0.0, "total_cap_gains": 0.0,
                "cum_cap_gains": cum_cap_gains_at(po.date),
                "loan_db_id": None, "cash_due": round(po.extra, 2),
                "projected_interest": po.projected_interest,
                "projected_accrued_interest": po.accrued,
                "projected_tax_loans": po.projected_principal,
                "covered_by_sale": False, "status": "projected", "is_projected": True,
            })

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


def _annotate_sale_taxes(enriched: list, timeline: list, ts_dict: dict,
                          loan_grant_by_id: dict | None = None,
                          loan_payoff_method: str | None = None,
                          lot_selection_method: str | None = 'lifo',
                          flexible_payoff_enabled: bool = False,
                          sale_overrides: dict | None = None,
                          sale_loan_ids: dict | None = None,
                          sale_lot_overrides: dict | None = None) -> None:
    """
    Compute estimated_tax for each Sale event in place, via the single shared
    compute_all_sale_taxes — the same function /api/sales/{id}/tax, the bulk
    /api/sales/tax and payoff-sale sizing use, so the timeline (and the
    Dashboard it feeds) can never disagree with them about the same sale.
    """
    from app.sale_tax import compute_all_sale_taxes

    sale_specs = []
    for e in enriched:
        if e.get("event_type") != "Sale":
            continue
        shares = abs(e.get("vested_shares") or 0)
        if not shares:
            continue
        sale_id = e.get("sale_id")
        sale_specs.append({
            "id": sale_id,
            "date": _to_date(e["date"]),
            "shares": shares,
            "price_per_share": round(e["gross_proceeds"] / shares, 10),
            "loan_id": (sale_loan_ids or {}).get(sale_id),
            "lot_overrides": (sale_lot_overrides or {}).get(sale_id),
            "rates": (sale_overrides or {}).get(sale_id, ts_dict),
        })

    results, final_tl = compute_all_sale_taxes(
        timeline, sale_specs, loan_grant_by_id or {}, loan_payoff_method,
        lot_selection_method, flexible_payoff_enabled,
    )
    for e in enriched:
        if e.get("event_type") != "Sale":
            continue
        result = results.get(e.get("sale_id"))
        if result is None:
            continue
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]
        e["lt_gain"] = result["lt_gain"]
        e["st_gain"] = result["st_gain"]

    # Annotate the projected liquidation event (if present), against
    # everything real that came before it.
    for e in enriched:
        if e.get("event_type") != "Liquidation (projected)":
            continue
        liq_date = _to_date(e["date"])
        shares = abs(e.get("vested_shares") or 0)
        if shares == 0:
            continue
        price_per_share = round(e["gross_proceeds"] / shares, 10)
        liq_lot_order = lot_selection_method if lot_selection_method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
        result = compute_sale_tax(final_tl, {"date": liq_date, "shares": shares, "price_per_share": price_per_share}, ts_dict, lot_order=liq_lot_order)
        e["estimated_tax"] = result["estimated_tax"]
        e["st_shares"] = result["st_shares"]
        e["lt_gain"] = result["lt_gain"]
        e["st_gain"] = result["st_gain"]


# Events at which gains are realized. Vesting is not one: under 83(b) it is no
# tax event, and without it the spread is ordinary income, not a capital gain.
_TAXABLE_EVENT_TYPES = frozenset({'Sale', 'Liquidation (projected)'})


def _apply_interest_deduction(enriched: list, interest_paid_by_year: dict[int, float],
                              excluded_years: set[int] | None = None) -> None:
    """
    Annotate realized-gain events with the investment-interest deduction.

    Interest is deductible in the year it is paid — an Interest loan when it
    is repaid, accrued interest when its loan is — and only against gains
    actually realized that year (Form 4952); the unused part carries forward.
    It offsets short-term gains first, then long-term, so each dollar saves
    the rate of the gain it offsets. Interest paid in an excluded year (one
    the user did not itemize) is forfeited.

    `interest_paid_by_year` comes from `Projection.interest_paid_by_year()`.
    Sale events need `st_gain`/`lt_gain` from `_annotate_sale_taxes`.

    Adds to every event:
      interest_deduction_applied, interest_deduction_on_stcg,
      interest_deduction_on_ltcg, adjusted_total_cap_gains, adjusted_cum_cap_gains
    """
    pool = interest_paid_by_year
    sorted_years = sorted(pool)
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
        if event.get('event_type') in _TAXABLE_EVENT_TYPES and event_year not in excl and available > 0:
            st = max(0.0, event.get('st_gain') or 0.0)
            lt = max(0.0, event.get('lt_gain') or 0.0)
            ded_stcg = min(available, st)
            available -= ded_stcg
            ded_ltcg = min(available, lt)
            available -= ded_ltcg

        ded_total = ded_stcg + ded_ltcg
        cum_deduction += ded_total
        event['interest_deduction_applied'] = round(ded_total, 2)
        event['interest_deduction_on_stcg'] = round(ded_stcg, 2)
        event['interest_deduction_on_ltcg'] = round(ded_ltcg, 2)
        event['adjusted_total_cap_gains'] = round(event.get('total_cap_gains', 0.0) - ded_total, 2)
        event['adjusted_cum_cap_gains'] = round(event.get('cum_cap_gains', 0.0) - cum_deduction, 2)


def _deduction_totals(enriched: list, ts: dict, cutoff: date | None = None) -> tuple[float, float]:
    """(deduction used, tax it saves) over annotated events up to `cutoff`."""
    st_rate = ts["federal_st_cg_rate"] + ts["niit_rate"] + ts["state_st_cg_rate"]
    lt_rate = ts["federal_lt_cg_rate"] + ts["niit_rate"] + ts["state_lt_cg_rate"]
    used = saved = 0.0
    for e in enriched:
        if cutoff is not None and _to_date(e["date"]) > cutoff:
            break
        used += e.get("interest_deduction_applied", 0.0)
        saved += (e.get("interest_deduction_on_stcg", 0.0) * st_rate
                  + e.get("interest_deduction_on_ltcg", 0.0) * lt_rate)
    return round(used, 2), round(saved, 2)


def _ts_dict(ts_row) -> dict | None:
    if not ts_row:
        return None
    return {
        "federal_income_rate": ts_row.federal_income_rate,
        "federal_lt_cg_rate": ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": ts_row.federal_st_cg_rate,
        "niit_rate": ts_row.niit_rate,
        "state_income_rate": ts_row.state_income_rate,
        "state_lt_cg_rate": ts_row.state_lt_cg_rate,
        "state_st_cg_rate": ts_row.state_st_cg_rate,
        "lt_holding_days": ts_row.lt_holding_days,
    }


def _sale_overrides(sales, ts_row) -> tuple[dict, dict, dict]:
    overrides, loan_ids, lots = {}, {}, {}
    for s in sales:
        loan_ids[s.id] = s.loan_id
        if s.lot_overrides:
            lots[s.id] = s.lot_overrides
        if ts_row:
            overrides[s.id] = {
                k: (getattr(s, k) if getattr(s, k) is not None else getattr(ts_row, k))
                for k in ("federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate", "niit_rate",
                          "state_income_rate", "state_lt_cg_rate", "state_st_cg_rate", "lt_holding_days")
            }
    return overrides, loan_ids, lots


def _projected_events(user: User, db: Session, *, horizon_date=None, deduction_enabled=None,
                      excluded_years=None):
    """Grants, loans, sales and the enriched, taxed, deduction-annotated
    timeline: one path for /events, /preview-exit, /preview-deduction and the
    dashboard so none of them can disagree about a payoff or a deduction."""
    grants, prices, loans, loans_db, initial_price, election_83b_map, estimated_price_dates = _user_source_data(user, db)
    if not grants and not prices:
        return None
    timeline = get_timeline(user.id, grants, prices, loans, initial_price)
    loan_payments = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    ts_dict = _ts_dict(ts_row)
    from app.routers.loans import _is_flexible_payoff_enabled
    flexible_payoff_enabled = _is_flexible_payoff_enabled(db)
    settings = _projection_settings(ts_row)
    tax_due = _tax_due_dates(db)
    loan_grant_by_id = {ln.id: (ln.grant_year, ln.grant_type) for ln in loans_db}
    overrides, sale_loan_ids, lot_overrides = _sale_overrides(sales, ts_row)
    if deduction_enabled is None:
        deduction_enabled = bool(ts_row and ts_row.deduct_investment_interest)
    if excluded_years is None:
        excluded_years = set(ts_row.deduction_excluded_years or []) if ts_row else set()
    ctx = {
        "grants": grants, "prices": prices, "loans_db": loans_db, "timeline": timeline,
        "loan_payments": loan_payments, "sales": sales, "ts_row": ts_row, "ts_dict": ts_dict,
        "election_83b_map": election_83b_map, "estimated_price_dates": estimated_price_dates,
        "initial_price": initial_price, "settings": settings,
        "deduction_enabled": deduction_enabled, "excluded_years": excluded_years,
    }
    proj = _project(grants, prices, loans_db, loan_payments, sales, settings, tax_due)
    ctx["projection"] = proj
    stop = None
    if horizon_date is not None:
        stop = horizon_date + timedelta(days=settings["lag_days"])
        ctx["exit_projection"] = _project(grants, prices, loans_db, loan_payments, sales, settings, tax_due, stop=stop)
    enriched = _enrich_timeline(timeline, loans_db, loan_payments, sales, horizon_date=horizon_date, projection=proj)
    if ts_dict:
        _annotate_sale_taxes(enriched, timeline, ts_dict,
                             loan_grant_by_id=loan_grant_by_id,
                             loan_payoff_method=ts_row.loan_payoff_method,
                             lot_selection_method=ts_row.lot_selection_method,
                             flexible_payoff_enabled=flexible_payoff_enabled,
                             sale_overrides=overrides, sale_loan_ids=sale_loan_ids,
                             sale_lot_overrides=lot_overrides)
        if deduction_enabled:
            paid = (ctx["exit_projection"] if horizon_date is not None else proj).interest_paid_by_year()
            _apply_interest_deduction(enriched, paid, excluded_years=excluded_years)
    ctx["enriched"] = enriched
    return ctx


@router.get("/preview-deduction")
def preview_deduction(
    enabled: bool = Query(..., description="Whether to apply investment interest deduction"),
    exclude_past: bool = Query(False, description="Auto-exclude years before the current year"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute investment interest deduction impact without saving the setting."""
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if not ts_row:
        return None
    excl = set(ts_row.deduction_excluded_years or [])
    if exclude_past and not excl:
        this_year = date.today().year
        grants_db = db.query(Grant).filter(Grant.user_id == user.id).all()
        from services.vesting import vest_years
        excl = {y for g in grants_db for y in vest_years(g) if y < this_year}
    ctx = _projected_events(user, db, deduction_enabled=enabled, excluded_years=excl)
    db.close()
    if ctx is None:
        return None
    used, saved = _deduction_totals(ctx["enriched"], ctx["ts_dict"]) if enabled else (0.0, 0.0)
    return {"interest_deduction_total": used, "tax_savings_from_deduction": saved}


def _preview_exit_data(user: User, db: Session, date_str: str):
    """Core preview-exit logic. Used by both the direct endpoint and the
    /sharing/view/{invitation_id}/preview-exit endpoint, so it must operate
    on an arbitrary User (not just the current request user)."""
    from datetime import date as date_type
    try:
        preview_date = date_type.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date format") from None

    ctx = _projected_events(user, db, horizon_date=preview_date)
    db.close()
    if ctx is None:
        return None
    enriched = ctx["enriched"]
    liq = next((e for e in enriched if e.get("event_type") == "Liquidation (projected)"), None)
    if not liq:
        return None
    summary = _build_exit_summary(
        enriched, ctx["grants"], ctx["loans_db"], ctx["loan_payments"], ctx["sales"],
        preview_date, ctx["ts_dict"], ctx["deduction_enabled"], ctx["excluded_years"],
        projection=ctx["projection"], exit_projection=ctx["exit_projection"],
    )
    if not summary:
        return None
    return {
        "date": preview_date.isoformat(),
        **summary,
    }


@router.get("/preview-exit")
def preview_exit(
    date: str = Query(..., description="ISO date to preview as exit date"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute projected liquidation figures for a given exit date without saving it."""
    return _preview_exit_data(user, db, date)


@router.get("/events")
def get_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_events_data(user, db)


def _get_events_data(user: User, db: Session) -> list:
    """Core events logic, usable by both the direct endpoint and shared view."""
    ctx = _projected_events(user, db)
    if ctx is None:
        return []
    enriched = ctx["enriched"]
    from services.price_state import price_metadata
    price_rows = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()
    db.close()
    current_row = price_rows[0] if price_rows else None
    price_index = 0
    for event in enriched:
        when = _to_date(event["date"])
        while price_index < len(price_rows) and price_rows[price_index].effective_date <= when:
            current_row = price_rows[price_index]
            price_index += 1
        if current_row:
            event.update(price_metadata(current_row))

    # Annotate vesting events with election_83b flag from their grant
    # Annotate Share Price events with is_estimate flag
    for e in enriched:
        if e["event_type"] == "Vesting":
            e["election_83b"] = ctx["election_83b_map"].get((e.get("grant_year"), e.get("grant_type")), False)
        elif e["event_type"] == "Share Price":
            if _to_date(e["date"]) in ctx["estimated_price_dates"]:
                e["is_estimate"] = True
    return [_serialize_event(e) for e in enriched]


@router.get("/dashboard")
def get_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_dashboard_data(user, db)


def _as_of_view(payload: dict, as_of: date, timeline: list) -> dict:
    """Rename the bounded figures to say what they actually count.

    `total_*` bounded to a date are not the totals the app's keys mean: a caller
    read `total_shares` as the whole position and got the vested count. So the
    date-bounded figures get date-bounded names, and the one full-schedule figure
    that is a fact rather than an assumption comes back beside them — share
    counts follow the vesting schedule, income and gains follow projected prices,
    which is why there is no lifetime equivalent of those two.
    """
    payload = dict(payload)
    payload["as_of"] = as_of.isoformat()
    payload["vested_shares"] = payload.pop("total_shares")
    payload["shares_at_end_of_schedule"] = timeline[-1].get("cum_shares", 0) if timeline else 0
    payload["income_to_date"] = payload.pop("total_income")
    payload["cap_gains_to_date"] = payload.pop("total_cap_gains")
    payload["basis"] = (
        "vested_shares, income_to_date, cap_gains_to_date, total_tax_paid and "
        f"cash_received count only what has happened by {as_of.isoformat()}. "
        "held_vested_shares excludes shares sold or exchanged; total_stock_value "
        "values those holdings at stock_valuation_price plus purchased unvested "
        "shares at purchase cost. net_equity subtracts outstanding_loan_balance "
        "and accrued_unbooked_interest. The balance nets early payments and settled "
        "loans (unlike gross total_loan_principal). "
        "shares_at_end_of_schedule is the position once every grant on record has "
        "fully vested — a share count, so it is a fact. There is no lifetime "
        "income or gains figure because those would be computed from prices the "
        "user assumed."
    )
    return payload


def _get_dashboard_data(user: User, db: Session, as_of: date | None = None) -> dict:
    """Core dashboard logic, usable by both the direct endpoint and shared view.

    `as_of` bounds the cumulative figures to a point on the timeline instead of
    running to its end. The web app has always done this itself — it picks the
    last event on or before the date in its picker and flags when that rests on
    an estimated price — but the endpoint returned the *final* event, which on
    an account with price projections is a decade out. That is fine for the app,
    which only uses these as a placeholder until it computes its own, and wrong
    for anything that reads them as the answer: `current_price` held a projected
    2034 price.

    Left as None the cumulative figures still run to the end of the timeline,
    which is what the app expects. The position fields (`total_stock_value`,
    `net_equity` and the figures they are built from) and `price_is_estimate`
    are always a snapshot at `as_of`, or today when it is None.
    """
    grants, prices, loans, loans_db, initial_price, _election_83b_map, estimated_price_dates = _user_source_data(user, db)

    today = date.today()
    cutoff = as_of or today
    # Live rows only. A refinanced loan is carried by its successor, so summing
    # every row charges one debt once per link in its chain. All cumulative
    # figures use the same cutoff as the requested snapshot.
    live_loans = _live_loans(loans_db, cutoff)
    total_tax_paid = sum(
        ln.amount for ln in live_loans
        if ln.loan_type == "Tax" and ln.loan_year <= cutoff.year
    )

    sales_db = db.query(Sale).filter(Sale.user_id == user.id).all()
    # Build loan amount + early payment maps for cash received calculation
    loan_payments_db = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).all()
    payments_by_loan: dict[int, float] = {}
    for lp in loan_payments_db:
        if lp.date <= cutoff:
            payments_by_loan[lp.loan_id] = payments_by_loan.get(lp.loan_id, 0.0) + lp.amount
    purchased = [g for g in grants if g["exercise_date"].date() <= cutoff]
    position = {
        "purchased_unvested_value": round(_compute_unvested_cost(purchased, cutoff), 2),
        "outstanding_loan_balance": round(
            _compute_outstanding_principal(loans_db, loan_payments_db, sales_db, cutoff), 2
        ),
        "accrued_unbooked_interest": None,
        "valuation_price": None,
    }
    for price in prices:
        if _to_date(price["date"]) <= cutoff:
            position["valuation_price"] = price["price"]
        else:
            break
    loan_amount_by_id = {ln.id: ln.amount for ln in loans_db}
    # Cash received = all sale proceeds minus loan amounts covered by payoff sales
    cash_received_gross = sum(
        s.shares * s.price_per_share - (
            max(0, loan_amount_by_id.get(s.loan_id, 0) - payments_by_loan.get(s.loan_id, 0))
            if s.loan_id is not None else 0
        )
        for s in sales_db
        if s.date <= cutoff
    )
    sale_taxes = 0.0

    if not grants and not prices:
        empty = {
            "current_price": 0, "total_shares": 0,
            "total_income": 0, "total_cap_gains": 0,
            "total_loan_principal": 0, "total_tax_paid": 0,
            "cash_received": 0, "next_event": None,
            "held_vested_shares": 0, "stock_valuation_price": None,
            "vested_stock_value": None,
            "purchased_unvested_stock_value": 0,
            "total_stock_value": None, "outstanding_loan_balance": 0,
            "accrued_unbooked_interest": 0,
            "net_equity": None,
        }
        # An empty account must not hand back a different shape from a full one,
        # or a caller reads `total_shares` here and `vested_shares` everywhere else.
        return _as_of_view(empty, as_of, []) if as_of is not None else empty

    timeline = get_timeline(user.id, grants, prices, loans, initial_price)

    # Add estimated tax from Sale events (FIFO, chronological order)
    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    proj_settings = _projection_settings(ts_row)
    tax_due = _tax_due_dates(db)
    projection = _project(grants, prices, loans_db, loan_payments_db, sales_db, proj_settings, tax_due)
    from app.loan_projection import outstanding_at_stop
    at_cutoff = outstanding_at_stop(_project(grants, prices, loans_db, loan_payments_db, sales_db,
                                             proj_settings, tax_due, stop=cutoff))
    # Interest accrued and capitalised but not yet on a statement — the same
    # projection the payoffs and the exit use, so the three cannot disagree.
    position["accrued_unbooked_interest"] = round(at_cutoff["projected_interest"] + at_cutoff["accrued"], 2)

    covered_loan_ids = {s.loan_id for s in sales_db if s.loan_id is not None}

    from app.routers.loans import _is_flexible_payoff_enabled
    flexible_payoff_enabled = _is_flexible_payoff_enabled(db)
    loan_grant_by_id = {ln.id: (ln.grant_year, ln.grant_type) for ln in loans_db}
    loan_payoff_method = ts_row.loan_payoff_method if ts_row else None
    lot_selection_method = ts_row.lot_selection_method if ts_row else None

    # Snapshot the sales due for tax before closing the DB session.
    sale_specs = []
    for s in sales_db:
        if s.date > cutoff:
            continue
        sale_specs.append({
            "id": s.id, "date": s.date, "shares": s.shares, "price_per_share": s.price_per_share,
            "loan_id": s.loan_id, "lot_overrides": s.lot_overrides,
            "rates": ({
                    "federal_income_rate": s.federal_income_rate if s.federal_income_rate is not None else ts_row.federal_income_rate,
                    "federal_lt_cg_rate": s.federal_lt_cg_rate if s.federal_lt_cg_rate is not None else ts_row.federal_lt_cg_rate,
                    "federal_st_cg_rate": s.federal_st_cg_rate if s.federal_st_cg_rate is not None else ts_row.federal_st_cg_rate,
                    "niit_rate": s.niit_rate if s.niit_rate is not None else ts_row.niit_rate,
                    "state_income_rate": s.state_income_rate if s.state_income_rate is not None else ts_row.state_income_rate,
                    "state_lt_cg_rate": s.state_lt_cg_rate if s.state_lt_cg_rate is not None else ts_row.state_lt_cg_rate,
                    "state_st_cg_rate": s.state_st_cg_rate if s.state_st_cg_rate is not None else ts_row.state_st_cg_rate,
                    "lt_holding_days": s.lt_holding_days if s.lt_holding_days is not None else ts_row.lt_holding_days,
                } if ts_row else {
                    "federal_income_rate": 0, "federal_lt_cg_rate": 0,
                    "federal_st_cg_rate": 0, "niit_rate": 0,
                    "state_income_rate": 0, "state_lt_cg_rate": 0,
                    "state_st_cg_rate": 0, "lt_holding_days": 365,
                }),
        })

    # All DB reads are done — release the connection before CPU-heavy computation.
    db.close()

    holdings_timeline = timeline
    if sale_specs:
        from app.sale_tax import compute_all_sale_taxes
        results, holdings_timeline = compute_all_sale_taxes(
            timeline, sale_specs, loan_grant_by_id, loan_payoff_method,
            lot_selection_method, flexible_payoff_enabled,
        )
        for spec in sale_specs:
            tax = results[spec["id"]]["estimated_tax"]
            total_tax_paid += tax
            sale_taxes += tax

    from app.routers.sales import _remaining_holdings_from_timeline
    holdings = _remaining_holdings_from_timeline(holdings_timeline, cutoff)
    position["held_vested_shares"] = sum(h["vested_shares"] for h in holdings)

    # Loan payment by year: payoff_sale vs cash_in (skip refinanced loans — they show as $0 events)
    loan_payment_by_year: dict[str, dict] = {}
    for ln in live_loans:
        year = str(ln.due_date.year)
        early_paid = payments_by_loan.get(ln.id, 0.0)
        cash_due = max(0.0, ln.amount - early_paid)
        if year not in loan_payment_by_year:
            loan_payment_by_year[year] = {"year": year, "payoff_sale": 0.0, "cash_in": 0.0, "projected": 0.0}
        # Unbooked interest and projected tax loans due with it, kept apart so
        # the principal columns still reconcile to total_loan_principal.
        loan_payment_by_year[year]["projected"] += projection.extra_for(ln.id)
        if ln.id in covered_loan_ids:
            loan_payment_by_year[year]["payoff_sale"] += cash_due
        else:
            loan_payment_by_year[year]["cash_in"] += cash_due

    for po in projection.orphan_payoffs():
        year = str(po.date.year)
        row = loan_payment_by_year.setdefault(year, {"year": year, "payoff_sale": 0.0, "cash_in": 0.0, "projected": 0.0})
        row["projected"] += po.extra

    if as_of is None:
        last = timeline[-1] if timeline else {}
    else:
        # The same point the app's own card values use: the newest event that
        # has actually happened by this date.
        last = {}
        for e in timeline:
            if _to_date(e["date"]) <= as_of:
                last = e
            else:
                break

    next_event = None
    for e in timeline:
        edate = _to_date(e["date"])
        if edate >= today:
            next_event = {"date": edate.isoformat(), "event_type": e["event_type"]}
            break

    # Investment interest deduction: interest actually paid by the cutoff,
    # against gains actually realized by then (the sales above).
    interest_deduction_total = 0.0
    tax_savings_from_deduction = 0.0
    if ts_row and ts_row.deduct_investment_interest and sale_specs:
        paid: dict[int, float] = {}
        for po in projection.payoffs:
            if po.date <= cutoff:
                paid[po.date.year] = paid.get(po.date.year, 0.0) + po.interest_paid
        realized = sorted(
            ({"date": spec["date"], "event_type": "Sale",
              "st_gain": results[spec["id"]]["st_gain"], "lt_gain": results[spec["id"]]["lt_gain"]}
             for spec in sale_specs), key=lambda e: e["date"])
        _apply_interest_deduction(realized, paid, excluded_years=set(ts_row.deduction_excluded_years or []))
        interest_deduction_total, tax_savings_from_deduction = _deduction_totals(realized, _ts_dict(ts_row))

    # Whether the price these figures rest on is one the user projected rather
    # than a real valuation. The app shows this as a banner; anything reading
    # the endpoint needs it just as much, and more so, because it cannot see one.
    price_is_estimate = False
    for p in prices:
        pdate = _to_date(p["date"])
        if pdate <= cutoff:
            price_is_estimate = pdate in estimated_price_dates
        else:
            break

    from services.price_state import price_metadata
    applicable_price = (db.query(Price).filter(Price.user_id == user.id, Price.effective_date <= cutoff)
                        .order_by(Price.effective_date.desc()).first())
    metadata = price_metadata(applicable_price, cutoff) if applicable_price else {}
    price_is_estimate = metadata.get("price_is_estimate", False)
    payload = {
        **metadata,
        "as_of": as_of.isoformat() if as_of else None,
        "price_is_estimate": price_is_estimate,
        "current_price": last.get("share_price", initial_price),
        "total_shares": last.get("cum_shares", 0),
        "total_income": last.get("cum_income", 0),
        "total_cap_gains": round(last.get("cum_cap_gains", 0), 2),
        "total_loan_principal": round(sum(ln.amount for ln in live_loans), 2),
        "total_tax_paid": round(total_tax_paid - tax_savings_from_deduction, 2),
        "cash_received": round(cash_received_gross - sale_taxes, 2),
        "interest_deduction_total": round(interest_deduction_total, 2),
        "tax_savings_from_deduction": round(tax_savings_from_deduction, 2),
        "loan_payment_by_year": sorted(loan_payment_by_year.values(), key=lambda x: x["year"]),
        "next_event": next_event,
    }

    if position is not None:
        valuation_price = position["valuation_price"]
        vested_value = (round(position["held_vested_shares"] * valuation_price, 2)
                        if valuation_price is not None else None)
        stock_value = (round(vested_value + position["purchased_unvested_value"], 2)
                       if vested_value is not None else None)
        payload.update({
            "held_vested_shares": position["held_vested_shares"],
            "stock_valuation_price": valuation_price,
            "vested_stock_value": vested_value,
            "purchased_unvested_stock_value": position["purchased_unvested_value"],
            "total_stock_value": stock_value,
            "outstanding_loan_balance": position["outstanding_loan_balance"],
            "accrued_unbooked_interest": position["accrued_unbooked_interest"],
            "net_equity": (round(
                stock_value - position["outstanding_loan_balance"]
                - position["accrued_unbooked_interest"], 2
            )
                           if stock_value is not None else None),
        })

    return _as_of_view(payload, as_of, timeline) if as_of is not None else payload
