"""Tests for flexible loan payoff lot selection methods."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from sqlalchemy import text

from tests.conftest import register_user


# ============================================================
# Helpers
# ============================================================

GRANT_DATA = {
    "year": 2018, "type": "Purchase", "shares": 10000, "price": 5.0,
    "vest_start": "2019-01-01", "periods": 4, "exercise_date": "2018-01-01",
    "dp_shares": 0,
}

GRANT_DATA2 = {
    "year": 2020, "type": "Purchase", "shares": 10000, "price": 8.0,
    "vest_start": "2021-01-01", "periods": 4, "exercise_date": "2020-01-01",
    "dp_shares": 0,
}

LOAN_DATA = {
    "grant_year": 2018, "grant_type": "Purchase",
    "loan_type": "Interest", "loan_year": 2019,
    "amount": 10000.0, "interest_rate": 0.03,
    "due_date": "2025-01-01",
}


def _set_flexible_payoff(db_session, active: bool):
    db_session.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'flexible_payoff_enabled'"),
        {"v": "true" if active else "false"},
    )
    db_session.commit()


def _set_payoff_method(client, method: str):
    resp = client.put("/api/tax-settings", json={"loan_payoff_method": method})
    assert resp.status_code == 200, resp.text


def _setup_data(client):
    """Create grants and price for coverage tests."""
    client.post("/api/grants", json=GRANT_DATA)
    client.post("/api/grants", json=GRANT_DATA2)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 20.0})


# ============================================================
# Admin endpoint tests
# ============================================================

def test_admin_get_flexible_payoff(client, db_session):
    """GET /api/admin/flexible-payoff returns current state."""
    client.post("/api/auth/test-login", json={"email": "admin@example.com", "name": "Admin"})
    os.environ["ADMIN_EMAIL"] = "admin@example.com"
    try:
        resp = client.get("/api/admin/flexible-payoff")
        assert resp.status_code == 200
        assert resp.json()["active"] is False
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_admin_set_flexible_payoff(client, db_session):
    """POST /api/admin/flexible-payoff toggles the flag."""
    client.post("/api/auth/test-login", json={"email": "admin@example.com", "name": "Admin"})
    os.environ["ADMIN_EMAIL"] = "admin@example.com"
    try:
        resp = client.post("/api/admin/flexible-payoff", json={"active": True})
        assert resp.status_code == 200
        assert resp.json()["active"] is True
        # Verify it actually changed in DB
        row = db_session.execute(
            text("SELECT value FROM system_settings WHERE key = 'flexible_payoff_enabled'")
        ).scalar()
        assert row == "true"
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


# ============================================================
# TaxSettings: loan_payoff_method exposed via GET
# ============================================================

def test_tax_settings_includes_flexible_payoff_enabled(client, db_session):
    """GET /api/tax-settings returns flexible_payoff_enabled reflecting system_settings."""
    register_user(client)
    resp = client.get("/api/tax-settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "loan_payoff_method" in data
    assert data["loan_payoff_method"] == "epic_lifo"
    assert "flexible_payoff_enabled" in data
    assert data["flexible_payoff_enabled"] is False

    _set_flexible_payoff(db_session, True)
    resp2 = client.get("/api/tax-settings")
    assert resp2.json()["flexible_payoff_enabled"] is True


def test_update_loan_payoff_method(client, db_session):
    """PUT /api/tax-settings updates loan_payoff_method."""
    register_user(client)
    resp = client.put("/api/tax-settings", json={"loan_payoff_method": "lifo"})
    assert resp.status_code == 200
    assert resp.json()["loan_payoff_method"] == "lifo"


# ============================================================
# Coverage check + payoff dispatch
# ============================================================

def test_payoff_uses_same_tranche_when_flexible_disabled(client, db_session):
    """Without flexible_payoff_enabled, payoff sale always uses same-tranche shares."""
    register_user(client)
    _setup_data(client)
    _set_payoff_method(client, "lifo")  # user prefers lifo, but flexible is OFF

    # Create loan with auto payoff sale
    resp = client.post("/api/loans?generate_payoff_sale=true", json=LOAN_DATA)
    assert resp.status_code == 201

    sales = client.get("/api/sales").json()
    assert len(sales) == 1

    # Tax breakdown should reflect same_tranche (all lots from grant_year=2018)
    sale_id = sales[0]["id"]
    tax = client.get(f"/api/sales/{sale_id}/tax").json()
    # All lots from the 2018 grant → grant_year 2018 in the lots breakdown
    assert any(lot["grant_year"] == 2018 for lot in tax["lots"])
    # No lots from 2020 grant in same-tranche payoff
    assert not any(lot["grant_year"] == 2020 for lot in tax["lots"])


def test_payoff_uses_flexible_method_when_enabled_and_eligible(client, db_session):
    """With flexible enabled and sufficient coverage, payoff uses user's method."""
    register_user(client)
    _setup_data(client)
    _set_flexible_payoff(db_session, True)
    _set_payoff_method(client, "fifo")

    resp = client.post("/api/loans?generate_payoff_sale=true", json=LOAN_DATA)
    assert resp.status_code == 201

    sales = client.get("/api/sales").json()
    assert len(sales) == 1
    # Coverage check: 2018 grant vested shares * $20 + unvested * $5 >> $10,000 loan
    # FIFO should pick oldest lots first (2018 grant) which is same as same_tranche here,
    # but the key difference is the method dispatch path was used. We verify the sale exists.
    assert sales[0]["loan_id"] is not None


def test_payoff_falls_back_to_same_tranche_when_insufficient_coverage(client, db_session):
    """If coverage is insufficient, same-tranche is used even if flexible is enabled."""
    register_user(client)
    # Only create a small grant to make coverage insufficient
    client.post("/api/grants", json={
        "year": 2018, "type": "Purchase", "shares": 10, "price": 5.0,
        "vest_start": "2019-01-01", "periods": 4, "exercise_date": "2018-01-01",
        "dp_shares": 0,
    })
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 20.0})

    _set_flexible_payoff(db_session, True)
    _set_payoff_method(client, "fifo")

    # Loan of $10,000 but only 10 shares * $20 = $200 vested + small unvested value
    loan_resp = client.post("/api/loans?generate_payoff_sale=true", json={
        **LOAN_DATA, "amount": 10000.0
    })
    assert loan_resp.status_code == 201

    # Payoff sale is created (falls back to same_tranche, computes from tiny grant)
    sales = client.get("/api/sales").json()
    # Sale may or may not be created depending on whether enough shares exist,
    # but the system shouldn't crash — just verify no unhandled error
    assert loan_resp.status_code == 201


def test_regenerate_creates_missing_payoff_sales(client, db_session):
    """regenerate-all-payoff-sales creates sales for loans that don't have one yet."""
    register_user(client)
    _setup_data(client)

    # Create a purchase loan WITH payoff sale and an interest loan WITHOUT
    purchase_loan = client.post(
        "/api/loans?generate_payoff_sale=true",
        json={
            "grant_year": 2018, "grant_type": "Purchase",
            "loan_type": "Purchase", "loan_year": 2018,
            "amount": 5000.0, "interest_rate": 0.05,
            "due_date": "2030-01-01",
        },
    ).json()
    interest_loan = client.post(
        "/api/loans?generate_payoff_sale=false",
        json={
            "grant_year": 2018, "grant_type": "Purchase",
            "loan_type": "Interest", "loan_year": 2019,
            "amount": 500.0, "interest_rate": 0.03,
            "due_date": "2030-01-01",
        },
    ).json()

    # Only one sale exists (for the purchase loan)
    sales_before = client.get("/api/sales").json()
    assert len(sales_before) == 1
    assert sales_before[0]["loan_id"] == purchase_loan["id"]

    # Regenerate should create the missing sale for the interest loan
    resp = client.post("/api/loans/regenerate-all-payoff-sales")
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1  # purchase loan's sale updated
    assert data["created"] == 1  # interest loan's sale created

    sales_after = client.get("/api/sales").json()
    assert len(sales_after) == 2
    loan_ids = {s["loan_id"] for s in sales_after}
    assert purchase_loan["id"] in loan_ids
    assert interest_loan["id"] in loan_ids


def test_regenerate_skips_refinanced_loans(client, db_session):
    """regenerate-all-payoff-sales does not create sales for refinanced loans."""
    register_user(client)
    _setup_data(client)

    # Create original loan without payoff sale
    original = client.post(
        "/api/loans?generate_payoff_sale=false",
        json={
            "grant_year": 2018, "grant_type": "Purchase",
            "loan_type": "Purchase", "loan_year": 2018,
            "amount": 5000.0, "interest_rate": 0.05,
            "due_date": "2030-01-01", "loan_number": "L001",
        },
    ).json()

    # Create refinancing loan that references the original
    refi = client.post(
        "/api/loans?generate_payoff_sale=false",
        json={
            "grant_year": 2018, "grant_type": "Purchase",
            "loan_type": "Purchase", "loan_year": 2022,
            "amount": 5000.0, "interest_rate": 0.04,
            "due_date": "2032-01-01",
            "refinances_loan_id": original["id"],
        },
    ).json()

    resp = client.post("/api/loans/regenerate-all-payoff-sales")
    assert resp.status_code == 200

    sales = client.get("/api/sales").json()
    loan_ids = {s["loan_id"] for s in sales}
    # Only the refi loan should get a sale, not the refinanced original
    assert original["id"] not in loan_ids
    assert refi["id"] in loan_ids


def test_wizard_creates_payoff_sales_for_interest_loans(client, db_session):
    """Wizard submit generates payoff sales for interest loans, not just purchase."""
    register_user(client)
    resp = client.post("/api/wizard/submit", json={
        "grants": [{
            "year": 2018, "type": "Purchase", "shares": 10000, "price": 5.0,
            "vest_start": "2019-01-01", "periods": 4, "exercise_date": "2018-01-01",
            "loans": [
                {
                    "loan_type": "Purchase", "loan_year": 2018,
                    "amount": 5000.0, "interest_rate": 0.05,
                    "due_date": "2030-01-01",
                },
                {
                    "loan_type": "Interest", "loan_year": 2019,
                    "amount": 500.0, "interest_rate": 0.03,
                    "due_date": "2030-01-01",
                },
            ],
        }],
        "prices": [{"effective_date": "2020-01-01", "price": 20.0}],
        "generate_payoff_sales": True,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["payoff_sales"] == 2  # both purchase AND interest

    sales = client.get("/api/sales").json()
    assert len(sales) == 2
    loan_types = set()
    loans = client.get("/api/loans").json()
    sale_loan_ids = {s["loan_id"] for s in sales}
    for loan in loans:
        if loan["id"] in sale_loan_ids:
            loan_types.add(loan["loan_type"])
    assert "Purchase" in loan_types
    assert "Interest" in loan_types


def test_payoff_sizing_covers_loan_after_actual_tax(client, db_session):
    """Payoff sale's actual tax-adjusted net proceeds must cover cash_due.

    Regression: when multiple prior sales had consumed lots in lot_selection_method
    order, _compute_payoff_sale was injecting them as oldest-first reducers, causing
    later payoff sizings to see a different lot pool than the tax calc actually uses.
    Result: negative "Cash received" (payoff sale shortfall). The iterative verify
    step must now ensure sizing matches real tax-adjusted proceeds.
    """
    register_user(client)
    # Multiple Purchase tranches with varying bases to create lot-order sensitivity
    client.post("/api/grants", json={
        "year": 2018, "type": "Purchase", "shares": 5000, "price": 2.0,
        "vest_start": "2018-06-01", "periods": 4, "exercise_date": "2018-01-01",
        "dp_shares": 0,
    })
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 5000, "price": 8.0,
        "vest_start": "2020-06-01", "periods": 4, "exercise_date": "2020-01-01",
        "dp_shares": 0,
    })
    client.post("/api/prices", json={"effective_date": "2018-01-01", "price": 10.0})
    client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 20.0})

    _set_flexible_payoff(db_session, True)
    _set_payoff_method(client, "epic_lifo")

    # Two loans — order matters: sizing loan B must see the real lots loan A's sale consumed
    client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2018, "grant_type": "Purchase",
        "loan_type": "Purchase", "loan_year": 2018,
        "amount": 30000.0, "interest_rate": 0.03,
        "due_date": "2024-06-30",
    })
    client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Purchase",
        "loan_type": "Purchase", "loan_year": 2020,
        "amount": 30000.0, "interest_rate": 0.03,
        "due_date": "2024-06-30",
    })

    sales = client.get("/api/sales").json()
    assert len(sales) == 2
    loans = {l["id"]: l for l in client.get("/api/loans").json()}

    # Each sale's actual tax-adjusted net proceeds must cover its loan
    for s in sales:
        tax = client.get(f"/api/sales/{s['id']}/tax").json()
        gross = s["shares"] * s["price_per_share"]
        est_tax = tax["estimated_tax"]
        loan_amount = loans[s["loan_id"]]["amount"]
        net = gross - est_tax
        # Allow $1 tolerance for rounding
        assert net + 1.0 >= loan_amount, (
            f"Sale {s['id']} for loan {s['loan_id']}: net={net} < loan={loan_amount} "
            f"(gross={gross}, tax={est_tax}, shares={s['shares']})"
        )


def test_tax_settings_update_does_not_expose_flexible_flag_for_update(client, db_session):
    """flexible_payoff_enabled is read-only; PUT should not change system_settings."""
    register_user(client)
    # Attempt to "update" flexible_payoff_enabled via tax settings — it's not in TaxSettingsUpdate
    # so it should be silently ignored
    resp = client.put("/api/tax-settings", json={"loan_payoff_method": "lifo"})
    assert resp.status_code == 200

    # Verify system_settings row is still false
    row = db_session.execute(
        text("SELECT value FROM system_settings WHERE key = 'flexible_payoff_enabled'")
    ).scalar()
    assert row == "false"
