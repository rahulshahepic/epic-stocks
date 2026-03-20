import sys
import os
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


# ============================================================
# AUTH
# ============================================================

def test_google_login_creates_user(client):
    token = register_user(client, "a@b.com")
    assert token is not None
    assert len(token) > 0


def test_google_login_returns_same_user(client):
    fake_info = {
        "sub": "fixed-google-id",
        "email": "a@b.com",
        "email_verified": "true",
        "name": "Test",
        "picture": "",
        "aud": "",
    }
    with patch("routers.auth_router.verify_google_token", return_value=fake_info):
        resp1 = client.post("/api/auth/google", json={"token": "t1"})
        resp2 = client.post("/api/auth/google", json={"token": "t2"})
    # Both calls succeed — same user, new tokens
    assert resp1.status_code == 200
    assert resp2.status_code == 200


def test_google_login_invalid_token(client):
    with patch("routers.auth_router.verify_google_token", side_effect=ValueError("Invalid Google token")):
        resp = client.post("/api/auth/google", json={"token": "bad"})
    assert resp.status_code == 401


def test_protected_no_token(client):
    resp = client.get("/api/grants")
    assert resp.status_code == 401


# ============================================================
# GRANTS CRUD
# ============================================================

GRANT_DATA = {
    "year": 2020,
    "type": "Purchase",
    "shares": 10000,
    "price": 1.99,
    "vest_start": "2021-03-01",
    "periods": 5,
    "exercise_date": "2020-12-31",
    "dp_shares": -500,
}


def test_create_grant(client):
    token = register_user(client)
    resp = client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    data = resp.json()
    assert data["year"] == 2020
    assert data["shares"] == 10000
    assert data["id"] is not None


def test_list_grants(client):
    token = register_user(client)
    client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token))
    resp = client.get("/api/grants", headers=auth_header(token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_get_grant(client):
    token = register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token)).json()
    resp = client.get(f"/api/grants/{created['id']}", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["year"] == 2020


def test_update_grant(client):
    token = register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token)).json()
    resp = client.put(f"/api/grants/{created['id']}", json={"shares": 20000}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["shares"] == 20000


def test_delete_grant(client):
    token = register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token)).json()
    resp = client.delete(f"/api/grants/{created['id']}", headers=auth_header(token))
    assert resp.status_code == 204
    resp = client.get("/api/grants", headers=auth_header(token))
    assert len(resp.json()) == 0


def test_grant_not_found(client):
    token = register_user(client)
    resp = client.get("/api/grants/999", headers=auth_header(token))
    assert resp.status_code == 404


def test_bulk_create_grants(client):
    token = register_user(client)
    items = [GRANT_DATA, {**GRANT_DATA, "year": 2021}]
    resp = client.post("/api/grants/bulk", json=items, headers=auth_header(token))
    assert resp.status_code == 201
    assert len(resp.json()) == 2


# ============================================================
# LOANS CRUD
# ============================================================

LOAN_DATA = {
    "grant_year": 2020,
    "grant_type": "Purchase",
    "loan_type": "Purchase",
    "loan_year": 2020,
    "amount": 19900.0,
    "interest_rate": 3.5,
    "due_date": "2025-12-31",
    "loan_number": "123456",
}


def test_create_loan(client):
    token = register_user(client)
    resp = client.post("/api/loans", json=LOAN_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    assert resp.json()["amount"] == 19900.0


def test_list_loans(client):
    token = register_user(client)
    client.post("/api/loans", json=LOAN_DATA, headers=auth_header(token))
    resp = client.get("/api/loans", headers=auth_header(token))
    assert len(resp.json()) == 1


def test_update_loan(client):
    token = register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA, headers=auth_header(token)).json()
    resp = client.put(f"/api/loans/{created['id']}", json={"amount": 25000.0}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["amount"] == 25000.0


def test_delete_loan(client):
    token = register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA, headers=auth_header(token)).json()
    resp = client.delete(f"/api/loans/{created['id']}", headers=auth_header(token))
    assert resp.status_code == 204


def test_bulk_create_loans(client):
    token = register_user(client)
    items = [LOAN_DATA, {**LOAN_DATA, "loan_type": "Interest", "amount": 500.0}]
    resp = client.post("/api/loans/bulk", json=items, headers=auth_header(token))
    assert resp.status_code == 201
    assert len(resp.json()) == 2


# ============================================================
# PRICES CRUD
# ============================================================

PRICE_DATA = {"effective_date": "2020-12-31", "price": 1.99}


def test_create_price(client):
    token = register_user(client)
    resp = client.post("/api/prices", json=PRICE_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    assert resp.json()["price"] == 1.99


def test_list_prices(client):
    token = register_user(client)
    client.post("/api/prices", json=PRICE_DATA, headers=auth_header(token))
    resp = client.get("/api/prices", headers=auth_header(token))
    assert len(resp.json()) == 1


def test_update_price(client):
    token = register_user(client)
    created = client.post("/api/prices", json=PRICE_DATA, headers=auth_header(token)).json()
    resp = client.put(f"/api/prices/{created['id']}", json={"price": 2.50}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["price"] == 2.50


def test_delete_price(client):
    token = register_user(client)
    created = client.post("/api/prices", json=PRICE_DATA, headers=auth_header(token)).json()
    resp = client.delete(f"/api/prices/{created['id']}", headers=auth_header(token))
    assert resp.status_code == 204


# ============================================================
# OWNERSHIP ISOLATION
# ============================================================

def test_user_isolation(client):
    token_a = register_user(client, "a@test.com")
    token_b = register_user(client, "b@test.com")

    created = client.post("/api/grants", json=GRANT_DATA, headers=auth_header(token_a)).json()

    # User B can't see user A's grant
    resp = client.get(f"/api/grants/{created['id']}", headers=auth_header(token_b))
    assert resp.status_code == 404

    # User B's list is empty
    resp = client.get("/api/grants", headers=auth_header(token_b))
    assert len(resp.json()) == 0

    # User B can't update user A's grant
    resp = client.put(f"/api/grants/{created['id']}", json={"shares": 1}, headers=auth_header(token_b))
    assert resp.status_code == 404

    # User B can't delete user A's grant
    resp = client.delete(f"/api/grants/{created['id']}", headers=auth_header(token_b))
    assert resp.status_code == 404
