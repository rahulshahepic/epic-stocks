"""Tests for admin metrics endpoints and the metrics sampler."""
import sys
import os
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    resp = client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})
    return resp.json()["access_token"]


# ============================================================
# METRICS HISTORY
# ============================================================

def test_metrics_returns_list(client):
    """Metrics endpoint returns a list (may be non-empty due to startup sampler)."""
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.get("/api/admin/metrics", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


def test_metrics_requires_admin(client):
    with _admin_env():
        token = register_user(client, "regular@test.com")
        resp = client.get("/api/admin/metrics", headers=auth_header(token))
        assert resp.status_code == 403


def test_metrics_requires_auth(client):
    resp = client.get("/api/admin/metrics")
    assert resp.status_code == 401


def test_metrics_returns_correct_fields(client, db_session):
    from scaffold.models import SystemMetric
    from datetime import datetime, timezone

    with _admin_env():
        admin_token = _register_admin(client)

        row = SystemMetric(
            timestamp=datetime.now(timezone.utc),
            cpu_percent=42.5,
            ram_used_mb=1024.0,
            ram_total_mb=8192.0,
            db_size_bytes=9000000,
            error_log_count=3,
        )
        db_session.add(row)
        db_session.commit()

        resp = client.get("/api/admin/metrics?hours=72", headers=auth_header(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        # At least our row should be present
        assert len(data) >= 1
        # Find our specific row by cpu_percent
        our_rows = [d for d in data if d["cpu_percent"] == 42.5]
        assert len(our_rows) == 1
        r = our_rows[0]
        assert r["ram_used_mb"] == 1024.0
        assert r["ram_total_mb"] == 8192.0
        assert r["db_size_bytes"] == 9000000
        assert r["error_log_count"] == 3
        assert "timestamp" in r


def test_metrics_hours_filter_excludes_old(client, db_session):
    from scaffold.models import SystemMetric
    from datetime import datetime, timezone, timedelta

    with _admin_env():
        admin_token = _register_admin(client)

        now = datetime.now(timezone.utc)
        # Add a very old row (should be excluded)
        db_session.add(SystemMetric(
            timestamp=now - timedelta(hours=100),
            cpu_percent=99.9, ram_used_mb=600.0, ram_total_mb=8192.0,
            db_size_bytes=2000, error_log_count=0,
        ))
        db_session.commit()

        resp = client.get("/api/admin/metrics?hours=24", headers=auth_header(admin_token))
        data = resp.json()
        # The old row (cpu=99.9) must NOT appear
        old_rows = [d for d in data if d["cpu_percent"] == 99.9]
        assert len(old_rows) == 0


def test_metrics_ordered_by_timestamp(client, db_session):
    from scaffold.models import SystemMetric
    from datetime import datetime, timezone, timedelta

    with _admin_env():
        admin_token = _register_admin(client)

        now = datetime.now(timezone.utc)
        for i in range(3):
            db_session.add(SystemMetric(
                timestamp=now - timedelta(hours=72 - i),  # push to end of 72h window
                cpu_percent=float(i * 10),
                ram_used_mb=100.0, ram_total_mb=8192.0,
                db_size_bytes=1000, error_log_count=0,
            ))
        db_session.commit()

        resp = client.get("/api/admin/metrics?hours=72", headers=auth_header(admin_token))
        data = resp.json()
        # All returned rows must be in ascending timestamp order
        timestamps = [d["timestamp"] for d in data]
        assert timestamps == sorted(timestamps)


# ============================================================
# DB TABLES
# ============================================================

def test_db_tables_returns_empty_for_sqlite(client):
    """SQLite environments return an empty list (no pg_tables)."""
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.get("/api/admin/db-tables", headers=auth_header(admin_token))
        assert resp.status_code == 200
        # Test env uses SQLite, so returns []
        assert resp.json() == []


def test_db_tables_requires_admin(client):
    with _admin_env():
        token = register_user(client, "regular2@test.com")
        resp = client.get("/api/admin/db-tables", headers=auth_header(token))
        assert resp.status_code == 403


def test_db_tables_requires_auth(client):
    resp = client.get("/api/admin/db-tables")
    assert resp.status_code == 401


# ============================================================
# ADMIN STATS — NEW FIELDS
# ============================================================

def test_admin_stats_includes_system_fields(client):
    """AdminStats response includes cpu_percent, ram_used_mb, ram_total_mb."""
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.get("/api/admin/stats", headers=auth_header(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert "cpu_percent" in data
        assert "ram_used_mb" in data
        assert "ram_total_mb" in data
        # Values are either null (no metrics yet) or numeric
        for key in ("cpu_percent", "ram_used_mb", "ram_total_mb"):
            assert data[key] is None or isinstance(data[key], (int, float))


def test_admin_stats_shows_latest_metric(client, db_session):
    """AdminStats returns values from the most recent SystemMetric row."""
    from scaffold.models import SystemMetric
    from datetime import datetime, timezone, timedelta

    with _admin_env():
        admin_token = _register_admin(client)

        # Insert a row far in the future so it's always the latest
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        db_session.add(SystemMetric(
            timestamp=future,
            cpu_percent=77.0, ram_used_mb=5000.0, ram_total_mb=8192.0,
            db_size_bytes=3000, error_log_count=0,
        ))
        db_session.commit()

        resp = client.get("/api/admin/stats", headers=auth_header(admin_token))
        data = resp.json()
        assert data["cpu_percent"] == 77.0
        assert data["ram_used_mb"] == 5000.0
        assert data["ram_total_mb"] == 8192.0


# ============================================================
# SAMPLE METRICS FUNCTION
# ============================================================

def test_sample_metrics_creates_row(setup_db):
    """_sample_metrics() persists a SystemMetric row."""
    import database
    from main import _sample_metrics
    from scaffold.models import SystemMetric

    db = database.SessionLocal()
    try:
        before = db.query(SystemMetric).count()
        db.close()
    except Exception:
        db.close()
        raise

    _sample_metrics()

    db2 = database.SessionLocal()
    try:
        after = db2.query(SystemMetric).count()
    finally:
        db2.close()

    assert after > before


def test_sample_metrics_trims_error_logs(setup_db):
    """_sample_metrics() trims error_logs to at most 500 entries."""
    import database
    from main import _sample_metrics
    from scaffold.models import ErrorLog
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    db = database.SessionLocal()
    try:
        for i in range(510):
            db.add(ErrorLog(
                timestamp=now - timedelta(seconds=510 - i),
                method="GET", path="/test",
                error_type="TestError", error_message="msg",
            ))
        db.commit()
    finally:
        db.close()

    _sample_metrics()

    db2 = database.SessionLocal()
    try:
        count = db2.query(ErrorLog).count()
    finally:
        db2.close()

    assert count <= 500


def test_sample_metrics_cleans_old_metrics(setup_db):
    """_sample_metrics() removes metric rows older than 30 days."""
    import database
    from main import _sample_metrics
    from scaffold.models import SystemMetric
    from datetime import datetime, timezone, timedelta

    sentinel_cpu = -999.0  # impossible in real usage; identifies our old row
    db = database.SessionLocal()
    try:
        db.add(SystemMetric(
            timestamp=datetime.now(timezone.utc) - timedelta(days=35),
            cpu_percent=sentinel_cpu, ram_used_mb=100.0, ram_total_mb=8192.0,
            db_size_bytes=100, error_log_count=0,
        ))
        db.commit()
    finally:
        db.close()

    _sample_metrics()

    db2 = database.SessionLocal()
    try:
        remaining = db2.query(SystemMetric).filter(SystemMetric.cpu_percent == sentinel_cpu).first()
    finally:
        db2.close()

    assert remaining is None
