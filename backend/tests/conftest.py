import sys
import os

os.environ["TESTING"] = "1"

import pytest
from unittest.mock import patch
from sqlalchemy import create_engine, event as sa_event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import Base, get_db
from main import app

TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@sa_event.listens_for(TEST_ENGINE, "connect")
def _fk(dbapi_conn, _):
    dbapi_conn.cursor().execute("PRAGMA foreign_keys=ON")


TestSession = sessionmaker(bind=TEST_ENGINE, autoflush=False, autocommit=False)

_user_counter = 0


@pytest.fixture(autouse=True)
def setup_db():
    global _user_counter
    _user_counter = 0
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

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _fake_google_info(email):
    global _user_counter
    _user_counter += 1
    return {
        "sub": f"google-id-{_user_counter}",
        "email": email,
        "email_verified": "true",
        "name": f"Test User {_user_counter}",
        "picture": "",
        "aud": "",
    }


def register_user(client, email="test@example.com"):
    with patch("routers.auth_router.verify_google_token", return_value=_fake_google_info(email)):
        resp = client.post("/api/auth/google", json={"token": "fake-google-token"})
    return resp.json()["access_token"]


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}
