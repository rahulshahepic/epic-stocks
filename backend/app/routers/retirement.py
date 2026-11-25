"""Retirement Simulator: persisted simulation params + dashboard prefs.

The simulator runs entirely client-side, but we save the owner's last input
set so it loads pre-populated next visit, and so shared viewers see the
owner's saved scenario as the default.
"""
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.expense_funding import (
    FUNDING_PLANS, expense_for_funding, funding_options, keep_funding_plan,
    list_funding_plans, retirement_params_without_funding, sync_funding_plans,
)
from database import get_db
from scaffold.models import User
from scaffold.auth import get_current_user

retirement_router = APIRouter(prefix="/api/retirement", tags=["retirement"])
dashboard_prefs_router = APIRouter(prefix="/api/dashboard-prefs", tags=["dashboard-prefs"])


class _Params(BaseModel):
    # Loose dict so we don't have to migrate every time we add a slider.
    # The frontend owns the schema; backend just stores/retrieves the blob.
    params: dict[str, Any]
    preserve_planned_expenses: bool = False


@retirement_router.get("/params")
def get_my_retirement_params(user: User = Depends(get_current_user)):
    params = user.retirement_params
    return {
        "params": retirement_params_without_funding(params),
        "funding_plans": list_funding_plans(params or {}),
    }


@retirement_router.put("/params")
def save_my_retirement_params(
    body: _Params,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not isinstance(body.params, dict):
        raise HTTPException(status_code=422, detail="params must be an object")
    from app.retirement_simulation import MILLIONS, THOUSANDS, validate_changes
    db.refresh(user, with_for_update=True)
    previous = user.retirement_params or {}
    # A legacy value can be carried forward while unrelated inputs are saved.
    # New and changed amounts must satisfy the current limits.
    money = {
        key: value
        for key, value in body.params.items()
        if key in MILLIONS | THOUSANDS
        and (
            key not in previous
            or value != previous[key]
            or isinstance(value, bool) != isinstance(previous[key], bool)
        )
    }
    if money:
        try:
            validate_changes(money)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if 'plannedEvents' in body.params:
        from app.retirement_simulation import validate_planned_events
        try:
            validate_planned_events(body.params['plannedEvents'])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    params = dict(body.params)
    if body.preserve_planned_expenses:
        params.pop("plannedEvents", None)
        if "plannedEvents" in previous:
            params["plannedEvents"] = previous["plannedEvents"]
    sync_funding_plans(params, previous)
    user.retirement_params = params
    db.commit()
    return get_my_retirement_params(user)


class _PlannedExpenses(BaseModel):
    plannedEvents: list[dict[str, Any]]


@retirement_router.patch("/params")
def save_my_planned_expenses(
    body: _PlannedExpenses,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.retirement_simulation import validate_planned_events
    try:
        validate_planned_events(body.plannedEvents)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(user, with_for_update=True)
    previous = user.retirement_params or {}
    params = {**previous, "plannedEvents": body.plannedEvents}
    sync_funding_plans(params, previous)
    user.retirement_params = params
    db.commit()
    return get_my_retirement_params(user)


@retirement_router.get("/expense-funding")
def get_expense_funding_plans(user: User = Depends(get_current_user)):
    return list_funding_plans(user.retirement_params or {})


@retirement_router.get("/expense-funding/{expense_id:path}")
def preview_expense_funding(
    expense_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    params = user.retirement_params or {}
    return funding_options(user, db, params, expense_for_funding(params, expense_id))


class _ConfirmFunding(BaseModel):
    method: Literal["savings", "epic"]
    confirmation: str = Field(min_length=64, max_length=64)


@retirement_router.post("/expense-funding/{expense_id:path}")
def confirm_expense_funding(
    expense_id: str,
    body: _ConfirmFunding,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.refresh(user, with_for_update=True)
    params = dict(user.retirement_params or {})
    expense = expense_for_funding(params, expense_id)
    options = funding_options(user, db, params, expense)
    if options["confirmation"] != body.confirmation or (body.method == "epic" and options["sale"] is None):
        raise HTTPException(409, "Funding options changed. Review the updated estimate before saving.")
    plan = keep_funding_plan(params, expense, options, body.method)
    user.retirement_params = params
    db.commit()
    return plan


@retirement_router.delete("/expense-funding/{expense_id:path}", status_code=204)
def clear_expense_funding(
    expense_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.refresh(user, with_for_update=True)
    previous = user.retirement_params or {}
    if expense_id in previous.get(FUNDING_PLANS, {}):
        params = dict(previous)
        params[FUNDING_PLANS] = {key: value for key, value in previous[FUNDING_PLANS].items() if key != expense_id}
        user.retirement_params = params
        db.commit()


class _CompEntries(BaseModel):
    # List of salary-change or bonus events. Frontend owns the schema.
    entries: list[Any]


# A working life's worth of raises and bonuses. The list is a column on the
# users table rather than rows of its own, so it needs a ceiling here — the
# same one the MCP write tool enforces on the other way in.
MAX_COMP_ENTRIES = 400


@retirement_router.get("/comp-entries")
def get_comp_entries(user: User = Depends(get_current_user)):
    return {"entries": user.comp_entries or []}


@retirement_router.put("/comp-entries")
def save_comp_entries(
    body: _CompEntries,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not isinstance(body.entries, list):
        raise HTTPException(status_code=422, detail="entries must be an array")
    if len(body.entries) > MAX_COMP_ENTRIES:
        raise HTTPException(
            status_code=422,
            detail=f"at most {MAX_COMP_ENTRIES} compensation entries",
        )
    user.comp_entries = body.entries
    db.commit()
    return {"entries": body.entries}


class _Prefs(BaseModel):
    prefs: dict[str, Any]


@dashboard_prefs_router.get("")
def get_my_dashboard_prefs(user: User = Depends(get_current_user)):
    return {"prefs": user.dashboard_prefs or {}}


@dashboard_prefs_router.put("")
def save_my_dashboard_prefs(
    body: _Prefs,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not isinstance(body.prefs, dict):
        raise HTTPException(status_code=422, detail="prefs must be an object")
    user.dashboard_prefs = body.prefs
    db.commit()
    return {"prefs": body.prefs}
