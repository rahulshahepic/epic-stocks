"""Dedicated password login and administrator-only internal test-user management (#827)."""
from contextlib import nullcontext
from html import escape
import hmac
import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from scaffold import test_users
from scaffold.auth import cookie_secure, create_token, get_admin_user, set_session_cookies
from scaffold.client_ip import client_ip
from scaffold.models import InternalTestAccount, User
from scaffold.oauth import admin_actions
from scaffold.rate_limit import check_rate_ip_shared, check_rate_shared

router = APIRouter(tags=['Internal test users'])
# Same-origin Referrer-Policy, as on the reviewer sign-in: under no-referrer
# a browser sends `Origin: null` on this page's own POST, which the
# cross-origin write check (#821) cannot validate.
NO_STORE = {'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin'}


def safe_next(value):
    return value if value and value.startswith('/oauth/authorize') and not any(c in value for c in ('\\', '\r', '\n')) else '/'


def page(title, body):
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><link rel="stylesheet" href="/oauth/consent.css"><link rel="stylesheet" href="/reviewer-login.css"></head><body><main class="card"><h1>' + escape(title) + '</h1>' + body + '</main></body></html>'


@router.get('/test-user-login', response_class=HTMLResponse)
def login_page(next: str = '/'):
    csrf = secrets.token_urlsafe(32)
    response = HTMLResponse(page('Internal test user sign-in',
        '<p>INTERNAL TEST ONLY. This sign-in opens a fictional account used by the operator to validate the service. It cannot access an ordinary Epic Stocks account. Use the login and password supplied by the administrator.</p>'
        '<form method="post"><label>Test user login<input name="login" autocomplete="username" required maxlength="80"></label>'
        '<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>'
        f'<input type="hidden" name="next" value="{escape(safe_next(next), quote=True)}">'
        f'<input type="hidden" name="csrf" value="{csrf}"><button type="submit">Sign in to fictional account</button></form>'), headers=NO_STORE)
    response.set_cookie('test_user_csrf', csrf, secure=cookie_secure(), httponly=True, samesite='strict', max_age=900, path='/test-user-login')
    return response


@router.post('/test-user-login')
def login(request: Request, login: str = Form(..., max_length=80), password: str = Form(..., max_length=128),
          csrf: str = Form(..., max_length=128), next: str = Form('/'), db: Session = Depends(get_db)):
    check_rate_ip_shared(client_ip(request), 'test_user_login', 120, 900)
    if not csrf.isascii() or not request.cookies.get('test_user_csrf', '').isascii() or not hmac.compare_digest(csrf, request.cookies.get('test_user_csrf', '')) or not csrf:
        raise HTTPException(403, 'Reload the test user sign-in page')
    # Credential stuffing is also bounded per login across source networks.
    check_rate_shared(test_users.verifier(login), 'test_user_login_identity', 10, 900)
    from scaffold.synthetic_accounts import account_lock
    row = db.query(InternalTestAccount).filter_by(login=login).first()
    guard = account_lock(db, row.user_id) if row else nullcontext()
    with guard:
        row = db.query(InternalTestAccount).filter_by(login=login).populate_existing().first()
        user_id = row.user_id if row else None
        test_users.audit_login(db, user_id, 'attempt')
        try:
            user = test_users.authenticate(db, login, password)
        except HTTPException:
            test_users.audit_login(db, user_id, 'failure')
            raise
        test_users.audit_login(db, user.id, 'success')
        response = RedirectResponse(safe_next(next), status_code=303, headers=NO_STORE)
        set_session_cookies(response, create_token(user.id, user.session_version))
        response.delete_cookie('test_user_csrf', path='/test-user-login')
        return response


class Access(BaseModel):
    label: str = Field(max_length=test_users.MAX_LABEL_LEN)
    scenario: str = Field(default='established', max_length=20)
    days: int = Field(default=30, ge=1, le=90)
    test_user_id: int | None = Field(default=None, ge=1)


@router.get('/api/admin/test-users')
def list_test_users(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    return [test_users.state(r) for r in db.query(InternalTestAccount).order_by(InternalTestAccount.id).all()]


@router.post('/api/admin/test-users/access')
def access(body: Access, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    raw, digest = test_users.credentials()
    args = {**body.model_dump(), 'credential_hash': digest}
    actor = admin_actions.Actor(via='browser', email=admin.email)
    def change():
        result = test_users.grant_access(db, args)
        db.commit()
        return result, result
    try:
        result = admin_actions._run(db, actor, 'test_user_access', 'test_user', body.test_user_id, None, change)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    from fastapi.responses import JSONResponse
    return JSONResponse({**result, 'password': raw, 'notice': 'Copy now to a secure store. Not retrievable later; rotate if lost.'}, headers=NO_STORE)


class Manage(BaseModel):
    action: str = Field(pattern='^(reset|revoke|delete)$')
    confirm: str | None = Field(default=None, max_length=64)


def manage(db, test_user_id, action, confirm, actor):
    from scaffold.synthetic_accounts import account_lock, synthetic_key
    from scaffold.user_deletion import delete_financial_data, delete_user
    from scaffold.models import TaxSettings
    from services.reviewer_fixtures import seed, version
    from uuid import uuid4
    row = db.get(InternalTestAccount, test_user_id)
    if not row:
        raise ValueError('Test user not found')
    with account_lock(db, row.user_id):
        db.refresh(row)
        before = test_users.state(row)
        token = test_users.verifier(f'{action}:{row.id}:{row.generation}:{row.credential_hash}:{row.expires_at}:{row.revoked_at}')
        if confirm is None:
            return {'applied': False, 'test_user': before, 'confirm': token, 'warning': f'{action} affects only this fictional test account. Ask for explicit confirmation.'}
        if not isinstance(confirm, str) or not confirm.isascii() or not hmac.compare_digest(confirm, token):
            raise ValueError('Stale confirmation; preview again')
        user = db.get(User, row.user_id)
        if not test_users.identity(user):
            raise ValueError('Test user identity boundary failed')
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
                row.revoked_at = test_users.now()
                test_users.invalidate(db, user)
            elif action == 'delete':
                delete_user(db, user.id)
            else:
                raise ValueError('Unknown action')
            db.commit()
            result = {'applied': True, 'id': test_user_id, 'action': action}
            return result, result
        return admin_actions._run(db, actor, 'test_user_' + action, 'test_user', row.id, before, change)


@router.post('/api/admin/test-users/{test_user_id}/manage')
def manage_http(test_user_id: int, body: Manage, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    try:
        return manage(db, test_user_id, body.action, body.confirm, admin_actions.Actor(via='browser', email=admin.email))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
