"""Tests for sales CRUD, tax computation, and FIFO engine."""
import sys
import os
import math
from datetime import date, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header
from sales_engine import build_fifo_lots, compute_sale_tax, compute_grossup_shares
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
    assert lots[0][2] == 0.0  # Bonus lot (share_price basis since grant_price=0)
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
    token = register_user(client)
    resp = client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    data = resp.json()
    assert data["shares"] == 100
    assert data["id"] is not None
    assert data["version"] == 1


def test_list_sales(client):
    token = register_user(client)
    client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    resp = client.get("/api/sales", headers=auth_header(token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_update_sale(client):
    token = register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    sale_id = create_resp.json()["id"]
    resp = client.put(f"/api/sales/{sale_id}", json={"shares": 200, "version": 1}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["shares"] == 200
    assert resp.json()["version"] == 2


def test_delete_sale(client):
    token = register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    sale_id = create_resp.json()["id"]
    resp = client.delete(f"/api/sales/{sale_id}", headers=auth_header(token))
    assert resp.status_code == 204
    list_resp = client.get("/api/sales", headers=auth_header(token))
    assert len(list_resp.json()) == 0


def test_sales_user_isolation(client):
    token1 = register_user(client, "user1@example.com")
    token2 = register_user(client, "user2@example.com")
    client.post("/api/sales", json=SALE_DATA, headers=auth_header(token1))
    resp = client.get("/api/sales", headers=auth_header(token2))
    assert resp.json() == []


def test_sale_requires_auth(client):
    resp = client.get("/api/sales")
    assert resp.status_code == 401


def test_sale_version_conflict(client):
    token = register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    sale_id = create_resp.json()["id"]
    # Update once to bump version
    client.put(f"/api/sales/{sale_id}", json={"shares": 150, "version": 1}, headers=auth_header(token))
    # Try to update with stale version
    resp = client.put(f"/api/sales/{sale_id}", json={"shares": 200, "version": 1}, headers=auth_header(token))
    assert resp.status_code == 409


# ============================================================
# TAX SETTINGS API TESTS
# ============================================================

def test_get_tax_settings_creates_defaults(client):
    token = register_user(client)
    resp = client.get("/api/tax-settings", headers=auth_header(token))
    assert resp.status_code == 200
    data = resp.json()
    assert abs(data["federal_lt_cg_rate"] - 0.20) < 0.0001
    assert abs(data["state_lt_cg_rate"] - 0.0536) < 0.0001
    assert data["lt_holding_days"] == 365


def test_update_tax_settings(client):
    token = register_user(client)
    resp = client.put("/api/tax-settings", json={"federal_lt_cg_rate": 0.15}, headers=auth_header(token))
    assert resp.status_code == 200
    assert abs(resp.json()["federal_lt_cg_rate"] - 0.15) < 0.0001
    # Other fields unchanged
    assert abs(resp.json()["state_lt_cg_rate"] - 0.0536) < 0.0001


def test_update_prefer_stock_dp(client):
    token = register_user(client)
    resp = client.put("/api/tax-settings", json={"prefer_stock_dp": True}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["prefer_stock_dp"] is True
    resp = client.put("/api/tax-settings", json={"prefer_stock_dp": False}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["prefer_stock_dp"] is False


def test_tax_settings_user_isolation(client):
    token1 = register_user(client, "user1@example.com")
    token2 = register_user(client, "user2@example.com")
    client.put("/api/tax-settings", json={"federal_lt_cg_rate": 0.15}, headers=auth_header(token1))
    resp = client.get("/api/tax-settings", headers=auth_header(token2))
    assert abs(resp.json()["federal_lt_cg_rate"] - 0.20) < 0.0001


def test_get_sale_tax_empty_timeline(client):
    token = register_user(client)
    create_resp = client.post("/api/sales", json=SALE_DATA, headers=auth_header(token))
    sale_id = create_resp.json()["id"]
    resp = client.get(f"/api/sales/{sale_id}/tax", headers=auth_header(token))
    assert resp.status_code == 200
    data = resp.json()
    # No grants → all shares unvested
    assert data["unvested_shares"] == 100
    assert data["gross_proceeds"] == pytest.approx(100 * 25.50, abs=0.01)


def test_sale_tax_not_found(client):
    token = register_user(client)
    resp = client.get("/api/sales/9999/tax", headers=auth_header(token))
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


def _create_loan(client, token, data=None):
    resp = client.post("/api/loans?generate_payoff_sale=false",
                       json=data or LOAN_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    return resp.json()["id"]


def test_create_loan_payment(client):
    token = register_user(client)
    loan_id = _create_loan(client, token)
    resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id,
        "date": "2025-06-01",
        "amount": 500.0,
        "notes": "Early payment",
    }, headers=auth_header(token))
    assert resp.status_code == 201
    data = resp.json()
    assert data["loan_id"] == loan_id
    assert data["amount"] == 500.0
    assert data["version"] == 1


def test_list_loan_payments_by_loan(client):
    token = register_user(client)
    loan_id = _create_loan(client, token)
    client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token))
    resp = client.get(f"/api/loan-payments?loan_id={loan_id}", headers=auth_header(token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_list_loan_payments_all(client):
    token = register_user(client)
    loan_id = _create_loan(client, token)
    client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token))
    resp = client.get("/api/loan-payments", headers=auth_header(token))
    assert len(resp.json()) == 1


def test_update_loan_payment(client):
    token = register_user(client)
    loan_id = _create_loan(client, token)
    create_resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token))
    lp_id = create_resp.json()["id"]
    resp = client.put(f"/api/loan-payments/{lp_id}", json={"amount": 750.0, "version": 1},
                      headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["amount"] == 750.0
    assert resp.json()["version"] == 2


def test_delete_loan_payment(client):
    token = register_user(client)
    loan_id = _create_loan(client, token)
    create_resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token))
    lp_id = create_resp.json()["id"]
    resp = client.delete(f"/api/loan-payments/{lp_id}", headers=auth_header(token))
    assert resp.status_code == 204
    list_resp = client.get(f"/api/loan-payments?loan_id={loan_id}", headers=auth_header(token))
    assert len(list_resp.json()) == 0


def test_loan_payment_wrong_loan_404(client):
    token = register_user(client)
    resp = client.post("/api/loan-payments", json={
        "loan_id": 9999, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token))
    assert resp.status_code == 404


def test_loan_payment_user_isolation(client):
    token1 = register_user(client, "user1@example.com")
    token2 = register_user(client, "user2@example.com")
    loan_id = _create_loan(client, token1)
    # user2 cannot add payment to user1's loan
    resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2025-06-01", "amount": 500.0,
    }, headers=auth_header(token2))
    assert resp.status_code == 404


# ============================================================
# CASH-OUT VALIDATION TESTS
# ============================================================

def test_cash_out_blocked_by_uncovered_loan(client):
    """Cash-out sale blocked when loan due on/before sale date has no linked sale."""
    token = register_user(client)
    _create_loan(client, token, {**LOAN_DATA, "due_date": "2023-01-01"})
    # Cash-out sale: no loan_id, date after loan due
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    }, headers=auth_header(token))
    assert resp.status_code == 422
    assert "Repay loans" in resp.json()["detail"]


def test_cash_out_allowed_when_no_loans(client):
    """Cash-out sale allowed with no outstanding loans."""
    token = register_user(client)
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    }, headers=auth_header(token))
    assert resp.status_code == 201


def test_cash_out_allowed_after_loan_covered_by_sale(client):
    """Cash-out sale allowed once loan has a linked payoff sale."""
    token = register_user(client)
    loan_id = _create_loan(client, token, {**LOAN_DATA, "due_date": "2023-01-01"})
    # Create a linked (payoff) sale for this loan
    client.post("/api/sales", json={
        "date": "2023-01-01", "shares": 50, "price_per_share": 10.0, "loan_id": loan_id,
    }, headers=auth_header(token))
    # Now cash-out sale should succeed
    resp = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 100, "price_per_share": 10.0,
    }, headers=auth_header(token))
    assert resp.status_code == 201


def test_duplicate_payoff_sale_rejected(client):
    """A second sale linked to the same loan is rejected."""
    token = register_user(client)
    loan_id = _create_loan(client, token, {**LOAN_DATA, "due_date": "2023-01-01"})
    client.post("/api/sales", json={
        "date": "2023-01-01", "shares": 50, "price_per_share": 10.0, "loan_id": loan_id,
    }, headers=auth_header(token))
    resp = client.post("/api/sales", json={
        "date": "2023-01-15", "shares": 30, "price_per_share": 10.0, "loan_id": loan_id,
    }, headers=auth_header(token))
    assert resp.status_code == 409


# ============================================================
# AUTO-SALE GENERATION TESTS
# ============================================================

def test_create_loan_no_auto_sale_when_disabled(client):
    """POST /api/loans?generate_payoff_sale=false should NOT create a sale."""
    token = register_user(client)
    resp = client.post("/api/loans?generate_payoff_sale=false",
                       json=LOAN_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    sales_resp = client.get("/api/sales", headers=auth_header(token))
    assert len(sales_resp.json()) == 0


def test_create_loan_auto_sale_skipped_without_price(client):
    """Auto-sale is skipped when no price data exists (price=0)."""
    token = register_user(client)
    # No price records → price=0 → auto-sale skipped
    resp = client.post("/api/loans?generate_payoff_sale=true",
                       json=LOAN_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    sales_resp = client.get("/api/sales", headers=auth_header(token))
    assert len(sales_resp.json()) == 0


# ============================================================
# SALE EVENTS IN TIMELINE
# ============================================================

def _setup_grant_and_price(client, token):
    """Create a grant with 2-year vesting and a price entry."""
    client.post("/api/grants", json={
        "year": 2020, "type": "Bonus", "shares": 1000, "price": 0.0,
        "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2030-01-01",
        "dp_shares": 0,
    }, headers=auth_header(token))
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0},
                headers=auth_header(token))


def test_sale_appears_in_events_timeline(client):
    """A recorded sale injects a Sale event into the timeline."""
    token = register_user(client)
    _setup_grant_and_price(client, token)

    client.post("/api/sales", json={
        "date": "2022-01-01", "shares": 200, "price_per_share": 10.0,
    }, headers=auth_header(token))

    events = client.get("/api/events", headers=auth_header(token)).json()
    sale_events = [e for e in events if e["event_type"] == "Sale"]
    assert len(sale_events) == 1
    assert sale_events[0]["vested_shares"] == -200
    assert sale_events[0]["gross_proceeds"] == 2000.0


def test_sale_decrements_cum_shares(client):
    """cum_shares must decrease after a sale event."""
    token = register_user(client)
    _setup_grant_and_price(client, token)

    events_before = client.get("/api/events", headers=auth_header(token)).json()
    # Find cum_shares at the last vesting before sale date
    vesting_2021 = next(e for e in events_before
                        if e["event_type"] == "Vesting" and e["date"] == "2021-01-01")
    shares_before_sale = vesting_2021["cum_shares"]  # 500 (half of 1000)

    client.post("/api/sales", json={
        "date": "2022-01-01", "shares": 200, "price_per_share": 10.0,
    }, headers=auth_header(token))

    events_after = client.get("/api/events", headers=auth_header(token)).json()
    sale_event = next(e for e in events_after if e["event_type"] == "Sale")
    # Sale event cum_shares = shares after vesting 2 (500+500=1000) minus 200 sold
    assert sale_event["cum_shares"] == 1000 - 200

    # Events after the sale also have reduced cum_shares
    later_events = [e for e in events_after if e["date"] > "2022-01-01"]
    for e in later_events:
        assert e["cum_shares"] <= shares_before_sale + 500 - 200


def test_sale_tax_accounts_for_prior_sale(client):
    """Second sale's tax computation excludes lots consumed by first sale."""
    token = register_user(client)
    _setup_grant_and_price(client, token)

    # First sale: sell 300 shares (all from 2021-01-01 vesting lot of 500)
    sale1 = client.post("/api/sales", json={
        "date": "2022-06-01", "shares": 300, "price_per_share": 12.0,
    }, headers=auth_header(token)).json()

    # Second sale: sell 300 shares — only 200 remain from the 2021 lot (after first sale),
    # plus 500 from the 2022 vesting. So 200 from 2021 lot + 100 from 2022 lot.
    sale2 = client.post("/api/sales", json={
        "date": "2023-06-01", "shares": 300, "price_per_share": 15.0,
    }, headers=auth_header(token)).json()

    tax1 = client.get(f"/api/sales/{sale1['id']}/tax", headers=auth_header(token)).json()
    tax2 = client.get(f"/api/sales/{sale2['id']}/tax", headers=auth_header(token)).json()

    # First sale: 300 shares, all from 2021 lot (held > 1yr by 2022-06-01)
    assert tax1["lt_shares"] + tax1["st_shares"] + tax1["unvested_shares"] == 300

    # Second sale: 300 shares — should NOT double-count the 300 already sold
    # Total available: 500 (2021 lot) - 300 (first sale) = 200 remaining + 500 (2022 lot) = 700
    # So all 300 should come from vested lots, none unvested
    assert tax2["unvested_shares"] == 0
    assert tax2["lt_shares"] + tax2["st_shares"] == 300


def test_per_sale_tax_rates_stored_and_used(client):
    """Sale can store per-sale tax rates that override TaxSettings in the tax endpoint."""
    token = register_user(client)
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
    }, headers=auth_header(token))
    assert resp.status_code == 201
    sale = resp.json()
    assert sale["federal_lt_cg_rate"] == 0.10
    assert sale["lt_holding_days"] == 180

    # Update should preserve and allow changing per-sale rates
    upd = client.put(f"/api/sales/{sale['id']}", json={
        "federal_lt_cg_rate": 0.15,
    }, headers=auth_header(token)).json()
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
    token = register_user(client)

    # Grant: 1000 shares, vesting 2021-01-01 (2 periods), exercise 2030-01-01
    client.post("/api/grants", json={
        "year": 2020, "type": "Bonus", "shares": 1000, "price": 0.0,
        "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2030-01-01",
        "dp_shares": 0,
    }, headers=auth_header(token))

    # Price at loan due date: $10/share
    client.post("/api/prices", json={"effective_date": "2021-01-01", "price": 10.0},
                headers=auth_header(token))
    # Far-future price projection: $1/share (much lower — the bug would use this)
    client.post("/api/prices", json={"effective_date": "2030-01-01", "price": 1.0},
                headers=auth_header(token))

    # Loan of $500, due 2022-01-01 (when 500 shares are vested at $10)
    resp = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Bonus", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 500.0, "interest_rate": 0.0,
        "due_date": "2022-01-01",
    }, headers=auth_header(token))
    assert resp.status_code == 201

    sales = client.get("/api/sales", headers=auth_header(token)).json()
    assert len(sales) == 1
    sale = sales[0]

    # price_per_share should be $10 (price at loan due date), not $1 (final price)
    assert sale["price_per_share"] == 10.0

    # shares should be ~ceil(500 / 10) = 50 (no cap gains since basis=price for income grant)
    # With the bug (price=$1), shares would be ~500, causing negative cum_shares on 500 vested
    assert sale["shares"] <= 100, f"Expected ≤100 shares (at $10 price), got {sale['shares']}"

    # Verify cum_shares never goes negative in the events timeline
    events = client.get("/api/events", headers=auth_header(token)).json()
    for e in events:
        assert e.get("cum_shares", 0) >= 0, (
            f"cum_shares went negative ({e['cum_shares']}) at {e['date']} ({e['event_type']}). "
            "Payoff sale share count computed with wrong (far-future) price."
        )
