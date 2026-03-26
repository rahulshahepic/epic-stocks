"""Tests for backend/rotate_master_key.py"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

# Keep the app's master key for conftest compatibility; the rotation script
# has its own standalone crypto helpers and does not read ENCRYPTION_MASTER_KEY.
from tests.conftest import TEST_ENGINE, register_user, auth_header

from rotate_master_key import (
    encrypt_user_key,
    decrypt_user_key,
    encrypt_value,
    decrypt_value,
    rotate_master,
    encrypt_plaintext,
    ENCRYPTED_COLUMNS,
    _ENC_PREFIX,
)

OLD_MASTER = "old-master-key-for-rotation-tests"
NEW_MASTER = "new-master-key-for-rotation-tests"


# ---------------------------------------------------------------------------
# Unit tests: standalone crypto helpers
# ---------------------------------------------------------------------------

def test_encrypt_decrypt_user_key_roundtrip():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = AESGCM.generate_key(bit_length=256)
    wrapped = encrypt_user_key(raw, OLD_MASTER)
    assert wrapped != raw.hex()
    assert decrypt_user_key(wrapped, OLD_MASTER) == raw


def test_encrypt_user_key_different_nonces():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = AESGCM.generate_key(bit_length=256)
    w1 = encrypt_user_key(raw, OLD_MASTER)
    w2 = encrypt_user_key(raw, OLD_MASTER)
    assert w1 != w2  # random nonce


def test_decrypt_user_key_wrong_master_fails():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = AESGCM.generate_key(bit_length=256)
    wrapped = encrypt_user_key(raw, OLD_MASTER)
    with pytest.raises(Exception):
        decrypt_user_key(wrapped, NEW_MASTER)


def test_encrypt_decrypt_value_roundtrip():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = AESGCM.generate_key(bit_length=256)
    ct = encrypt_value("19900.0", key)
    assert ct.startswith(_ENC_PREFIX)
    assert decrypt_value(ct, key) == "19900.0"


def test_decrypt_value_wrong_key_fails():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    k1 = AESGCM.generate_key(bit_length=256)
    k2 = AESGCM.generate_key(bit_length=256)
    with pytest.raises(Exception):
        decrypt_value(encrypt_value("secret", k1), k2)


# ---------------------------------------------------------------------------
# Helpers: build an isolated SQLite DB for migration tests
# ---------------------------------------------------------------------------

def _make_engine():
    """Fresh in-memory SQLite engine with the schema from TEST_ENGINE."""
    from database import Base
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine


def _seed_user(conn, user_id: int, email: str, enc_key: str | None = None):
    conn.execute(
        text(
            "INSERT INTO users (id, email, google_id, name, encrypted_key, created_at) "
            "VALUES (:id, :email, :gid, :name, :ek, datetime('now'))"
        ),
        {"id": user_id, "email": email, "gid": f"gid-{user_id}", "name": email, "ek": enc_key},
    )


def _seed_grant(conn, user_id: int, shares_val: str, price_val: str, dp_val: str):
    conn.execute(
        text(
            "INSERT INTO grants (user_id, year, type, shares, price, vest_start, "
            "periods, exercise_date, dp_shares) "
            "VALUES (:uid, 2020, 'Purchase', :s, :p, '2021-01-01', 5, '2020-12-31', :dp)"
        ),
        {"uid": user_id, "s": shares_val, "p": price_val, "dp": dp_val},
    )


# ---------------------------------------------------------------------------
# rotate_master tests
# ---------------------------------------------------------------------------

def test_rotate_master_rewraps_user_keys():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    engine = _make_engine()
    raw_key = AESGCM.generate_key(bit_length=256)
    old_enc_key = encrypt_user_key(raw_key, OLD_MASTER)

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", old_enc_key)

    rotate_master(engine, OLD_MASTER, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()

    new_enc_key = row[0]
    assert new_enc_key != old_enc_key
    # Decryptable with new master, not old
    assert decrypt_user_key(new_enc_key, NEW_MASTER) == raw_key
    with pytest.raises(Exception):
        decrypt_user_key(new_enc_key, OLD_MASTER)


def test_rotate_master_dry_run_no_changes():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    engine = _make_engine()
    raw_key = AESGCM.generate_key(bit_length=256)
    old_enc_key = encrypt_user_key(raw_key, OLD_MASTER)

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", old_enc_key)

    rotate_master(engine, OLD_MASTER, NEW_MASTER, dry_run=True)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()

    # Key unchanged — dry run made no writes
    assert row[0] == old_enc_key


def test_rotate_master_multiple_users():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    engine = _make_engine()
    keys = [AESGCM.generate_key(bit_length=256) for _ in range(3)]

    with engine.begin() as conn:
        for i, raw in enumerate(keys, start=1):
            _seed_user(conn, i, f"user{i}@example.com", encrypt_user_key(raw, OLD_MASTER))

    rotate_master(engine, OLD_MASTER, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, encrypted_key FROM users ORDER BY id")).fetchall()

    for i, (uid, enc_key) in enumerate(rows):
        assert decrypt_user_key(enc_key, NEW_MASTER) == keys[i]


def test_rotate_master_wrong_old_key_raises():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    engine = _make_engine()
    raw_key = AESGCM.generate_key(bit_length=256)

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", encrypt_user_key(raw_key, OLD_MASTER))

    with pytest.raises(SystemExit):
        rotate_master(engine, "wrong-old-master", NEW_MASTER, dry_run=False)


def test_rotate_master_skips_users_without_key():
    """Users with NULL encrypted_key are silently skipped."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    engine = _make_engine()
    raw_key = AESGCM.generate_key(bit_length=256)

    with engine.begin() as conn:
        _seed_user(conn, 1, "has-key@example.com", encrypt_user_key(raw_key, OLD_MASTER))
        _seed_user(conn, 2, "no-key@example.com", None)

    rotate_master(engine, OLD_MASTER, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, encrypted_key FROM users ORDER BY id")
        ).fetchall()

    assert decrypt_user_key(rows[0][1], NEW_MASTER) == raw_key
    assert rows[1][1] is None  # untouched


# ---------------------------------------------------------------------------
# encrypt_plaintext tests
# ---------------------------------------------------------------------------

def test_encrypt_plaintext_creates_user_key():
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)  # no key

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()

    assert row[0] is not None
    raw = decrypt_user_key(row[0], NEW_MASTER)
    assert len(raw) == 32


def test_encrypt_plaintext_encrypts_grant_columns():
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)
        _seed_grant(conn, 1, "10000", "1.99", "500")

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT shares, price, dp_shares FROM grants")).fetchone()

    assert row[0].startswith(_ENC_PREFIX)
    assert row[1].startswith(_ENC_PREFIX)
    assert row[2].startswith(_ENC_PREFIX)


def test_encrypt_plaintext_values_decrypt_correctly():
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)
        _seed_grant(conn, 1, "10000", "1.99", "500")

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        user_row = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()
        grant_row = conn.execute(text("SELECT shares, price FROM grants")).fetchone()

    raw_key = decrypt_user_key(user_row[0], NEW_MASTER)
    assert decrypt_value(grant_row[0], raw_key) == "10000"
    assert decrypt_value(grant_row[1], raw_key) == "1.99"


def test_encrypt_plaintext_idempotent():
    """Running encrypt twice does not double-encrypt already-encrypted values."""
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)
        _seed_grant(conn, 1, "10000", "1.99", "500")

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        first_shares = conn.execute(text("SELECT shares FROM grants")).fetchone()[0]

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        second_shares = conn.execute(text("SELECT shares FROM grants")).fetchone()[0]

    # Value still decrypts correctly; we check it's a valid encrypted string
    with engine.connect() as conn:
        enc_key = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()[0]
    raw_key = decrypt_user_key(enc_key, NEW_MASTER)
    assert decrypt_value(second_shares, raw_key) == "10000"


def test_encrypt_plaintext_dry_run_no_changes():
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)
        _seed_grant(conn, 1, "10000", "1.99", "500")

    encrypt_plaintext(engine, NEW_MASTER, dry_run=True)

    with engine.connect() as conn:
        user_row = conn.execute(text("SELECT encrypted_key FROM users WHERE id = 1")).fetchone()
        grant_row = conn.execute(text("SELECT shares FROM grants")).fetchone()

    assert user_row[0] is None            # key not written
    assert not grant_row[0].startswith(_ENC_PREFIX)  # data not encrypted


def test_encrypt_plaintext_null_columns_left_null():
    """Nullable encrypted columns that are NULL should remain NULL."""
    engine = _make_engine()

    with engine.begin() as conn:
        _seed_user(conn, 1, "alice@example.com", None)
        # Insert a sale with NULL tax overrides
        conn.execute(
            text(
                "INSERT INTO sales (user_id, date, shares, price_per_share, notes, version) "
                "VALUES (1, '2024-01-01', 100, '50.0', '', 1)"
            )
        )

    encrypt_plaintext(engine, NEW_MASTER, dry_run=False)

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT federal_income_rate FROM sales WHERE user_id = 1")
        ).fetchone()

    assert row[0] is None
