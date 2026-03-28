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


@pytest.fixture()
def sentinel_path(tmp_path):
    """Redirect maintenance sentinel to a temp path in admin, maintenance module, and main."""
    p = tmp_path / "maintenance"
    import scaffold.routers.admin as admin_mod
    import scaffold.maintenance as maint_mod
    import main as main_mod
    orig_admin = admin_mod._SENTINEL
    orig_maint = maint_mod.SENTINEL_PATH
    orig_main = main_mod._MAINTENANCE_SENTINEL
    admin_mod._SENTINEL = p
    maint_mod.SENTINEL_PATH = p
    main_mod._MAINTENANCE_SENTINEL = p
    yield p
    admin_mod._SENTINEL = orig_admin
    maint_mod.SENTINEL_PATH = orig_maint
    main_mod._MAINTENANCE_SENTINEL = orig_main


@pytest.fixture()
def snapshot_path(tmp_path):
    """Redirect _SNAPSHOT_PATH in admin to a temp path."""
    p = tmp_path / "rotation_snapshot.json"
    import scaffold.routers.admin as admin_mod
    orig = admin_mod._SNAPSHOT_PATH
    admin_mod._SNAPSHOT_PATH = p
    yield p
    admin_mod._SNAPSHOT_PATH = orig


@pytest.fixture()
def key_override_path(tmp_path):
    """Redirect KEY_OVERRIDE_PATH in crypto to a temp path."""
    p = tmp_path / "current_master_key"
    import scaffold.crypto as c
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


def test_status_not_in_maintenance(client, sentinel_path):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["maintenance"] is False


def test_status_in_maintenance(client, sentinel_path):
    sentinel_path.touch()
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["maintenance"] is True


def test_middleware_blocks_financial_routes_during_maintenance(client, sentinel_path):
    """Financial API routes return 503 with no-store cache headers when sentinel is set."""
    token = register_user(client, "blocked@example.com")
    sentinel_path.touch()
    for path in ["/api/grants", "/api/loans", "/api/prices", "/api/events", "/api/sales"]:
        resp = client.get(path, headers=auth_header(token))
        assert resp.status_code == 503, f"GET {path} should be blocked"
        assert "no-store" in resp.headers.get("cache-control", "")


def test_middleware_blocks_mutating_methods_during_maintenance(client, sentinel_path):
    """POST/PUT/DELETE on financial routes are blocked — not just GET."""
    token = register_user(client, "mutate@example.com")
    sentinel_path.touch()
    assert client.post("/api/grants", json={}, headers=auth_header(token)).status_code == 503
    assert client.delete("/api/grants/1", headers=auth_header(token)).status_code == 503
    assert client.post("/api/sales", json={}, headers=auth_header(token)).status_code == 503


def test_middleware_blocks_delete_me_during_maintenance(client, sentinel_path):
    """DELETE /api/me (account deletion) is blocked — cascades into encrypted tables."""
    token = register_user(client, "selfdelete@example.com")
    sentinel_path.touch()
    assert client.delete("/api/me", headers=auth_header(token)).status_code == 503
    # GET /api/me must still work (needed for nav/auth checks)
    assert client.get("/api/me", headers=auth_header(token)).status_code == 200


def test_middleware_allows_auth_and_admin_during_maintenance(client, sentinel_path):
    """Auth, admin, health, status, and config pass through during maintenance."""
    sentinel_path.touch()
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/status").status_code == 200
    assert client.get("/api/config").status_code == 200
    # /api/auth/* returns 422 (missing body) not 503 — proves it passes through
    assert client.post("/api/auth/google", json={}).status_code != 503


def test_delete_user_blocked_during_maintenance(client, sentinel_path):
    sentinel_path.touch()
    other_token = register_user(client, "victim@example.com")
    # get victim's id
    with _admin_env():
        token = _register_admin(client)
        users_resp = client.get("/api/admin/users", headers=auth_header(token))
        victim_id = next(u["id"] for u in users_resp.json()["users"] if u["email"] == "victim@example.com")
        resp = client.delete(f"/api/admin/users/{victim_id}", headers=auth_header(token))
    assert resp.status_code == 503
    assert sentinel_path.exists()  # sentinel untouched by the failed delete


# ============================================================
# Key rotation — happy path
# ============================================================

def test_rotate_key_non_admin_forbidden(client, sentinel_path):
    token = register_user(client, "user@example.com")
    assert client.post("/api/admin/rotate-key", headers=auth_header(token)).status_code == 403


def test_rotate_key_no_encryption_emits_error(client, sentinel_path, snapshot_path, key_override_path):
    """When encryption is disabled, rotation emits an error event immediately."""
    with _admin_env():
        token = _register_admin(client)
    import scaffold.crypto as crypto_mod
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


def test_rotate_key_emits_done_event(client, sentinel_path, snapshot_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    steps = [e["step"] for e in events]
    assert "done" in steps
    assert "error" not in steps
    assert "rollback" not in steps


def test_rotate_key_rewraps_all_user_keys(client, sentinel_path, snapshot_path, key_override_path):
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


def test_rotate_key_clears_maintenance_sentinel(client, sentinel_path, snapshot_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)
        client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert not sentinel_path.exists()


def test_rotate_key_snapshot_written_and_cleaned_up(client, sentinel_path, snapshot_path, key_override_path):
    """Snapshot file is written before rotation and deleted on success."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))
    assert not snapshot_path.exists()


def test_rotate_key_writes_override_file(client, sentinel_path, snapshot_path, key_override_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))
    assert key_override_path.exists()
    assert len(key_override_path.read_text().strip()) > 0


def test_rotate_key_new_key_decrypts_user_keys(client, sentinel_path, snapshot_path, key_override_path):
    """After rotation the new master key correctly decrypts all user keys in the DB."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotate-key", headers=auth_header(token))
    assert any(e["step"] == "done" for e in _parse_sse(resp.text))

    new_master = key_override_path.read_text().strip()
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

def test_rotate_key_rollback_on_decrypt_failure(client, sentinel_path, snapshot_path, key_override_path):
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

    # Sentinel and snapshot must be cleared even after failure
    assert not sentinel_path.exists()
    assert not snapshot_path.exists()

    # Override file must NOT be written (rotation failed)
    assert not key_override_path.exists()

    # DB keys must be unchanged
    with TEST_ENGINE.connect() as conn:
        after = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()}
    assert before == after


# ============================================================
# Rotation status + restore
# ============================================================

def test_rotation_status_no_snapshot(client, sentinel_path, snapshot_path):
    """Status returns snapshot_exists=False when no snapshot file is present."""
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/rotation-status", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["snapshot_exists"] is False
    assert resp.json()["maintenance_active"] is False


def test_rotation_status_with_snapshot(client, sentinel_path, snapshot_path):
    """Status returns snapshot_exists=True when a snapshot file is present."""
    snapshot_path.write_text('{"1": "dummykey"}')
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/admin/rotation-status", headers=auth_header(token))
    assert resp.json()["snapshot_exists"] is True


def test_rotation_restore_no_snapshot_returns_404(client, sentinel_path, snapshot_path):
    with _admin_env():
        token = _register_admin(client)
        resp = client.post("/api/admin/rotation-restore", headers=auth_header(token))
    assert resp.status_code == 404


def test_rotation_restore_recovers_keys(client, sentinel_path, snapshot_path):
    """Restore endpoint writes snapshot keys back to DB and clears sentinel + snapshot."""
    # Register a regular user (their key will be corrupted; admin key stays intact)
    register_user(client, "victim2@example.com")

    with _admin_env():
        token = _register_admin(client)

    # Capture only the regular user's key
    with TEST_ENGINE.connect() as conn:
        rows = conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()
    # Separate admin from regular user
    admin_id = next(r[0] for r in rows if r[0] != rows[0][0] or True)  # all rows
    # Get non-admin user id
    with TEST_ENGINE.connect() as conn:
        victim_row = conn.execute(
            text("SELECT id, encrypted_key FROM users WHERE email = 'victim2@example.com'")
        ).fetchone()
    assert victim_row is not None
    victim_id, victim_key = victim_row[0], victim_row[1]

    import json as _json
    snapshot_path.write_text(_json.dumps({str(victim_id): victim_key}))
    sentinel_path.touch()

    # Corrupt only the victim's key to simulate partial rotation
    with TEST_ENGINE.connect() as conn:
        # Use valid-looking but wrong base64 so it's "wrong key" not "corrupt format"
        conn.execute(
            text("UPDATE users SET encrypted_key = :bad WHERE id = :id"),
            {"bad": victim_key[::-1], "id": victim_id},
        )
        conn.commit()

    with _admin_env():
        resp = client.post("/api/admin/rotation-restore", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["restored"] == 1

    # Snapshot and sentinel must be gone
    assert not snapshot_path.exists()
    assert not sentinel_path.exists()

    # Victim's key must be restored
    with TEST_ENGINE.connect() as conn:
        restored_key = conn.execute(
            text("SELECT encrypted_key FROM users WHERE id = :id"), {"id": victim_id}
        ).scalar()
    assert restored_key == victim_key
