"""Tests for the preview-exit endpoint (dashboard "If you exit on this date" section)."""
from datetime import date

import pytest

from tests.conftest import register_user
from app.routers.events import _last_vesting_date, _compute_projected_unrecorded_interest


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


# ============================================================
# Unit tests for _compute_projected_unrecorded_interest
# ============================================================

class _FakeLoan:
    def __init__(self, id, grant_year, grant_type, loan_type, loan_year, amount, interest_rate, due_date, refinances_loan_id=None):
        self.id = id
        self.grant_year = grant_year
        self.grant_type = grant_type
        self.loan_type = loan_type
        self.loan_year = loan_year
        self.amount = amount
        self.interest_rate = interest_rate
        self.due_date = due_date
        self.refinances_loan_id = refinances_loan_id


def test_projected_unrecorded_interest_no_interest_loans():
    """All years between purchase loan_year+1 and exit year should be projected."""
    purchase = _FakeLoan(1, 2020, "Purchase", "Purchase", 2020, 100_000, 0.05, date(2030, 12, 31))
    # Exit in 2023: years 2021, 2022, 2023 are unrecorded → 3 × 5000 = 15000
    result = _compute_projected_unrecorded_interest([purchase], date(2023, 6, 1))
    assert result == pytest.approx(15_000.0)


def test_projected_unrecorded_interest_some_recorded():
    """Only gap years (no Interest loan row) are projected."""
    purchase = _FakeLoan(1, 2020, "Purchase", "Purchase", 2020, 100_000, 0.05, date(2030, 12, 31))
    interest_2021 = _FakeLoan(2, 2020, "Purchase", "Interest", 2021, 5_000, 0.05, date(2030, 12, 31))
    # Exit 2023: 2021 recorded, 2022 and 2023 are gaps → 2 × 5000 = 10000
    result = _compute_projected_unrecorded_interest([purchase, interest_2021], date(2023, 6, 1))
    assert result == pytest.approx(10_000.0)


def test_projected_unrecorded_interest_all_recorded():
    """When every year has an Interest loan entry, projected amount is zero."""
    purchase = _FakeLoan(1, 2020, "Purchase", "Purchase", 2020, 100_000, 0.05, date(2030, 12, 31))
    int_2021 = _FakeLoan(2, 2020, "Purchase", "Interest", 2021, 5_000, 0.05, date(2030, 12, 31))
    int_2022 = _FakeLoan(3, 2020, "Purchase", "Interest", 2022, 5_000, 0.05, date(2030, 12, 31))
    result = _compute_projected_unrecorded_interest([purchase, int_2021, int_2022], date(2022, 12, 31))
    assert result == pytest.approx(0.0)


def test_projected_unrecorded_interest_capped_at_due_year():
    """Interest stops accruing after the loan's due year."""
    purchase = _FakeLoan(1, 2020, "Purchase", "Purchase", 2020, 100_000, 0.05, date(2022, 12, 31))
    # Due in 2022; exit in 2025 — only 2021 and 2022 can accrue
    result = _compute_projected_unrecorded_interest([purchase], date(2025, 1, 1))
    assert result == pytest.approx(10_000.0)


def test_projected_unrecorded_interest_skips_refinanced_purchase():
    """A purchase loan that was refinanced away should not generate projected interest."""
    old_purchase = _FakeLoan(1, 2020, "Purchase", "Purchase", 2020, 100_000, 0.05, date(2030, 12, 31))
    new_purchase = _FakeLoan(2, 2020, "Purchase", "Purchase", 2022, 110_000, 0.05, date(2030, 12, 31), refinances_loan_id=1)
    # new_purchase.refinances_loan_id=1 means old_purchase (id=1) is refinanced; it should be excluded
    result = _compute_projected_unrecorded_interest([old_purchase, new_purchase], date(2023, 6, 1))
    # old_purchase skipped (id in refinanced_ids); new_purchase: years 2023 only (loan_year=2022, exit 2023)
    assert result == pytest.approx(110_000.0 * 0.05)


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
    # 2021, 2022, 2023 unrecorded → 3 × (100000 × 0.05) = 15000
    assert data["outstanding_accrued_interest"] == pytest.approx(15_000.0)


def test_preview_exit_accrued_interest_zero_when_fully_recorded(client):
    """When all interest loans are entered, outstanding_accrued_interest is 0."""
    register_user(client)
    _seed_with_purchase_loan(client)
    for yr in [2021, 2022, 2023]:
        client.post("/api/loans?generate_payoff_sale=false", json={
            "grant_year": 2020, "grant_type": "A", "loan_type": "Interest",
            "loan_year": yr, "amount": 5_000.0, "interest_rate": 0.05,
            "due_date": "2030-12-31",
        })

    resp = client.get("/api/preview-exit?date=2023-06-01")
    data = resp.json()
    assert data["outstanding_accrued_interest"] == pytest.approx(0.0)


def test_preview_exit_net_cash_reduced_by_accrued_interest(client):
    """net_cash with unrecorded interest should be lower than without any loans."""
    register_user(client)
    _seed_with_purchase_loan(client)

    resp_with = client.get("/api/preview-exit?date=2023-06-01").json()

    # Compare to a baseline with no loans
    register_user(client)  # re-registers same user, wiping data
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/grants", json={
        "year": 2020, "type": "A", "shares": 1000, "price": 10.0,
        "vest_start": "2020-01-01", "periods": 2,
        "exercise_date": "2020-01-01", "dp_shares": 0, "election_83b": False,
    })
    resp_without = client.get("/api/preview-exit?date=2023-06-01").json()

    assert resp_with["net_cash"] < resp_without["net_cash"]
    # The difference should be at least the accrued interest (principal also reduces net_cash)
    diff = resp_without["net_cash"] - resp_with["net_cash"]
    assert diff >= pytest.approx(15_000.0)
