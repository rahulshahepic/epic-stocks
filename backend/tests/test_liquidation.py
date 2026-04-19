"""Tests for the preview-exit endpoint (dashboard "If you exit on this date" section)."""
from datetime import date

import pytest

from tests.conftest import register_user
from app.routers.events import _last_vesting_date


# ============================================================
# Unit tests for _last_vesting_date helper (still used by tips.py)
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
# /api/events no longer injects projected liquidation
# ============================================================

def _seed_data(client):
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    })


def test_events_does_not_include_projected_liquidation(client):
    register_user(client)
    _seed_data(client)

    events = client.get("/api/events").json()
    projected = [e for e in events if e.get("is_projected")]
    assert projected == []
    assert not any(e.get("event_type") == "Liquidation (projected)" for e in events)


# ============================================================
# /api/preview-exit returns the full exit breakdown
# ============================================================

def test_preview_exit_returns_breakdown(client):
    register_user(client)
    _seed_data(client)

    resp = client.get("/api/preview-exit?date=2025-06-01")
    assert resp.status_code == 200
    data = resp.json()
    assert data is not None
    assert data["date"] == "2025-06-01"
    # Exit summary fields
    assert data["vested_shares"] == 1000
    assert data["gross_vested"] == pytest.approx(10000.0)
    assert data["unvested_cost_proceeds"] == pytest.approx(0.0)
    assert "liquidation_tax" in data
    assert "outstanding_principal" in data
    assert "prior_sales" in data
    assert data["prior_sales"] == []
    assert "net_cash" in data


def test_preview_exit_early_date_uses_partial_shares(client):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    })

    resp = client.get("/api/preview-exit?date=2020-03-01")
    assert resp.status_code == 200
    data = resp.json()
    # 500 vested × $10 = 5000; 500 unvested at cost $10 = 5000
    assert data["vested_shares"] == 500
    assert data["gross_vested"] == pytest.approx(5000.0)
    assert data["unvested_cost_proceeds"] == pytest.approx(5000.0)


def test_preview_exit_no_data_returns_none(client):
    register_user(client)
    resp = client.get("/api/preview-exit?date=2025-06-01")
    assert resp.status_code == 200
    assert resp.json() is None


def test_preview_exit_invalid_date_returns_422(client):
    register_user(client)
    resp = client.get("/api/preview-exit?date=not-a-date")
    assert resp.status_code == 422
