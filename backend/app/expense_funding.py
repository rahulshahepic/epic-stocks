"""Dated funding estimates for the first bill of a planned expense."""
import hashlib
import json
import math
from datetime import date

from fastapi import HTTPException

from app.routers.sales import (
    _check_cash_out_allowed,
    _remaining_holdings_from_timeline,
    estimate_sale_from_timeline,
    sale_projection,
)
from app.routers.loans import _get_lot_selection_method, _get_tax_settings_dict
from scaffold.models import Price, Sale


FUNDING_PLANS = "expenseFundingPlans"


def retirement_params_without_funding(params):
    return None if params is None else {key: value for key, value in params.items() if key != FUNDING_PLANS}


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _month(when):
    return when.year * 12 + when.month


def _retirement_date(params):
    try:
        return date.fromisoformat(params.get("retirementDate", ""))
    except (TypeError, ValueError):
        return None


def _signature(expense, params):
    retirement = _retirement_date(params)
    retirement_basis = retirement.isoformat()[:7] if retirement and not expense.get("priceBasisDate") else None
    return _fingerprint([expense, retirement_basis])


def _eligible(expense, params):
    retirement = _retirement_date(params)
    return (
        expense.get("funding", "mixed") in ("mixed", "epic") and not expense.get("condition")
        and (retirement is None or expense["date"][:7] < retirement.isoformat()[:7])
    )


def sync_funding_plans(params, previous):
    """Keep confirmed plans attached only to the expense the user reviewed."""
    params.pop(FUNDING_PLANS, None)
    stored = previous.get(FUNDING_PLANS)
    if not isinstance(stored, dict) or not stored:
        return
    retained = {}
    for expense in params.get("plannedEvents", []):
        plan = stored.get(expense["id"])
        if isinstance(plan, dict) and _eligible(expense, params) and plan.get("signature") == _signature(expense, params):
            retained[expense["id"]] = plan
    if retained:
        params[FUNDING_PLANS] = retained


def list_funding_plans(params):
    clean = dict(params)
    sync_funding_plans(clean, params)
    return {key: value["plan"] for key, value in clean.get(FUNDING_PLANS, {}).items()}


def expense_for_funding(params, expense_id):
    expense = next((event for event in params.get("plannedEvents", []) if event["id"] == expense_id), None)
    if expense is None:
        raise HTTPException(404, "Planned expense not found.")
    if not _eligible(expense, params) or date.fromisoformat(expense["date"]) <= date.today():
        raise HTTPException(422, "Funding options are for upcoming expenses with funding set to Decide later or Epic stock.")
    return expense


def _cash_sale(user, db, when, target, other_plans):
    price = db.query(Price).filter(
        Price.user_id == user.id, Price.effective_date <= when,
    ).order_by(Price.effective_date.desc()).first()
    if price is None or price.price <= 0:
        return None, "Add a share price to estimate an Epic sale."
    try:
        _check_cash_out_allowed(user, when, db)
    except HTTPException as exc:
        if exc.status_code != 422:
            raise
        return None, "Loans due by this date need a repayment plan before you can plan a cash-out sale."

    tentative = [plan["sale"] for plan in other_plans if plan["sale"]]
    sale_dates = {when}
    sale_dates.update(d for (d,) in db.query(Sale.date).filter(Sale.user_id == user.id, Sale.date > when))
    sale_dates.update(date.fromisoformat(sale["date"]) for sale in tentative if sale["date"] > when.isoformat())
    last_sale_date = max(sale_dates)
    baseline, timeline = sale_projection(user, db, last_sale_date, tentative_sales=tentative)
    # A later vest can fund a later sale. Check room left after each commitment
    # on its own date, including saved loan-payoff sales.
    remaining_shares = {
        cutoff: sum(row["vested_shares"] for row in _remaining_holdings_from_timeline(timeline, cutoff))
        for cutoff in sale_dates
    }
    available = min(10_000_000, min(remaining_shares.values()))
    if available <= 0:
        return None, "There are no projected vested shares available for this expense after other sale plans."

    settings = {**_get_tax_settings_dict(user, db), "lot_selection_method": _get_lot_selection_method(user, db)}
    estimate = estimate_sale_from_timeline(timeline, when, settings, price_per_share=price.price, target_net_cash=target)
    if estimate["shares_needed"] > available:
        estimate = estimate_sale_from_timeline(timeline, when, settings, price_per_share=price.price, shares=available)
    if estimate["net_proceeds"] <= 0:
        return None, "The projected sale does not provide cash after estimated tax."
    sale = {
        "date": when.isoformat(),
        "shares": estimate["shares_needed"],
        "price_per_share": price.price,
        "price_date": price.effective_date.isoformat(),
        "price_is_estimate": price.is_estimate,
        "gross_proceeds": estimate["gross_proceeds"],
        "estimated_tax": estimate["estimated_tax"],
        "net_proceeds": estimate["net_proceeds"],
    }
    if last_sale_date > when:
        # A later sale can depend on specific lots even if the aggregate share
        # count fits. Check the lot allocator with this particular sale added.
        projected, projected_timeline = sale_projection(user, db, last_sale_date, tentative_sales=[*tentative, sale])
        loan_or_sale_shortfall = any(
            result["unvested_shares"] < projected[key]["unvested_shares"] for key, result in baseline.items()
        )
        # Explicit lot overrides can still report a vested sale after their lot
        # has been used. Fewer shares disappearing means two sales used that lot.
        overlaps_manual_lots = any(
            sum(row["vested_shares"] for row in _remaining_holdings_from_timeline(projected_timeline, cutoff))
            > remaining - sale["shares"]
            for cutoff, remaining in remaining_shares.items() if cutoff > when
        )
        if loan_or_sale_shortfall or overlaps_manual_lots:
            return None, "This sale would use shares needed by another planned sale."
    return sale, None


def funding_options(user, db, params, expense):
    today = date.today()
    when = date.fromisoformat(expense["date"])
    basis = date.fromisoformat(expense["priceBasisDate"]) if expense.get("priceBasisDate") else _retirement_date(params) or today
    price_factor = math.pow(1 + expense.get("inflationRate", 0.025), (_month(when) - _month(basis)) / 12)
    price = expense["amountM"] * price_factor * 1_000_000
    loan_months = 12 * expense.get("loanYears", 0)
    financed = price * (1 - expense.get("downPaymentPct", 1)) if loan_months else 0
    upfront = price - financed - expense.get("saleOffsetM", 0) * price_factor * 1_000_000
    monthly = expense.get("annualCostM", 0) * price_factor * 1_000_000 / 12
    if financed:
        rate = expense.get("loanRate", 0) / 12
        monthly += financed * rate / -math.expm1(-loan_months * math.log1p(rate)) if rate else financed / loan_months
    first_bill = round(max(0, upfront if upfront > 0 else monthly + upfront), 2)
    if first_bill == 0 and monthly == 0:
        raise HTTPException(422, "There is no upcoming bill to fund after applying sale proceeds or trade-in value.")

    existing = list_funding_plans(params)
    other_plans = [
        plan for key, plan in existing.items()
        if key != expense["id"] and plan["due_date"] >= today.isoformat()
    ]
    sale, unavailable = (
        _cash_sale(user, db, when, first_bill, other_plans) if first_bill > 0
        else (None, "Trade-in or other proceeds cover the first bill.")
    )
    options = {
        "event_id": expense["id"],
        "title": expense["title"],
        "due_date": when.isoformat(),
        "initial_cash": first_bill,
        "first_month_only": upfront <= 0,
        "monthly_cost": round(monthly, 2),
        "months_to_save": max(0, _month(when) - _month(today) - (when.day < today.day)),
        "sale": sale,
        "sale_unavailable": unavailable,
    }
    return {**options, "confirmation": _fingerprint([_signature(expense, params), options])}


def keep_funding_plan(params, expense, options, method):
    plan = {key: value for key, value in options.items() if key not in {"confirmation", "sale_unavailable"}}
    plan["method"] = method
    if method == "savings":
        plan["sale"] = None
    stored = params.get(FUNDING_PLANS, {})
    params[FUNDING_PLANS] = {
        **stored, expense["id"]: {"signature": _signature(expense, params), "plan": plan},
    }
    return plan
