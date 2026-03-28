import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


def _seed_data(client):
    """Create a grant, loan, and price for the user."""
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2021-03-01", "periods": 5, "exercise_date": "2020-12-31", "dp_shares": 0,
    })
    client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 2000.0, "interest_rate": 3.5,
        "due_date": "2025-12-31", "loan_number": "L001",
    })
    client.post("/api/prices", json={
        "effective_date": "2021-03-01", "price": 3.0,
    })


def _counts(client):
    grants = client.get("/api/grants").json()
    loans = client.get("/api/loans").json()
    prices = client.get("/api/prices").json()
    return len(grants), len(loans), len(prices)


# ============================================================
# POST /api/me/reset — Reset financial data
# ============================================================

def test_reset_deletes_financial_data(client):
    register_user(client)
    _seed_data(client)
    assert _counts(client) == (1, 1, 1)

    resp = client.post("/api/me/reset")
    assert resp.status_code == 204

    assert _counts(client) == (0, 0, 0)


def test_reset_preserves_account(client):
    register_user(client)
    _seed_data(client)
    client.post("/api/me/reset")

    # Account still works
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


def test_reset_does_not_affect_other_users(client, make_client):
    register_user(client, "user1@test.com")
    _seed_data(client)

    with make_client("user2@test.com") as client2:
        _seed_data(client2)
        assert _counts(client2) == (1, 1, 1)

        client.post("/api/me/reset")
        assert _counts(client) == (0, 0, 0)

        # user2's data is unaffected
        assert _counts(client2) == (1, 1, 1)


def test_reset_requires_auth(client):
    resp = client.post("/api/me/reset")
    assert resp.status_code == 401


# ============================================================
# DELETE /api/me — Delete account
# ============================================================

def test_delete_account(client):
    register_user(client)
    _seed_data(client)

    resp = client.delete("/api/me")
    assert resp.status_code == 204

    # Cookie no longer works — user gone
    resp = client.get("/api/me")
    assert resp.status_code == 401


def test_delete_account_removes_all_data(client, db_session):
    register_user(client)
    _seed_data(client)

    client.delete("/api/me")

    from scaffold.models import User, Grant, Loan, Price
    assert db_session.query(User).count() == 0
    assert db_session.query(Grant).count() == 0
    assert db_session.query(Loan).count() == 0
    assert db_session.query(Price).count() == 0


def test_delete_does_not_affect_other_users(client, make_client):
    register_user(client, "user1@test.com")
    _seed_data(client)

    with make_client("user2@test.com") as client2:
        _seed_data(client2)

        client.delete("/api/me")
        assert _counts(client2) == (1, 1, 1)

        resp = client2.get("/api/me")
        assert resp.status_code == 200


def test_delete_requires_auth(client):
    resp = client.delete("/api/me")
    assert resp.status_code == 401
