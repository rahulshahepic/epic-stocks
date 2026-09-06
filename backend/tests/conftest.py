import sys
import os
import pytest
from contextlib import contextmanager
from sqlalchemy import create_engine, event as sa_event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Enable encryption for tests using the two-level key hierarchy.
os.environ["KEY_ENCRYPTION_KEY"] = "74657374" * 8  # 64 hex chars = 32 bytes, test-only
os.environ["LEGACY_MASTER_KEY"] = "6c656761" * 8  # 64 hex chars = 32 bytes, test-only
os.environ["E2E_TEST"] = "1"

import database
from database import Base, get_db

TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@sa_event.listens_for(TEST_ENGINE, "connect")
def _fk(dbapi_conn, _):
    dbapi_conn.cursor().execute("PRAGMA foreign_keys=ON")


TestSession = sessionmaker(bind=TEST_ENGINE, autoflush=False, autocommit=False)

# Swap the engine so the app lifespan creates tables on the test engine
database.engine = TEST_ENGINE
database.SessionLocal.configure(bind=TEST_ENGINE)
database._is_sqlite = True  # advisory locks must be skipped in test environment

from main import app, _fastapi_app


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)
    # Settings read from the database are cached with a short TTL. The rows
    # they were read from have just been dropped, so a test that lands inside
    # that window would otherwise see the previous test's admin settings.
    from scaffold.oauth.settings import invalidate
    invalidate()


@pytest.fixture()
def db_session(setup_db):
    session = TestSession()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def client(db_session):
    def _override():
        try:
            yield db_session
        finally:
            pass

    _fastapi_app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    _fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def make_client(client):
    """
    Factory for additional TestClient instances that share the same DB session.
    Use in multi-user isolation tests where two separate authenticated sessions
    are needed simultaneously.

    Usage:
        def test_isolation(client, make_client):
            register_user(client, "a@test.com")
            with make_client("b@test.com") as client_b:
                resp = client_b.get("/api/grants")
                assert resp.json() == []
    """
    @contextmanager
    def _make(email, name="Test User"):
        with TestClient(app) as c:
            c.post("/api/auth/test-login", json={"email": email, "name": name})
            yield c

    return _make


@contextmanager
def user_key(user):
    """Put `user`'s data key in the encryption contextvar for the duration.

    Tests that seed rows straight through db_session bypass the request path,
    where EncryptionMiddleware sets the key. Encrypted columns fail closed
    without one, so wrap direct seeding (and any read of what was seeded) in
    this rather than letting the write land as plaintext.
    """
    from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key
    if encryption_enabled() and user.encrypted_key:
        set_current_key(decrypt_user_key(user.encrypted_key))
    try:
        yield
    finally:
        set_current_key(None)


def register_user(client, email="test@example.com", name="Test User"):
    """Log in as a user via the E2E test-login endpoint; sets the session cookie on client."""
    resp = client.post("/api/auth/test-login", json={"email": email, "name": name})
    assert resp.status_code == 200, f"test-login failed: {resp.text}"


@contextmanager
def push_transport(responder):
    """Intercept push sends one layer below requests.Session.

    Patching requests.post no longer reaches send_push: it hands pywebpush a
    GuardedPushSession (scaffold/push_transport.py), and the guard — the part
    that refuses to follow a redirect — lives in Session.request/Session.send.
    Replacing the HTTP adapter instead leaves all of that running, so a test
    sees exactly the requests that would have gone out on the wire.

    `responder(request, calls)` returns (status, headers, body) for each
    attempt; `calls` is the list of urllib3-level requests made so far, which
    is what a redirect test asserts on.
    """
    import io
    from unittest.mock import patch

    import requests
    import urllib3

    calls: list[str] = []

    def _send(self, request, **kwargs):
        calls.append(request.url)
        status, headers, body = responder(request, calls)
        resp = requests.Response()
        resp.status_code = status
        resp.reason = "Testing"
        resp.url = request.url
        resp.request = request
        headers = headers or {}
        resp.headers.update(headers)
        resp.raw = urllib3.HTTPResponse(
            body=io.BytesIO(body), headers=headers, status=status, preload_content=False
        )
        return resp

    with patch.object(requests.adapters.HTTPAdapter, "send", _send):
        yield calls
