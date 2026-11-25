"""Optional measurement protocol. Tokens stay in POST bodies, never URLs."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from database import get_db
from scaffold import onboarding as measure
from scaffold.auth import get_current_user
from scaffold.client_ip import client_ip
from scaffold.models import User
from scaffold.rate_limit import check_rate_ip_shared

router = APIRouter(prefix='/api/onboarding', tags=['onboarding'])


class Start(BaseModel):
    model_config = ConfigDict(extra='forbid')
    opt_in: bool = False
    entrypoint: Literal['trial', 'account']
    nonce: str = Field(pattern=r'^[0-9a-f]{48}$')


class Event(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str = Field(max_length=48)
    sequence: int = Field(default=1, ge=1, le=500)
    opt_in: bool = False
    event: Literal['preview_viewed', 'save_intent', 'reminder_enabled', 'carryover_failed'] = 'preview_viewed'


def _allowed(request, body, db):
    check_rate_ip_shared(client_ip(request), 'onboarding_event', max_calls=1200, window_secs=300)
    if not body.opt_in or request.headers.get('dnt') == '1':
        if hasattr(body, 'token'):
            measure.safely(db, lambda: measure.forget(db, body.token))
        return False
    return True


@router.post('/start')
def start(body: Start, request: Request, db: Session = Depends(get_db)):
    if body.entrypoint != 'trial':
        raise HTTPException(422, 'Use the authenticated account-start endpoint')
    if not _allowed(request, body, db):
        return {'token': None}
    token = measure.safely(db, lambda: measure.start(db, body.entrypoint, body.nonce))
    return {'token': token, 'ttl_seconds': 86400}


@router.post('/event')
def event(body: Event, request: Request, db: Session = Depends(get_db)):
    if body.event not in ('preview_viewed', 'save_intent') or not _allowed(request, body, db):
        return {'recorded': False}
    return {'recorded': bool(measure.safely(db, lambda: measure.client_event(db, body.token, body.sequence, body.event)))}


@router.post('/claim')
def claim(body: Event, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {'recorded': bool(_allowed(request, body, db) and measure.safely(db, lambda: measure.claim(db, body.token, user)))}


@router.post('/account-event')
def account_event(body: Event, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.event not in ('reminder_enabled', 'carryover_failed') or not _allowed(request, body, db):
        return {'recorded': False}
    return {'recorded': bool(measure.safely(db, lambda: measure.client_event(db, body.token, body.sequence, body.event, user)))}


@router.post('/forget')
def forget(body: Event, request: Request, db: Session = Depends(get_db)):
    check_rate_ip_shared(client_ip(request), 'onboarding_event', max_calls=1200, window_secs=300)
    measure.safely(db, lambda: measure.forget(db, body.token))
    return {'forgotten': True}


@router.post('/start-account')
def start_account(body: Start, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.entrypoint != 'account':
        raise HTTPException(422, 'Use the trial-start endpoint')
    if not _allowed(request, body, db):
        return {'token': None}
    token = measure.safely(db, lambda: measure.start(db, 'account', body.nonce))
    return {'token': token, 'ttl_seconds': 86400}
