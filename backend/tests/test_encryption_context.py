"""Encryption must reach every authenticated path, and fail loudly when it cannot.

Two failures used to compound. The key was set in the get_current_user
dependency, which FastAPI runs in a threadpool that gets a *copy* of the
context — so only the cookie path worked, because EncryptionMiddleware set the
key in the ASGI context first. A native shell sends a Bearer token and no
cookie, so its requests ran keyless. And keyless was silent: writes stored
plaintext, and reads of real ciphertext returned 0.0. A native user's financial
data went to disk unencrypted and their own reads came back as zeros.
"""
import sys
import os

import pytest
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.crypto import (
    EncryptionKeyMissing,
    EncryptedFloat,
    EncryptedInt,
    EncryptedString,
    EncryptedJSON,
    EncryptedDate,
    encryption_enabled,
    encrypt_value,
    set_current_key,
    generate_user_key,
)
from scaffold.models import User
from tests.conftest import register_user


PRICE = {"effective_date": "2024-01-01", "price": 12.5}


def _bearer_only(client, email="native@example.com"):
    """Authenticate, then drop the cookie so only the Bearer token remains."""
    register_user(client, email)
    token = client.cookies.get("session")
    assert token
    client.cookies.clear()
    return {"Authorization": f"Bearer {token}"}


# ── The Bearer path must encrypt ────────────────────────────────────────────

def test_bearer_write_is_stored_encrypted(client, db_session):
    headers = _bearer_only(client)

    assert client.post("/api/prices", json=PRICE, headers=headers).status_code == 201

    raw = db_session.execute(text("SELECT price FROM prices")).scalar()
    assert str(raw).startswith("$ENC$"), f"Bearer request stored plaintext: {raw!r}"


def test_bearer_reads_back_what_the_cookie_path_wrote(client):
    """The two transports must agree: same account, same key, same numbers."""
    register_user(client, "native@example.com")
    assert client.post("/api/prices", json=PRICE).status_code == 201
    token = client.cookies.get("session")
    client.cookies.clear()

    resp = client.get("/api/prices", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()[0]["price"] == 12.5


def test_cookie_path_still_encrypts(client, db_session):
    register_user(client)
    assert client.post("/api/prices", json=PRICE).status_code == 201

    raw = db_session.execute(text("SELECT price FROM prices")).scalar()
    assert str(raw).startswith("$ENC$")


def test_grant_round_trips_over_bearer(client, db_session):
    """Grants carry EncryptedInt as well as EncryptedFloat."""
    headers = _bearer_only(client)
    body = {
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2022-03-01", "periods": 3,
        "exercise_date": "2031-12-31", "dp_shares": 0,
    }
    assert client.post("/api/grants", json=body, headers=headers).status_code == 201

    raw_shares = db_session.execute(text("SELECT shares FROM grants")).scalar()
    assert str(raw_shares).startswith("$ENC$")
    assert client.get("/api/grants", headers=headers).json()[0]["shares"] == 1000


def test_an_invalid_bearer_token_sets_no_key(client, db_session):
    """A forged token must not leave some other user's key in context."""
    register_user(client)
    client.post("/api/prices", json=PRICE)
    client.cookies.clear()

    resp = client.get("/api/prices", headers={"Authorization": "Bearer not.a.token"})

    assert resp.status_code == 401


# ── Fail closed ─────────────────────────────────────────────────────────────

@pytest.mark.skipif(not encryption_enabled(), reason="encryption not configured")
@pytest.mark.parametrize("column,value", [
    (EncryptedFloat(), 12.5),
    (EncryptedInt(), 1000),
    (EncryptedString(), "notes"),
    (EncryptedJSON(), {"a": 1}),
    (EncryptedDate(), "2024-01-01"),
])
def test_write_without_a_key_raises_rather_than_storing_plaintext(column, value):
    set_current_key(None)
    with pytest.raises(EncryptionKeyMissing):
        column.process_bind_param(value, None)


@pytest.mark.parametrize("column,placeholder", [
    (EncryptedFloat(), 0.0),
    (EncryptedInt(), 0),
    (EncryptedString(), None),
    (EncryptedJSON(), None),
    (EncryptedDate(), None),
])
def test_read_of_ciphertext_without_a_key_raises_rather_than_a_placeholder(column, placeholder):
    """The old behaviour returned `placeholder`, indistinguishable from real data."""
    ciphertext = encrypt_value("12.5", generate_user_key())
    set_current_key(None)

    with pytest.raises(EncryptionKeyMissing):
        column.process_result_value(ciphertext, None)


def test_plaintext_rows_still_read_without_a_key():
    """Databases predating KEY_ENCRYPTION_KEY must stay readable."""
    set_current_key(None)
    assert EncryptedFloat().process_result_value("12.5", None) == 12.5
    assert EncryptedInt().process_result_value("1000", None) == 1000
    assert EncryptedString().process_result_value("notes", None) == "notes"


def test_none_is_never_encrypted_or_rejected():
    set_current_key(None)
    for column in (EncryptedFloat(), EncryptedInt(), EncryptedString(),
                   EncryptedJSON(), EncryptedDate()):
        assert column.process_bind_param(None, None) is None
        assert column.process_result_value(None, None) is None


# ── No user may be created without a key ────────────────────────────────────

@pytest.mark.skipif(not encryption_enabled(), reason="encryption not configured")
def test_a_user_row_always_gets_a_data_key(db_session):
    """The column default covers every creation path, not just the login ones."""
    user = User(email="direct@example.com", google_id="g-direct", name="Direct")
    db_session.add(user)
    db_session.commit()

    assert user.encrypted_key


@pytest.mark.skipif(not encryption_enabled(), reason="encryption not configured")
def test_login_provisions_a_key_for_a_pre_encryption_account(client, db_session):
    """An account created before encryption was switched on gets a key on next login."""
    register_user(client, "legacy@example.com")
    user = db_session.query(User).filter(User.email == "legacy@example.com").first()
    db_session.execute(
        text("UPDATE users SET encrypted_key = NULL WHERE id = :uid"), {"uid": user.id}
    )
    db_session.commit()
    db_session.expire_all()

    register_user(client, "legacy@example.com")

    db_session.expire_all()
    user = db_session.query(User).filter(User.email == "legacy@example.com").first()
    assert user.encrypted_key
    assert client.post("/api/prices", json=PRICE).status_code == 201
