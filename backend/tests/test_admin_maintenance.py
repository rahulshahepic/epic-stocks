"""Tests for maintenance mode and encryption key rotation admin endpoints."""
import json
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text
from tests.conftest import TEST_ENGINE, register_user, auth_header

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    from tests.conftest import _fake_google_info
    info = _fake_google_info(ADMIN_EMAIL)
    with patch("routers.auth_router.verify_google_token", return_value=info):
        resp = client.post("/api/auth/google", json={"token": "admin-token"})
    return resp.json()["access_token"]


def _parse_sse(body: str) -> list[dict]:
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


@pytest.fixture()
def sentinel_path(tmp_path):
    """Redirect _SENTINEL to a temp path."""
    p = tmp_path / "maintenance"
    import routers.admin as admin_mod
    orig = admin_mod._SENTINEL
    admin_mod._SENTINEL = p
    yield p
    admin_mod._SENTINEL = orig


@pytest.fixture()
def key_override_path(tmp_path):
    """Redirect KEY_OVERRIDE_PATH in crypto to a temp path."""
    p = tmp_path / "current_master_key"
    import crypto as c
    orig_path = c._KEY_OVERRIDE_PATH
    c._KEY_OVERRIDE_PATH = p
    yield p
    c._KEY_OVERRIDE_PATH = orig_path


# ============================================================
# Maintenance mode
# ============================================================

def test_maintenance_off_by_default(client, sentinel_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/maintenance", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() == {"active": False}
    assert not sentinel_path.exists()


def test_maintenance_enable_creates_sentinel(client, sentinel_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/maintenance", json={"active": True},
                           headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["active"] is True
    assert sentinel_path.exists()


def test_maintenance_disable_removes_sentinel(client, sentinel_path):
    sentinel_path.touch()
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/maintenance", json={"active": False},
                           headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["active"] is False
    assert not sentinel_path.exists()


def test_maintenance_toggle_reflects_in_get(client, sentinel_path):
    with _admin_env():
        token = _register_admin(client)
        client.post("/api/admin/maintenance", json={"active": True}, headers=auth_header(token))
        assert client.get("/api/admin/maintenance", headers=auth_header(token)).json()["active"] is True
        client.post("/api/admin/maintenance", json={"active": False}, headers=auth_header(token))
        assert client.get("/api/admin/maintenance", headers=auth_header(token)).json()["active"] is False


def test_maintenance_non_admin_forbidden(client, sentinel_path):
    token = register_user(client, "user@example.com")
    assert client.get("/api/admin/maintenance", headers=auth_header(token)).status_code == 403
    assert client.post("/api/admin/maintenance", json={"active": True},
                       headers=auth_header(token)).status_code == 403


# ============================================================
# Key rotation — happy path
# ============================================================

def test_rotate_key_non_admin_forbidden(client, sentinel_path):
    token = register_user(client, "user@example.com")
    assert client.post("/api/admin/rotate-key", headers=auth_header(token)).status_code == 403


def test_rotate_key_no_encryption_emits_error(client, sentinel_path, key_override_path):
    """When encryption is disabled, rotation emits an error event immediately."""
    with _admin_env():
        token = _register_admin(client)
    import crypto as crypto_mod
    orig = crypto_mod.ENCRYPTION_MASTER_KEY
    crypto_mod.ENCRYPTION_MASTER_KEY = ""
    try:
        with _admin_env():
            resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
        events = _parse_sse(resp.text)
        steps = [e["step"] for e in events]
        assert "error" in steps
        assert "done" not in steps
    finally:
        crypto_mod.ENCRYPTION_MASTER_KEY = orig


def test_rotate_key_emits_done_event(client, sentinel_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    steps = [e["step"] for e in events]
    assert "done" in steps
    assert "error" not in steps
    assert "rollback" not in steps


def test_rotate_key_rewraps_all_user_keys(client, sentinel_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)

    with TEST_ENGINE.connect() as conn:
        before = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}

    with _admin_env():
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))

    with TEST_ENGINE.connect() as conn:
        after = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}

    assert set(before.keys()) == set(after.keys())
    for uid in before:
        assert before[uid] != after[uid], f"Key for user {uid} was not re-wrapped"


def test_rotate_key_writes_override_file(client, sentinel_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))
    assert key_override_path.exists()
    assert len(key_override_path.read_text().strip()) > 0


def test_rotate_key_new_key_decrypts_user_keys(client, sentinel_path, key_override_path):
    """After rotation the new master key correctly decrypts all user keys in the DB."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))

    new_master = key_override_path.read_text().strip()
    from rotate_master_key import decrypt_user_key as _unwrap

    with TEST_ENGINE.connect() as conn:
        rows = conn.execute(
            text("SELECT encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()

    for (enc_key,) in rows:
        raw = _unwrap(enc_key, new_master)  # raises InvalidTag on wrong key
        assert len(raw) == 32


# ============================================================
# Key rotation — rollback on failure
# ============================================================

def test_rotate_key_rollback_on_decrypt_failure(client, sentinel_path, key_override_path):
    """If decryption fails during re-wrap, original DB keys are restored."""
    with _admin_env():
        token = _register_admin(client)

    with TEST_ENGINE.connect() as conn:
        before = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}

    # Patch decrypt_user_key inside rotate_master_key so the re-wrap phase fails.
    # The import inside event_stream() picks up the patched version.
    def boom(enc, master):
        raise Exception("Simulated decryption failure")

    with patch("rotate_master_key.decrypt_user_key", boom):
        with _admin_env():
            resp = client.post("/api/admin/rotate-key", headers=auth_header(token))

    events = _parse_sse(resp.text)
    steps = [e["step"] for e in events]

    assert "error" in steps
    assert "rollback" in steps
    assert "done" not in steps

    # Override file must NOT be written (rotation failed)
    assert not key_override_path.exists()

    # DB keys must be unchanged
    with TEST_ENGINE.connect() as conn:
        after = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()
        }
    assert before == after
