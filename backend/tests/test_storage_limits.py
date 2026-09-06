"""Bounds on what one account can write to the database.

The body limit caps a single request; these cap what a run of valid requests
can accumulate. Encrypted columns store several times the bytes they are given,
so an unbounded note field is a shared-disk exhaustion path.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


from schemas import MAX_BULK_ITEMS, MAX_LABEL_LEN, MAX_NOTES_LEN
from tests.conftest import register_user

BIG = "A" * 900_000


def _grant(**over):
    g = {
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    }
    g.update(over)
    return g


def _loan(**over):
    ln = {
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 1000.0, "interest_rate": 5.0,
        "due_date": "2025-01-01",
    }
    ln.update(over)
    return ln


# ── Field lengths ────────────────────────────────────────────────────────────

def test_grant_type_length_is_capped(client):
    register_user(client)
    assert client.post("/api/grants", json=_grant(type=BIG)).status_code == 422
    assert client.post("/api/grants", json=_grant(type="A" * (MAX_LABEL_LEN + 1))).status_code == 422
    assert client.post("/api/grants", json=_grant(type="A" * MAX_LABEL_LEN)).status_code == 201


def test_grant_update_type_length_is_capped(client):
    register_user(client)
    gid = client.post("/api/grants", json=_grant()).json()["id"]
    assert client.put(f"/api/grants/{gid}", json={"type": BIG}).status_code == 422


def test_loan_grant_type_and_number_lengths_are_capped(client):
    register_user(client)
    client.post("/api/grants", json=_grant())
    assert client.post("/api/loans", json=_loan(grant_type=BIG)).status_code == 422
    assert client.post("/api/loans", json=_loan(loan_number=BIG)).status_code == 422


def test_sale_notes_length_is_capped(client):
    register_user(client)
    sale = {"date": "2024-01-01", "shares": 10, "price_per_share": 5.0, "notes": BIG}
    assert client.post("/api/sales", json=sale).status_code == 422
    sale["notes"] = "n" * (MAX_NOTES_LEN + 1)
    assert client.post("/api/sales", json=sale).status_code == 422


def test_loan_payment_notes_length_is_capped(client):
    register_user(client)
    client.post("/api/grants", json=_grant())
    loan_id = client.post("/api/loans", json=_loan()).json()["id"]
    resp = client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2024-01-01", "amount": 10.0, "notes": BIG,
    })
    assert resp.status_code == 422


def test_lot_overrides_list_is_capped(client):
    register_user(client)
    resp = client.post("/api/sales", json={
        "date": "2024-01-01", "shares": 10, "price_per_share": 5.0,
        "lot_overrides": [{"shares": 1}] * 501,
    })
    assert resp.status_code == 422


# ── Bulk list lengths ────────────────────────────────────────────────────────

def test_bulk_grant_creation_is_capped(client):
    register_user(client)
    items = [_grant(year=1900 + i) for i in range(MAX_BULK_ITEMS + 1)]
    assert client.post("/api/grants/bulk", json=items).status_code == 422


def test_bulk_loan_creation_is_capped(client):
    register_user(client)
    items = [_loan() for _ in range(MAX_BULK_ITEMS + 1)]
    assert client.post("/api/loans/bulk", json=items).status_code == 422


def test_wizard_submit_list_is_capped(client):
    register_user(client)
    resp = client.post("/api/wizard/submit", json={
        "grants": [], "prices": [{"effective_date": "2020-01-01", "price": 1.0}] * (MAX_BULK_ITEMS + 1),
    })
    assert resp.status_code == 422


# ── Row quotas ───────────────────────────────────────────────────────────────

def test_row_quota_blocks_the_write_that_would_exceed_it(client, db_session, monkeypatch):
    from scaffold.models import Grant
    import scaffold.quota as quota
    register_user(client)
    monkeypatch.setitem(quota.ROW_QUOTAS, "Grant", 2)
    assert client.post("/api/grants", json=_grant(year=2020)).status_code == 201
    assert client.post("/api/grants", json=_grant(year=2021)).status_code == 201
    resp = client.post("/api/grants", json=_grant(year=2022))
    assert resp.status_code == 409
    assert "at most" in resp.json()["detail"]
    assert db_session.query(Grant).count() == 2


def test_row_quota_counts_the_whole_bulk_batch(client, monkeypatch):
    import scaffold.quota as quota
    register_user(client)
    monkeypatch.setitem(quota.ROW_QUOTAS, "Grant", 2)
    items = [_grant(year=2020 + i) for i in range(3)]
    assert client.post("/api/grants/bulk", json=items).status_code == 409


def test_row_quota_is_per_user(client, make_client, monkeypatch):
    import scaffold.quota as quota
    monkeypatch.setitem(quota.ROW_QUOTAS, "Grant", 1)
    register_user(client)
    assert client.post("/api/grants", json=_grant()).status_code == 201
    assert client.post("/api/grants", json=_grant(year=2021)).status_code == 409
    with make_client("other@example.com") as other:
        assert other.post("/api/grants", json=_grant()).status_code == 201


def test_growth_prices_cannot_outrun_the_price_quota(client, monkeypatch):
    import scaffold.quota as quota
    from datetime import date
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 5.0})
    monkeypatch.setitem(quota.ROW_QUOTAS, "Price", 3)
    next_year = date.today().year + 1
    resp = client.post("/api/flows/growth-price", json={
        "annual_growth_pct": 10,
        "first_date": f"{next_year}-01-01",
        "through_date": f"{next_year + 50}-01-01",
    })
    assert resp.status_code == 409


def test_wizard_clear_existing_respects_the_quota(client, monkeypatch):
    import scaffold.quota as quota
    register_user(client)
    monkeypatch.setitem(quota.ROW_QUOTAS, "Price", 2)
    resp = client.post("/api/wizard/submit", json={
        "grants": [],
        "prices": [{"effective_date": f"20{10 + i}-01-01", "price": 1.0} for i in range(3)],
        "clear_existing": True,
    })
    assert resp.status_code == 409


# ── Mutation rate limit ──────────────────────────────────────────────────────

def test_mutations_are_rate_limited_per_account(client, make_client, monkeypatch):
    """E2E_TEST disables the limiter, so this test turns it back on."""
    import main
    import scaffold.rate_limit as rl
    register_user(client)
    with make_client("other@example.com") as other:
        monkeypatch.delenv("E2E_TEST", raising=False)
        monkeypatch.setattr(main, "_MUTATION_LIMIT", 3)
        monkeypatch.setattr(rl, "_redis_checked", True)
        monkeypatch.setattr(rl, "_redis_client", None)
        rl._calls.clear()

        codes = [
            client.post("/api/prices", json={"effective_date": f"2020-01-0{i + 1}", "price": 5.0}).status_code
            for i in range(4)
        ]
        assert codes[:3] == [201, 201, 201]
        assert codes[3] == 429

        # Reads are untouched, and the limit is keyed on the account.
        assert client.get("/api/prices").status_code == 200
        assert other.post("/api/prices", json={"effective_date": "2020-01-01", "price": 5.0}).status_code == 201
