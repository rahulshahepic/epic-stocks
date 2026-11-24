"""Anonymous demo using request-local inputs and the account calculation services."""
from datetime import date
from typing import Literal
import threading

from fastapi import APIRouter, Depends, HTTPException, Request
from database import get_db
from scaffold.auth import get_current_user
from pydantic import BaseModel, ConfigDict, Field

from app.demo import AS_OF, PROFILES, VERSION, profile_inputs
from app.routers.events import _get_dashboard_data, _get_events_data, _preview_exit_data, _ts_dict
from app.routers.sales import estimate_sale_from_timeline
from scaffold.client_ip import client_ip
from scaffold.rate_limit import check_rate_ip_shared

router = APIRouter(prefix='/api/demo', tags=['demo'])
SLOTS = threading.BoundedSemaphore(2)


class DemoRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile: Literal['early', 'established', 'exit'] = 'established'
    as_of: date = AS_OF
    sale_shares: int | None = Field(default=None, ge=1, le=10_000)


@router.post('/preview')
def preview(body: DemoRequest, request: Request):
    if not AS_OF <= body.as_of <= date(2042, 12, 31):
        raise HTTPException(422, 'Choose a demo date between 2026-11-24 and 2042-12-31')
    check_rate_ip_shared(client_ip(request), 'demo-preview', 300, 300)
    if not SLOTS.acquire(blocking=False):
        raise HTTPException(503, 'Demo calculations are busy; please retry shortly', headers={'Retry-After': '2'})
    try:
        inputs = profile_inputs(body.profile)
        dashboard = _get_dashboard_data(None, None, as_of=body.as_of, include_details=True, inputs=inputs)
        exit_preview = _preview_exit_data(None, None, body.as_of.isoformat(), inputs=inputs)
        sale = None
        if body.sale_shares is not None:
            available = dashboard['held_vested_shares']
            if body.sale_shares > available:
                raise HTTPException(422, f'This fictional profile has {available} vested shares on that date')
            sale = estimate_sale_from_timeline(
                inputs.timeline(), body.as_of, {**_ts_dict(inputs.tax), 'lot_selection_method': inputs.tax.lot_selection_method},
                price_per_share=dashboard['stock_valuation_price'], shares=body.sale_shares,
            )
        return {'fictional': True, 'version': VERSION, 'profile': body.profile,
                'profiles': PROFILES, 'as_of': body.as_of, 'dashboard': dashboard,
                'events': _get_events_data(None, None, inputs=inputs), 'exit': exit_preview, 'sale': sale,
                'assumptions': 'Invented prices and grants; older purchases assumed paid in cash. Default Wisconsin tax assumptions. Future prices are estimates. Not representative of Epic compensation.'}
    finally:
        SLOTS.release()


class SeedRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile: Literal['early', 'established', 'exit']
    confirm: str | None = Field(default=None, max_length=128)
    reset: bool = False


@router.post('/seed')
def seed(body: SeedRequest, user=Depends(get_current_user), db=Depends(get_db)):
    from app.staging_demo import seed_profile
    return seed_profile(user, db, body.profile, confirm=body.confirm, reset=body.reset)
