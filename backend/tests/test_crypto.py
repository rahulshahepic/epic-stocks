"""Tests for per-user column-level encryption."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch
from tests.conftest import register_user, TEST_ENGINE

from sqlalchemy import text


# ============================================================
# Unit tests for crypto module
# ============================================================

def test_generate_and_roundtrip_user_key():
    from scaffold.crypto import generate_user_key, encrypt_user_key, decrypt_user_key
    raw = generate_user_key()
    assert len(raw) == 32
    encrypted = encrypt_user_key(raw)
    assert encrypted != raw
    decrypted = decrypt_user_key(encrypted)
    assert decrypted == raw


def test_encrypt_decrypt_value():
    from scaffold.crypto import generate_user_key, encrypt_value, decrypt_value, _ENC_PREFIX
    key = generate_user_key()
    plaintext = "19900.0"
    ct = encrypt_value(plaintext, key)
    assert ct.startswith(_ENC_PREFIX)
    assert plaintext not in ct
    assert decrypt_value(ct, key) == plaintext


def test_different_nonces_produce_different_ciphertexts():
    from scaffold.crypto import generate_user_key, encrypt_value
    key = generate_user_key()
    ct1 = encrypt_value("100", key)
    ct2 = encrypt_value("100", key)
    assert ct1 != ct2  # Random nonce → different ciphertext each time


def test_wrong_key_fails():
    import pytest
    from scaffold.crypto import generate_user_key, encrypt_value, decrypt_value
    key1 = generate_user_key()
    key2 = generate_user_key()
    ct = encrypt_value("secret", key1)
    with pytest.raises(Exception):
        decrypt_value(ct, key2)


def test_encryption_enabled():
    from scaffold.crypto import encryption_enabled
    assert encryption_enabled() is True  # KEY_ENCRYPTION_KEY set in conftest


# ============================================================
# Integration: verify data is encrypted in SQLite
# ============================================================

def test_grant_data_encrypted_at_rest(client):
    """Verify that sensitive fields are stored as encrypted strings in the DB, not plaintext."""
    register_user(client, "encrypt-test@example.com")
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.99,
        "vest_start": "2021-03-01", "periods": 5,
        "exercise_date": "2020-12-31", "dp_shares": -500,
    })

    # Read raw DB values bypassing ORM
    with TEST_ENGINE.connect() as conn:
        row = conn.execute(text("SELECT shares, price, dp_shares FROM grants LIMIT 1")).fetchone()

    shares_raw, price_raw, dp_raw = row
    # Values should be encrypted strings, not plaintext numbers
    assert isinstance(shares_raw, str), f"Expected encrypted string, got {type(shares_raw)}: {shares_raw}"
    assert shares_raw.startswith("$ENC$"), f"shares not encrypted: {shares_raw}"
    assert isinstance(price_raw, str) and price_raw.startswith("$ENC$")
    assert isinstance(dp_raw, str) and dp_raw.startswith("$ENC$")
    # The plaintext value should NOT appear in the encrypted string
    assert "10000" not in shares_raw[5:]  # Skip prefix, check base64 doesn't contain plaintext


def test_loan_data_encrypted_at_rest(client):
    register_user(client, "loan-enc@example.com")
    client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 19900.0, "interest_rate": 3.5,
        "due_date": "2025-12-31", "loan_number": "SECRET-123",
    })

    with TEST_ENGINE.connect() as conn:
        row = conn.execute(text("SELECT amount, interest_rate, loan_number FROM loans LIMIT 1")).fetchone()

    assert row[0].startswith("$ENC$"), f"amount not encrypted: {row[0]}"
    assert row[1].startswith("$ENC$"), f"interest_rate not encrypted: {row[1]}"
    assert row[2].startswith("$ENC$"), f"loan_number not encrypted: {row[2]}"


def test_price_data_encrypted_at_rest(client):
    register_user(client, "price-enc@example.com")
    client.post("/api/prices", json={
        "effective_date": "2020-12-31", "price": 1.99,
    })

    with TEST_ENGINE.connect() as conn:
        row = conn.execute(text("SELECT price FROM prices LIMIT 1")).fetchone()

    assert row[0].startswith("$ENC$"), f"price not encrypted: {row[0]}"


def test_user_has_encrypted_key(client):
    """New users get an encryption key when ENCRYPTION_MASTER_KEY is set."""
    register_user(client, "key-test@example.com")

    with TEST_ENGINE.connect() as conn:
        row = conn.execute(text("SELECT encrypted_key FROM users LIMIT 1")).fetchone()

    assert row[0] is not None, "User should have an encrypted_key"
    assert len(row[0]) > 20, "encrypted_key should be a substantial base64 string"


def test_different_users_different_keys(client, make_client):
    """Each user gets a unique encryption key."""
    register_user(client, "user1@example.com")
    with make_client("user2@example.com"):
        pass

    with TEST_ENGINE.connect() as conn:
        rows = conn.execute(text("SELECT encrypted_key FROM users ORDER BY id")).fetchall()

    assert len(rows) == 2
    assert rows[0][0] != rows[1][0], "Users should have different encryption keys"


def test_api_returns_decrypted_values(client):
    """Verify the API transparently decrypts data for the authenticated user."""
    register_user(client, "decrypt-api@example.com")
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.99,
        "vest_start": "2021-03-01", "periods": 5,
        "exercise_date": "2020-12-31", "dp_shares": -500,
    })

    resp = client.get("/api/grants")
    grant = resp.json()[0]
    assert grant["shares"] == 10000
    assert grant["price"] == 1.99
    assert grant["dp_shares"] == -500
