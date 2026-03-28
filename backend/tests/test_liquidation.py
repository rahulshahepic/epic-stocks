"""Tests for the projected liquidation event feature."""
from datetime import date

import pytest

from tests.conftest import register_user, auth_header
from app.routers.events import _last_vesting_date


# ============================================================
# Unit tests for _last_vesting_date helper
# ============================================================

def test_last_vesting_date_returns_latest():
    from datetime import datetime
    timeline = [
        {"event_type": "Vesting", "date": datetime(2022, 1, 1)},
        {"event_type": "Vesting", "date": datetime(2023, 6, 15)},
        {"event_type": "Share Price", "date": datetime(2023, 12, 1)},
    ]
    assert _last_vesting_date(timeline) == date(2023, 6, 15)


def test_last_vesting_date_no_vesting():
    assert _last_vesting_date([]) is None


def test_last_vesting_date_ignores_non_vesting():
    from datetime import datetime
    timeline = [
        {"event_type": "Share Price", "date": datetime(2023, 1, 1)},
        {"event_type": "Exercise", "date": datetime(2024, 6, 1)},
    ]
    assert _last_vesting_date(timeline) is None


# ============================================================
# Integration tests for projected liquidation in /api/events
# ============================================================

def _seed_data(client, headers):
    """Seed a minimal grant, price, and loan for testing."""
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0}, headers=headers)
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    }, headers=headers)


def test_events_includes_projected_liquidation(client):
    token = register_user(client)
    headers = auth_header(token)
    _seed_data(client, headers)

    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    p = projected[0]
    assert p["event_type"] == "Liquidation (projected)"
    assert p["cum_shares"] == 0
    assert p["gross_proceeds"] > 0
    assert p["is_projected"] is True


def test_events_projected_uses_explicit_horizon_date(client):
    token = register_user(client)
    headers = auth_header(token)
    _seed_data(client, headers)

    client.put("/api/horizon-settings", json={"horizon_date": "2030-12-31"}, headers=headers)

    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    assert projected[0]["date"] == "2030-12-31"


def test_events_projected_uses_last_vesting_when_horizon_null(client):
    token = register_user(client)
    headers = auth_header(token)
    _seed_data(client, headers)

    # Ensure horizon is null
    client.put("/api/horizon-settings", json={"horizon_date": None}, headers=headers)

    events = client.get("/api/events", headers=headers).json()
    vesting_events = [e for e in events if e["event_type"] == "Vesting"]
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    # Should be at the last vesting date
    last_vest_date = max(e["date"] for e in vesting_events)
    assert projected[0]["date"] == last_vest_date


def test_events_no_liquidation_when_no_data(client):
    token = register_user(client)
    headers = auth_header(token)
    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 0


def test_events_projected_has_tax_annotation(client):
    token = register_user(client)
    headers = auth_header(token)
    _seed_data(client, headers)
    # Ensure TaxSettings exist so _annotate_sale_taxes runs
    client.get("/api/tax-settings", headers=headers)

    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    assert projected[0].get("estimated_tax") is not None


# ============================================================
# Horizon settings API round-trip
# ============================================================

def test_horizon_settings_default_null(client):
    token = register_user(client)
    headers = auth_header(token)
    resp = client.get("/api/horizon-settings", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["horizon_date"] is None


def test_horizon_settings_set_and_read(client):
    token = register_user(client)
    headers = auth_header(token)
    resp = client.put("/api/horizon-settings", json={"horizon_date": "2028-06-30"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["horizon_date"] == "2028-06-30"
    # Read back
    resp2 = client.get("/api/horizon-settings", headers=headers)
    assert resp2.json()["horizon_date"] == "2028-06-30"


def test_horizon_settings_clear_to_null(client):
    token = register_user(client)
    headers = auth_header(token)
    client.put("/api/horizon-settings", json={"horizon_date": "2028-06-30"}, headers=headers)
    resp = client.put("/api/horizon-settings", json={"horizon_date": None}, headers=headers)
    assert resp.json()["horizon_date"] is None


def test_early_horizon_uses_shares_at_that_date(client):
    """An exit date before the last vesting event should liquidate only vested shares."""
    token = register_user(client)
    headers = auth_header(token)
    # Two vesting periods: 500 shares vest 2020-01-01, 500 vest 2020-07-01
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0}, headers=headers)
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    }, headers=headers)

    # Set horizon to 2020-03-01 — after first vest (500 shares) but before second (500 shares)
    client.put("/api/horizon-settings", json={"horizon_date": "2020-03-01"}, headers=headers)

    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    p = projected[0]
    assert p["date"] == "2020-03-01"
    # Only the first 500 shares are vested by 2020-03-01; gross_proceeds should reflect 500 * 10 = 5000
    assert p["cum_shares"] == 0
    assert p["gross_proceeds"] == pytest.approx(5000.0)


def test_late_horizon_uses_full_shares(client):
    """An exit date after all vesting uses all shares."""
    token = register_user(client)
    headers = auth_header(token)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0}, headers=headers)
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    }, headers=headers)

    client.put("/api/horizon-settings", json={"horizon_date": "2025-01-01"}, headers=headers)

    events = client.get("/api/events", headers=headers).json()
    projected = [e for e in events if e.get("is_projected")]
    assert len(projected) == 1
    p = projected[0]
    # All 1000 shares vested; gross_proceeds = 1000 * 10 = 10000
    assert p["gross_proceeds"] == pytest.approx(10000.0)
