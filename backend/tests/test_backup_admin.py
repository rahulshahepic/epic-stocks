"""Admin settings cross the file handoff; storage credentials never cross into the app."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from services import backup_admin
from services.backup_protocol import destination_id, read_json, revision, safe_status, validate_settings

SETTINGS = {"enabled": True, "account_id": "a" * 32, "bucket": "test-staging-backups",
            "recipient": "age1" + "q" * 58, "retention_days": 30}
RUN = "20261114T031700Z"


@pytest.fixture()
def host_settings(tmp_path, monkeypatch):
    directory = tmp_path / "settings"
    directory.mkdir()
    snapshot = tmp_path / "host.json"
    monkeypatch.setenv("BACKUP_SETTINGS_DIR", str(directory))
    monkeypatch.setenv("DIAGNOSTICS_HOST_FILE", str(snapshot))
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    return directory, snapshot


def admin_login(client):
    assert client.post("/api/auth/test-login", json={"email": "admin@example.com"}).status_code == 200


def observed(path, settings=None, **changes):
    now = datetime.now(timezone.utc).isoformat()
    document = {"version": 1, "environment": "staging", **(settings or SETTINGS)}
    backup = {"environment": "staging", "configured": True, "credentials_configured": True,
              "enabled": True, "last_result": "success", "last_attempt_utc": now, "last_success_utc": now,
              "last_success_run": RUN, "settings_revision": revision(document), "settings": document,
              "database_plaintext_bytes": 1000, "database_encrypted_bytes": 1200,
              "secrets_encrypted_bytes": 300, "duration_seconds": 2.5, "last_success_duration_seconds": 2.5,
              "backup_destination_id": destination_id(document), **changes}
    path.write_text(json.dumps({"environment": "staging", "collected_at_utc": now, "backup": backup}))
    return backup


@pytest.mark.parametrize("method,path,body", [("GET", "", None), ("PUT", "/settings", SETTINGS),
                                               ("POST", "/run", None), ("POST", "/restore-test", {"run_id": RUN, "confirmed": True})])
def test_every_backup_endpoint_requires_admin(client, host_settings, method, path, body):
    assert client.request(method, "/api/admin/backups" + path, json=body).status_code == 401
    client.post("/api/auth/test-login", json={"email": "regular@example.com"})
    assert client.request(method, "/api/admin/backups" + path, json=body).status_code == 403
    assert list(host_settings[0].iterdir()) == []


def test_unconfigured_read_is_safe_and_controls_require_installation(client, host_settings, monkeypatch):
    admin_login(client)
    monkeypatch.delenv("BACKUP_SETTINGS_DIR")
    response = client.get("/api/admin/backups")
    assert response.status_code == 200
    assert response.json()["state"] == "unavailable"
    assert response.json()["settings"]["enabled"] is False
    assert response.json()["controls_available"] is False
    assert client.put("/api/admin/backups/settings", json=SETTINGS).status_code == 503


def test_save_is_atomic_environment_scoped_and_optimistic(client, host_settings):
    directory, snapshot = host_settings
    admin_login(client)
    first = client.put("/api/admin/backups/settings", json=SETTINGS)
    assert first.status_code == 200
    document = read_json(directory / "settings.json")
    assert validate_settings(document, "staging") == document
    assert oct((directory / "settings.json").stat().st_mode & 0o777) == "0o600"
    rev = first.json()["revision"]
    assert client.put("/api/admin/backups/settings", json={**SETTINGS, "retention_days": 7}).status_code == 409
    assert read_json(directory / "settings.json") == document
    observed(snapshot, settings_revision=None)
    assert client.get("/api/admin/backups").json()["state"] == "pending"
    observed(snapshot)
    assert client.get("/api/admin/backups").json()["state"] == "succeeded"
    changed = client.put("/api/admin/backups/settings", json={**SETTINGS, "enabled": False, "expected_revision": rev})
    assert changed.status_code == 200
    assert read_json(directory / "settings.json")["enabled"] is False
    assert client.post("/api/admin/backups/run").status_code == 400


@pytest.mark.parametrize("changes", [{"account_id": "http://127.0.0.1"}, {"bucket": "../../escape"},
                                      {"recipient": "AGE-SECRET-KEY-1private"}, {"retention_days": 0},
                                      {"enabled": "true"}, {"secret_access_key": "DO-NOT-STORE"},
                                      {"endpoint": "https://attacker.example"}])
def test_invalid_or_secret_settings_never_reach_handoff(client, host_settings, changes):
    admin_login(client)
    response = client.put("/api/admin/backups/settings", json={**SETTINGS, **changes})
    assert response.status_code in (400, 422)
    assert not (host_settings[0] / "settings.json").exists()


def test_request_is_fixed_file_and_restore_needs_explicit_confirmation(client, host_settings):
    directory, snapshot = host_settings
    admin_login(client)
    client.put("/api/admin/backups/settings", json=SETTINGS)
    observed(snapshot)
    assert client.post("/api/admin/backups/run").json() == {"queued": True}
    assert set(read_json(directory / "request.json")) == {"requested_at_utc"}
    assert client.post("/api/admin/backups/restore-test", json={"run_id": RUN, "confirmed": False}).status_code == 400
    assert not (directory / "restore-test.json").exists()
    assert client.post("/api/admin/backups/restore-test", json={"run_id": "20260101T000000Z", "confirmed": True}).status_code == 400
    result = client.post("/api/admin/backups/restore-test", json={"run_id": RUN, "confirmed": True})
    assert result.status_code == 200
    assert result.json()["restore_test"]["source"] == "admin_recorded"
    rev = client.get("/api/admin/backups").json()["revision"]
    client.put("/api/admin/backups/settings", json={**SETTINGS, "bucket": "different-bucket", "expected_revision": rev})
    assert client.get("/api/admin/backups").json()["restore_test"] is None


def test_stale_or_wrong_environment_never_looks_healthy(client, host_settings):
    _, path = host_settings
    admin_login(client)
    observed(path)
    content = read_json(path)
    content["collected_at_utc"] = (datetime.now(timezone.utc) - timedelta(minutes=4)).isoformat()
    path.write_text(json.dumps(content))
    assert client.get("/api/admin/backups").json()["backup"] is None
    observed(path)
    content = read_json(path)
    content["environment"] = "production"
    path.write_text(json.dumps(content))
    assert client.get("/api/admin/backups").json()["state"] == "unavailable"


def test_status_only_contains_bounded_allowlisted_fields(client, host_settings):
    admin_login(client)
    observed(host_settings[1], error="PUT failed: HTTP 403 AccessDenied", prune_error="secret-token",
             secret_access_key="secret-token", exception="secret-token", duration_seconds=float("inf"))
    response = client.get("/api/admin/backups")
    assert response.status_code == 200
    data = response.json()["backup"]
    assert data["error"] == "Backup storage returned HTTP 403."
    assert data["duration_seconds"] is None
    assert "secret-token" not in response.text
    assert safe_status(data, "staging") == data


def test_handoff_rejects_symlinks_and_oversized_files(host_settings, tmp_path):
    directory, _ = host_settings
    target = tmp_path / "secret"
    target.write_text("secret-token")
    (directory / "settings.json").symlink_to(target)
    assert backup_admin.status()["state"] == "invalid_settings"
    with pytest.raises(OSError):
        read_json(directory / "settings.json")
    (directory / "settings.json").unlink()
    (directory / "settings.json").write_text("x" * 8193)
    assert backup_admin.status()["state"] == "invalid_settings"
