"""refinances_loan_id must point at a loan the caller owns.

POST /api/loans and PUT /api/loans/{id} checked this; POST /api/loans/bulk did
not. The consequence is not a read of someone else's data — the id is opaque —
but a write into their account's referential integrity: refinances_loan_id is a
plain FK with no ON DELETE, so a row pointing at a victim's loan makes *their*
account deletion and data reset fail on the constraint. The victim cannot clear
it, because the offending row is in an account they cannot see.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user

LOAN = {
    "grant_year": 2020,
    "grant_type": "Purchase",
    "loan_type": "Purchase",
    "loan_year": 2020,
    "amount": 19900.0,
    "interest_rate": 3.5,
    "due_date": "2025-12-31",
}


def _victims_loan(make_client) -> int:
    with make_client("victim@example.com") as victim:
        resp = victim.post("/api/loans", json={**LOAN, "loan_number": "V-1"})
        assert resp.status_code == 201
        return resp.json()["id"]


def test_bulk_create_refuses_another_users_loan(client, make_client):
    victim_loan_id = _victims_loan(make_client)
    register_user(client, "attacker@example.com")

    resp = client.post("/api/loans/bulk", json=[
        {**LOAN, "loan_number": "A-1", "refinances_loan_id": victim_loan_id},
    ])

    assert resp.status_code == 400
    assert "another user" in resp.json()["detail"]
    assert client.get("/api/loans").json() == []


def test_bulk_create_writes_nothing_when_one_item_is_bad(client, make_client):
    """The whole batch is checked before the first row is written.

    Otherwise a bad reference at the end of the batch leaves the good rows
    behind, and the caller cannot tell which of them landed.
    """
    victim_loan_id = _victims_loan(make_client)
    register_user(client, "attacker@example.com")

    resp = client.post("/api/loans/bulk", json=[
        {**LOAN, "loan_number": "A-1"},
        {**LOAN, "loan_number": "A-2", "refinances_loan_id": victim_loan_id},
    ])

    assert resp.status_code == 400
    assert client.get("/api/loans").json() == []


def test_bulk_create_still_accepts_the_callers_own_loan(client):
    register_user(client, "owner@example.com")
    own = client.post("/api/loans", json={**LOAN, "loan_number": "O-1"}).json()

    resp = client.post("/api/loans/bulk", json=[
        {**LOAN, "loan_number": "O-2", "loan_type": "Interest",
         "refinances_loan_id": own["id"]},
    ])

    assert resp.status_code == 201
    assert resp.json()[0]["refinances_loan_id"] == own["id"]


def test_bulk_create_refuses_a_loan_id_that_does_not_exist(client):
    register_user(client, "owner@example.com")
    resp = client.post("/api/loans/bulk", json=[
        {**LOAN, "refinances_loan_id": 987654},
    ])
    assert resp.status_code == 400


def test_the_victim_can_still_reset_and_delete_their_account(client, make_client):
    """The point of the check: a cross-account row would break both of these.

    Both go through user_deletion.py, which nulls refinances_loan_id only for
    rows the user owns — a foreign row pointing in is not something it can
    reach, so the DELETE hits the FK constraint and the account is stuck.
    """
    victim_loan_id = _victims_loan(make_client)

    register_user(client, "attacker@example.com")
    client.post("/api/loans/bulk", json=[
        {**LOAN, "loan_number": "A-1", "refinances_loan_id": victim_loan_id},
    ])

    with make_client("victim@example.com") as victim:
        assert victim.post("/api/me/reset").status_code == 204
        assert victim.delete("/api/me").status_code == 204


def test_single_create_and_update_are_unchanged(client, make_client):
    """The two paths that already had the check keep their behaviour."""
    victim_loan_id = _victims_loan(make_client)
    register_user(client, "attacker@example.com")

    created = client.post("/api/loans", json={**LOAN, "loan_number": "A-1"}).json()

    resp = client.post("/api/loans", json={
        **LOAN, "loan_number": "A-2", "refinances_loan_id": victim_loan_id,
    })
    assert resp.status_code == 400

    resp = client.put(f"/api/loans/{created['id']}",
                      json={"refinances_loan_id": victim_loan_id})
    assert resp.status_code == 400

    resp = client.put(f"/api/loans/{created['id']}",
                      json={"refinances_loan_id": created["id"]})
    assert resp.status_code == 400
    assert "cannot refinance itself" in resp.json()["detail"]
