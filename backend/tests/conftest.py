import sys
import os
import pytest
from sqlalchemy import create_engine, event as sa_event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Enable encryption and test-only auth endpoint for tests
os.environ["ENCRYPTION_MASTER_KEY"] = "test-master-key-for-encryption-tests"
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


def register_user(client, email="test@example.com"):
    """Register a test user via the E2E test-login endpoint (no OAuth required)."""
    resp = client.post("/api/auth/test-login", json={"email": email})
    assert resp.status_code == 200, f"test-login failed: {resp.text}"
    return resp.json()["access_token"]


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}
