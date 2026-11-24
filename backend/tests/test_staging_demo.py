"""The browser fixture never reads or overwrites its authenticated owner's finances."""
from unittest.mock import patch

import pytest
from sqlalchemy import text

from scaffold.models import ErrorLog, MCPTestAccount
from tests.conftest import register_user
from tests.test_mcp_tools import seed

STAGING = {'APP_ENV': 'staging', 'DOMAIN': 'staging.epic-stocks.com'}


def snapshot(db):
    return {table: db.execute(text(f'SELECT * FROM {table} WHERE {"id" if table == "users" else "user_id"}=1')).all()
            for table in ('users', 'grants', 'grant_vestings', 'prices', 'loans', 'sales')}


@pytest.fixture()
def browser(client, db_session, monkeypatch):
    register_user(client)
    seed(client)  # original financial records must survive even initial setup
    assert client.patch('/api/me/profile', json={'date_of_birth': '1980-01-01'}).status_code == 200
    assert client.put('/api/retirement/params', json={'params': {'defaultSpend': 123}}).status_code == 200
    before = snapshot(db_session)
    for key, value in STAGING.items():
        monkeypatch.setenv(key, value)
    yield client, db_session
    assert snapshot(db_session) == before


@pytest.mark.parametrize('profile,count', [('early', 6), ('established', 20), ('exit', 40)])
def test_open_isolated_browser_profile_and_preserve_on_retry(browser, profile, count):
    client, db = browser
    before = client.get('/api/me').json()
    assert before['date_of_birth'] is None
    assert before['staging_account']['initialized'] is False
    assert client.get('/api/grants').status_code == 409
    response = client.post('/api/demo/seed', json={'profile': profile})
    assert response.status_code == 200, response.text
    context = response.json()['account_context']
    assert context['synthetic'] and context['initialized'] and context['scenario'] == profile
    rows = client.get('/api/grants').json()
    assert len(rows) == count
    row = db.query(MCPTestAccount).filter_by(grant_id=None).one()
    assert row.synthetic_id != row.user_id
    params = client.get('/api/retirement/params').json()['params']
    assert params['defaultSpend'] != 123
    assert client.get('/api/me').json()['date_of_birth'] != '1980-01-01'
    for table, column in [('grants', 'shares'), ('loans', 'amount'), ('prices', 'price')]:
        values = db.execute(text(f'SELECT {column} FROM {table} WHERE user_id=:uid'), {'uid': row.synthetic_id}).scalars().all()
        assert values and all(v.startswith('$ENC$') for v in values)
    assert client.put('/api/retirement/params', json={'params': {'defaultSpend': 77}}).status_code == 200
    again = client.post('/api/demo/seed', json={'profile': profile})
    assert again.json()['account_context']['generation'] == context['generation']
    assert client.get('/api/retirement/params').json()['params']['defaultSpend'] == 77
    assert client.get('/api/grants').json() == rows


def test_reset_requires_confirmation_restores_fixture_and_rejects_stale_tokens(browser):
    client, _ = browser
    client.post('/api/demo/seed', json={'profile': 'established'})
    original = client.get('/api/prices').json()
    assert client.post('/api/prices', json={'effective_date': '2026-11-24', 'price': 400, 'is_estimate': True}).status_code == 201
    edited = client.get('/api/prices').json()
    assert len(edited) == len(original) + 1
    change = {'changes': [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-25', 'price': 500}}]}
    import_preview = client.post('/api/changes/preview', json=change).json()
    preview = client.post('/api/demo/seed', json={'profile': 'early'}).json()['detail']
    assert preview['code'] == 'reset_required'
    assert client.get('/api/prices').json() == edited
    restored = client.post('/api/demo/seed', json={'profile': 'early', 'confirm': preview['confirm']})
    assert restored.status_code == 200
    assert len(client.get('/api/grants').json()) == 6
    assert not any(p['effective_date'] == '2026-11-24' for p in client.get('/api/prices').json())
    stale = client.post('/api/demo/seed', json={'profile': 'early', 'reset': True, 'confirm': preview['confirm']})
    assert stale.status_code == 409
    assert stale.headers['X-Error-Ref']
    assert client.post('/api/changes/apply', json={**change, 'confirm': import_preview['confirm']}).status_code == 422


def test_same_profile_reset_restores_params_and_diagnostic_has_no_values(browser):
    client, db = browser
    client.post('/api/demo/seed', json={'profile': 'early'})
    client.put('/api/retirement/params', json={'params': {'defaultSpend': 98765}})
    preview = client.post('/api/demo/seed', json={'profile': 'early', 'reset': True}).json()['detail']
    assert client.get('/api/retirement/params').json()['params']['defaultSpend'] == 98765
    confirmed = client.post('/api/demo/seed', json={'profile': 'early', 'reset': True, 'confirm': preview['confirm']})
    assert confirmed.status_code == 200
    assert client.get('/api/retirement/params').json()['params']['defaultSpend'] == 40
    first = client.post('/api/demo/seed', json={'profile': 'early', 'reset': True, 'confirm': 'wrong'})
    again = client.post('/api/demo/seed', json={'profile': 'early', 'reset': True, 'confirm': 'wrong'})
    assert first.status_code == again.status_code == 409
    assert first.headers['X-Error-Ref'] == again.headers['X-Error-Ref']
    diagnostic = db.query(ErrorLog).one()
    assert diagnostic.error_message == 'invalid_confirmation'
    assert diagnostic.traceback is None


def test_failure_rolls_back_fixture_and_restores_principal_key(browser):
    client, db = browser
    with patch('app.mcp.test_account_tools._seed', side_effect=RuntimeError('fixture failed')):
        with pytest.raises(RuntimeError, match='fixture failed'):
            client.post('/api/demo/seed', json={'profile': 'early'})
    assert db.query(MCPTestAccount).count() == 0
    assert not client.get('/api/me').json()['staging_account']['initialized']
    assert client.get('/api/grants').status_code == 409


def test_browser_and_mcp_fixtures_remain_independent(browser):
    from tests.test_mcp_tools import Mcp
    client, db = browser
    client.post('/api/demo/seed', json={'profile': 'early'})
    mcp = Mcp(client)
    assert mcp.call('get_account_context')['initialized'] is False
    mcp.call('setup_test_account', scenario='exit')
    assert len(mcp.call('list_grants')['grants']) == 40
    assert len(client.get('/api/grants').json()) == 6
    assert db.query(MCPTestAccount).count() == 2
    reset = client.post('/api/demo/seed', json={'profile': 'established'}).json()['detail']['confirm']
    client.post('/api/demo/seed', json={'profile': 'established', 'confirm': reset})
    assert len(mcp.call('list_grants')['grants']) == 40


@pytest.mark.parametrize('env', [{}, {'APP_ENV': 'production', 'DOMAIN': 'epic-stocks.com'},
                                 {'APP_ENV': 'staging', 'DOMAIN': 'epic-stocks.com'},
                                 {'APP_ENV': 'staging', 'DOMAIN': 'evil.example'}])
def test_seed_unavailable_outside_official_staging(client, env):
    register_user(client)
    with patch.dict('os.environ', env, clear=True):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 404


def test_web_boundary_rejects_connector_and_synthetic_sessions(browser):
    from scaffold.auth import create_token
    from tests.test_mcp_tools import Mcp
    client, db = browser
    mcp = Mcp(client)
    client.post('/api/demo/seed', json={'profile': 'early'})
    synthetic_id = db.query(MCPTestAccount.synthetic_id).scalar()
    client.cookies.clear()
    assert client.get('/api/grants', headers=mcp.auth).status_code == 401
    assert client.post('/api/demo/seed', headers=mcp.auth, json={'profile': 'early'}).status_code == 401
    assert client.get('/api/grants', headers={'Authorization': 'Bearer ' + create_token(synthetic_id)}).status_code == 401


def test_fixture_is_not_used_outside_staging(browser, monkeypatch):
    client, _ = browser
    client.post('/api/demo/seed', json={'profile': 'exit'})
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DOMAIN', 'epic-stocks.com')
    # The real account remains the normal production routing target.
    assert len(client.get('/api/grants').json()) == 2
    assert client.get('/api/me').json()['date_of_birth'] == '1980-01-01'


def test_public_bootstrap_is_available_without_a_workspace(client, monkeypatch):
    for key, value in STAGING.items():
        monkeypatch.setenv(key, value)
    for path in ('/api/health', '/api/config', '/api/status', '/api/import/template', '/api/import/sample'):
        assert client.get(path).status_code == 200
    assert client.get('/api/grants').status_code == 401


def test_invalid_browser_binding_never_falls_back_to_the_real_account(browser, monkeypatch):
    client, db = browser
    client.post('/api/demo/seed', json={'profile': 'early'})
    row = db.query(MCPTestAccount).filter_by(grant_id=None).one()
    row.synthetic_id = row.user_id
    db.commit()
    monkeypatch.delenv('KEY_ENCRYPTION_KEY', raising=False)
    assert client.get('/api/grants').status_code == 409
    assert client.get('/api/me').status_code == 409


def test_expiring_one_browser_fixture_keeps_other_owners(browser):
    from datetime import datetime, timedelta, timezone
    from scaffold.synthetic_accounts import prune_test_accounts
    client, db = browser
    client.post('/api/demo/seed', json={'profile': 'early'})
    first_id = db.query(MCPTestAccount.id).scalar()
    with patch.dict('os.environ', {'DOMAIN': ''}):
        register_user(client, 'other-browser@example.invalid')
    assert client.post('/api/demo/seed', json={'profile': 'exit'}).status_code == 200
    first = db.get(MCPTestAccount, first_id)
    first.last_used_at = datetime.now(timezone.utc) - timedelta(days=31)
    db.commit()
    assert prune_test_accounts(db) == 1
    assert db.query(MCPTestAccount).count() == 1
    assert len(client.get('/api/grants').json()) == 40


def test_deleting_owner_cleans_browser_and_connector_fixtures(client, db_session, monkeypatch):
    from scaffold.models import User
    from scaffold.user_deletion import delete_user
    from tests.test_mcp_tools import Mcp
    register_user(client)
    for key, value in STAGING.items():
        monkeypatch.setenv(key, value)
    client.post('/api/demo/seed', json={'profile': 'early'})
    mcp = Mcp(client)
    mcp.call('setup_test_account', scenario='exit')
    assert db_session.query(MCPTestAccount).count() == 2
    delete_user(db_session, 1)
    db_session.commit()
    assert db_session.query(MCPTestAccount).count() == 0
    assert db_session.query(User).count() == 0


def test_browser_cannot_accept_or_view_real_account_shares(browser):
    from datetime import datetime, timedelta, timezone
    from scaffold.invite_tokens import token_verifier, code_verifier
    from scaffold.models import Invitation
    client, db = browser
    client.post('/api/demo/seed', json={'profile': 'early'})
    fixture_id = db.query(MCPTestAccount.synthetic_id).scalar()
    invitation = Invitation(inviter_id=1, invitee_email='fictional@example.invalid',
                            token=token_verifier('fictional-invite'), short_code=code_verifier('TEST1234'),
                            expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    db.add(invitation)
    db.commit()
    assert client.post('/api/sharing/accept', json={'token': 'fictional-invite'}).status_code == 403
    db.refresh(invitation)
    assert invitation.status == 'pending' and invitation.invitee_id is None
    invitation.status, invitation.invitee_id = 'accepted', fixture_id
    db.commit()
    assert client.get(f'/api/sharing/view/{invitation.id}/grants').status_code == 403


def test_browser_notifications_cannot_move_the_real_device_subscription(browser):
    from scaffold.models import PushSubscription
    client, db = browser
    endpoint = 'https://fcm.googleapis.com/fcm/send/fictional-browser-test'
    sub = PushSubscription(user_id=1, endpoint=endpoint, p256dh='original-test-key', auth='original-test-auth')
    db.add(sub)
    db.commit()
    original_id = sub.id
    client.post('/api/demo/seed', json={'profile': 'early'})
    assert client.post('/api/push/status', json={'endpoint': endpoint}).status_code == 403
    assert client.post('/api/push/subscribe', json={'endpoint': endpoint, 'keys': {'p256dh': 'new-test-key', 'auth': 'new-test-auth'}}).status_code == 403
    assert client.post('/api/push/test').status_code == 403
    db.refresh(sub)
    assert (sub.id, sub.user_id, sub.p256dh, sub.auth) == (original_id, 1, 'original-test-key', 'original-test-auth')
    assert db.query(PushSubscription).count() == 1
