"""Retirement Simulator: persisted simulation params + dashboard prefs.

The simulator runs entirely client-side, but we save the owner's last input
set so it loads pre-populated next visit, and so shared viewers see the
owner's saved scenario as the default.
"""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User
from scaffold.auth import get_current_user

retirement_router = APIRouter(prefix="/api/retirement", tags=["retirement"])
dashboard_prefs_router = APIRouter(prefix="/api/dashboard-prefs", tags=["dashboard-prefs"])


class _Params(BaseModel):
    # Loose dict so we don't have to migrate every time we add a slider.
    # The frontend owns the schema; backend just stores/retrieves the blob.
    params: dict[str, Any]


@retirement_router.get("/params")
def get_my_retirement_params(user: User = Depends(get_current_user)):
    return {"params": user.retirement_params}


@retirement_router.put("/params")
def save_my_retirement_params(
    body: _Params,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not isinstance(body.params, dict):
        raise HTTPException(status_code=422, detail="params must be an object")
    user.retirement_params = body.params
    db.commit()
    return {"params": body.params}


class _CompEntries(BaseModel):
    # List of salary-change or bonus events. Frontend owns the schema.
    entries: list[Any]


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
