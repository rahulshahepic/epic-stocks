"""Internal test users (#827): the operator's own actor for prod validation.

A separate kind from directory reviewers — own tables, own sign-in page,
own admin list — so internal validation never borrows a reviewer's
identity. These tests pin the separation, the restrictions, the lifecycle
(expiry, rotation, revocation, deletion) and the actor workflow the
mechanism exists for: export → delete → re-login fails.
"""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from scaffold import reviewers, test_users
from scaffold.models import InternalTestAccount, ReviewerAccount, User, Grant
from scaffold.oauth.admin_actions import Actor
from scaffold.routers.test_users import manage
from scaffold.synthetic_accounts import prune_test_accounts
from tests.conftest import register_user
from tests.test_oauth_server import connect


def provision(db, label='Audit validation', scenario='established'):
    raw, digest = test_users.credentials()
    result = test_users.grant_access(db, {'label': label, 'scenario': scenario, 'days': 30, 'credential_hash': digest})
    db.commit()
    return result, raw


def sign_in(client, account, password):
    page = client.get('/test-user-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    response = client.post('/test-user-login', data={'login': account['login'], 'password': password, 'csrf': csrf}, follow_redirects=False)
    assert response.status_code == 303, response.text
    assert response.headers['cache-control'] == 'no-store'


def rpc(client, token, name, arguments=None):
    return client.post('/mcp', headers={'Authorization': 'Bearer ' + token}, json={
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments or {}}})


def test_provision_sign_in_and_fixture(client, db_session):
    info, raw = provision(db_session)
    assert info['label'] == 'Audit validation'
    assert info['notice'].startswith('INTERNAL TEST')
    sign_in(client, info, raw)
    assert client.get('/api/grants').status_code == 200
    assert client.get('/api/grants').json(), 'the established fixture seeds grants'
    me = client.get('/api/me').json()
    assert me['test_user_account']['label'] == 'Audit validation'
    assert me['is_admin'] is False
    row = db_session.get(InternalTestAccount, info['id'])
    user = db_session.get(User, row.user_id)
    assert user.is_synthetic and user.provider_name == 'internal-test'
    assert user.email.endswith('@test-users.example.invalid')
    assert db_session.query(Grant).filter_by(user_id=user.id).count() > 0


def test_actor_workflow_export_delete_relogin_fails(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    export = client.get('/api/export/excel')
    assert export.status_code == 200, export.text
    assert export.content[:2] == b'PK'  # a real workbook, the user's own export

    assert client.delete('/api/me').status_code == 204
    assert client.get('/api/grants').status_code == 401
    row_id = info['id']
    assert db_session.get(InternalTestAccount, row_id) is None
    assert db_session.query(User).filter_by(email=info['login'] + '@test-users.example.invalid').count() == 0

    page = client.get('/test-user-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    response = client.post('/test-user-login', data={'login': info['login'], 'password': raw, 'csrf': csrf}, follow_redirects=False)
    assert response.status_code == 401


def test_test_user_never_admin_and_cannot_reach_other_people(client, db_session, monkeypatch):
    register_user(client, 'ordinary@example.invalid')
    client.post('/api/prices', json={'effective_date': '2026-01-01', 'price': 777})
    info, raw = provision(db_session, scenario='empty')
    sign_in(client, info, raw)
    row = db_session.get(InternalTestAccount, info['id'])
    test_account = db_session.get(User, row.user_id)
    monkeypatch.setenv('ADMIN_EMAIL', test_account.email)
    assert client.get('/api/admin/stats').status_code == 403
    assert client.get('/api/prices').json() == []
    for path in ('/api/sharing', '/api/push', '/api/notifications', '/api/admin/test-users', '/api/admin/reviewers', '/api/onboarding', '/api/trial'):
        assert client.get(path).status_code == 403, path
    test_account.is_admin = 1
    db_session.commit()
    assert client.get('/api/grants').status_code == 401


def test_separate_from_reviewers_in_storage_signin_and_admin_lists(client, db_session, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    tinfo, traw = provision(db_session)
    rraw, rdigest = reviewers.credentials()
    rinfo = reviewers.grant_access(db_session, {'platform': 'openai', 'scenario': 'established', 'days': 30, 'credential_hash': rdigest})
    db_session.commit()

    # Each sign-in page refuses the other kind's credentials.
    page = client.get('/reviewer-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    assert client.post('/reviewer-login', data={'login': tinfo['login'], 'password': traw, 'csrf': csrf}).status_code == 401
    page = client.get('/test-user-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    assert client.post('/test-user-login', data={'login': rinfo['login'], 'password': rraw, 'csrf': csrf}).status_code == 401

    # Each admin list names only its own kind.
    test_logins = {r['login'] for r in client.get('/api/admin/test-users').json()}
    reviewer_logins = {r['login'] for r in client.get('/api/admin/reviewers').json()}
    assert tinfo['login'] in test_logins and rinfo['login'] not in test_logins
    assert rinfo['login'] in reviewer_logins and tinfo['login'] not in reviewer_logins

    # The nightly synthetic prune must not mistake either for an orphan.
    assert prune_test_accounts(db_session) == 0
    assert db_session.get(InternalTestAccount, tinfo['id']) is not None
    assert db_session.get(ReviewerAccount, rinfo['id']) is not None


def test_oauth_authorize_and_revoke_against_own_account(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client, scope='equity:read equity:write')
    context = rpc(client, tokens['access_token'], 'get_account_context').json()['result']
    assert not context.get('isError'), context
    actor = Actor('browser', 'admin@example.invalid')
    preview = manage(db_session, info['id'], 'revoke', None, actor)
    manage(db_session, info['id'], 'revoke', preview['confirm'], actor)
    assert rpc(client, tokens['access_token'], 'get_dashboard').status_code == 401
    assert client.get('/api/grants').status_code == 401


def test_rotation_and_expiry(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    tokens = connect(client)
    raw2, digest = test_users.credentials()
    test_users.grant_access(db_session, {'test_user_id': info['id'], 'label': 'Audit validation', 'scenario': 'established', 'days': 60, 'credential_hash': digest})
    db_session.commit()
    assert rpc(client, tokens['access_token'], 'get_dashboard').status_code == 401
    with pytest.raises(Exception):
        test_users.authenticate(db_session, info['login'], raw)
    assert test_users.authenticate(db_session, info['login'], raw2)
    row = db_session.get(InternalTestAccount, info['id'])
    row.expires_at = test_users.now() - timedelta(seconds=1)
    db_session.commit()
    sign_in_attempt = client.get('/test-user-login')
    csrf = sign_in_attempt.text.split('name="csrf" value="')[1].split('"')[0]
    assert client.post('/test-user-login', data={'login': info['login'], 'password': raw2, 'csrf': csrf}).status_code == 401


def test_reset_reseeds_and_delete_removes_everything(client, db_session):
    info, raw = provision(db_session)
    sign_in(client, info, raw)
    client.post('/api/prices', json={'effective_date': '2043-01-01', 'price': 1000})
    actor = Actor('browser', 'admin@example.invalid')
    preview = manage(db_session, info['id'], 'reset', None, actor)
    manage(db_session, info['id'], 'reset', preview['confirm'], actor)
    assert not any(p['effective_date'] == '2043-01-01' for p in client.get('/api/prices').json())
    with pytest.raises(ValueError):
        manage(db_session, info['id'], 'reset', preview['confirm'], actor)

    preview = manage(db_session, info['id'], 'delete', None, actor)
    manage(db_session, info['id'], 'delete', preview['confirm'], actor)
    assert db_session.get(InternalTestAccount, info['id']) is None
    assert db_session.query(User).filter_by(email=info['login'] + '@test-users.example.invalid').count() == 0


def test_browser_provisioning_journals_and_shows_password_once(client, db_session, monkeypatch):
    from scaffold.oauth.models import AdminActionJournal
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    response = client.post('/api/admin/test-users/access', json={'label': 'Release check', 'scenario': 'empty', 'days': 7})
    assert response.status_code == 200, response.text
    result = response.json()
    row = db_session.get(InternalTestAccount, result['id'])
    assert row.credential_hash != result['password']
    assert len(result['password']) >= 64
    assert result['password'] not in client.get('/api/admin/test-users').text
    journal = db_session.query(AdminActionJournal).filter_by(action='test_user_access').all()
    assert len(journal) == 1 and journal[0].outcome == 'ok'
    assert result['password'] not in (journal[0].before or '') + (journal[0].after or '')


def test_label_is_required_and_bounded(client, db_session, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    assert client.post('/api/admin/test-users/access', json={'label': '', 'scenario': 'empty'}).status_code == 400
    assert client.post('/api/admin/test-users/access', json={'label': 'x' * 81, 'scenario': 'empty'}).status_code in (400, 422)
    with pytest.raises(ValueError):
        test_users.grant_access(db_session, {'scenario': 'empty', 'days': 30, 'credential_hash': 'a' * 64})


def test_login_counters_are_bounded_and_hold_no_supplied_text(client, db_session):
    from scaffold.models import InternalTestLoginAudit
    info, raw = provision(db_session, scenario='empty')
    page = client.get('/test-user-login')
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    for index in range(20):
        response = client.post('/test-user-login', data={'login': f'unknown-{index}', 'password': 'wrong', 'csrf': csrf})
        assert response.status_code == 401
    rows = db_session.query(InternalTestLoginAudit).all()
    assert {r.outcome: r.count for r in rows} == {'attempt': 20, 'failure': 20}
    assert all(r.user_id is None for r in rows)
    assert set(InternalTestLoginAudit.__table__.columns.keys()) == {'bucket', 'user_id', 'outcome', 'count', 'last_at'}


def test_admin_user_lists_and_metrics_exclude_test_users(client, db_session, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAIL', 'owner@example.invalid')
    register_user(client, 'owner@example.invalid')
    provision(db_session)
    users = client.get('/api/admin/users').json()['users']
    assert all(not u['email'].endswith('@test-users.example.invalid') for u in users)
    stats = client.get('/api/admin/stats').json()
    assert stats['total_users'] == 1


def test_nightly_cleanup_prunes_old_test_user_auth_buckets(db_session):
    from scaffold.models import InternalTestLoginAudit
    from scaffold.oauth.cleanup import prune
    db_session.add(InternalTestLoginAudit(bucket='unknown:2000-01-01:failure', outcome='failure', count=1,
                                          last_at=test_users.now() - timedelta(days=91)))
    db_session.commit()
    assert prune(db_session)['test_user_auth_buckets'] == 1
    assert db_session.query(InternalTestLoginAudit).count() == 0


def test_test_user_change_set_on_own_data(client, db_session):
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
    from scaffold.synthetic_accounts import synthetic_key
    user_id = db_session.get(InternalTestAccount, info['id']).user_id
    with synthetic_key(db_session, user_id):
        grants = db_session.scalars(select(Grant).where(Grant.user_id == user_id)).all()
    assert grants, 'writes landed on the test user alone'
