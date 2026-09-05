import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _report(**over):
    body = {"message": "The dashboard is blank after I sign in"}
    body.update(over)
    return body


# ============================================================
# SUBMISSION — anyone, signed in or not
# ============================================================

def test_anonymous_can_report(client):
    resp = client.post("/api/report", json=_report())
    assert resp.status_code == 200
    assert resp.json()["id"] > 0


def test_empty_message_rejected(client):
    resp = client.post("/api/report", json=_report(message="   "))
    assert resp.status_code == 400


def test_pre_login_email_is_kept_without_details(client):
    """The email field is its own explicit act — it survives the details toggle being off."""
    client.post("/api/report", json=_report(email="someone@example.com", include_details=False))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        entry = client.get("/api/admin/reports").json()[0]
    assert entry["email"] == "someone@example.com"
    assert entry["include_details"] is False


def test_details_off_stores_nothing_identifying(client):
    """A signed-in report without the tick is stored anonymously, with no client log or UA."""
    register_user(client, "user@test.com")
    client.post("/api/report", json=_report(
        include_details=False,
        user_agent="Mozilla/5.0 (iPhone)",
        client_log="route /grants\nPOST /api/grants 500",
        path="/grants",
    ))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        entry = client.get("/api/admin/reports").json()[0]
    assert entry["user_id"] is None
    assert entry["email"] is None
    assert entry["user_agent"] is None
    assert entry["client_log"] is None
    # Non-identifying context is still kept — it is what makes the report fixable.
    assert entry["path"] == "/grants"


def test_details_on_attaches_account_and_log(client):
    register_user(client, "user@test.com")
    client.post("/api/report", json=_report(
        include_details=True,
        user_agent="Mozilla/5.0 (iPhone)",
        client_log="route /grants\nPOST /api/grants 500",
        app_version="abc1234",
    ))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        entry = client.get("/api/admin/reports").json()[0]
    assert entry["email"] == "user@test.com"
    assert entry["user_id"] is not None
    assert entry["user_agent"] == "Mozilla/5.0 (iPhone)"
    assert "POST /api/grants 500" in entry["client_log"]
    assert entry["app_version"] == "abc1234"


def test_long_fields_are_truncated_not_rejected(client):
    resp = client.post("/api/report", json=_report(
        message="x" * 5000,
        include_details=True,
        client_log="y" * 20000,
    ))
    assert resp.status_code == 200
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        entry = client.get("/api/admin/reports").json()[0]
    assert len(entry["message"]) == 2000
    assert len(entry["client_log"]) == 8000


def test_bad_source_falls_back_to_manual(client):
    client.post("/api/report", json=_report(source="../../etc/passwd"))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        assert client.get("/api/admin/reports").json()[0]["source"] == "manual"


def test_malformed_error_ref_is_dropped(client):
    client.post("/api/report", json=_report(error_ref="not a ref!!"))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        assert client.get("/api/admin/reports").json()[0]["error_ref"] is None


def test_ip_is_hashed_never_stored(client, db_session):
    from scaffold.models import UserReport
    client.post("/api/report", json=_report())
    entry = db_session.query(UserReport).first()
    assert entry.ip_hash and len(entry.ip_hash) == 32
    assert "testclient" not in entry.ip_hash


def test_rate_limits_are_enforced(client):
    """E2E_TEST disables the limiters, so exercise them directly.

    The IP bucket is shared behind a reverse proxy, which is why it is loose;
    the per-user one is the tight one.
    """
    from scaffold.rate_limit import check_rate, check_rate_ip
    from fastapi import HTTPException
    import pytest

    with patch.dict(os.environ, {"E2E_TEST": "0"}):
        for _ in range(30):
            check_rate_ip("10.0.0.9", "user_report", max_calls=30, window_secs=900)
        with pytest.raises(HTTPException) as exc:
            check_rate_ip("10.0.0.9", "user_report", max_calls=30, window_secs=900)
        assert exc.value.status_code == 429

        for _ in range(10):
            check_rate(4242, "user_report", max_calls=10, window_secs=900)
        with pytest.raises(HTTPException) as exc:
            check_rate(4242, "user_report", max_calls=10, window_secs=900)
        assert exc.value.status_code == 429


def test_admin_notification_is_best_effort(client):
    """A failing mailer must not fail the submission."""
    with patch("scaffold.email_sender.email_configured", side_effect=RuntimeError("smtp down")):
        resp = client.post("/api/report", json=_report())
    assert resp.status_code == 200


# ============================================================
# ERROR CORRELATION
# ============================================================

def test_error_ref_links_report_to_traceback(client, db_session):
    from scaffold.models import ErrorLog
    db_session.add(ErrorLog(
        method="GET", path="/api/events", error_type="ValueError",
        error_message="boom", traceback="Traceback: boom", error_ref="deadbeef",
    ))
    db_session.commit()

    client.post("/api/report", json=_report(error_ref="deadbeef", error_message="Error 500"))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        entry = client.get("/api/admin/reports").json()[0]
    assert entry["error_ref"] == "deadbeef"
    assert entry["error_traceback"] == "Traceback: boom"


def test_report_without_ref_has_no_traceback(client):
    client.post("/api/report", json=_report())
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        assert client.get("/api/admin/reports").json()[0]["error_traceback"] is None


# ============================================================
# ADMIN ACCESS
# ============================================================

def test_reports_require_admin(client):
    with _admin_env():
        register_user(client, "regular@test.com")
        assert client.get("/api/admin/reports").status_code == 403
        assert client.patch("/api/admin/reports/1", json={"status": "resolved"}).status_code == 403
        assert client.delete("/api/admin/reports/1").status_code == 403


def test_reports_require_auth(client):
    assert client.get("/api/admin/reports").status_code == 401


def test_resolve_and_delete(client):
    report_id = client.post("/api/report", json=_report()).json()["id"]
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        assert client.get("/api/admin/reports?status=new").json()
        assert client.patch(f"/api/admin/reports/{report_id}", json={"status": "resolved"}).status_code == 204
        assert client.get("/api/admin/reports?status=new").json() == []
        assert client.get("/api/admin/reports?status=resolved").json()[0]["id"] == report_id

        assert client.patch(f"/api/admin/reports/{report_id}", json={"status": "bogus"}).status_code == 400

        assert client.delete(f"/api/admin/reports/{report_id}").status_code == 204
        assert client.get("/api/admin/reports").json() == []
        assert client.delete(f"/api/admin/reports/{report_id}").status_code == 404


def test_open_report_count_in_admin_stats(client):
    client.post("/api/report", json=_report())
    client.post("/api/report", json=_report(message="second"))
    with _admin_env():
        register_user(client, ADMIN_EMAIL)
        assert client.get("/api/admin/stats").json()["new_reports"] == 2


def test_reports_survive_error_log_trim(client, db_session):
    """The reason reports are their own table: the nightly trim must not touch them."""
    from scaffold.models import ErrorLog, UserReport
    client.post("/api/report", json=_report())
    for i in range(3):
        db_session.add(ErrorLog(method="GET", path=f"/api/x{i}", error_type="E", error_message="e"))
    db_session.commit()

    db_session.query(ErrorLog).delete()
    db_session.commit()
    assert db_session.query(UserReport).count() == 1


def test_reports_still_accepted_during_maintenance(client):
    """Downtime is when people most want to report — the endpoint must stay open."""
    from scaffold import maintenance
    with patch.object(maintenance, "is_maintenance_active", return_value=True):
        assert client.get("/api/events").status_code == 503
        assert client.post("/api/report", json=_report()).status_code == 200
