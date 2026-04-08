"""Tests for sales CRUD, tax computation, and FIFO engine."""
import sys
import os
import math
from datetime import date, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from app.sales_engine import build_fifo_lots, compute_sale_tax, compute_grossup_shares
from collections import deque


# ============================================================
# FIFO ENGINE UNIT TESTS
# ============================================================

def _make_vesting_event(vest_date, shares, share_price, grant_price=0.0, grant_type=None):
    return {
        "date": vest_date,
        "event_type": "Vesting",
        "vested_shares": shares,
        "grant_price": grant_price,
        "share_price": share_price,
        "grant_type": grant_type,
    }


def _make_reduction_event(event_date, shares_negative, event_type="Loan Repayment"):
    return {
        "date": event_date,
        "event_type": event_type,
        "vested_shares": shares_negative,
        "grant_price": None,
        "share_price": 10.0,
    }


WI_DEFAULTS = {
    "federal_income_rate": 0.37,
    "federal_lt_cg_rate": 0.20,
    "federal_st_cg_rate": 0.37,
    "niit_rate": 0.038,
    "state_income_rate": 0.0765,
    "state_lt_cg_rate": 0.0536,
    "state_st_cg_rate": 0.0765,
    "lt_holding_days": 365,
}


def test_build_fifo_lots_single_vesting():
    events = [_make_vesting_event(date(2022, 1, 1), 100, 10.0)]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    assert len(lots) == 1
    assert lots[0][1] == 100
    assert lots[0][2] == 10.0


def test_build_fifo_lots_excludes_future_events():
    events = [
        _make_vesting_event(date(2022, 1, 1), 100, 10.0),
        _make_vesting_event(date(2024, 1, 1), 200, 20.0),
    ]
    lots = build_fifo_lots(events, date(2023, 6, 1))
    assert len(lots) == 1
    assert lots[0][1] == 100


def test_build_fifo_lots_multiple_vestings():
    events = [
        _make_vesting_event(date(2021, 1, 1), 50, 5.0),
        _make_vesting_event(date(2022, 1, 1), 100, 10.0),
        _make_vesting_event(date(2023, 1, 1), 150, 15.0),
    ]
    lots = build_fifo_lots(events, date(2023, 12, 31))
    assert len(lots) == 3
    assert sum(l[1] for l in lots) == 300


def test_build_fifo_lots_with_reduction_consuming_full_lot():
    events = [
        _make_vesting_event(date(2021, 1, 1), 50, 5.0),
        _make_vesting_event(date(2022, 1, 1), 100, 10.0),
        _make_reduction_event(date(2022, 6, 1), -50),
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    assert len(lots) == 1
    assert lots[0][1] == 100
    assert lots[0][2] == 10.0


def test_build_fifo_lots_with_partial_reduction():
    events = [
        _make_vesting_event(date(2021, 1, 1), 100, 5.0),
        _make_reduction_event(date(2022, 1, 1), -30),
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    assert len(lots) == 1
    assert lots[0][1] == 70


def test_dp_exchange_consumes_bonus_lots_first():
    """Down payment exchange uses Bonus lots before Purchase lots (lowest cost basis first)."""
    events = [
        _make_vesting_event(date(2021, 1, 1), 100, 5.0, grant_price=5.0, grant_type='Purchase'),
        _make_vesting_event(date(2022, 1, 1), 50, 10.0, grant_price=0.0, grant_type='Bonus'),
        {"date": date(2022, 6, 1), "event_type": "Down payment exchange", "vested_shares": -50,
         "grant_price": None, "share_price": 10.0},
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    # Bonus lot (50 shares) should be fully consumed; Purchase lot (100 shares) intact
    assert len(lots) == 1
    assert lots[0][2] == 5.0  # Purchase lot basis
    assert lots[0][1] == 100


def test_dp_exchange_bonus_first_then_fifo_for_remainder():
    """After bonus lots exhausted, DP exchange consumes oldest Purchase lots."""
    events = [
        _make_vesting_event(date(2020, 1, 1), 30, 3.0, grant_price=3.0, grant_type='Purchase'),
        _make_vesting_event(date(2021, 1, 1), 40, 5.0, grant_price=5.0, grant_type='Purchase'),
        _make_vesting_event(date(2022, 1, 1), 20, 10.0, grant_price=0.0, grant_type='Bonus'),
        {"date": date(2022, 6, 1), "event_type": "Down payment exchange", "vested_shares": -40,
         "grant_price": None, "share_price": 10.0},
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    # 20 bonus consumed, then 20 from oldest Purchase (2020 lot of 30 → 10 remain)
    assert len(lots) == 2
    remaining_shares = {l[2]: l[1] for l in lots}
    assert remaining_shares[3.0] == 10   # 30 - 20 = 10 remaining from oldest Purchase
    assert remaining_shares[5.0] == 40   # 2021 Purchase untouched


def test_dp_exchange_fifo_when_no_bonus_lots():
    """Without Bonus lots, DP exchange falls back to FIFO (oldest first)."""
    events = [
        _make_vesting_event(date(2021, 1, 1), 50, 5.0, grant_price=5.0, grant_type='Purchase'),
        _make_vesting_event(date(2022, 1, 1), 100, 10.0, grant_price=10.0, grant_type='Purchase'),
        {"date": date(2022, 6, 1), "event_type": "Down payment exchange", "vested_shares": -50,
         "grant_price": None, "share_price": 10.0},
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    # Oldest lot (2021, 50 shares) fully consumed; 2022 lot intact
    assert len(lots) == 1
    assert lots[0][2] == 10.0
    assert lots[0][1] == 100


def test_loan_repayment_still_uses_fifo():
    """Loan repayments continue to consume oldest lots first (unchanged behavior)."""
    events = [
        _make_vesting_event(date(2021, 1, 1), 50, 5.0, grant_price=5.0, grant_type='Purchase'),
        _make_vesting_event(date(2022, 1, 1), 20, 10.0, grant_price=0.0, grant_type='Bonus'),
        _make_reduction_event(date(2022, 6, 1), -50, event_type="Loan Repayment"),
    ]
    lots = build_fifo_lots(events, date(2023, 1, 1))
    # FIFO: oldest Purchase lot (50) consumed first; Bonus lot intact
    assert len(lots) == 1
    assert lots[0][2] == 10.0  # Bonus lot basis = FMV at vest (share_price)
    assert lots[0][1] == 20


def test_fifo_lt_classification():
    vest_date = date(2022, 1, 1)
    sale_date = date(2023, 6, 1)  # >365 days → LT
    events = [_make_vesting_event(vest_date, 100, 10.0)]
    sale = {"date": sale_date, "shares": 100, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["lt_shares"] == 100
    assert result["st_shares"] == 0
    assert result["unvested_shares"] == 0
    assert result["gross_proceeds"] == 2000.0
    assert result["cost_basis"] == 1000.0
    assert result["net_gain"] == 1000.0
    # LT rate = 0.20 + 0.038 + 0.0536 = 0.2916
    assert abs(result["lt_rate"] - 0.2916) < 0.0001
    assert abs(result["lt_tax"] - 291.6) < 0.01


def test_fifo_st_classification():
    vest_date = date(2023, 1, 1)
    sale_date = date(2023, 6, 1)  # <365 days → ST
    events = [_make_vesting_event(vest_date, 100, 10.0)]
    sale = {"date": sale_date, "shares": 100, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["st_shares"] == 100
    assert result["lt_shares"] == 0
    # ST rate = 0.37 + 0.038 + 0.0765 = 0.4845
    assert abs(result["st_rate"] - 0.4845) < 0.0001


def test_purchase_grant_holding_period_starts_at_exercise():
    """Purchase grants (grant_price > 0) use exercise date for LT/ST clock, not vest date.
    Without this, shares vested recently from an old purchase look short-term even though
    the employee has held them (and taken price risk) since the exercise date.
    """
    exercise_date = date(2018, 12, 31)
    vest_date = date(2026, 6, 15)   # vested recently — would be ST without fix
    sale_date = date(2027, 7, 15)   # 395 days after vest, but 8+ years after exercise

    exercise_event = {
        "date": exercise_date,
        "event_type": "Exercise",
        "grant_year": 2018,
        "grant_type": "Purchase",
        "grant_price": 1.5,
        "vested_shares": None,
    }
    vesting_event = {
        "date": vest_date,
        "event_type": "Vesting",
        "grant_year": 2018,
        "grant_type": "Purchase",
        "grant_price": 1.5,
        "share_price": 6.59,
        "vested_shares": 5000,
    }
    events = [exercise_event, vesting_event]
    sale = {"date": sale_date, "shares": 5000, "price_per_share": 6.59}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    # Clock starts at exercise (2018-12-31), so hold period >> 365 days → LTCG
    assert result["lt_shares"] == 5000
    assert result["st_shares"] == 0


def test_rsu_grant_holding_period_starts_at_vest():
    """RSU/income grants (grant_price = 0) still use vest date for LT/ST clock."""
    vest_date = date(2026, 6, 15)
    sale_date = date(2027, 7, 15)   # 395 days after vest → LT
    events = [_make_vesting_event(vest_date, 100, 6.59, grant_price=0.0)]
    sale = {"date": sale_date, "shares": 100, "price_per_share": 6.59}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["lt_shares"] == 100
    assert result["st_shares"] == 0


def test_purchase_grant_without_exercise_event_falls_back_to_vest_date():
    """If no Exercise event is in the timeline, fall back to vesting date (safe default)."""
    vest_date = date(2026, 6, 15)
    sale_date = date(2026, 9, 1)   # <365 days → ST (vest date used as fallback)
    events = [_make_vesting_event(vest_date, 100, 6.59, grant_price=1.5, grant_type='Purchase')]
    sale = {"date": sale_date, "shares": 100, "price_per_share": 6.59}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["st_shares"] == 100
    assert result["lt_shares"] == 0


def test_fifo_mixed_lt_and_st():
    events = [
        _make_vesting_event(date(2022, 1, 1), 60, 10.0),  # LT on 2023-06-01
        _make_vesting_event(date(2023, 1, 1), 40, 12.0),  # ST on 2023-06-01
    ]
    sale = {"date": date(2023, 6, 1), "shares": 100, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["lt_shares"] == 60
    assert result["st_shares"] == 40
    assert result["unvested_shares"] == 0


def test_fifo_purchase_grant_sorts_before_later_rsu():
    """
    FIFO should use hold_start_date (acquisition date) as the sort key, not vest_date.

    Scenario: a Purchase grant exercised in 2018 vests a tranche in 2022. An RSU grant
    vests in 2021. Under vest_date FIFO the RSU lot (2021) sorts before the Purchase lot
    (2022), causing the RSU (STCG) to be consumed first at a mid-2022 sale even though
    the Purchase lot was acquired 4 years earlier.

    Under hold_start FIFO the Purchase lot (hold_start=2018) sorts first, so the LTCG
    Purchase lot is consumed and only the RSU STCG lot remains.
    """
    exercise_date = date(2018, 1, 1)
    purchase_vest = date(2022, 3, 1)   # vests late, but held since 2018 → LTCG
    rsu_vest = date(2021, 6, 1)        # vested before purchase tranche, hold_start=vest → STCG at sale

    exercise_event = {
        "date": exercise_date,
        "event_type": "Exercise",
        "grant_year": 2018,
        "grant_type": "Purchase",
        "grant_price": 2.0,
        "vested_shares": None,
    }
    purchase_vesting = {
        "date": purchase_vest,
        "event_type": "Vesting",
        "grant_year": 2018,
        "grant_type": "Purchase",
        "grant_price": 2.0,
        "share_price": 5.0,
        "vested_shares": 100,
        "grant_type": "Purchase",
    }
    rsu_vesting = {
        "date": rsu_vest,
        "event_type": "Vesting",
        "grant_year": 2021,
        "grant_type": "Income",
        "grant_price": 0.0,
        "share_price": 4.0,
        "vested_shares": 100,
    }
    events = [exercise_event, rsu_vesting, purchase_vesting]

    # Sale on 2022-09-01: Purchase lot held since 2018 = LTCG; RSU held since 2021-06 = STCG
    sale_date = date(2022, 9, 1)
    sale = {"date": sale_date, "shares": 100, "price_per_share": 6.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS, lot_order='fifo')

    # FIFO by hold_start_date: Purchase (2018) before RSU (2021).
    # 100 Purchase shares consumed (LTCG) → 0 ST shares.
    assert result["lt_shares"] == 100, f"Expected 100 LTCG shares, got lt={result['lt_shares']} st={result['st_shares']}"
    assert result["st_shares"] == 0


def test_unvested_shares_detection():
    events = [_make_vesting_event(date(2022, 1, 1), 50, 10.0)]
    sale = {"date": date(2022, 6, 1), "shares": 80, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["unvested_shares"] == 30
    assert result["lt_shares"] + result["st_shares"] == 50


def test_unvested_tax_rate():
    """Unvested shares taxed at federal_income + state_income."""
    events = []  # no vesting events → all unvested
    sale = {"date": date(2022, 6, 1), "shares": 100, "price_per_share": 10.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["unvested_shares"] == 100
    assert result["cost_basis"] == 0.0
    # income rate = 0.37 + 0.0765 = 0.4465
    assert abs(result["unvested_rate"] - 0.4465) < 0.0001


def test_wi_defaults_lt_rate():
    """Combined LT rate for Wisconsin = 0.20 + 0.038 + 0.0536 = 0.2916."""
    expected = 0.20 + 0.038 + 0.0536
    events = [_make_vesting_event(date(2020, 1, 1), 100, 10.0)]
    sale = {"date": date(2022, 1, 1), "shares": 100, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert abs(result["lt_rate"] - expected) < 0.0001


def test_wi_defaults_st_rate():
    """Combined ST rate for Wisconsin = 0.37 + 0.038 + 0.0765 = 0.4845."""
    expected = 0.37 + 0.038 + 0.0765
    events = [_make_vesting_event(date(2023, 6, 1), 100, 10.0)]
    sale = {"date": date(2023, 7, 1), "shares": 100, "price_per_share": 20.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert abs(result["st_rate"] - expected) < 0.0001


def test_net_proceeds():
    events = [_make_vesting_event(date(2020, 1, 1), 100, 5.0)]
    sale = {"date": date(2022, 1, 1), "shares": 100, "price_per_share": 10.0}
    result = compute_sale_tax(events, sale, WI_DEFAULTS)
    assert result["net_proceeds"] == round(result["gross_proceeds"] - result["estimated_tax"], 2)


# ============================================================
# SALES CRUD API TESTS
# ============================================================

SALE_DATA = {
    "date": "2023-06-01",
    "shares": 100,
    "price_per_share": 25.50,
    "notes": "First sale",
}


def test_create_sale(client):
    register_user(client)
    resp = client.post("/api/sales", json=SALE_DATA)
    assert resp.status_code == 201
    data = resp.json()
    assert data["shares"] == 100
    assert data["id"] is not None
    assert data["version"] == 1


def test_list_sales(client):
    register_user(client)
    client.post("/api/sales", json=SALE_DATA)
    resp = client.get("/api/sales")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_update_sale(client):
    register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA)
    sale_id = create_resp.json()["id"]
    resp = client.put(f"/api/sales/{sale_id}", json={"shares": 200, "version": 1})
    assert resp.status_code == 200
    assert resp.json()["shares"] == 200
    assert resp.json()["version"] == 2


def test_delete_sale(client):
    register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA)
    sale_id = create_resp.json()["id"]
    resp = client.delete(f"/api/sales/{sale_id}")
    assert resp.status_code == 204
    list_resp = client.get("/api/sales")
    assert len(list_resp.json()) == 0


def test_sales_user_isolation(make_client):
    with make_client("user1@example.com") as c1, make_client("user2@example.com") as c2:
        c1.post("/api/sales", json=SALE_DATA)
        resp = c2.get("/api/sales")
        assert resp.json() == []


def test_sale_requires_auth(client):
    resp = client.get("/api/sales")
    assert resp.status_code == 401


def test_sale_version_conflict(client):
    register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA)
    sale_id = create_resp.json()["id"]
    # Update once to bump version
    client.put(f"/api/sales/{sale_id}", json={"shares": 150, "version": 1})
    # Try to update with stale version
    resp = client.put(f"/api/sales/{sale_id}", json={"shares": 200, "version": 1})
    assert resp.status_code == 409


# ============================================================
# TAX SETTINGS API TESTS
# ============================================================

def test_get_tax_settings_creates_defaults(client):
    register_user(client)
    resp = client.get("/api/tax-settings")
    assert resp.status_code == 200
    data = resp.json()
    assert abs(data["federal_lt_cg_rate"] - 0.20) < 0.0001
    assert abs(data["state_lt_cg_rate"] - 0.0536) < 0.0001
    assert data["lt_holding_days"] == 365


def test_update_tax_settings(client):
    register_user(client)
    resp = client.put("/api/tax-settings", json={"federal_lt_cg_rate": 0.15})
    assert resp.status_code == 200
    assert abs(resp.json()["federal_lt_cg_rate"] - 0.15) < 0.0001
    # Other fields unchanged
    assert abs(resp.json()["state_lt_cg_rate"] - 0.0536) < 0.0001


def test_update_prefer_stock_dp(client):
    register_user(client)
    resp = client.put("/api/tax-settings", json={"prefer_stock_dp": True})
    assert resp.status_code == 200
    assert resp.json()["prefer_stock_dp"] is True
    resp = client.put("/api/tax-settings", json={"prefer_stock_dp": False})
    assert resp.status_code == 200
    assert resp.json()["prefer_stock_dp"] is False


def test_tax_settings_user_isolation(make_client):
    with make_client("user1@example.com") as c1, make_client("user2@example.com") as c2:
        c1.put("/api/tax-settings", json={"federal_lt_cg_rate": 0.15})
        resp = c2.get("/api/tax-settings")
        assert abs(resp.json()["federal_lt_cg_rate"] - 0.20) < 0.0001


def test_get_sale_tax_empty_timeline(client):
    register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA)
    sale_id = create_resp.json()["id"]
    resp = client.get(f"/api/sales/{sale_id}/tax")
    assert resp.status_code == 200
    data = resp.json()
    # No grants → all shares unvested
    assert data["unvested_shares"] == 100
    assert data["gross_proceeds"] == pytest.approx(100 * 25.50, abs=0.01)


def test_sale_tax_not_found(client):
    register_user(client)
    resp = client.get("/api/sales/9999/tax")
    assert resp.status_code == 404


import pytest


# ============================================================
# COMPUTE GROSSUP SHARES TESTS
# ============================================================

def _make_lots(*items):
    """items: (vest_date, shares, basis)"""
    return deque([[d, s, b] for d, s, b in items])


def test_grossup_basic_lt():
    """Single LT lot: gross-up > naive ceil(cash_due/price)."""
    sale_date = date(2023, 6, 1)
    lots = _make_lots((date(2021, 1, 1), 1000, 5.0))  # held >365 days → LT
    price = 10.0
    cash_due = 100.0
    # LT rate = 0.20+0.038+0.0536 = 0.2916
    # net_per_share = 10 - 0.2916*(10-5) = 10 - 1.458 = 8.542
    # shares needed = ceil(100/8.542) = ceil(11.706) = 12
    shares = compute_grossup_shares(lots, cash_due, price, sale_date, WI_DEFAULTS)
    naive = math.ceil(cash_due / price)  # 10
    assert shares > naive
    assert shares == 12


def test_grossup_no_tax_equals_naive():
    """With zero tax rates, gross-up == naive ceil."""
    sale_date = date(2023, 6, 1)
    lots = _make_lots((date(2021, 1, 1), 1000, 0.0))
    zero_tax = {**WI_DEFAULTS,
                "federal_lt_cg_rate": 0.0, "federal_st_cg_rate": 0.0,
                "niit_rate": 0.0, "state_lt_cg_rate": 0.0, "state_st_cg_rate": 0.0}
    shares = compute_grossup_shares(lots, 100.0, 10.0, sale_date, zero_tax)
    assert shares == math.ceil(100.0 / 10.0)  # = 10


def test_grossup_mixed_lots():
    """LT lot exhausted first, then ST lot for remainder."""
    sale_date = date(2023, 6, 1)
    # Lot 1: LT (2021-01-01), 5 shares, basis=5
    # Lot 2: ST (2023-03-01), 1000 shares, basis=5
    lots = _make_lots(
        (date(2021, 1, 1), 5, 5.0),
        (date(2023, 3, 1), 1000, 5.0),
    )
    price = 10.0
    cash_due = 100.0
    shares = compute_grossup_shares(lots, cash_due, price, sale_date, WI_DEFAULTS)
    # Gross-up means more than naive (10) and all shares cover the cash
    assert shares >= math.ceil(cash_due / price)


def test_grossup_underwater_basis():
    """Basis >= price means no tax on gain; net_per_share = price."""
    sale_date = date(2023, 6, 1)
    lots = _make_lots((date(2021, 1, 1), 1000, 15.0))  # basis > price
    price = 10.0
    cash_due = 100.0
    shares = compute_grossup_shares(lots, cash_due, price, sale_date, WI_DEFAULTS)
    # No gain → net_per_share = price; shares = ceil(100/10) = 10
    assert shares == 10


def test_grossup_zero_price_returns_zero():
    lots = _make_lots((date(2021, 1, 1), 1000, 5.0))
    assert compute_grossup_shares(lots, 100.0, 0.0, date(2023, 1, 1), WI_DEFAULTS) == 0


def test_grossup_zero_cash_due_returns_zero():
    lots = _make_lots((date(2021, 1, 1), 1000, 5.0))
    assert compute_grossup_shares(lots, 0.0, 10.0, date(2023, 1, 1), WI_DEFAULTS) == 0


def test_grossup_insufficient_lots_fallback():
    """If lots run out before covering cash_due, fall back to price-based ceil."""
    sale_date = date(2023, 6, 1)
    lots = _make_lots((date(2021, 1, 1), 1, 5.0))  # only 1 share
    price = 10.0
    cash_due = 1000.0
    shares = compute_grossup_shares(lots, cash_due, price, sale_date, WI_DEFAULTS)
    # Should cover cash_due at minimum (naive)
    assert shares >= math.ceil(cash_due / price)


def test_estimate_with_shares_param_returns_exact_gross(client):
    """Passing shares= to /estimate returns gross = shares * price, not a gross-up."""
    register_user(client)
    resp = client.get("/api/sales/estimate?price_per_share=8.78&shares=1&sale_date=2029-07-15")
    assert resp.status_code == 200
    data = resp.json()
    assert data["shares_needed"] == 1
    assert abs(data["gross_proceeds"] - 8.78) < 0.01


def test_estimate_with_target_net_cash_grosses_up(client):
    """Passing target_net_cash= still performs the gross-up (original behaviour)."""
    register_user(client)
    # With LT tax rates in effect, selling to net $8.78 requires >1 share
    resp = client.get("/api/sales/estimate?price_per_share=8.78&target_net_cash=8.78&sale_date=2029-07-15")
    assert resp.status_code == 200
    data = resp.json()
    assert data["shares_needed"] >= 1
    assert data["gross_proceeds"] >= 8.78


# ============================================================
# LOAN PAYMENT CRUD TESTS
# ============================================================

LOAN_DATA = {
    "grant_year": 2020,
    "grant_type": "Purchase",
    "loan_type": "Purchase",
    "loan_year": 2020,
    "amount": 10000.0,
    "interest_rate": 0.05,
    "due_date": "2025-12-31",
}


def _create_loan(client, data=None):
    resp = client.post("/api/loans?generate_payoff_sale=false", json=data or LOAN_DATA)
    assert resp.status_code == 201
    return resp.json()["id"]


def test_create_loan_payment(client):
    register_user(client)
    loan_id = _create_loan(client)
    resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id,
        "date": "2025-06-01",
        "amount": 500.0,
        "notes": "Early payment",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["loan_id"] == loan_id
    assert data["amount"] == 500.0
    assert data["version"] == 1


def test_list_loan_payments_by_loan(client):
    register_user(client)
    loan_id = _create_loan(client)
    client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    })
    resp = client.get(f"/api/loan-payments?loan_id={loan_id}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_list_loan_payments_all(client):
    register_user(client)
    loan_id = _create_loan(client)
    client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    })
    resp = client.get("/api/loan-payments")
    assert len(resp.json()) == 1


def test_update_loan_payment(client):
    register_user(client)
    loan_id = _create_loan(client)
    create_resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    })
    lp_id = create_resp.json()["id"]
    resp = client.put(f"/api/loan-payments/{lp_id}", json={"amount": 750.0, "version": 1})
    assert resp.status_code == 200
    assert resp.json()["amount"] == 750.0
    assert resp.json()["version"] == 2


def test_delete_loan_payment(client):
    register_user(client)
    loan_id = _create_loan(client)
    create_resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    })
    lp_id = create_resp.json()["id"]
    resp = client.delete(f"/api/loan-payments/{lp_id}")
    assert resp.status_code == 204
    list_resp = client.get(f"/api/loan-payments?loan_id={loan_id}")
    assert len(list_resp.json()) == 0


def test_loan_payment_wrong_loan_404(client):
    register_user(client)
    resp = client.post("/api/loan-payments", json={
        "loan_id": 9999, "date": "2025-06-01", "amount": 500.0,
    })
    assert resp.status_code == 404


def test_loan_payment_user_isolation(make_client):
    with make_client("user1@example.com") as c1, make_client("user2@example.com") as c2:
        loan_id = _create_loan(c1)
        # user2 cannot add payment to user1's loan
        resp = c2.post("/api/loan-payments", json={
            "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
        })
        assert resp.status_code == 404


# ============================================================
# CASH-OUT VALIDATION TESTS
# ============================================================

def test_cash_out_blocked_by_uncovered_loan(client):
    """Cash-out sale blocked when loan due on/before sale date has no linked sale."""
    register_user(client)
    _create_loan(client, {**LOAN_DATA, "due_date": "2023-01-01"})
    # Cash-out sale: no loan_id, date after loan due
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    })
    assert resp.status_code == 422
    assert "Repay loans" in resp.json()["detail"]


def test_cash_out_allowed_when_no_loans(client):
    """Cash-out sale allowed with no outstanding loans."""
    register_user(client)
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    })
    assert resp.status_code == 201


def test_cash_out_allowed_after_loan_covered_by_sale(client):
    """Cash-out sale allowed once loan has a linked payoff sale."""
    register_user(client)
    loan_id = _create_loan(client, {**LOAN_DATA, "due_date": "2023-01-01"})
    # Create a linked (payoff) sale for this loan
    client.post("/api/sales", json={
        "date": "2023-01-01", "shares": 50, "price_per_share": 10.0, "loan_id": loan_id,
    })
    # Now cash-out sale should succeed
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    })
    assert resp.status_code == 201


def test_duplicate_payoff_sale_rejected(client):
    """A second sale linked to the same loan is rejected."""
    register_user(client)
    loan_id = _create_loan(client, {**LOAN_DATA, "due_date": "2023-01-01"})
    client.post("/api/sales", json={
        "date": "2023-01-01", "shares": 50, "price_per_share": 10.0, "loan_id": loan_id,
    })
    resp = client.post("/api/sales", json={
        "date": "2023-01-15", "shares": 30, "price_per_share": 10.0, "loan_id": loan_id,
    })
    assert resp.status_code == 409


# ============================================================
# AUTO-SALE GENERATION TESTS
# ============================================================

def test_create_loan_no_auto_sale_when_disabled(client):
    """POST /api/loans?generate_payoff_sale=false should NOT create a sale."""
    register_user(client)
    resp = client.post("/api/loans?generate_payoff_sale=false", json=LOAN_DATA)
    assert resp.status_code == 201
    sales_resp = client.get("/api/sales")
    assert len(sales_resp.json()) == 0


def test_create_loan_auto_sale_skipped_without_price(client):
    """Auto-sale is skipped when no price data exists (price=0)."""
    register_user(client)
    # No price records → price=0 → auto-sale skipped
    resp = client.post("/api/loans?generate_payoff_sale=true", json=LOAN_DATA)
    assert resp.status_code == 201
    sales_resp = client.get("/api/sales")
    assert len(sales_resp.json()) == 0


# ============================================================
# SALE EVENTS IN TIMELINE
# ============================================================

def _setup_grant_and_price(client):
    """Create a grant with 2-year vesting and a price entry."""
    client.post("/api/grants", json={
        "year": 2020, "type": "Bonus", "shares": 1000, "price": 0.0,
        "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2030-01-01",
        "dp_shares": 0,
    })
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})


def test_sale_appears_in_events_timeline(client):
    """A recorded sale injects a Sale event into the timeline."""
    register_user(client)
    _setup_grant_and_price(client)

    client.post("/api/sales", json={
        "date": "2022-01-01", "shares": 200, "price_per_share": 10.0,
    })

    events = client.get("/api/events").json()
    sale_events = [e for e in events if e["event_type"] == "Sale"]
    assert len(sale_events) == 1
    assert sale_events[0]["vested_shares"] == -200
    assert sale_events[0]["gross_proceeds"] == 2000.0


def test_sale_decrements_cum_shares(client):
    """cum_shares must decrease after a sale event."""
    register_user(client)
    _setup_grant_and_price(client)

    events_before = client.get("/api/events").json()
    # Find cum_shares at the last vesting before sale date
    vesting_2021 = next(e for e in events_before
                        if e["event_type"] == "Vesting" and e["date"] == "2021-01-01")
    shares_before_sale = vesting_2021["cum_shares"]  # 500 (half of 1000)

    client.post("/api/sales", json={
        "date": "2022-01-01", "shares": 200, "price_per_share": 10.0,
    })

    events_after = client.get("/api/events").json()
    sale_event = next(e for e in events_after if e["event_type"] == "Sale")
    # Sale event cum_shares = shares after vesting 2 (500+500=1000) minus 200 sold
    assert sale_event["cum_shares"] == 1000 - 200

    # Events after the sale also have reduced cum_shares
    later_events = [e for e in events_after if e["date"] > "2022-01-01"]
    for e in later_events:
        assert e["cum_shares"] <= shares_before_sale + 500 - 200


def test_sale_tax_accounts_for_prior_sale(client):
    """Second sale's tax computation excludes lots consumed by first sale."""
    register_user(client)
    _setup_grant_and_price(client)

    # First sale: sell 300 shares (all from 2021-01-01 vesting lot of 500)
    sale1 = client.post("/api/sales", json={
        "date": "2022-06-01", "shares": 300, "price_per_share": 12.0,
    }).json()

    # Second sale: sell 300 shares — only 200 remain from the 2021 lot (after first sale),
    # plus 500 from the 2022 vesting. So 200 from 2021 lot + 100 from 2022 lot.
    sale2 = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 300, "price_per_share": 15.0,
    }).json()

    tax1 = client.get(f"/api/sales/{sale1['id']}/tax").json()
    tax2 = client.get(f"/api/sales/{sale2['id']}/tax").json()

    # First sale: 300 shares, all from 2021 lot (held > 1yr by 2022-06-01)
    assert tax1["lt_shares"] + tax1["st_shares"] + tax1["unvested_shares"] == 300

    # Second sale: 300 shares — should NOT double-count the 300 already sold
    # Total available: 500 (2021 lot) - 300 (first sale) = 200 remaining + 500 (2022 lot) = 700
    # So all 300 should come from vested lots, none unvested
    assert tax2["unvested_shares"] == 0
    assert tax2["lt_shares"] + tax2["st_shares"] == 300


def test_per_sale_tax_rates_stored_and_used(client):
    """Sale can store per-sale tax rates that override TaxSettings in the tax endpoint."""
    register_user(client)
    # Create sale with custom per-sale rates
    resp = client.post("/api/sales", json={
        "date": "2025-01-01",
        "shares": 100,
        "price_per_share": 50.0,
        "federal_lt_cg_rate": 0.10,  # custom lower rate
        "federal_st_cg_rate": 0.20,
        "federal_income_rate": 0.30,
        "niit_rate": 0.0,
        "state_income_rate": 0.05,
        "state_lt_cg_rate": 0.02,
        "state_st_cg_rate": 0.05,
        "lt_holding_days": 180,
    })
    assert resp.status_code == 201
    sale = resp.json()
    assert sale["federal_lt_cg_rate"] == 0.10
    assert sale["lt_holding_days"] == 180

    # Update should preserve and allow changing per-sale rates
    upd = client.put(f"/api/sales/{sale['id']}", json={
        "federal_lt_cg_rate": 0.15,
    }).json()
    assert upd["federal_lt_cg_rate"] == 0.15


def test_payoff_sale_uses_price_at_loan_due_date_not_final_price(client):
    """
    Payoff sale gross-up must use the share price at the loan due date,
    not the last (possibly far-future and lower) price in the timeline.

    Regression: _compute_payoff_sale previously used _current_price_from_timeline
    which returned the final timeline price. If future price projections are lower
    than the price at the loan due date, the gross-up would compute too many shares,
    causing cum_shares to go deeply negative in the chart.
    """
    register_user(client)

    # Grant: 1000 shares, vesting 2021-01-01 (2 periods), exercise 2030-01-01
    client.post("/api/grants", json={
        "year": 2020, "type": "Bonus", "shares": 1000, "price": 0.0,
        "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2030-01-01",
        "dp_shares": 0,
    })

    # Price at loan due date: $10/share
    client.post("/api/prices", json={"effective_date": "2021-01-01", "price": 10.0})
    # Far-future price projection: $1/share (much lower — the bug would use this)
    client.post("/api/prices", json={"effective_date": "2030-01-01", "price": 1.0})

    # Loan of $500, due 2022-01-01 (when 500 shares are vested at $10)
    resp = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Bonus", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 500.0, "interest_rate": 0.0,
        "due_date": "2022-01-01",
    })
    assert resp.status_code == 201

    sales = client.get("/api/sales").json()
    assert len(sales) == 1
    sale = sales[0]

    # price_per_share should be $10 (price at loan due date), not $1 (final price)
    assert sale["price_per_share"] == 10.0

    # shares should be ~ceil(500 / 10) = 50 (no cap gains since basis=price for income grant)
    # With the bug (price=$1), shares would be ~500, causing negative cum_shares on 500 vested
    assert sale["shares"] <= 100, f"Expected ≤100 shares (at $10 price), got {sale['shares']}"

    # Verify cum_shares never goes negative in the events timeline
    events = client.get("/api/events").json()
    for e in events:
        assert e.get("cum_shares", 0) >= 0, (
            f"cum_shares went negative ({e['cum_shares']}) at {e['date']} ({e['event_type']}). "
            "Payoff sale share count computed with wrong (far-future) price."
        )


# ============================================================
# PRIOR SALE LOT SENTINEL TESTS (lot-tracking fix)
# ============================================================

def test_prior_sale_lot_removes_specific_lot():
    """'Prior Sale Lot' sentinel removes the targeted lot, not just the oldest."""
    events = [
        _make_vesting_event(date(2022, 1, 1), 1000, 5.0),   # Lot 1 (old, LTCG)
        _make_vesting_event(date(2024, 1, 1), 1000, 40.0),  # Lot 2 (new, STCG → later LTCG)
        # Sentinel: prior LIFO sale consumed Lot 2 (the newer/STCG lot)
        {
            "date": date(2024, 7, 1),
            "event_type": "Prior Sale Lot",
            "target_vest_date": date(2024, 1, 1),
            "target_grant_year": None,
            "target_grant_type": None,
            "shares_consumed": 1000,
            "vested_shares": 0,
            "grant_price": None,
            "share_price": 0.0,
        },
    ]
    lots = build_fifo_lots(events, date(2025, 1, 1))
    # Only Lot 1 (old, low-basis) should remain — Lot 2 was consumed by the prior sale
    assert len(lots) == 1
    assert lots[0][2] == 5.0   # basis of Lot 1
    assert lots[0][1] == 1000


def test_prior_sale_lot_partial_removal():
    """'Prior Sale Lot' sentinel handles partial lot removal correctly."""
    events = [
        _make_vesting_event(date(2023, 1, 1), 1000, 20.0),
        {
            "date": date(2024, 1, 1),
            "event_type": "Prior Sale Lot",
            "target_vest_date": date(2023, 1, 1),
            "target_grant_year": None,
            "target_grant_type": None,
            "shares_consumed": 400,
            "vested_shares": 0,
            "grant_price": None,
            "share_price": 0.0,
        },
    ]
    lots = build_fifo_lots(events, date(2025, 1, 1))
    assert len(lots) == 1
    assert lots[0][1] == 600
    assert lots[0][2] == 20.0


def test_lifo_multi_sale_lot_tracking():
    """
    Regression: with two sales using LIFO, the second sale must see the lots
    that actually remain after the first sale (old low-basis lots), not the
    lots the old FIFO-sentinel approach would have left (new high-basis lots).

    Setup:
      Lot 1: vest 2022-01-01, basis $5  (LTCG at both sales)
      Lot 2: vest 2024-01-01, basis $40 (STCG at Sale 1, LTCG by Sale 2)

    LIFO at Sale 1 (2024-07-01 @ $50): consumes Lot 2 (newest).
      gain = 1000 × ($50 - $40) = $10k STCG   → tax ≈ $4,845

    After Sale 1, only Lot 1 remains (basis $5).
    Sale 2 (2025-07-01 @ $30): should consume Lot 1.
      gain = 1000 × ($30 - $5)  = $25k LTCG   → tax ≈ $7,290

    Old sentinel bug: would have left Lot 2 "available" for Sale 2 and
    shown $0 tax (loss on Lot 2), making LIFO appear falsely cheaper.
    """
    from app.routers.events import _annotate_sale_taxes, _sort_key
    from datetime import datetime as dt

    vesting_tl = [
        {**_make_vesting_event(date(2022, 1, 1), 1000, 5.0),
         "grant_year": None, "grant_type": None},
        {**_make_vesting_event(date(2024, 1, 1), 1000, 40.0),
         "grant_year": None, "grant_type": None},
    ]
    # Add fields compute_timeline would normally provide
    for e in vesting_tl:
        e.setdefault("grant_year", None)
        e.setdefault("grant_type", None)

    enriched = [
        {
            "date": dt.combine(date(2024, 7, 1), dt.min.time()),
            "event_type": "Sale",
            "vested_shares": -1000,
            "gross_proceeds": 1000 * 50.0,
            "share_price": 50.0,
            "sale_id": 1,
        },
        {
            "date": dt.combine(date(2025, 7, 1), dt.min.time()),
            "event_type": "Sale",
            "vested_shares": -1000,
            "gross_proceeds": 1000 * 30.0,
            "share_price": 30.0,
            "sale_id": 2,
        },
    ]

    _annotate_sale_taxes(enriched, vesting_tl, WI_DEFAULTS, lot_order='lifo')

    sale1_tax = enriched[0]["estimated_tax"]
    sale2_tax = enriched[1]["estimated_tax"]

    # Sale 1: 1000 shares STCG (basis $40, price $50 → $10k gain)
    # ST rate = 0.37 + 0.038 + 0.0765 = 0.4845 → tax ≈ $4,845
    assert abs(sale1_tax - 4845.0) < 10, f"Sale 1 tax wrong: {sale1_tax}"

    # Sale 2: 1000 shares LTCG (basis $5, price $30 → $25k gain)
    # LT rate = 0.20 + 0.038 + 0.0536 = 0.2916 → tax ≈ $7,290
    assert sale2_tax > 5000, (
        f"Sale 2 tax suspiciously low ({sale2_tax}): sentinel bug may have left "
        "high-basis Lot 2 available instead of low-basis Lot 1."
    )
    assert abs(sale2_tax - 7290.0) < 10, f"Sale 2 tax wrong: {sale2_tax}"
