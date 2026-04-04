from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Grant, Loan, Price, LoanPayment, Sale, TaxSettings, HorizonSettings, TipAcceptance
from scaffold.auth import get_current_user
from app.core import generate_all_events, compute_timeline
from app.routers.events import (
    _user_source_data, _enrich_timeline, _annotate_sale_taxes,
    _apply_interest_deduction, _last_vesting_date,
)

router = APIRouter(prefix="/api/tips", tags=["tips"])

_THRESHOLD_EXIT = 1000.0
_THRESHOLD_DEDUCTION = 500.0
_THRESHOLD_METHOD = 1000.0


def _compute_scenario(
    grants, prices, loans, loans_db, initial_price,
    loan_payments, sales,
    ts_dict: dict,
    lot_order: str,
    horizon_date,
    deduct_interest: bool,
) -> tuple[float, float]:
    """Return (total_tax, net_cash) for Sale/Liquidation events in the scenario."""
    timeline = compute_timeline(generate_all_events(grants, prices, loans), initial_price)
    enriched = _enrich_timeline(timeline, loans_db, loan_payments, sales, horizon_date=horizon_date)
    _annotate_sale_taxes(enriched, timeline, ts_dict, lot_order=lot_order)
    if deduct_interest:
        _apply_interest_deduction(enriched, loans_db)
    sale_events = [
        e for e in enriched
        if e.get("event_type") in ("Sale", "Liquidation (projected)")
    ]
    total_tax = sum(e.get("estimated_tax") or 0.0 for e in sale_events)
    # _apply_interest_deduction annotates events but doesn't update estimated_tax.
    # Compute the tax savings from the deduction fields and subtract here.
    deduction_savings = 0.0
    if deduct_interest:
        stcg_rate = ts_dict["federal_st_cg_rate"] + ts_dict["niit_rate"] + ts_dict["state_st_cg_rate"]
        ltcg_rate = ts_dict["federal_lt_cg_rate"] + ts_dict["niit_rate"] + ts_dict["state_lt_cg_rate"]
        deduction_savings = sum(
            e.get("interest_deduction_on_stcg", 0.0) * stcg_rate +
            e.get("interest_deduction_on_ltcg", 0.0) * ltcg_rate
            for e in enriched
        )
        total_tax -= deduction_savings
    net_cash = sum(
        (e.get("gross_proceeds") or 0.0) - (e.get("estimated_tax") or 0.0)
        for e in sale_events
    ) + deduction_savings
    return total_tax, net_cash


def _compute_scenario_tax(
    grants, prices, loans, loans_db, initial_price,
    loan_payments, sales,
    ts_dict: dict,
    lot_order: str,
    horizon_date,
    deduct_interest: bool,
) -> float:
    tax, _ = _compute_scenario(
        grants, prices, loans, loans_db, initial_price,
        loan_payments, sales, ts_dict, lot_order, horizon_date, deduct_interest,
    )
    return tax


@router.get("")
def get_tips(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants, prices, loans, loans_db, initial_price, _ = _user_source_data(user, db)
    if not grants:
        return []

    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    if not ts_row:
        return []

    hs_row = db.query(HorizonSettings).filter(HorizonSettings.user_id == user.id).first()
    loan_payments = db.query(LoanPayment).filter(LoanPayment.user_id == user.id).order_by(LoanPayment.date).all()
    sales = db.query(Sale).filter(Sale.user_id == user.id).all()
    db.close()

    ts_dict = {
        "federal_income_rate": ts_row.federal_income_rate,
        "federal_lt_cg_rate": ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": ts_row.federal_st_cg_rate,
        "niit_rate": ts_row.niit_rate,
        "state_income_rate": ts_row.state_income_rate,
        "state_lt_cg_rate": ts_row.state_lt_cg_rate,
        "state_st_cg_rate": ts_row.state_st_cg_rate,
        "lt_holding_days": ts_row.lt_holding_days,
    }

    current_lot = ts_row.lot_selection_method or 'epic_lifo'
    if current_lot not in ('fifo', 'lifo', 'epic_lifo'):
        current_lot = 'epic_lifo'
    current_deduct = bool(ts_row.deduct_investment_interest)

    # Determine current horizon_date (same logic as events endpoint)
    base_timeline = compute_timeline(generate_all_events(grants, prices, loans), initial_price)
    current_horizon = (hs_row.horizon_date if hs_row and hs_row.horizon_date else None) \
        or _last_vesting_date(base_timeline)

    if current_horizon is None:
        return []

    baseline_tax, baseline_net_cash = _compute_scenario(
        grants, prices, loans, loans_db, initial_price,
        loan_payments, sales,
        ts_dict, current_lot, current_horizon, current_deduct,
    )
    baseline = baseline_tax  # used by tips 2 & 3

    tips = []

    # --- Tip 1: Exit date extension ---
    # Fire when net cash (proceeds − taxes) improves, not just when taxes drop.
    # A higher exit price raises both proceeds and taxes; what matters is the net.
    for days in [30, 60, 90]:
        new_horizon = current_horizon + timedelta(days=days)
        _, new_net_cash = _compute_scenario(
            grants, prices, loans, loans_db, initial_price,
            loan_payments, sales,
            ts_dict, current_lot, new_horizon, current_deduct,
        )
        gain = round(new_net_cash - baseline_net_cash, 2)
        if gain >= _THRESHOLD_EXIT:
            tips.append({
                "type": "exit_date",
                "title": f"Push your exit date back {days} days",
                "description": (
                    f"Moving your projected exit date to {new_horizon.strftime('%b %d, %Y')} "
                    f"could put ~${gain:,.0f} more in your pocket after taxes."
                ),
                "savings": gain,
                "apply": {"horizon_date": new_horizon.isoformat()},
            })
            break  # smallest improvement that clears threshold

    # --- Tip 2: Investment interest deduction ---
    if not current_deduct:
        new_tax = _compute_scenario_tax(
            grants, prices, loans, loans_db, initial_price,
            loan_payments, sales,
            ts_dict, current_lot, current_horizon, True,
        )
        savings = round(baseline - new_tax, 2)
        if savings >= _THRESHOLD_DEDUCTION:
            tips.append({
                "type": "deduction",
                "title": "Enable the investment interest deduction",
                "description": (
                    f"Your loan interest may be deductible against capital gains (IRS Form 4952), "
                    f"potentially saving ~${savings:,.0f}. Note: this covers investment interest only — "
                    f"consider your full itemized deductions vs. the standard deduction."
                ),
                "savings": savings,
                "apply": {"deduct_investment_interest": True},
            })

    # --- Tip 3: Lot selection method ---
    best_savings = 0.0
    best_method = None
    for lot_method in ('fifo', 'lifo', 'epic_lifo'):
        if lot_method == current_lot:
            continue
        new_tax = _compute_scenario_tax(
            grants, prices, loans, loans_db, initial_price,
            loan_payments, sales,
            ts_dict, lot_method, current_horizon, current_deduct,
        )
        savings = round(baseline - new_tax, 2)
        if savings > best_savings:
            best_savings = savings
            best_method = lot_method

    if best_method and best_savings >= _THRESHOLD_METHOD:
        label = {'fifo': 'FIFO', 'lifo': 'LIFO', 'epic_lifo': 'LIFO (prefer long-term)'}.get(best_method, best_method.upper())
        current_label = {'fifo': 'FIFO', 'lifo': 'LIFO', 'epic_lifo': 'LIFO (prefer long-term)'}.get(current_lot, current_lot.upper())
        tips.append({
            "type": "method",
            "title": f"Switch lot selection to {label}",
            "description": (
                f"Using {label} instead of {current_label} for share lot selection "
                f"could save ~${best_savings:,.0f} in taxes. "
                f"(Manual lot selection was not analyzed.)"
            ),
            "savings": best_savings,
            "apply": {"lot_selection_method": best_method},
        })

    tips.sort(key=lambda t: t["savings"], reverse=True)
    return tips


class AcceptBody(BaseModel):
    tip_type: str
    savings_estimate: float


@router.post("/accept", status_code=204)
def accept_tip(
    body: AcceptBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record (or update) a tip acceptance. Upserts on (user_id, tip_type)."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    import database

    if database._is_sqlite:
        # SQLite: use merge / replace logic
        existing = db.query(TipAcceptance).filter(
            TipAcceptance.user_id == user.id,
            TipAcceptance.tip_type == body.tip_type,
        ).first()
        if existing:
            existing.savings_estimate = body.savings_estimate
            existing.accepted_at = datetime.now()
        else:
            db.add(TipAcceptance(
                user_id=user.id,
                tip_type=body.tip_type,
                savings_estimate=body.savings_estimate,
            ))
    else:
        stmt = pg_insert(TipAcceptance).values(
            user_id=user.id,
            tip_type=body.tip_type,
            savings_estimate=body.savings_estimate,
            accepted_at=datetime.now(),
        ).on_conflict_do_update(
            constraint='uq_tip_acceptance_user_type',
            set_=dict(
                savings_estimate=body.savings_estimate,
                accepted_at=datetime.now(),
            ),
        )
        db.execute(stmt)

    db.commit()
