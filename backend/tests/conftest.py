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
os.environ["KEY_ENCRYPTION_KEY"] = "test-kek-for-tests-do-not-use-in-prod"
os.environ["LEGACY_MASTER_KEY"] = "test-master-key-for-encryption-tests"
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


def register_user(client, email="test@example.com", name="Test User"):
    """Log in as a user via the E2E test-login endpoint; sets the session cookie on client."""
    resp = client.post("/api/auth/test-login", json={"email": email, "name": name})
    assert resp.status_code == 200, f"test-login failed: {resp.text}"
