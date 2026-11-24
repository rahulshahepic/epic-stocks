from unittest.mock import patch

import pytest

from tests.conftest import register_user

STAGING = {'APP_ENV': 'staging', 'DOMAIN': 'staging.epic-stocks.com'}


@pytest.mark.parametrize('profile', ['early', 'established', 'exit'])
def test_seed_empty_staging_account(client, profile):
    register_user(client)
    with patch.dict('os.environ', STAGING):
        response = client.post('/api/demo/seed', json={'profile': profile})
    assert response.status_code == 200, response.text
    assert response.json()['fictional'] is True
    assert len(client.get('/api/grants').json()) == {'early': 6, 'established': 20, 'exit': 40}[profile]
    assert len(client.get('/api/loans').json()) == 3
    assert len(client.get('/api/prices').json()) > 10
    params = client.get('/api/retirement/params').json()['params']
    assert params['retirementDate'] == '2026-11-24'
    assert params['epicExitMode'] == 'automatic'
    assert params['epicExit'] > 0
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': profile}).status_code == 409


@pytest.mark.parametrize('env', [{}, {'APP_ENV': 'production', 'DOMAIN': 'epic-stocks.com'},
                                 {'APP_ENV': 'staging', 'DOMAIN': 'epic-stocks.com'},
                                 {'APP_ENV': 'staging', 'DOMAIN': 'evil.example'}])
def test_seed_unavailable_outside_official_staging(client, env):
    register_user(client)
    with patch.dict('os.environ', env, clear=True):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 404


def test_seed_requires_session_and_keeps_other_accounts(client):
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 401
    register_user(client, 'first@example.com')
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 200
    before = client.get('/api/grants').json()
    register_user(client, 'second@example.com')
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'exit'}).status_code == 200
    register_user(client, 'first@example.com')
    assert client.get('/api/grants').json() == before


def test_seed_rolls_back_the_whole_profile_if_later_setup_fails(client):
    register_user(client)
    with patch.dict('os.environ', STAGING), patch('app.routers.events._preview_exit_data', side_effect=RuntimeError('test failure')):
        with pytest.raises(RuntimeError, match='test failure'):
            client.post('/api/demo/seed', json={'profile': 'early'})
    assert client.get('/api/grants').json() == []
    assert client.get('/api/loans').json() == []
    assert client.get('/api/prices').json() == []
    assert client.get('/api/me').json()['date_of_birth'] is None


def test_seed_rejects_existing_financial_records(client):
    register_user(client)
    record = client.post('/api/prices', json={'effective_date': '2026-01-01', 'price': 100}).json()
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 409
    assert client.get('/api/prices').json() == [record]


def test_seeded_account_works_through_mcp_and_connector_cannot_seed(client):
    from tests.test_mcp_tools import Mcp
    register_user(client)
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 200
    mcp = Mcp(client, scope='equity:read equity:write comp:read comp:write')
    dashboard = mcp.call('get_dashboard')
    http = client.get('/api/dashboard?as_of=2026-11-24').json()
    assert dashboard['held_vested_shares'] == http['held_vested_shares']
    assert mcp.call('get_retirement_params')['params']['defaultSpend'] == 40
    client.cookies.clear()
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', headers=mcp.auth, json={'profile': 'exit'}).status_code == 401


def test_seed_preserves_existing_birthday(client):
    register_user(client)
    assert client.patch('/api/me/profile', json={'date_of_birth': '1980-01-01'}).status_code == 200
    with patch.dict('os.environ', STAGING):
        assert client.post('/api/demo/seed', json={'profile': 'early'}).status_code == 409
    assert client.get('/api/me').json()['date_of_birth'] == '1980-01-01'
    assert client.get('/api/grants').json() == []


@pytest.mark.parametrize('reason', ['birthday_present', 'saved_plan_present', 'compensation_present', 'financial_records_present'])
def test_seed_refusal_has_a_safe_correlated_diagnostic(client, db_session, reason):
    from scaffold.models import ErrorLog
    register_user(client)
    if reason == 'birthday_present':
        client.patch('/api/me/profile', json={'date_of_birth': '1980-01-01'})
    elif reason == 'saved_plan_present':
        client.put('/api/retirement/params', json={'params': {'defaultSpend': 65}})
    elif reason == 'compensation_present':
        client.put('/api/retirement/comp-entries', json={'entries': [{'id': 'fictional', 'type': 'bonus', 'date': '2026-01-01', 'amount': 1000}]})
    else:
        client.post('/api/prices', json={'effective_date': '2026-01-01', 'price': 100})
    with patch.dict('os.environ', STAGING):
        first = client.post('/api/demo/seed', json={'profile': 'early'})
        second = client.post('/api/demo/seed', json={'profile': 'established'})
    assert first.status_code == second.status_code == 409
    ref = first.headers['X-Error-Ref']
    assert second.headers['X-Error-Ref'] == ref
    diagnostic = db_session.query(ErrorLog).filter_by(error_ref=ref).one()
    assert diagnostic.error_type == 'StagingSetupRefused'
    assert diagnostic.error_message == reason
    assert diagnostic.path == '/api/demo/seed'
    assert diagnostic.traceback is None
    assert db_session.query(ErrorLog).count() == 1
