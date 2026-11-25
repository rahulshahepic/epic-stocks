"""Dedicated password login and administrator-only directory-reviewer management."""
from contextlib import nullcontext
from html import escape
import hmac
import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from scaffold import reviewers
from scaffold.auth import create_token, get_admin_user, set_session_cookies, cookie_secure
from scaffold.client_ip import client_ip
from scaffold.models import ReviewerAccount, User
from scaffold.oauth import admin_actions, admin_journal
from scaffold.rate_limit import check_rate_ip_shared, check_rate_shared

router = APIRouter(tags=['Directory reviewers'])
NO_STORE = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}


def safe_next(value):
    return value if value and value.startswith('/oauth/authorize') and not any(c in value for c in ('\\', '\r', '\n')) else '/'


def page(title, body):
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><link rel="stylesheet" href="/oauth/consent.css"><link rel="stylesheet" href="/reviewer-login.css"></head><body><main class="card"><h1>' + escape(title) + '</h1>' + body + '</main></body></html>'


@router.get('/reviewer-login.css')
def reviewer_styles():
    return Response('label{display:block;margin-top:1rem;font-weight:600}input{display:block;box-sizing:border-box;width:100%;min-height:44px;margin-top:.35rem;padding:.6rem;border:1px solid #8f8278;border-radius:.5rem;background:var(--surface);color:var(--text);font:inherit}button{min-height:44px;margin-top:1.25rem;background:#a30f28;color:white;font:inherit;font-weight:600}input:focus-visible,button:focus-visible{outline:3px solid #a30f28;outline-offset:3px}', media_type='text/css', headers={'Cache-Control': 'public, max-age=300'})


@router.get('/reviewer-login', response_class=HTMLResponse)
def login_page(next: str = '/'):
    csrf = secrets.token_urlsafe(32)
    response = HTMLResponse(page('Directory reviewer sign-in',
        '<p>FICTIONAL DATA ONLY. This sign-in cannot access an ordinary Epic Stocks account. Use the login and password supplied securely for your review.</p>'
        '<form method="post"><label>Reviewer login<input name="login" autocomplete="username" required maxlength="80"></label>'
        '<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>'
        f'<input type="hidden" name="next" value="{escape(safe_next(next), quote=True)}">'
        f'<input type="hidden" name="csrf" value="{csrf}"><button type="submit">Sign in to fictional account</button></form>'), headers=NO_STORE)
    response.set_cookie('reviewer_csrf', csrf, secure=cookie_secure(), httponly=True, samesite='strict', max_age=900, path='/reviewer-login')
    return response


@router.post('/reviewer-login')
def login(request: Request, login: str = Form(..., max_length=80), password: str = Form(..., max_length=128),
          csrf: str = Form(..., max_length=128), next: str = Form('/'), db: Session = Depends(get_db)):
    check_rate_ip_shared(client_ip(request), 'reviewer_login', 120, 900)
    if not csrf.isascii() or not request.cookies.get('reviewer_csrf', '').isascii() or not hmac.compare_digest(csrf, request.cookies.get('reviewer_csrf', '')) or not csrf:
        raise HTTPException(403, 'Reload the reviewer sign-in page')
    # Credential stuffing is also bounded per login across source networks.
    check_rate_shared(reviewers.verifier(login), 'reviewer_login_identity', 10, 900)
    from scaffold.synthetic_accounts import account_lock
    row = db.query(ReviewerAccount).filter_by(login=login).first()
    guard = account_lock(db, row.user_id) if row else nullcontext()
    with guard:
        journal = admin_journal.begin(db, via='reviewer', action='reviewer_login', actor_email=None)
        try:
            user = reviewers.authenticate(db, login, password)
        except HTTPException:
            admin_journal.finish(db, journal, outcome=admin_journal.FAILED, detail='Invalid or expired credentials')
            raise
        admin_journal.finish(db, journal, outcome=admin_journal.OK, target_id=user.id)
        response = RedirectResponse(safe_next(next), status_code=303, headers=NO_STORE)
        set_session_cookies(response, create_token(user.id, user.session_version))
        response.delete_cookie('reviewer_csrf', path='/reviewer-login')
        return response


class Access(BaseModel):
    platform: str = Field(max_length=12)
    scenario: str = Field(default='established', max_length=20)
    days: int = Field(default=30, ge=1, le=90)
    reviewer_id: int | None = Field(default=None, ge=1)


@router.get('/api/admin/reviewers')
def list_reviewers(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    return [reviewers.state(r) for r in db.query(ReviewerAccount).order_by(ReviewerAccount.id).all()]


@router.post('/api/admin/reviewers/access')
def access(body: Access, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    raw, digest = reviewers.credentials()
    args = {**body.model_dump(), 'credential_hash': digest}
    actor = admin_actions.Actor(via='browser', email=admin.email)
    def change():
        result = reviewers.grant_access(db, args)
        db.commit()
        return result, result
    try:
        result = admin_actions._run(db, actor, 'reviewer_access', 'reviewer', body.reviewer_id, None, change)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    from fastapi.responses import JSONResponse
    return JSONResponse({**result, 'password': raw, 'notice': 'Copy now to a secure store. Not retrievable later; rotate if lost.'}, headers=NO_STORE)


class Manage(BaseModel):
    action: str = Field(pattern='^(reset|revoke|delete)$')
    confirm: str | None = Field(default=None, max_length=64)


def manage(db, reviewer_id, action, confirm, actor):
    from scaffold.synthetic_accounts import account_lock, synthetic_key
    from scaffold.user_deletion import delete_financial_data, delete_user
    from scaffold.models import TaxSettings
    from services.reviewer_fixtures import seed, version
    from uuid import uuid4
    row = db.get(ReviewerAccount, reviewer_id)
    if not row:
        raise ValueError('Reviewer not found')
    with account_lock(db, row.user_id):
        db.refresh(row)
        before = reviewers.state(row)
        token = reviewers.verifier(f'{action}:{row.id}:{row.generation}:{row.credential_hash}:{row.expires_at}:{row.revoked_at}')
        if confirm is None:
            return {'applied': False, 'reviewer': before, 'confirm': token, 'warning': f'{action} affects only this fictional reviewer account. Ask for explicit confirmation.'}
        if not isinstance(confirm, str) or not confirm.isascii() or not hmac.compare_digest(confirm, token):
            raise ValueError('Stale confirmation; preview again')
        user = db.get(User, row.user_id)
        if not reviewers.identity(user):
            raise ValueError('Reviewer identity boundary failed')
        def change():
            if action == 'reset':
                with synthetic_key(db, user.id):
                    delete_financial_data(db, user.id)
                    db.query(TaxSettings).filter_by(user_id=user.id).delete(synchronize_session=False)
                    db.expire_all()
                    user.date_of_birth = None
                    user.comp_entries = None
                    user.retirement_params = None
                    user.dashboard_prefs = None
                    if row.scenario != 'empty':
                        seed(db, user, row.scenario)
                row.generation = uuid4().hex
                row.fixture_version = version
            elif action == 'revoke':
                row.revoked_at = reviewers.now()
                reviewers.invalidate(db, user)
            elif action == 'delete':
                delete_user(db, user.id)
            else:
                raise ValueError('Unknown action')
            db.commit()
            result = {'applied': True, 'id': reviewer_id, 'action': action}
            return result, result
        return admin_actions._run(db, actor, 'reviewer_' + action, 'reviewer', row.id, before, change)


@router.post('/api/admin/reviewers/{reviewer_id}/manage')
def manage_http(reviewer_id: int, body: Manage, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    try:
        return manage(db, reviewer_id, body.action, body.confirm, admin_actions.Actor(via='browser', email=admin.email))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
