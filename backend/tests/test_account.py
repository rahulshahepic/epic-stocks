import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


def _seed_data(client, token):
    """Create a grant, loan, and price for the user."""
    h = auth_header(token)
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2021-03-01", "periods": 5, "exercise_date": "2020-12-31", "dp_shares": 0,
    }, headers=h)
    client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 2000.0, "interest_rate": 3.5,
        "due_date": "2025-12-31", "loan_number": "L001",
    }, headers=h)
    client.post("/api/prices", json={
        "effective_date": "2021-03-01", "price": 3.0,
    }, headers=h)


def _counts(client, token):
    h = auth_header(token)
    grants = client.get("/api/grants", headers=h).json()
    loans = client.get("/api/loans", headers=h).json()
    prices = client.get("/api/prices", headers=h).json()
    return len(grants), len(loans), len(prices)


# ============================================================
# POST /api/me/reset — Reset financial data
# ============================================================

def test_reset_deletes_financial_data(client):
    token = register_user(client)
    _seed_data(client, token)
    assert _counts(client, token) == (1, 1, 1)

    resp = client.post("/api/me/reset", headers=auth_header(token))
    assert resp.status_code == 204

    assert _counts(client, token) == (0, 0, 0)


def test_reset_preserves_account(client):
    token = register_user(client)
    _seed_data(client, token)
    client.post("/api/me/reset", headers=auth_header(token))

    # Account still works
    resp = client.get("/api/me", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


def test_reset_does_not_affect_other_users(client):
    token1 = register_user(client, "user1@test.com")
    token2 = register_user(client, "user2@test.com")
    _seed_data(client, token1)
    _seed_data(client, token2)

    client.post("/api/me/reset", headers=auth_header(token1))
    assert _counts(client, token1) == (0, 0, 0)
    assert _counts(client, token2) == (1, 1, 1)


def test_reset_requires_auth(client):
    resp = client.post("/api/me/reset")
    assert resp.status_code == 401


# ============================================================
# DELETE /api/me — Delete account
# ============================================================

def test_delete_account(client):
    token = register_user(client)
    _seed_data(client, token)

    resp = client.delete("/api/me", headers=auth_header(token))
    assert resp.status_code == 204

    # Token no longer works — user gone
    resp = client.get("/api/me", headers=auth_header(token))
    assert resp.status_code == 401


def test_delete_account_removes_all_data(client, db_session):
    token = register_user(client)
    _seed_data(client, token)

    client.delete("/api/me", headers=auth_header(token))

    from models import User, Grant, Loan, Price
    assert db_session.query(User).count() == 0
    assert db_session.query(Grant).count() == 0
    assert db_session.query(Loan).count() == 0
    assert db_session.query(Price).count() == 0


def test_delete_does_not_affect_other_users(client):
    token1 = register_user(client, "user1@test.com")
    token2 = register_user(client, "user2@test.com")
    _seed_data(client, token1)
    _seed_data(client, token2)

    client.delete("/api/me", headers=auth_header(token1))
    assert _counts(client, token2) == (1, 1, 1)

    resp = client.get("/api/me", headers=auth_header(token2))
    assert resp.status_code == 200


def test_delete_requires_auth(client):
    resp = client.delete("/api/me")
    assert resp.status_code == 401
