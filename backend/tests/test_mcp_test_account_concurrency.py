"""Independent sessions, encrypted writes, and real database locks.

CI runs the same races on PostgreSQL (including a one-slot financial pool).
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
import json
import os
import threading

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from database import Base
from scaffold.crypto import initialize_master_key
from scaffold.models import MCPTestAccount, User
from scaffold.oauth.models import OAuthGrant
from scaffold.oauth.resource import Connector
from scaffold.synthetic_accounts import account_lock, tool_account
from app.mcp.tools import REGISTRY, ToolContext


@pytest.fixture(params=['sqlite', 'postgresql'])
def isolated_database(request, tmp_path, monkeypatch):
    url = os.getenv('TEST_POSTGRES_URL') if request.param == 'postgresql' else f'sqlite:///{tmp_path}/synthetic.db'
    if not url:
        pytest.skip('TEST_POSTGRES_URL is supplied by the PostgreSQL CI service')
    options = {'pool_size': 1, 'max_overflow': 0, 'pool_timeout': 2} if request.param == 'postgresql' else {'connect_args': {'check_same_thread': False}}
    engine = create_engine(url, **options)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setenv('DOMAIN', 'staging.epic-stocks.com')
    with factory() as db:
        initialize_master_key(db)
        owner = User(email='fictional-owner@example.invalid', provider_name='test', google_id='fictional-owner')
        db.add(owner)
        db.flush()
        grant = OAuthGrant(user_id=owner.id, client_id='fictional-client', client_name='Fictional test', scope='equity:read equity:write comp:read comp:write')
        db.add(grant)
        db.commit()
        owner_id, grant_id = owner.id, grant.id
    @contextmanager
    def context():
        with factory() as db:
            connector = Connector(user=db.get(User, owner_id), grant=db.get(OAuthGrant, grant_id), scopes=['equity:read', 'equity:write', 'comp:read', 'comp:write'])
            ctx = ToolContext(connector=connector, db=db)
            # Release initial auth reads just as the transport's audit commit does.
            db.commit()
            yield ctx
    yield factory, context, owner_id, grant_id
    Base.metadata.drop_all(engine)
    engine.dispose()


def invoke(ctx, name, **args):
    with tool_account(ctx, name):
        return REGISTRY[name].handler(ctx, args)


def test_concurrent_provisioning_is_single_and_persistent(isolated_database):
    factory, context, owner_id, grant_id = isolated_database
    barrier = threading.Barrier(4)
    # With a one-slot PostgreSQL pool, put the barrier before opening sessions
    # to avoid making the test itself hold all data connections.
    def request(_):
        barrier.wait()
        with context() as ctx:
            try:
                return invoke(ctx, 'setup_test_account', scenario='early')
            except ValueError as exc:
                assert 'busy' in str(exc)
                return None
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(request, range(4)))
    successful = [r for r in results if r]
    assert successful
    with context() as ctx:
        again = invoke(ctx, 'setup_test_account', scenario='early')
        assert again['generation'] == successful[0]['generation']
    with factory() as db:
        assert db.query(MCPTestAccount).count() == 1
        assert db.query(User).filter_by(is_synthetic=True).count() == 1
        sid = db.query(MCPTestAccount.synthetic_id).scalar()
        assert db.execute(text('SELECT count(*) FROM grants WHERE user_id=:uid'), {'uid': sid}).scalar() == 6


def test_reset_excludes_write_and_invalidates_preview(isolated_database, monkeypatch):
    _, context, _, _ = isolated_database
    with context() as ctx:
        invoke(ctx, 'setup_test_account', scenario='early')
        reset = invoke(ctx, 'reset_test_account')
        change = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-11-23', 'price': 500}}]
        preview = invoke(ctx, 'apply_changes', changes=change)
    from app.mcp import test_account_tools
    original = test_account_tools._seed
    entered, release = threading.Event(), threading.Event()
    def paused_seed(*args):
        entered.set()
        assert release.wait(10)
        return original(*args)
    monkeypatch.setattr(test_account_tools, '_seed', paused_seed)
    def reset_request():
        with context() as ctx:
            return invoke(ctx, 'reset_test_account', confirm=reset['confirm'])
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(reset_request)
        assert entered.wait(10)
        # Lock acquisition itself never consumes the one-slot financial pool.
        factory = isolated_database[0]
        with factory() as db:
            with pytest.raises(ValueError, match='busy'):
                with account_lock(db, isolated_database[2]):
                    pass
        release.set()
        assert pending.result(timeout=10)['reset']
    with context() as ctx:
        with pytest.raises(ValueError, match='preview'):
            invoke(ctx, 'apply_changes', changes=change, confirm=preview['confirm'])
        assert invoke(ctx, 'list_prices')['current_price'] != 500


def test_locks_survive_commits_rollbacks_and_restore_on_error(isolated_database):
    factory, _, owner_id, _ = isolated_database
    with factory() as db:
        with account_lock(db, owner_id):
            db.execute(text('SELECT 1'))
            db.commit()
            db.execute(text('SELECT 1'))
            db.rollback()
            with factory() as other:
                with pytest.raises(ValueError, match='busy'):
                    with account_lock(other, owner_id):
                        pass
    with factory() as db:
        with account_lock(db, owner_id):
            pass  # the previous request released the lock


READ_BATCH = ('get_dashboard', 'list_grants', 'list_prices', 'list_loans',
              'list_interest_checkpoints', 'get_compensation',
              'get_retirement_params', 'get_import_guide')


def call(ctx, name, **args):
    from app.mcp.transport import _call_tool
    response = _call_tool({'name': name, 'arguments': args}, 1, ctx)['result']
    assert not response.get('isError'), response
    return json.loads(response['content'][0]['text'])


def test_eight_parallel_reads_share_one_fixture(isolated_database, monkeypatch):
    factory, context, owner_id, _ = isolated_database
    with context() as ctx:
        generation = call(ctx, 'setup_test_account', scenario='established')['generation']
    baseline = {}
    for name in READ_BATCH:
        with context() as ctx:
            baseline[name] = call(ctx, name)
    with factory() as db:
        actual_before = db.execute(text('SELECT comp_entries, retirement_params FROM users WHERE id=:uid'),
                                   {'uid': owner_id}).one()
    handlers = threading.Barrier(len(READ_BATCH))
    # Hold every handler inside its account guard at once. Releasing the data
    # connection also exercises a one-slot pool without a test-induced deadlock.
    def gated_handler(original):
        def handler(ctx, args):
            ctx.db.rollback()
            handlers.wait(timeout=10)
            return original(ctx, args)
        return handler
    for name in READ_BATCH:
        tool = REGISTRY[name]
        monkeypatch.setitem(REGISTRY, name, replace(tool, handler=gated_handler(tool.handler)))
    def request(name):
        with context() as ctx:
            return name, call(ctx, name)
    with ThreadPoolExecutor(len(READ_BATCH)) as pool:
        results = dict(pool.map(request, READ_BATCH))
    assert results == baseline
    assert {r['account_context']['generation'] for r in results.values()} == {generation}
    assert all(r['account_context']['synthetic'] for r in results.values())
    with factory() as db:
        assert db.execute(text('SELECT comp_entries, retirement_params FROM users WHERE id=:uid'),
                          {'uid': owner_id}).one() == actual_before


@pytest.mark.parametrize('name,args', [
    ('get_dashboard', {}), ('refresh_equity_view', {'view': 'grants'}),
    ('refresh_retirement_view', {}),
])
def test_read_and_widget_callbacks_exclude_reset_and_writes(isolated_database, monkeypatch, name, args):
    factory, context, owner_id, _ = isolated_database
    with context() as ctx:
        status = call(ctx, 'setup_test_account', scenario='early')
        reset = call(ctx, 'reset_test_account')
    entered, release = threading.Event(), threading.Event()
    tool = REGISTRY[name]
    def paused(ctx, args):
        ctx.db.rollback()
        entered.set()
        assert release.wait(10)
        return {'fixture_user': ctx.user.id}
    monkeypatch.setitem(REGISTRY, name, replace(tool, handler=paused))
    def read():
        with context() as ctx:
            return call(ctx, name, **args)
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(read)
        assert entered.wait(10)
        try:
            for write, values in [
                ('setup_test_account', {'scenario': 'early'}),
                ('reset_test_account', {'confirm': reset['confirm']}),
                ('add_compensation', {'entries': [{'type': 'bonus', 'date': '2026-11-24', 'amount': 1000}]}),
                ('apply_changes', {'changes': []}),
            ]:
                with context() as ctx:
                    with pytest.raises(AssertionError, match='busy'):
                        call(ctx, write, **values)
            # Disconnect/deletion/retention use the same exclusive guard.
            with factory() as db:
                with pytest.raises(ValueError, match='busy'):
                    with account_lock(db, owner_id):
                        pass
        finally:
            release.set()
        assert pending.result(timeout=10)['account_context']['generation'] == status['generation']
    with context() as ctx:
        restored = call(ctx, 'reset_test_account', confirm=reset['confirm'])
        assert restored['generation'] != status['generation']
        assert call(ctx, 'get_account_context')['generation'] == restored['generation']


@pytest.mark.parametrize('shared', [False, True])
def test_both_lock_modes_release_after_errors_and_transactions(isolated_database, shared):
    factory, _, owner_id, _ = isolated_database
    with factory() as db:
        with pytest.raises(RuntimeError, match='deliberate'):
            with account_lock(db, owner_id, shared=shared):
                db.execute(text('SELECT 1'))
                db.commit()
                db.rollback()
                with factory() as other:
                    with pytest.raises(ValueError, match='busy'):
                        with account_lock(other, owner_id):
                            pass
                raise RuntimeError('deliberate')
        with account_lock(db, owner_id):
            pass


def test_browser_read_guard_excludes_reset(isolated_database):
    from types import SimpleNamespace
    from app.staging_demo import seed_profile
    from scaffold.auth import create_token
    from scaffold.web_test_accounts import request_workspace
    factory, context, owner_id, _ = isolated_database
    with context() as ctx:
        initial = seed_profile(ctx.connector.user, ctx.db, 'early')['account_context']
    token = create_token(owner_id)
    with factory() as db:
        with request_workspace(db, token, '/api/grants', 'GET') as target:
            db.close()
            with context() as ctx:
                with pytest.raises(ValueError, match='busy'):
                    seed_profile(ctx.connector.user, ctx.db, 'exit')
            with factory() as other:
                with request_workspace(other, token, '/api/prices', 'GET') as second:
                    assert target == second
    with context() as ctx:
        from app.mcp.test_account_tools import _reset
        browser = ToolContext(connector=SimpleNamespace(user=ctx.connector.user, grant=SimpleNamespace(id=None)), db=ctx.db)
        with account_lock(ctx.db, owner_id):
            preview = _reset(browser, {'scenario': 'exit'}, browser=True)
            restored = _reset(browser, {'scenario': 'exit', 'confirm': preview['confirm']}, browser=True)
        assert restored['generation'] != initial['generation']


def test_directory_reviewers_write_independently_in_parallel(isolated_database):
    from scaffold import reviewers
    from scaffold.models import Price, ReviewerAccount
    from scaffold.synthetic_accounts import synthetic_key
    factory = isolated_database[0]
    identities = []
    with factory() as db:
        for platform in ('openai', 'anthropic'):
            _, digest = reviewers.credentials()
            info = reviewers.grant_access(db, {'platform': platform, 'scenario': 'early', 'days': 30, 'credential_hash': digest})
            uid = db.get(ReviewerAccount, info['id']).user_id
            grant = OAuthGrant(user_id=uid, client_id=f'fictional-{platform}', client_name='Fictional directory review',
                               scope='equity:read equity:write')
            db.add(grant)
            db.commit()
            identities.append((uid, grant.id))
    barrier = threading.Barrier(2)

    def write(index):
        barrier.wait()
        uid, gid = identities[index]
        with factory() as db:
            user, grant = db.get(User, uid), db.get(OAuthGrant, gid)
            ctx = ToolContext(Connector(user, grant, grant.scope.split()), db)
            db.commit()
            changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2044-01-01', 'price': 700 + index * 100}}]
            with synthetic_key(db, uid):
                preview = invoke(ctx, 'apply_changes', changes=changes)
                invoke(ctx, 'apply_changes', changes=changes, confirm=preview['confirm'])
                price = db.query(Price).filter_by(user_id=uid).order_by(Price.effective_date.desc()).first()
                return price.price

    with ThreadPoolExecutor(2) as pool:
        assert list(pool.map(write, range(2))) == [700, 800]
