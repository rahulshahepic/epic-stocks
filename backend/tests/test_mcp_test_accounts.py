"""Real transport + real encryption: staging can never route to actual records."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from scaffold.models import MCPTestAccount, User
from scaffold.oauth.models import McpAudit
from scaffold.synthetic_accounts import account_lock, prune_test_accounts
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, seed

MANAGEMENT = {'list_test_scenarios', 'setup_test_account', 'reset_test_account'}


@pytest.fixture()
def staging(client, monkeypatch):
    register_user(client)
    seed(client)  # actual account deliberately contains financial records
    monkeypatch.setenv('DOMAIN', 'staging.epic-stocks.com')
    mcp = Mcp(client)
    return mcp


def actual_snapshot(db):
    # Byte-for-byte comparisons, including encrypted financial fields.
    tables = ('users', 'grants', 'grant_vestings', 'loans', 'prices', 'sales')
    uid = db.execute(text('SELECT id FROM users WHERE is_synthetic=:flag'), {'flag': False}).scalar()
    return {t: db.execute(text(f'SELECT * FROM {t} WHERE {"id" if t == "users" else "user_id"}=:uid'), {'uid': uid}).all() for t in tables}


def test_production_cannot_discover_or_invoke(staging, monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DOMAIN', 'epic-stocks.com')
    staging = Mcp(staging.client)
    names = {t['name'] for t in staging.list_tools()}
    assert not names & MANAGEMENT
    for name in MANAGEMENT:
        result = staging.rpc('tools/call', {'name': name})
        assert result['error']['code'] == -32602
    assert staging.call('get_account_context')['synthetic'] is False
    assert len(staging.call('list_grants')['grants']) == 2


def test_fail_closed_entire_catalogue(staging):
    assert staging.call('get_account_context')['initialized'] is False
    for tool in staging.list_tools():
        if tool['name'] in MANAGEMENT | {'get_account_context'}:
            continue
        assert 'setup_test_account' in staging.error(tool['name'])
    initialization = staging.rpc('initialize')['result']['instructions']
    assert 'get_account_context' in initialization and 'setup_test_account' in initialization


@pytest.mark.parametrize('scenario', ['early', 'established', 'exit'])
def test_setup_encrypted_persistent_and_idempotent(staging, db_session, scenario):
    before = actual_snapshot(db_session)
    assert len(staging.call('list_test_scenarios')['scenarios']) == 3
    status = staging.call('setup_test_account', scenario=scenario)
    assert status['synthetic'] and status['initialized'] and status['scenario'] == scenario
    initial = staging.call('get_dashboard')
    assert initial['account_context']['synthetic'] is True
    assert staging.call('setup_test_account', scenario=scenario) == status
    assert db_session.query(MCPTestAccount).count() == 1
    assert db_session.query(User).filter_by(is_synthetic=True).count() == 1
    row = db_session.query(MCPTestAccount).one()
    for table, column in [('grants', 'shares'), ('loans', 'amount'), ('prices', 'price')]:
        values = db_session.execute(text(f'SELECT {column} FROM {table} WHERE user_id=:uid'), {'uid': row.synthetic_id}).scalars().all()
        assert values and all(v.startswith('$ENC$') for v in values)
    staging.call('add_compensation', entries=[{'type': 'bonus', 'date': '2026-11-23', 'amount': 12345}])
    staging.call('set_retirement_accounts', traditional_401k=.25)
    staging.call('setup_test_account', scenario=scenario)
    assert '12345' in json.dumps(staging.call('get_compensation'))
    assert actual_snapshot(db_session) == before


def test_reset_tokens_isolation_and_stale_import(staging, db_session):
    before = actual_snapshot(db_session)
    status = staging.call('setup_test_account', scenario='established')
    original = staging.call('list_grants')['grants']
    changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-23', 'price': 500}}]
    preview = staging.call('apply_changes', changes=changes)
    staging.call('apply_changes', changes=changes, confirm=preview['confirm'])
    assert staging.call('list_prices')['current_price'] == 500
    preview = staging.call('apply_changes', changes=[{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-22', 'price': 400}}])
    reset = staging.call('reset_test_account')
    assert reset['reset'] is False
    assert 'invalid' in staging.error('reset_test_account', confirm='wrong')
    assert 'invalid' in staging.error('reset_test_account', confirm='not-a-token-\u2603')
    assert staging.call('list_prices')['current_price'] == 500
    restored = staging.call('reset_test_account', confirm=reset['confirm'])
    assert restored['generation'] != status['generation']
    assert staging.call('list_prices')['current_price'] != 500
    assert len(staging.call('list_grants')['grants']) == len(original)
    assert 'stale' in staging.error('reset_test_account', confirm=reset['confirm'])
    assert 'preview' in staging.error('apply_changes', changes=[{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-22', 'price': 400}}], confirm=preview['confirm'])
    assert actual_snapshot(db_session) == before


def test_cross_connection_record_ids_and_confirmation_tokens(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    first = db_session.query(MCPTestAccount).one().synthetic_id
    first_reset = staging.call('reset_test_account')['confirm']
    other = Mcp(staging.client)
    assert other.call('get_account_context')['initialized'] is False
    other.call('setup_test_account', scenario='exit')
    other_reset = other.call('reset_test_account')['confirm']
    assert first_reset != other_reset
    assert 'invalid' in other.error('reset_test_account', confirm=first_reset)
    assert 'Unknown account' in other.error('get_dashboard', account=str(first))
    actual_id = db_session.execute(text('SELECT id FROM grants WHERE user_id=:uid'), {'uid': 1}).scalar()
    message = other.error('apply_changes', changes=[{'kind': 'grant', 'action': 'delete', 'id': actual_id, 'version': 1}])
    assert message
    first_grant = staging.call('list_grants')['grants'][0]
    assert other.error('apply_changes', changes=[{'kind': 'grant', 'action': 'delete', 'id': first_grant['id'], 'version': first_grant['version']}])
    assert len(staging.call('list_grants')['grants']) == 6
    assert len(other.call('list_grants')['grants']) == 40


def test_audit_scope_revocation_and_cleanup(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    row = db_session.query(MCPTestAccount).one()
    synthetic_id, grant_id, owner_id = row.synthetic_id, row.grant_id, row.user_id
    staging.call('get_dashboard')
    audit = db_session.query(McpAudit).filter_by(tool='get_dashboard').one()
    assert audit.user_id == owner_id and audit.grant_id == grant_id
    assert audit.user_id != synthetic_id
    assert staging.client.delete(f'/api/oauth/connections/{grant_id}').status_code == 204
    assert db_session.query(MCPTestAccount).count() == 0
    assert db_session.get(User, synthetic_id) is None
    for table in ('grants', 'grant_vestings', 'loans', 'loan_interest_checkpoints', 'prices', 'tax_settings'):
        assert db_session.execute(text(f'SELECT count(*) FROM {table} WHERE user_id=:uid'), {'uid': synthetic_id}).scalar() == 0
    response = staging.client.post('/mcp', headers=staging.auth, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
    assert response.status_code == 401


def test_scope_preserved_and_no_reconnect(staging):
    other = Mcp(staging.client, scope='comp:read')
    other.call('setup_test_account', scenario='early')
    assert other.call('get_account_context')['initialized'] is True
    assert 'permission' in other.error('add_compensation', entries=[{'type': 'bonus', 'date': '2026-11-23', 'amount': 12345}])
    assert 'permission' in other.error('get_dashboard')
    assert other.call('get_compensation')


def test_busy_lock_and_failed_key_restore(staging, db_session):
    from scaffold.crypto import get_current_key, set_current_key
    from scaffold.synthetic_accounts import synthetic_key
    staging.call('setup_test_account', scenario='early')
    owner = db_session.query(MCPTestAccount).one()
    with account_lock(db_session, owner.user_id):
        assert 'busy' in staging.error('setup_test_account', scenario='early')
        assert 'busy' in staging.error('reset_test_account')
        assert 'busy' in staging.error('get_dashboard')
    previous = b'x' * 32
    set_current_key(previous)
    with pytest.raises(RuntimeError):
        with synthetic_key(db_session, owner.synthetic_id):
            assert bytes(get_current_key()) != previous
            raise RuntimeError('deliberate failure')
    assert bytes(get_current_key()) == previous
    set_current_key(None)
    assert staging.call('get_dashboard')['account_context']['synthetic']


def test_retention_and_owner_deletion(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    row = db_session.query(MCPTestAccount).one()
    row.last_used_at = datetime.now(timezone.utc) - timedelta(days=31)
    db_session.commit()
    assert prune_test_accounts(db_session) == 1
    assert staging.call('get_account_context')['initialized'] is False
    assert 'setup_test_account' in staging.error('get_dashboard')
    staging.call('setup_test_account', scenario='exit')
    from scaffold.user_deletion import delete_user
    delete_user(db_session, 1)
    db_session.commit()
    assert db_session.query(User).count() == 0
    assert db_session.query(MCPTestAccount).count() == 0


def test_widgets_and_real_retirement_worker(staging):
    from app.retirement_simulation import RUNNER
    if not RUNNER.with_name('retirement.math.mjs').is_file():
        pytest.skip('Node retirement runtime is compiled in Docker/E2E; compile it for this integration test')
    staging.call('setup_test_account', scenario='exit')
    for name in ('show_equity', 'refresh_equity_view'):
        for view in ('summary', 'grants', 'loans', 'events'):
            result = staging.raw_call(name, view=view)
            assert not result.get('isError'), result
            assert result['structuredContent']['account_context']['synthetic'] is True
    for name in ('show_retirement', 'refresh_retirement_view', 'run_retirement_simulation'):
        result = staging.call(name, overrides={'paths': 100})
        assert result['account_context']['synthetic'] is True
        assert result['result']['paths'] == 100
        assert len(result['assumptions']['plannedEvents']) == 2
    comparison = staging.call('compare_retirement_scenarios', scenarios=[
        {'name': 'First', 'overrides': {'paths': 100, 'retirementDate': '2032-01-01'}},
        {'name': 'Later', 'overrides': {'paths': 100, 'retirementDate': '2033-01-01'}},
    ])
    assert len(comparison['scenarios']) == 2
    planned = staging.call('plan_life_events', events=[{'id': 'college', 'title': 'Fictional college', 'kind': 'education',
                                                       'date': '2038-09-01', 'amountM': 0, 'annualCostM': .04, 'durationYears': 4}], overrides={'paths': 100})
    assert planned['withEvents']['account_context']['synthetic'] is True
    for descriptor in staging.rpc('resources/list')['result']['resources']:
        content = staging.rpc('resources/read', {'uri': descriptor['uri']})['result']['contents'][0]
        assert 'syntheticNotice' in content['text']


def test_provision_failure_rolls_back_before_audit(staging, db_session, monkeypatch):
    from contextlib import contextmanager
    from app.mcp import test_account_tools
    from scaffold.crypto import get_current_key
    before = actual_snapshot(db_session)
    @contextmanager
    def broken_key(*args):
        raise ValueError('key unavailable')
        yield  # pragma: no cover
    monkeypatch.setattr(test_account_tools, 'synthetic_key', broken_key)
    assert 'key unavailable' in staging.error('setup_test_account', scenario='early')
    assert db_session.query(MCPTestAccount).count() == 0
    assert db_session.query(User).filter_by(is_synthetic=True).count() == 0
    assert actual_snapshot(db_session) == before
    assert get_current_key() is None


def test_reset_preserves_other_connection(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    other = Mcp(staging.client)
    other.call('setup_test_account', scenario='exit')
    other.call('add_compensation', entries=[{'type': 'bonus', 'date': '2026-11-23', 'amount': 12345}])
    before = other.call('get_compensation')
    confirm = staging.call('reset_test_account')['confirm']
    staging.call('reset_test_account', confirm=confirm)
    assert other.call('get_compensation') == before
    assert db_session.query(MCPTestAccount).count() == 2


@pytest.mark.parametrize('app_env,domain', [('production', 'staging.epic-stocks.com'), ('staging', ''), ('staging', 'wrong.example')])
def test_config_conflicts_never_route_to_actual_records(staging, monkeypatch, app_env, domain):
    monkeypatch.setenv('APP_ENV', app_env)
    monkeypatch.setenv('DOMAIN', domain)
    mcp = Mcp(staging.client)
    assert 'refused' in mcp.error('get_dashboard')
    assert not mcp.call('get_account_context')['initialized']


def test_canonical_synthetic_deletion_and_commit_lock(staging, db_session):
    from scaffold.user_deletion import delete_user
    staging.call('setup_test_account', scenario='early')
    row = db_session.query(MCPTestAccount).one()
    synthetic_id, owner_id = row.synthetic_id, row.user_id
    delete_user(db_session, synthetic_id)
    with pytest.raises(ValueError, match='busy'):
        with account_lock(db_session, owner_id):
            pass
    db_session.commit()
    with account_lock(db_session, owner_id):
        assert db_session.query(MCPTestAccount).count() == 0
    assert db_session.get(User, synthetic_id) is None
    assert db_session.get(User, owner_id) is not None


def test_all_financial_tool_families_use_fixture(staging, db_session):
    staging.call('setup_test_account', scenario='established')
    for name, args in [
        ('get_import_guide', {}), ('list_events', {'from_date': '2026-01-01', 'to_date': '2032-01-01'}),
        ('list_loans', {}), ('list_interest_checkpoints', {}), ('list_sales', {}),
        ('get_retirement_params', {}), ('get_compensation', {}),
        ('estimate_sale', {'shares': 10, 'price_per_share': 500}),
    ]:
        assert staging.call(name, **args)['account_context']['synthetic']
    sale = [{'kind': 'sale', 'action': 'create', 'values': {'date': '2026-11-23', 'shares': 10, 'price_per_share': 500}}]
    token = staging.call('apply_changes', changes=sale)['confirm']
    sid = staging.call('apply_changes', changes=sale, confirm=token)['changes'][0]['id']
    assert staging.call('get_tax_breakdown', sale_id=sid)['account_context']['synthetic']
    staging.call('update_retirement_params', changes={'defaultSpend': 75})
    checkpoint = staging.call('list_interest_checkpoints')['checkpoints'][0]
    change = [{'kind': 'interest_checkpoint', 'action': 'update', 'id': checkpoint['id'],
               'version': checkpoint['version'], 'values': {'accrued_interest': 750}}]
    token = staging.call('apply_changes', changes=change)['confirm']
    assert staging.call('apply_changes', changes=change, confirm=token)['applied']
    assert staging.call('list_interest_checkpoints')['checkpoints'][0]['accrued_interest'] == 750


def test_other_principal_isolation_and_host_spoofing(staging, db_session, monkeypatch):
    staging.call('setup_test_account', scenario='early')
    reset = staging.call('reset_test_account')['confirm']
    first = db_session.query(MCPTestAccount).one().synthetic_id
    with monkeypatch.context() as login_config:
        login_config.delenv('DOMAIN')
        register_user(staging.client, email='second-owner@example.invalid')
    other = Mcp(staging.client)
    assert not other.call('get_account_context')['initialized']
    other.call('setup_test_account', scenario='exit')
    assert 'invalid' in other.error('reset_test_account', confirm=reset)
    assert other.error('get_dashboard', account=str(first))
    assert len(staging.call('list_grants')['grants']) == 6  # conflicting browser cookie cannot change bearer routing
    response = staging.client.post('/mcp', headers={**other.auth, 'Host': 'epic-stocks.com', 'X-Forwarded-Host': 'epic-stocks.com'},
                                   json={'jsonrpc': '2.0', 'id': 123, 'method': 'tools/call', 'params': {'name': 'get_dashboard', 'arguments': {}}})
    result = json.loads(response.json()['result']['content'][0]['text'])
    assert result['account_context']['synthetic']
    assert result['account_context']['scenario'] == 'exit'


def test_disconnect_during_financial_request_is_retryable(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    row = db_session.query(MCPTestAccount).one()
    with account_lock(db_session, row.user_id):
        response = staging.client.delete(f'/api/oauth/connections/{row.grant_id}')
        assert response.status_code == 409
        assert response.headers['Retry-After'] == '1'
    assert staging.call('get_account_context')['initialized']


def test_fixture_provisioning_has_an_explicit_per_owner_quota(staging, monkeypatch, db_session):
    from scaffold.quota import ROW_QUOTAS
    monkeypatch.setitem(ROW_QUOTAS, 'MCPTestAccount', 0)
    assert 'Limit reached' in staging.error('setup_test_account', scenario='early')
    assert not db_session.query(MCPTestAccount).count()
    assert not db_session.query(User).filter_by(is_synthetic=True).count()


def test_expiry_and_reprovision_invalidate_import_even_when_ids_are_reused(staging, db_session):
    staging.call('setup_test_account', scenario='early')
    changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-23', 'price': 500}}]
    preview = staging.call('apply_changes', changes=changes)
    row = db_session.query(MCPTestAccount).one()
    old_generation, old_id = row.generation, row.synthetic_id
    old_price_ids = db_session.execute(text('SELECT id FROM prices WHERE user_id=:uid ORDER BY id'), {'uid': old_id}).scalars().all()
    row.last_used_at = datetime.now(timezone.utc) - timedelta(days=31)
    db_session.commit()
    assert prune_test_accounts(db_session) == 1
    fresh = staging.call('setup_test_account', scenario='early')
    assert fresh['generation'] != old_generation
    assert db_session.query(MCPTestAccount.synthetic_id).scalar() == old_id  # SQLite reuses the deleted maximum ID
    assert db_session.execute(text('SELECT id FROM prices WHERE user_id=:uid ORDER BY id'), {'uid': old_id}).scalars().all() == old_price_ids
    assert 'preview' in staging.error('apply_changes', changes=changes, confirm=preview['confirm'])


def test_notice_aware_widget_resource_versions_invalidate_cached_templates(staging):
    tools = {tool['name']: tool for tool in staging.list_tools()}
    assert tools['show_equity']['_meta']['ui']['resourceUri'] == 'ui://epic-stocks/portfolio-v4.html'
    assert tools['show_retirement']['_meta']['ui']['resourceUri'] == 'ui://epic-stocks/retirement-v5.html'
    # Previously advertised URIs remain readable while hosts refresh metadata.
    for uri in ('ui://epic-stocks/portfolio-v3.html', 'ui://epic-stocks/retirement-v4.html',
                'ui://epic-stocks/portfolio-v4.html', 'ui://epic-stocks/retirement-v5.html'):
        resource = staging.rpc('resources/read', {'uri': uri})['result']['contents'][0]
        assert resource['uri'] == uri
        assert 'FICTIONAL TEST ACCOUNT' in resource['text']
