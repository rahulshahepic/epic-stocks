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


# The projection itself (daily accrual, 31 December capitalisation, refinances,
# prepayments, payoff sales) is unit-tested in test_loan_projection.py.


# ============================================================
# Integration: preview-exit includes outstanding_accrued_interest
# ============================================================

def _seed_with_purchase_loan(client):
    """Seed a grant, price, and a purchase loan with no Interest loan rows."""
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    })
    # Purchase loan from 2020, due 2030, 5% annual rate
    client.post("/api/loans?generate_payoff_sale=false", json={
        "grant_year": 2020, "grant_type": "A", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 100_000.0, "interest_rate": 0.05,
        "due_date": "2030-12-31",
    })


def test_preview_exit_includes_accrued_interest_field(client):
    register_user(client)
    _seed_with_purchase_loan(client)

    resp = client.get("/api/preview-exit?date=2023-06-01")
    assert resp.status_code == 200
    data = resp.json()
    assert "outstanding_accrued_interest" in data


def test_preview_exit_accrued_interest_nonzero_when_no_interest_loans(client):
    """With a purchase loan and zero interest loans recorded, accrued interest must be >0."""
    register_user(client)
    _seed_with_purchase_loan(client)

    resp = client.get("/api/preview-exit?date=2023-06-01")
    data = resp.json()
    # Bought 2020-01-01: each 31 December's interest becomes an Interest loan
    # that accrues at the latest rate on record (5% here), and the exit pays
    # those plus 2023's accrual to 1 June. Actual/365.
    owed = 0.0
    for year in (2020, 2021, 2022):
        days = (date(year + 1, 1, 1) - date(year, 1, 1)).days
        owed += (100_000 + owed) * 0.05 * days / 365
    owed += (100_000 + owed) * 0.05 * (date(2023, 6, 1) - date(2023, 1, 1)).days / 365
    assert data["outstanding_accrued_interest"] == pytest.approx(owed, abs=0.05)


def test_preview_exit_accrued_interest_zero_when_fully_recorded(client):
    """When every year through the exit is booked, outstanding_accrued_interest
    is 0. A row for 2023 counts from 1 January 2024: before then the statement
    booking it did not exist."""
    register_user(client)
    _seed_with_purchase_loan(client)
    for yr in [2020, 2021, 2022, 2023]:
        client.post("/api/loans?generate_payoff_sale=false", json={
            "grant_year": 2020, "grant_type": "A", "loan_type": "Interest",
            "loan_year": yr, "amount": 5_000.0, "interest_rate": 0.05,
            "due_date": "2030-12-31",
        })

    data = client.get("/api/preview-exit?date=2024-01-01").json()
    assert data["outstanding_accrued_interest"] == pytest.approx(0.0)
    assert client.get("/api/preview-exit?date=2023-06-01").json()["outstanding_accrued_interest"] > 0


def test_preview_exit_net_cash_reduced_by_accrued_interest(client):
    """net_cash formula subtracts outstanding_accrued_interest from liq_net."""
    register_user(client)
    _seed_with_purchase_loan(client)

    data = client.get("/api/preview-exit?date=2023-06-01").json()

    # Verify the backend wired accrued interest into the net_cash formula.
    # net_cash = max(0, gross + unvested - tax - principal - accrued) + prior_sales + deduction
    expected_liq_net = max(0.0,
        data["gross_vested"] + data["unvested_cost_proceeds"]
        - data["liquidation_tax"]
        - data["outstanding_principal"]
        - data["outstanding_accrued_interest"]
    )
    expected_net_cash = round(expected_liq_net + data["prior_sales_net"] + data["deduction_savings"], 2)
    assert data["net_cash"] == pytest.approx(expected_net_cash)
    # Sanity: accrued interest is non-zero so it actually affected net_cash
    assert data["outstanding_accrued_interest"] > 0
