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


def test_date_of_birth_encrypted_at_rest(client):
    """date_of_birth is stored encrypted; API still returns ISO string."""
    register_user(client, "dob-enc@example.com")
    r = client.patch("/api/me/profile", json={"date_of_birth": "1985-06-15"})
    assert r.status_code == 200
    assert r.json()["date_of_birth"] == "1985-06-15"

    with TEST_ENGINE.connect() as conn:
        raw = conn.execute(text("SELECT date_of_birth FROM users ORDER BY id DESC LIMIT 1")).scalar()

    assert isinstance(raw, str), f"Expected encrypted string, got {type(raw)}: {raw}"
    assert raw.startswith("$ENC$"), f"date_of_birth not encrypted: {raw}"
    assert "1985" not in raw[5:]


def test_retirement_params_encrypted_at_rest(client):
    """retirement_params JSON blob is stored encrypted."""
    register_user(client, "ret-enc@example.com")
    params = {"epicExit": 3.5, "stockPct": 0.7, "ssMonthly": 2800}
    r = client.put("/api/retirement/params", json={"params": params})
    assert r.status_code == 200

    with TEST_ENGINE.connect() as conn:
        raw = conn.execute(text("SELECT retirement_params FROM users ORDER BY id DESC LIMIT 1")).scalar()

    assert isinstance(raw, str), f"Expected encrypted string, got {type(raw)}: {raw}"
    assert raw.startswith("$ENC$"), f"retirement_params not encrypted: {raw}"
    assert "epicExit" not in raw[5:]

    loaded = client.get("/api/retirement/params").json()["params"]
    assert loaded["epicExit"] == 3.5
    assert loaded["ssMonthly"] == 2800


def test_sale_actual_tax_paid_and_notes_encrypted_at_rest(client):
    """actual_tax_paid and notes on a sale record are stored encrypted."""
    register_user(client, "sale-enc@example.com")
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.0,
        "vest_start": "2021-03-01", "periods": 5,
        "exercise_date": "2020-12-31", "dp_shares": 0,
    })
    client.post("/api/prices", json={"effective_date": "2020-12-31", "price": 1.0})
    client.post("/api/prices", json={"effective_date": "2023-01-01", "price": 2.0})
    r = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 2.0,
        "notes": "secret note", "actual_tax_paid": 999.99,
    })
    assert r.status_code in (200, 201)

    with TEST_ENGINE.connect() as conn:
        row = conn.execute(text("SELECT notes, actual_tax_paid FROM sales ORDER BY id DESC LIMIT 1")).fetchone()

    notes_raw, tax_raw = row
    assert isinstance(notes_raw, str) and notes_raw.startswith("$ENC$"), f"notes not encrypted: {notes_raw}"
    assert "secret note" not in notes_raw[5:]
    assert isinstance(tax_raw, str) and tax_raw.startswith("$ENC$"), f"actual_tax_paid not encrypted: {tax_raw}"
    assert "999" not in tax_raw[5:]


def test_loan_payment_notes_encrypted_at_rest(client):
    """notes on a loan_payment record is stored encrypted."""
    register_user(client, "lpnotes-enc@example.com")
    client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 5000.0, "interest_rate": 3.0,
        "due_date": "2025-12-31",
    })
    loan_id = client.get("/api/loans").json()[0]["id"]
    r = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2024-01-15", "amount": 500.0, "notes": "private payment note",
    })
    assert r.status_code in (200, 201)

    with TEST_ENGINE.connect() as conn:
        raw = conn.execute(text("SELECT notes FROM loan_payments ORDER BY id DESC LIMIT 1")).scalar()

    assert isinstance(raw, str) and raw.startswith("$ENC$"), f"loan_payment notes not encrypted: {raw}"
    assert "private payment note" not in raw[5:]


def test_import_backup_data_json_encrypted_at_rest(client):
    """ImportBackup.data_json snapshot is stored encrypted."""
    import io
    register_user(client, "backup-enc@example.com")
    with open("/home/user/epic-stocks/test_data/fixture.xlsx", "rb") as f:
        data = f.read()
    # First import: seeds data, no backup yet (nothing to back up)
    r = client.post(
        "/api/import/excel",
        files={"file": ("fixture.xlsx", io.BytesIO(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code in (200, 201)
    # Second import: previous data is backed up before being overwritten
    r = client.post(
        "/api/import/excel",
        files={"file": ("fixture.xlsx", io.BytesIO(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code in (200, 201)

    with TEST_ENGINE.connect() as conn:
        raw = conn.execute(text("SELECT data_json FROM import_backups ORDER BY id DESC LIMIT 1")).scalar()

    assert raw is not None, "Expected a backup row after second import"
    assert isinstance(raw, str) and raw.startswith("$ENC$"), f"import backup data_json not encrypted: {raw}"
