"""Independent sessions, encrypted writes, and real database locks.

CI runs the same races on PostgreSQL (including a one-slot financial pool).
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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
