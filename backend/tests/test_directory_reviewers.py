"""Production-shaped reviewer OAuth, persistence and identity isolation."""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from scaffold import reviewers
from scaffold.models import ReviewerAccount, User, Grant
from scaffold.oauth.admin_actions import Actor
from scaffold.routers.reviewers import manage
from scaffold.synthetic_accounts import prune_test_accounts
from tests.conftest import register_user, user_key
from tests.test_oauth_server import connect


def provision(db, platform='openai', scenario='established'):
    raw, digest = reviewers.credentials()
    result = reviewers.grant_access(db, {'platform': platform, 'scenario': scenario, 'days': 30, 'credential_hash': digest})
    db.commit()
    return result, raw


def sign_in(client, account, password):
    page = client.get('/reviewer-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    response = client.post('/reviewer-login', data={'login': account['login'], 'password': password, 'csrf': csrf}, follow_redirects=False)
    assert response.status_code == 303, response.text
    assert response.headers['cache-control'] == 'no-store'


def rpc(client, token, name, arguments=None):
    response = client.post('/mcp', headers={'Authorization': 'Bearer ' + token}, json={
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments or {}}})
    return response


def test_production_oauth_persistent_writes_and_platform_isolation(client, db_session, monkeypatch):
    a, password = provision(db_session)
    b, _ = provision(db_session, 'anthropic')
    sign_in(client, a, password)
    monkeypatch.setenv('APP_ENV', 'production')
    user = db_session.get(User, db_session.get(ReviewerAccount, a['id']).user_id)
    assert user.is_synthetic and not user.is_admin
    tokens = connect(client, scope='equity:read equity:write comp:read comp:write')
    context = rpc(client, tokens['access_token'], 'get_account_context').json()['result']
    assert json.loads(context['content'][0]['text'])['synthetic'] is True
    assert client.get('/api/grants').status_code == 200
    response = client.post('/api/prices', json={'effective_date': '2043-01-01', 'price': 1000, 'is_estimate': True})
    assert response.status_code == 201, response.text
    assert any(p['effective_date'] == '2043-01-01' for p in client.get('/api/prices').json())
    assert not rpc(client, tokens['access_token'], 'list_prices', {'include_projections': True}).json()['result'].get('isError')
    assert rpc(client, tokens['access_token'], 'get_dashboard', {'account': str(b['id'])}).json()['result']['isError']
    client.cookies.clear()
    assert client.get('/api/grants', headers={'Authorization': 'Bearer ' + tokens['access_token']}).status_code == 401
    assert rpc(client, tokens['access_token'], 'get_dashboard').status_code == 200


def test_rotation_expiration_revocation_invalidate_oauth(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client)
    old_session = client.cookies.get('session')
    raw2, digest = reviewers.credentials()
    reviewers.grant_access(db_session, {'reviewer_id': info['id'], 'platform': 'openai', 'scenario': 'established', 'days': 60, 'credential_hash': digest})
    db_session.commit()
    assert rpc(client, tokens['access_token'], 'get_dashboard').status_code == 401
    assert client.get('/api/grants').status_code == 401
    with pytest.raises(Exception):
        reviewers.authenticate(db_session, info['login'], raw)
    assert reviewers.authenticate(db_session, info['login'], raw2)
    sign_in(client, info, raw2)
    newer = connect(client)
    row = db_session.get(ReviewerAccount, info['id'])
    row.expires_at = reviewers.now() - timedelta(seconds=1)
    db_session.commit()
    assert client.get('/api/grants').status_code == 401
    assert rpc(client, newer['access_token'], 'get_dashboard').status_code == 401
    row.expires_at = reviewers.now() + timedelta(days=1)
    db_session.commit()
    preview = manage(db_session, info['id'], 'revoke', None, Actor('browser', 'admin@example.invalid'))
    manage(db_session, info['id'], 'revoke', preview['confirm'], Actor('browser', 'admin@example.invalid'))
    assert rpc(client, newer['access_token'], 'get_dashboard').status_code == 401
    assert client.get('/api/me', cookies={'session': old_session}).status_code == 401


def test_reset_deliberate_and_cleanup_does_not_erase_reviewers(client, db_session):
    first, raw = provision(db_session)
    second, _ = provision(db_session, 'anthropic')
    first_row = db_session.get(ReviewerAccount, first['id'])
    second_row = db_session.get(ReviewerAccount, second['id'])
    assert first_row.user_id != second_row.user_id
    a = set(db_session.scalars(select(Grant.id).where(Grant.user_id == first_row.user_id)))
    b = set(db_session.scalars(select(Grant.id).where(Grant.user_id == second_row.user_id)))
    assert a and b and a.isdisjoint(b)
    assert prune_test_accounts(db_session) == 0
    actor = Actor('browser', 'admin@example.invalid')
    preview = manage(db_session, first['id'], 'reset', None, actor)
    assert first_row.generation == first['generation']
    with pytest.raises(ValueError):
        manage(db_session, second['id'], 'reset', preview['confirm'], actor)
    sign_in(client, first, raw)
    client.post('/api/prices', json={'effective_date': '2043-01-01', 'price': 1000})
    manage(db_session, first['id'], 'reset', preview['confirm'], actor)
    assert not any(p['effective_date'] == '2043-01-01' for p in client.get('/api/prices').json())
    assert second_row.generation == second['generation']
    with pytest.raises(ValueError):
        manage(db_session, first['id'], 'reset', preview['confirm'], actor)


def test_reviewers_never_admin_or_real_accounts(client, db_session, monkeypatch):
    register_user(client, 'ordinary@example.invalid')
    ordinary = db_session.query(User).filter_by(email='ordinary@example.invalid').one()
    client.post('/api/prices', json={'effective_date': '2026-01-01', 'price': 777})
    info, raw = provision(db_session, scenario='empty')
    sign_in(client, info, raw)
    row = db_session.get(ReviewerAccount, info['id'])
    reviewer = db_session.get(User, row.user_id)
    monkeypatch.setenv('ADMIN_EMAIL', reviewer.email)
    assert client.get('/api/admin/stats').status_code == 403
    assert client.get('/api/prices').json() == []
    for path in ('/api/sharing', '/api/push', '/api/notifications', '/api/admin/reviewers'):
        assert client.get(path).status_code == 403, path
    assert client.patch('/api/me', json={'is_admin': True}).status_code == 403
    assert client.post('/reviewer-login', data={'login': info['login'], 'password': raw, 'csrf': 'wrong'}).status_code == 403
    assert reviewers.account(db_session, ordinary) is None
    reviewer.is_admin = 1
    db_session.commit()
    assert client.get('/api/grants').status_code == 401


def test_management_browser_secrets_not_stored_and_delete(client, db_session, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    response = client.post('/api/admin/reviewers/access', json={'platform': 'anthropic'})
    assert response.status_code == 200, response.text
    result = response.json()
    row = db_session.get(ReviewerAccount, result['id'])
    assert row.credential_hash != result['password']
    assert len(result['password']) >= 64
    assert result['password'] not in client.get('/api/admin/reviewers').text
    actor = Actor('browser', 'owner@example.invalid')
    preview = manage(db_session, row.id, 'delete', None, actor)
    manage(db_session, row.id, 'delete', preview['confirm'], actor)
    assert db_session.get(ReviewerAccount, result['id']) is None


def test_synthetic_fixture_key_independence(db_session, client):
    a, _ = provision(db_session)
    b, _ = provision(db_session, 'anthropic')
    ua = db_session.get(User, db_session.get(ReviewerAccount, a['id']).user_id)
    ub = db_session.get(User, db_session.get(ReviewerAccount, b['id']).user_id)
    assert ua.encrypted_key != ub.encrypted_key
    with user_key(ua):
        assert db_session.query(Grant).filter_by(user_id=ua.id).first().shares > 0


def test_admin_mcp_widening_requires_human_approval(client, db_session, monkeypatch):
    from scaffold.oauth import admin_requests
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    _, digest = reviewers.credentials()
    row, _ = admin_requests.file_request(db_session, admin_requests.REVIEWER_ACCESS,
        {'platform': 'openai', 'credential_hash': digest}, reason='Directory review',
        actor_email='owner@example.invalid', grant_id=None, client_name='Admin assistant')
    assert db_session.query(ReviewerAccount).count() == 0
    result = admin_requests.decide(db_session, row.id, approve=True, admin_email='owner@example.invalid')
    assert result.status == 'approved', result.outcome
    assert db_session.query(ReviewerAccount).count() == 1


def test_login_rejects_ordinary_identity(client, db_session):
    register_user(client)
    ordinary = db_session.query(User).first()
    assert not reviewers.active(db_session, ordinary)
    assert reviewers.allowed_identity(db_session, ordinary)
    with pytest.raises(Exception):
        reviewers.authenticate(db_session, ordinary.email, 'fictional-wrong-password')


def test_reviewer_change_set_confirmation_and_reset_generation(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client, scope='equity:read equity:write')
    changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2043-01-01', 'price': 1000}}]
    result = rpc(client, tokens['access_token'], 'apply_changes', {'changes': changes}).json()['result']
    assert not result.get('isError'), result
    preview = json.loads(result['content'][0]['text'])
    result = rpc(client, tokens['access_token'], 'apply_changes', {'changes': changes, 'confirm': preview['confirm']}).json()['result']
    assert not result.get('isError'), result
    assert any(r['effective_date'] == '2043-01-01' for r in client.get('/api/prices').json())


def test_distinct_reviewers_concurrent_guards_and_reset_refusal(db_session):
    from scaffold.synthetic_accounts import account_lock, SyntheticAccountBusy
    a, _ = provision(db_session)
    b, _ = provision(db_session, 'anthropic')
    uid_a = db_session.get(ReviewerAccount, a['id']).user_id
    uid_b = db_session.get(ReviewerAccount, b['id']).user_id
    actor = Actor('browser', 'owner@example.invalid')
    with account_lock(db_session, uid_a):
        with account_lock(db_session, uid_b):
            pass
        with pytest.raises(SyntheticAccountBusy):
            manage(db_session, a['id'], 'reset', None, actor)


def test_login_rate_limits_without_test_bypass(client, db_session, monkeypatch):
    info, raw = provision(db_session, scenario='empty')
    monkeypatch.delenv('E2E_TEST')
    for _ in range(10):
        page = client.get('/reviewer-login')
        csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
        response = client.post('/reviewer-login', data={'login': info['login'], 'password': 'wrong', 'csrf': csrf})
        assert response.status_code == 401
    response = client.post('/reviewer-login', data={'login': info['login'], 'password': raw, 'csrf': csrf})
    assert response.status_code == 429
    assert response.headers.get('retry-after')


def test_expired_cookie_can_reauthenticate_and_use_public_docs(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    row = db_session.get(ReviewerAccount, info['id'])
    row.expires_at = reviewers.now() - timedelta(seconds=1)
    db_session.commit()
    assert client.get('/api/grants').status_code == 401
    assert client.get('/reviewer-login').status_code == 200
    assert client.get('/mcp-setup').status_code == 200
    assert client.get('/llms.txt').status_code == 200
    assert client.post('/api/auth/logout').status_code == 200


def test_reviewer_refresh_disabled_provider_revokes_without_nested_lock(client, db_session, monkeypatch):
    from scaffold.oauth.models import OAuthGrant
    from scaffold.oauth import router as oauth_router
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client)
    monkeypatch.setattr(oauth_router, '_provider_still_allowed', lambda uri: False)
    response = client.post('/oauth/token', data={'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']})
    assert response.status_code == 400, response.text
    assert response.json()['error'] == 'invalid_grant'
    assert db_session.query(OAuthGrant).count() == 0


def test_authenticated_call_rechecks_revoked_grant_under_lock(client, db_session):
    from scaffold.oauth.models import OAuthGrant
    from scaffold.oauth.resource import Connector
    from scaffold.synthetic_accounts import tool_account
    from app.mcp.tools import ToolContext
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    connect(client)
    grant = db_session.query(OAuthGrant).one()
    user = db_session.get(User, grant.user_id)
    ctx = ToolContext(Connector(user, grant, grant.scope.split()), db_session)
    db_session.delete(grant)
    db_session.commit()
    with pytest.raises(ValueError, match='revoked or rotated'):
        with tool_account(ctx, 'get_dashboard', read_only=True):
            pytest.fail('Stale authenticated call executed')


def test_unicode_login_csrf_and_reset_confirmation_are_input_errors(client, db_session):
    info, raw = provision(db_session)
    assert client.post('/reviewer-login', data={'login': info['login'], 'password': raw, 'csrf': 'é'}).status_code == 403
    with pytest.raises(ValueError, match='Stale confirmation'):
        manage(db_session, info['id'], 'reset', 'é', Actor('browser', 'owner@example.invalid'))


def test_reviewer_cannot_receive_content_admin_or_use_oidc_namespace(client, db_session):
    from scaffold.oauth import admin_requests
    from scaffold.routers.auth_router import _upsert_user
    from types import SimpleNamespace
    info, _ = provision(db_session)
    row = db_session.get(ReviewerAccount, info['id'])
    user = db_session.get(User, row.user_id)
    with pytest.raises(ValueError, match='administrative privileges'):
        admin_requests.file_request(db_session, admin_requests.GRANT_CONTENT_ADMIN,
            {'account_email': user.email}, reason=None, client_name='test', grant_id=None,
            actor_email='owner@example.invalid')
    with pytest.raises(Exception, match='external sign-in provider'):
        _upsert_user(SimpleNamespace(provider_name=reviewers.PROVIDER), db_session)


def test_unknown_login_flood_cannot_evict_management_journal(client, db_session):
    from scaffold.oauth import admin_journal
    from scaffold.oauth.models import AdminActionJournal
    from scaffold.models import ReviewerLoginAudit
    entry = admin_journal.begin(db_session, via='browser', action='important_management_action', actor_email='owner@example.invalid')
    page = client.get('/reviewer-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    for index in range(50):
        response = client.post('/reviewer-login', data={'login': f'unknown-{index}', 'password': 'wrong', 'csrf': csrf})
        assert response.status_code == 401
    assert db_session.get(AdminActionJournal, entry) is not None
    assert db_session.query(AdminActionJournal).count() == 1
    rows = db_session.query(ReviewerLoginAudit).all()
    assert len(rows) == 2
    assert {r.outcome: r.count for r in rows} == {'attempt': 50, 'failure': 50}
    assert all(r.user_id is None for r in rows)


def test_reviewer_auth_counters_are_bounded_and_have_no_supplied_text(db_session):
    from scaffold.models import ReviewerLoginAudit
    from datetime import datetime, timezone
    row = ReviewerLoginAudit(bucket='unknown:2000-01-01:failure', outcome='failure', count=1,
                             last_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
    db_session.add(row)
    db_session.commit()
    reviewers.audit_login(db_session, None, 'attempt')
    assert db_session.query(ReviewerLoginAudit).count() == 1
    assert set(ReviewerLoginAudit.__table__.columns.keys()) == {'bucket', 'user_id', 'outcome', 'count', 'last_at'}


def test_reviewer_can_report_privately_and_sign_out_everywhere(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client)
    report = client.post('/api/report', json={'message': 'Fictional reviewer test problem', 'include_details': False})
    assert report.status_code == 200, report.text
    from scaffold.models import UserReport
    assert db_session.get(UserReport, report.json()['id']).user_id is None
    assert client.post('/api/auth/logout-everywhere').status_code == 200
    assert rpc(client, tokens['access_token'], 'get_dashboard').status_code == 401


def test_nightly_cleanup_expires_auth_buckets_without_further_logins(db_session):
    from scaffold.models import ReviewerLoginAudit
    from scaffold.oauth.cleanup import prune
    db_session.add(ReviewerLoginAudit(bucket='unknown:2000-01-01:failure', outcome='failure', count=1,
                                     last_at=reviewers.now() - timedelta(days=91)))
    db_session.commit()
    assert prune(db_session)['reviewer_auth_buckets'] == 1
    assert db_session.query(ReviewerLoginAudit).count() == 0


def test_login_deleted_between_lookup_and_lock_returns_auth_failure(client, db_session, monkeypatch):
    from contextlib import contextmanager
    from scaffold import synthetic_accounts
    from scaffold.user_deletion import delete_user
    info, raw = provision(db_session)
    uid = db_session.get(ReviewerAccount, info['id']).user_id
    original = synthetic_accounts.account_lock
    deleted = False
    @contextmanager
    def delete_before_lock(db, user_id, **kwargs):
        nonlocal deleted
        if user_id == uid and not deleted:
            deleted = True
            delete_user(db_session, uid)
            db_session.commit()
        with original(db, user_id, **kwargs):
            yield
    monkeypatch.setattr(synthetic_accounts, 'account_lock', delete_before_lock)
    page = client.get('/reviewer-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    response = client.post('/reviewer-login', data={'login': info['login'], 'password': raw, 'csrf': csrf})
    assert response.status_code == 401, response.text


def test_reviewer_explicit_support_consent_is_scoped_encrypted_and_erased(client, db_session):
    from tests.test_sensitive_reports import _submit, _path
    from scaffold.models import SensitiveReport
    from scaffold.user_deletion import delete_user
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    response = _submit(client)
    assert response.status_code == 200, response.text
    report_id = response.json()['id']
    uid = db_session.get(ReviewerAccount, info['id']).user_id
    material = db_session.get(SensitiveReport, report_id)
    assert material.user_id == uid
    assert client.get(_path(report_id)).status_code == 403
    assert client.get('/api/admin/reviewers').status_code == 403
    delete_user(db_session, uid)
    db_session.commit()
    assert db_session.get(SensitiveReport, report_id) is None


def test_report_session_auth_rejects_expired_reviewer(client, db_session):
    from scaffold.auth import get_session_user
    from starlette.requests import Request
    from scaffold.auth import create_token
    info, _ = provision(db_session)
    row = db_session.get(ReviewerAccount, info['id'])
    user = db_session.get(User, row.user_id)
    token = create_token(user.id, user.session_version)
    row.expires_at = reviewers.now() - timedelta(seconds=1)
    db_session.commit()
    request = Request({'type': 'http', 'path': '/api/report/with-consent', 'method': 'POST',
                       'headers': [(b'cookie', ('session=' + token).encode())]})
    with pytest.raises(Exception, match='User not found'):
        get_session_user(request, db_session)


def test_expired_reviewer_mcp_preserves_oauth_discovery_challenge(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client)
    row = db_session.get(ReviewerAccount, info['id'])
    row.expires_at = reviewers.now() - timedelta(seconds=1)
    db_session.commit()
    response = rpc(client, tokens['access_token'], 'get_dashboard')
    assert response.status_code == 401
    assert 'resource_metadata=' in response.headers['www-authenticate']
