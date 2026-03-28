"""Tests for input validation on grants, loans, prices, and flows."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


# ============================================================
# GRANT VALIDATION
# ============================================================

def test_grant_rejects_negative_shares(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": -10, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_grant_rejects_empty_type(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_grant_rejects_zero_periods(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 0, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_grant_rejects_negative_price(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": -1.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_grant_allows_zero_price_for_bonus(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Bonus", "shares": 100, "price": 0.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 201

def test_grant_rejects_bad_year(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 1800, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_grant_update_validates_too(client):
    register_user(client)
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    gid = resp.json()["id"]
    resp = client.put(f"/api/grants/{gid}", json={"shares": -5})
    assert resp.status_code == 422


# ============================================================
# LOAN VALIDATION
# ============================================================

def test_loan_rejects_invalid_loan_type(client):
    register_user(client)
    resp = client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "BadType",
        "loan_year": 2020, "amount": 5000, "interest_rate": 0.05,
        "due_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_loan_rejects_negative_amount(client):
    register_user(client)
    resp = client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Interest",
        "loan_year": 2020, "amount": -100, "interest_rate": 0.05,
        "due_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_loan_rejects_negative_rate(client):
    register_user(client)
    resp = client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Interest",
        "loan_year": 2020, "amount": 5000, "interest_rate": -0.05,
        "due_date": "2025-01-01",
    })
    assert resp.status_code == 422


# ============================================================
# PRICE VALIDATION
# ============================================================

def test_price_rejects_zero(client):
    register_user(client)
    resp = client.post("/api/prices", json={
        "effective_date": "2020-01-01", "price": 0,
    })
    assert resp.status_code == 422

def test_price_rejects_negative(client):
    register_user(client)
    resp = client.post("/api/prices", json={
        "effective_date": "2020-01-01", "price": -5,
    })
    assert resp.status_code == 422


# ============================================================
# FLOW VALIDATION
# ============================================================

def test_flow_purchase_rejects_bad_data(client):
    register_user(client)
    resp = client.post("/api/flows/new-purchase", json={
        "year": 2020, "shares": -1, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_flow_bonus_rejects_zero_periods(client):
    register_user(client)
    resp = client.post("/api/flows/add-bonus", json={
        "year": 2020, "shares": 100, "vest_start": "2020-01-01",
        "periods": 0, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 422

def test_flow_price_rejects_negative(client):
    register_user(client)
    resp = client.post("/api/flows/annual-price", json={
        "effective_date": "2020-01-01", "price": -5,
    })
    assert resp.status_code == 422
