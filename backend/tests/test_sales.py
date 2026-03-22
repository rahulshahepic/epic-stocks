"""Tests for sales CRUD, tax computation, and FIFO engine."""
import sys
import os
from datetime import date, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header
from sales_engine import build_fifo_lots, compute_sale_tax
from collections import deque


# ============================================================
# FIFO ENGINE UNIT TESTS
# ============================================================

def _make_vesting_event(vest_date, shares, share_price, grant_price=0.0):
    return {
        "date": vest_date,
        "event_type": "Vesting",
        "vested_shares": shares,
        "grant_price": grant_price,
        "share_price": share_price,
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
