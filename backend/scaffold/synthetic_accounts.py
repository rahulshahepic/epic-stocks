"""Staging MCP isolation and lifecycle. Authentication always remains the principal's."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import os
import tempfile
import threading
import uuid

from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import NullPool

from scaffold.crypto import decrypt_user_key, encryption_enabled, get_current_key, set_current_key
from scaffold.models import InternalTestAccount, MCPTestAccount, ReviewerAccount, User

RETENTION_DAYS = 30
_LOCK_SLOTS = threading.BoundedSemaphore(2)
_READ_LOCK_SLOTS = threading.BoundedSemaphore(16)
_LOCK_ENGINES = {}
_LOCK_ENGINES_GUARD = threading.Lock()
_MEMORY_LOCK_NAMESPACE = uuid.uuid4().hex
_ALL_GRANTS = object()

class SyntheticAccountBusy(ValueError):
    """A retryable account operation, never an internal error."""


MANAGEMENT_TOOLS = frozenset({'get_account_context', 'list_test_scenarios', 'setup_test_account', 'reset_test_account'})


def is_staging():
    # Deployment configuration only. Never consult Host, Forwarded or tool arguments.
    return os.getenv('DOMAIN', '').strip().lower() == 'staging.epic-stocks.com' and os.getenv('APP_ENV', '').lower() != 'production'


def requires_synthetic():
    # A conflicting/missing domain must never turn a staging deployment into
    # an actual-account MCP. Provisioning is stricter and may still be refused.
    return os.getenv('APP_ENV', '').lower() == 'staging' or os.getenv('DOMAIN', '').strip().lower() == 'staging.epic-stocks.com'


def environment():
    if requires_synthetic():
        return 'staging'
    return 'production' if os.getenv('APP_ENV') == 'production' or os.getenv('DOMAIN') == 'epic-stocks.com' else 'development'


@contextmanager
def account_lock(db, principal_id, *, shared=False):
    """Survives router commits/preview rollbacks; shared across workers/replicas.

    Reads share the guard; mutations require exclusive access. Refuse conflicts
    instead of blocking ASGI or exhausting the DB pool.
    SQLite's file lock is for local development; deployments use PostgreSQL.
    """
    key = int.from_bytes(hashlib.sha256(f'mcp-test:{principal_id}'.encode()).digest()[:8], 'big', signed=True)
    if db.get_bind().dialect.name == 'postgresql':
        # Lock connections do not borrow from the financial session pool. This
        # prevents N locks from consuming all N connections before work starts.
        url = db.get_bind().url
        with _LOCK_ENGINES_GUARD:
            engine = _LOCK_ENGINES.get(url)
            if engine is None:
                engine = _LOCK_ENGINES[url] = create_engine(url, poolclass=NullPool)
        slots = _READ_LOCK_SLOTS if shared else _LOCK_SLOTS
        if not slots.acquire(blocking=False):
            raise SyntheticAccountBusy('Synthetic accounts are busy; retry this request shortly.')
        try:
            with engine.connect() as connection:
                lock = 'pg_try_advisory_lock_shared' if shared else 'pg_try_advisory_lock'
                unlock = 'pg_advisory_unlock_shared' if shared else 'pg_advisory_unlock'
                acquired = connection.execute(text(f'SELECT {lock}(:key)'), {'key': key}).scalar()
                if not acquired:
                    raise SyntheticAccountBusy('Synthetic account is busy; retry this request shortly.')
                try:
                    yield
                finally:
                    connection.execute(text(f'SELECT {unlock}(:key)'), {'key': key})
                    connection.commit()
        finally:
            slots.release()
    else:
        database = db.get_bind().url.database
        identity = os.path.abspath(database) if database and database != ':memory:' else f'memory-{_MEMORY_LOCK_NAMESPACE}-{id(db.get_bind())}'
        key = hashlib.sha256(f'{identity}:{principal_id}'.encode()).hexdigest()
        path = os.path.join(tempfile.gettempdir(), f'epic-mcp-test-{key}.lock')
        with open(path, 'a') as stream:
            try:
                fcntl.flock(stream, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SyntheticAccountBusy('Synthetic account is busy; retry this request shortly.') from None
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


@contextmanager
def lifecycle_lock(db, user_id):
    # Production cannot provision fixtures. Historical bindings still need the
    # guard for cleanup, but ordinary production accounts need no lock slot.
    if not requires_synthetic() and not db.query(MCPTestAccount.id).filter_by(user_id=user_id).first() and not db.query(ReviewerAccount.id).filter_by(user_id=user_id).first() and not db.query(InternalTestAccount.id).filter_by(user_id=user_id).first():
        yield
        return
    with account_lock(db, user_id):
        yield


@contextmanager
def deletion_lock(db, user_id):
    """Keep the guard until the caller's outer transaction commits/rolls back."""
    guard = lifecycle_lock(db, user_id)
    guard.__enter__()
    released = False
    def release(session, transaction):
        nonlocal released
        if transaction.parent is None and not released:
            released = True
            guard.__exit__(None, None, None)
    event.listen(db, 'after_transaction_end', release)
    try:
        yield
    except BaseException:
        if not released:
            released = True
            guard.__exit__(None, None, None)
        raise


def binding(db, user_id, grant_id):
    return db.query(MCPTestAccount).filter_by(user_id=user_id, grant_id=grant_id).populate_existing().first()


def account_context(ctx):
    from scaffold.reviewers import account as reviewer_account, state
    reviewer = reviewer_account(ctx.db, ctx.connector.user)
    if reviewer:
        return {**state(reviewer), 'environment': environment(), 'synthetic': True, 'initialized': True}
    from scaffold.test_users import account as test_user_account, state as test_user_state
    test_user = test_user_account(ctx.db, ctx.connector.user)
    if test_user:
        return {**test_user_state(test_user), 'environment': environment(), 'synthetic': True, 'initialized': True}
    row = binding(ctx.db, ctx.connector.user.id, ctx.connector.grant.id) if requires_synthetic() else None
    return {'environment': environment(), 'synthetic': bool(row), 'initialized': bool(row) if requires_synthetic() else True,
            'scenario': row.scenario if row else None, 'fixture_version': row.fixture_version if row else None,
            'generation': row.generation if row else None,
            'notice': 'FICTIONAL TEST DATA — isolated writable account' if row else
                      'Staging requires setup_test_account. Actual financial records are inaccessible.' if requires_synthetic() else 'Authenticated account'}


@contextmanager
def synthetic_key(db, user_id):
    previous = get_current_key()
    # Save the original object: replacing a key never zeros the parent ASGI context.
    try:
        wrapped = db.execute(text('SELECT encrypted_key FROM users WHERE id=:uid AND is_synthetic = :flag'),
                             {'uid': user_id, 'flag': True}).scalar()
        if encryption_enabled() and not wrapped:
            raise ValueError('Synthetic encryption key is unavailable; access refused.')
        set_current_key(decrypt_user_key(wrapped) if wrapped else None)
        yield
    finally:
        # Never clear/zero the caller's bytearray (thread contexts share it).
        if previous is not None:
            set_current_key(previous)
        else:
            set_current_key(None)


@contextmanager
def tool_account(ctx, tool_name, *, read_only=False):
    """All ordinary staging handlers, nested handlers and widget callbacks enter here."""
    from scaffold.reviewers import identity, active
    if identity(ctx.connector.user):
        with account_lock(ctx.db, ctx.connector.user.id, shared=read_only):
            if not active(ctx.db, ctx.connector.user):
                raise ValueError('Reviewer access expired or revoked')
            live = ctx.db.execute(text('SELECT g.user_id, g.session_version, u.session_version FROM oauth_grants g JOIN users u ON u.id=g.user_id WHERE g.id=:gid'), {'gid': ctx.connector.grant.id}).first()
            if not live or live[0] != ctx.connector.user.id or live[1] != live[2] or live[1] != ctx.connector.grant.session_version:
                raise ValueError('Reviewer connection was revoked or rotated; reconnect')
            if tool_name in MANAGEMENT_TOOLS - {'get_account_context'}:
                raise ValueError('Reviewer datasets are managed deliberately by the administrator')
            yield account_context(ctx)
        return
    from scaffold.test_users import identity as test_user_identity, active as test_user_active
    if test_user_identity(ctx.connector.user):
        # Unlike reviewers, a test user's data tools are the point: the
        # account exists so the operator can validate them in production.
        # The same live-grant/session serialization still applies, so a
        # revocation or rotation cannot race an in-flight call.
        with account_lock(ctx.db, ctx.connector.user.id, shared=read_only):
            if not test_user_active(ctx.db, ctx.connector.user):
                raise ValueError('Test user access expired or revoked')
            live = ctx.db.execute(text('SELECT g.user_id, g.session_version, u.session_version FROM oauth_grants g JOIN users u ON u.id=g.user_id WHERE g.id=:gid'), {'gid': ctx.connector.grant.id}).first()
            if not live or live[0] != ctx.connector.user.id or live[1] != live[2] or live[1] != ctx.connector.grant.session_version:
                raise ValueError('Test user connection was revoked or rotated; reconnect')
            yield account_context(ctx)
        return
    if not requires_synthetic():
        yield None
        return
    principal_id, grant_id = ctx.connector.user.id, ctx.connector.grant.id
    with account_lock(ctx.db, principal_id, shared=read_only):
        if not is_staging() and tool_name not in MANAGEMENT_TOOLS:
            raise ValueError('Staging deployment configuration is inconsistent; financial access refused.')
        live = ctx.db.execute(text('SELECT user_id FROM oauth_grants WHERE id=:gid'), {'gid': grant_id}).scalar()
        if live != principal_id:
            raise ValueError('This connection has been disconnected.')
        if tool_name in MANAGEMENT_TOOLS:
            try:
                yield None
            finally:
                # Key lookup/fixture construction can fail before a handler's
                # own try block. Audit completion must never commit partial setup.
                ctx.db.rollback()
            return
        row = binding(ctx.db, principal_id, grant_id)
        if row is None:
            raise ValueError('Staging financial access is locked. Call get_account_context, then setup_test_account. Actual financial records are never accessible.')
        status = account_context(ctx)
        synthetic_id = row.synthetic_id
        if not ctx.db.execute(text('SELECT id FROM users WHERE id=:uid AND is_synthetic=:flag'),
                              {'uid': synthetic_id, 'flag': True}).scalar():
            raise ValueError('Synthetic account is unavailable; access refused.')
        row.last_used_at = datetime.now(timezone.utc)
        ctx.db.commit()
        with synthetic_key(ctx.db, synthetic_id):
            try:
                ctx.active_user = ctx.db.get(User, synthetic_id)
                yield status
            finally:
                ctx.db.rollback()
                ctx.active_user = None


def delete_test_accounts(db, *, user_id=None, grant_id=_ALL_GRANTS):
    """Caller holds the principal lock and commits. No encrypted values are read."""
    from scaffold.user_deletion import delete_user
    query = db.query(MCPTestAccount)
    if user_id is not None:
        query = query.filter_by(user_id=user_id)
    if grant_id is not _ALL_GRANTS:
        query = query.filter_by(grant_id=grant_id)
    for row in query.all():
        synthetic_id = row.synthetic_id
        db.delete(row)
        db.flush()
        if db.execute(text('SELECT id FROM users WHERE id=:uid AND is_synthetic=:flag'),
                      {'uid': synthetic_id, 'flag': True}).scalar():
            delete_user(db, synthetic_id)


def prune_test_accounts(db):
    """Bound idle storage and remove any orphans left by a grant's FK cascade."""
    from scaffold.user_deletion import delete_user
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    rows = db.query(MCPTestAccount.id, MCPTestAccount.user_id).filter(MCPTestAccount.last_used_at < cutoff).all()
    removed = 0
    for rid, owner in rows:
        try:
            with account_lock(db, owner):
                row = db.query(MCPTestAccount).filter(MCPTestAccount.id == rid, MCPTestAccount.last_used_at < cutoff).first()
                if row:
                    delete_test_accounts(db, user_id=row.user_id, grant_id=row.grant_id)
                    db.commit()
                    removed += 1
        except ValueError:
            continue  # active call; next maintenance run retries
    for (uid,) in db.query(User.id).filter(User.is_synthetic.is_(True), ~User.id.in_(db.query(MCPTestAccount.synthetic_id)), ~User.id.in_(db.query(ReviewerAccount.user_id)), ~User.id.in_(db.query(InternalTestAccount.user_id))).all():
        delete_user(db, uid)
        removed += 1
    db.commit()
    return removed
