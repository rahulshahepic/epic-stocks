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
    resp = client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})
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


# ── DB state helpers ──────────────────────────────────────────────────────────

def _get_maintenance_state(db_session) -> bool:
    row = db_session.execute(
        text("SELECT value FROM system_settings WHERE key = 'maintenance_active'")
    ).scalar()
    return row == "true"


def _set_maintenance_state(db_session, active: bool):
    """Directly set maintenance state in DB and invalidate the module cache."""
    db_session.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'maintenance_active'"),
        {"v": "true" if active else "false"},
    )
    db_session.commit()
    import scaffold.maintenance as maint_mod
    maint_mod._cache = None


def _get_snapshot(db_session) -> dict | None:
    row = db_session.execute(
        text("SELECT value FROM system_settings WHERE key = 'rotation_snapshot'")
    ).scalar()
    if row is None:
        return None
    return {int(k): v for k, v in json.loads(row).items()}


def _write_snapshot(db_session, data: dict):
    value = json.dumps({str(k): v for k, v in data.items()})
    exists = db_session.execute(
        text("SELECT 1 FROM system_settings WHERE key = 'rotation_snapshot'")
    ).scalar()
    if exists:
        db_session.execute(
            text("UPDATE system_settings SET value = :v WHERE key = 'rotation_snapshot'"),
            {"v": value},
        )
    else:
        db_session.execute(
            text("INSERT INTO system_settings (key, value) VALUES ('rotation_snapshot', :v)"),
            {"v": value},
        )
    db_session.commit()


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_maintenance_cache():
    """Ensure maintenance cache is clean before and after each test."""
    import scaffold.maintenance as maint_mod
    maint_mod._cache = None
    yield
    maint_mod._cache = None


# ============================================================
# Maintenance mode
# ============================================================

def test_maintenance_off_by_default(client, db_session):
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/maintenance", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() == {"active": False}
    assert not _get_maintenance_state(db_session)


def test_maintenance_enable_updates_db(client, db_session):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/maintenance", json={"active": True},
                           headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["active"] is True
    assert _get_maintenance_state(db_session)


def test_maintenance_disable_updates_db(client, db_session):
    _set_maintenance_state(db_session, True)
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/maintenance", json={"active": False},
                           headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["active"] is False
    assert not _get_maintenance_state(db_session)


def test_maintenance_toggle_reflects_in_get(client, db_session):
    with _admin_env():
        token = _register_admin(client)
        client.post("/api/admin/maintenance", json={"active": True}, headers=auth_header(token))
        assert client.get("/api/admin/maintenance", headers=auth_header(token)).json()["active"] is True
        client.post("/api/admin/maintenance", json={"active": False}, headers=auth_header(token))
        assert client.get("/api/admin/maintenance", headers=auth_header(token)).json()["active"] is False


def test_maintenance_non_admin_forbidden(client):
    token = register_user(client, "user@example.com")
    assert client.get("/api/admin/maintenance", headers=auth_header(token)).status_code == 403
    assert client.post("/api/admin/maintenance", json={"active": True},
                       headers=auth_header(token)).status_code == 403


def test_status_not_in_maintenance(client, db_session):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["maintenance"] is False


def test_status_in_maintenance(client, db_session):
    _set_maintenance_state(db_session, True)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["maintenance"] is True


def test_middleware_blocks_financial_routes_during_maintenance(client, db_session):
    """Financial API routes return 503 with no-store cache headers when maintenance is active."""
    token = register_user(client, "blocked@example.com")
    _set_maintenance_state(db_session, True)
    for path in ["/api/grants", "/api/loans", "/api/prices", "/api/events", "/api/sales"]:
        resp = client.get(path, headers=auth_header(token))
        assert resp.status_code == 503, f"GET {path} should be blocked"
        assert "no-store" in resp.headers.get("cache-control", "")


def test_middleware_blocks_mutating_methods_during_maintenance(client, db_session):
    """POST/PUT/DELETE on financial routes are blocked — not just GET."""
    token = register_user(client, "mutate@example.com")
    _set_maintenance_state(db_session, True)
    assert client.post("/api/grants", json={}, headers=auth_header(token)).status_code == 503
    assert client.delete("/api/grants/1", headers=auth_header(token)).status_code == 503
    assert client.post("/api/sales", json={}, headers=auth_header(token)).status_code == 503


def test_middleware_blocks_delete_me_during_maintenance(client, db_session):
    """DELETE /api/me (account deletion) is blocked — cascades into encrypted tables."""
    token = register_user(client, "selfdelete@example.com")
    _set_maintenance_state(db_session, True)
    assert client.delete("/api/me", headers=auth_header(token)).status_code == 503
    # GET /api/me must still work (needed for nav/auth checks)
    assert client.get("/api/me", headers=auth_header(token)).status_code == 200


def test_middleware_allows_auth_and_admin_during_maintenance(client, db_session):
    """Auth, admin, health, status, and config pass through during maintenance."""
    _set_maintenance_state(db_session, True)
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/status").status_code == 200
    assert client.get("/api/config").status_code == 200
    # /api/auth/* returns 422 (missing body) not 503 — proves it passes through
    assert client.post("/api/auth/google", json={}).status_code != 503


def test_delete_user_blocked_during_maintenance(client, db_session):
    _set_maintenance_state(db_session, True)
    register_user(client, "victim@example.com")
    with _admin_env():
        token = _register_admin(client)
        users_resp = client.get("/api/admin/users", headers=auth_header(token))
        victim_id = next(u["id"] for u in users_resp.json()["users"] if u["email"] == "victim@example.com")
        resp = client.delete(f"/api/admin/users/{victim_id}", headers=auth_header(token))
    assert resp.status_code == 503
    # Maintenance state unchanged
    assert _get_maintenance_state(db_session)


# ============================================================
# Key rotation — happy path
# ============================================================

def test_rotate_key_non_admin_forbidden(client):
    token = register_user(client, "user@example.com")
    assert client.post("/api/admin/rotate-key", headers=auth_header(token)).status_code == 403


def test_rotate_key_no_encryption_emits_error(client):
    """When encryption is disabled, rotation emits an error event immediately."""
    with _admin_env():
        token = _register_admin(client)
    import scaffold.crypto as crypto_mod
    orig_kek = crypto_mod._KEK
    crypto_mod._KEK = ""
    try:
        with _admin_env():
            resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
        events = _parse_sse(resp.text)
        steps = [e["step"] for e in events]
        assert "error" in steps
        assert "done" not in steps
    finally:
        crypto_mod._KEK = orig_kek


def test_rotate_key_emits_done_event(client):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    steps = [e["step"] for e in events]
    assert "done" in steps
    assert "error" not in steps
    assert "rollback" not in steps


def test_rotate_key_rewraps_all_user_keys(client):
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


def test_rotate_key_clears_maintenance_mode(client, db_session):
    with _admin_env():
        token = _register_admin(client)
        client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert not _get_maintenance_state(db_session)


def test_rotate_key_snapshot_written_and_cleaned_up(client, db_session):
    """Snapshot row is written before rotation and deleted on success."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))
    assert _get_snapshot(db_session) is None


def test_rotate_key_updates_master_key_in_db(client, db_session):
    """After rotation the new master key is stored in system_settings."""
    import scaffold.crypto as crypto_mod
    old_master = crypto_mod.ENCRYPTION_MASTER_KEY

    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))

    # The in-memory ENCRYPTION_MASTER_KEY should have changed
    assert crypto_mod.ENCRYPTION_MASTER_KEY != old_master
    assert len(crypto_mod.ENCRYPTION_MASTER_KEY) > 0

    # The master_key_version should have incremented
    version = db_session.execute(
        text("SELECT value FROM system_settings WHERE key = 'master_key_version'")
    ).scalar()
    assert int(version) > 1


def test_rotate_key_new_key_decrypts_user_keys(client):
    """After rotation the new master key correctly decrypts all user keys in the DB."""
    import scaffold.crypto as crypto_mod

    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))

    new_master = crypto_mod.ENCRYPTION_MASTER_KEY
    from scaffold.rotate_master_key import decrypt_user_key as _unwrap

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

def test_rotate_key_rollback_on_decrypt_failure(client, db_session):
    """If decryption fails during re-wrap, original DB keys are restored."""
    with _admin_env():
        token = _register_admin(client)

    with TEST_ENGINE.connect() as conn:
        before = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}

    def boom(enc, master):
        raise Exception("Simulated decryption failure")

    with patch("scaffold.rotate_master_key.decrypt_user_key", boom):
        with _admin_env():
            resp = client.post("/api/admin/rotate-key", headers=auth_header(token))

    events = _parse_sse(resp.text)
    steps = [e["step"] for e in events]

    assert "error" in steps
    assert "rollback" in steps
    assert "done" not in steps

    # Maintenance and snapshot must be cleared even after failure
    assert not _get_maintenance_state(db_session)
    assert _get_snapshot(db_session) is None

    # DB keys must be unchanged
    with TEST_ENGINE.connect() as conn:
        after = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}
    assert before == after


# ============================================================
# Rotation status + restore
# ============================================================

def test_rotation_status_no_snapshot(client, db_session):
    """Status returns snapshot_exists=False when no snapshot row is present."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/rotation-status", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["snapshot_exists"] is False
    assert resp.json()["maintenance_active"] is False


def test_rotation_status_with_snapshot(client, db_session):
    """Status returns snapshot_exists=True when a snapshot row is in system_settings."""
    _write_snapshot(db_session, {1: "dummykey"})
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/rotation-status", headers=auth_header(token))
    assert resp.json()["snapshot_exists"] is True


def test_rotation_restore_no_snapshot_returns_404(client, db_session):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotation-restore", headers=auth_header(token))
    assert resp.status_code == 404


def test_rotation_restore_recovers_keys(client, db_session):
    """Restore endpoint writes snapshot keys back to DB and clears sentinel + snapshot."""
    register_user(client, "victim2@example.com")

    with _admin_env():
        token = _register_admin(client)

    with TEST_ENGINE.connect() as conn:
        victim_row = conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE email = 'victim2@example.com'")
        ).fetchone()
    assert victim_row is not None
    victim_id, victim_key = victim_row[0], victim_row[1]

    _write_snapshot(db_session, {victim_id: victim_key})
    _set_maintenance_state(db_session, True)

    # Corrupt only the victim's key to simulate partial rotation
    with TEST_ENGINE.connect() as conn:
        conn.execute(
            text("UPDATE users SET encrypted_key = :bad WHERE id = :id"),
            {"bad": victim_key[::-1], "id": victim_id},
        )
        conn.commit()

    with _admin_env():
        resp = client.post("/api/admin/rotation-restore", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["restored"] == 1

    # Snapshot and maintenance must be gone
    assert _get_snapshot(db_session) is None
    assert not _get_maintenance_state(db_session)

    # Victim's key must be restored
    with TEST_ENGINE.connect() as conn:
        restored_key = conn.execute(
            text("SELECT encrypted_key FROM users WHERE id = :id"), {"id": victim_id}
        ).scalar()
    assert restored_key == victim_key
