import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


# ============================================================
# AUTH
# ============================================================

def test_login_creates_user(client):
    register_user(client, "a@b.com")
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "a@b.com"


def test_login_can_reauthenticate(client):
    register_user(client, "a@b.com")
    register_user(client, "a@b.com")  # re-login, same user
    resp = client.get("/api/me")
    assert resp.status_code == 200


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
    register_user(client)
    resp = client.post("/api/grants", json=GRANT_DATA)
    assert resp.status_code == 201
    data = resp.json()
    assert data["year"] == 2020
    assert data["shares"] == 10000
    assert data["id"] is not None


def test_list_grants(client):
    register_user(client)
    client.post("/api/grants", json=GRANT_DATA)
    resp = client.get("/api/grants")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_get_grant(client):
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.get(f"/api/grants/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["year"] == 2020


def test_update_grant(client):
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.put(f"/api/grants/{created['id']}", json={"shares": 20000})
    assert resp.status_code == 200
    assert resp.json()["shares"] == 20000


def test_delete_grant(client):
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.delete(f"/api/grants/{created['id']}")
    assert resp.status_code == 204
    resp = client.get("/api/grants")
    assert len(resp.json()) == 0


def test_grant_not_found(client):
    register_user(client)
    resp = client.get("/api/grants/999")
    assert resp.status_code == 404


def test_bulk_create_grants(client):
    register_user(client)
    items = [GRANT_DATA, {**GRANT_DATA, "year": 2021}]
    resp = client.post("/api/grants/bulk", json=items)
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
    register_user(client)
    resp = client.post("/api/loans", json=LOAN_DATA)
    assert resp.status_code == 201
    assert resp.json()["amount"] == 19900.0


def test_list_loans(client):
    register_user(client)
    client.post("/api/loans", json=LOAN_DATA)
    resp = client.get("/api/loans")
    assert len(resp.json()) == 1


def test_update_loan(client):
    register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA).json()
    resp = client.put(f"/api/loans/{created['id']}", json={"amount": 25000.0})
    assert resp.status_code == 200
    assert resp.json()["amount"] == 25000.0


def test_delete_loan(client):
    register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA).json()
    resp = client.delete(f"/api/loans/{created['id']}")
    assert resp.status_code == 204


def test_bulk_create_loans(client):
    register_user(client)
    items = [LOAN_DATA, {**LOAN_DATA, "loan_type": "Interest", "amount": 500.0}]
    resp = client.post("/api/loans/bulk", json=items)
    assert resp.status_code == 201
    assert len(resp.json()) == 2


# ============================================================
# PRICES CRUD
# ============================================================

PRICE_DATA = {"effective_date": "2020-12-31", "price": 1.99}


def test_create_price(client):
    register_user(client)
    resp = client.post("/api/prices", json=PRICE_DATA)
    assert resp.status_code == 201
    assert resp.json()["price"] == 1.99


def test_list_prices(client):
    register_user(client)
    client.post("/api/prices", json=PRICE_DATA)
    resp = client.get("/api/prices")
    assert len(resp.json()) == 1


def test_update_price(client):
    register_user(client)
    created = client.post("/api/prices", json=PRICE_DATA).json()
    resp = client.put(f"/api/prices/{created['id']}", json={"price": 2.50})
    assert resp.status_code == 200
    assert resp.json()["price"] == 2.50


def test_delete_price(client):
    register_user(client)
    created = client.post("/api/prices", json=PRICE_DATA).json()
    resp = client.delete(f"/api/prices/{created['id']}")
    assert resp.status_code == 204


# ============================================================
# OWNERSHIP ISOLATION
# ============================================================

def test_user_isolation(client, make_client):
    register_user(client, "a@test.com")
    created = client.post("/api/grants", json=GRANT_DATA).json()

    with make_client("b@test.com") as client_b:
        # User B can't see user A's grant
        resp = client_b.get(f"/api/grants/{created['id']}")
        assert resp.status_code == 404

        # User B's list is empty
        resp = client_b.get("/api/grants")
        assert len(resp.json()) == 0

        # User B can't update user A's grant
        resp = client_b.put(f"/api/grants/{created['id']}", json={"shares": 1})
        assert resp.status_code == 404

        # User B can't delete user A's grant
        resp = client_b.delete(f"/api/grants/{created['id']}")
        assert resp.status_code == 404


# ============================================================
# EVENTS (computed)
# ============================================================

def _seed_data(client):
    """Seed a minimal set of grants, prices, loans for event testing."""
    grant = {
        "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.99,
        "vest_start": "2021-03-01", "periods": 5,
        "exercise_date": "2020-12-31", "dp_shares": -500,
    }
    bonus = {
        "year": 2020, "type": "Bonus", "shares": 5000, "price": 0.0,
        "vest_start": "2021-03-01", "periods": 5,
        "exercise_date": "2020-12-31", "dp_shares": 0,
    }
    client.post("/api/grants/bulk", json=[grant, bonus])
    client.post("/api/prices", json={"effective_date": "2020-12-31", "price": 1.99})
    client.post("/api/prices", json={"effective_date": "2021-03-01", "price": 2.50})
    client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 19900.0, "interest_rate": 3.5,
        "due_date": "2025-12-31", "loan_number": "123456",
    })


def test_events_empty(client):
    register_user(client)
    resp = client.get("/api/events")
    assert resp.status_code == 200
    assert resp.json() == []


def test_events_returns_computed_timeline(client):
    register_user(client)
    _seed_data(client)
    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) > 0
    # Should have various event types
    types = {e["event_type"] for e in events}
    assert "Exercise" in types
    assert "Vesting" in types
    assert "Share Price" in types
    assert "Down payment exchange" in types
    assert "Loan Payoff" in types


def test_events_has_timeline_fields(client):
    register_user(client)
    _seed_data(client)
    events = client.get("/api/events").json()
    last = events[-1]
    assert "share_price" in last
    assert "cum_shares" in last
    assert "cum_income" in last
    assert "cum_cap_gains" in last
    assert "income" in last
    assert "total_cap_gains" in last


def test_events_isolation(client, make_client):
    register_user(client, "a@test.com")
    _seed_data(client)
    events_a = client.get("/api/events").json()

    with make_client("b@test.com") as client_b:
        events_b = client_b.get("/api/events").json()
        assert len(events_b) == 0

    assert len(events_a) > 0


# ============================================================
# DASHBOARD
# ============================================================

def test_dashboard_empty(client):
    register_user(client)
    resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_price"] == 0
    assert data["total_shares"] == 0
    assert data["next_event"] is None


def test_dashboard_with_data(client):
    register_user(client)
    _seed_data(client)
    resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_price"] > 0
    assert data["total_income"] >= 0
    assert data["total_cap_gains"] >= 0
    assert data["total_loan_principal"] == 19900.0


# ============================================================
# FLOWS
# ============================================================

def test_flow_new_purchase_grant_only(client):
    register_user(client)
    resp = client.post("/api/flows/new-purchase", json={
        "year": 2022, "shares": 5000, "price": 3.50,
        "vest_start": "2023-03-01", "periods": 5,
        "exercise_date": "2022-12-31",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["grant"]["year"] == 2022
    assert data["grant"]["type"] == "Purchase"
    assert "loan" not in data


def test_flow_new_purchase_with_loan(client):
    register_user(client)
    resp = client.post("/api/flows/new-purchase", json={
        "year": 2022, "shares": 5000, "price": 3.50,
        "vest_start": "2023-03-01", "periods": 5,
        "exercise_date": "2022-12-31",
        "loan_amount": 17500.0, "loan_rate": 4.0,
        "loan_due_date": "2027-12-31", "loan_number": "654321",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["grant"]["shares"] == 5000
    assert data["loan"]["amount"] == 17500.0
    assert data["loan"]["loan_type"] == "Purchase"
    # Verify they appear in the CRUD lists
    grants = client.get("/api/grants").json()
    loans = client.get("/api/loans").json()
    assert len(grants) == 1
    assert len(loans) == 1


def test_flow_annual_price(client):
    register_user(client)
    resp = client.post("/api/flows/annual-price", json={
        "effective_date": "2023-03-01", "price": 4.25,
    })
    assert resp.status_code == 201
    assert resp.json()["price"] == 4.25
    prices = client.get("/api/prices").json()
    assert len(prices) == 1


def test_flow_add_bonus(client):
    register_user(client)
    resp = client.post("/api/flows/add-bonus", json={
        "year": 2023, "shares": 2000, "price": 0.0,
        "vest_start": "2024-03-01", "periods": 5,
        "exercise_date": "2023-12-31",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "Bonus"
    assert data["shares"] == 2000


# ============================================================
# OPTIMISTIC LOCKING (multi-device conflict detection)
# ============================================================

def test_grant_update_no_version_succeeds(client):
    """PUT without version field → backward compat, no check performed."""
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.put(f"/api/grants/{created['id']}", json={"shares": 5000})
    assert resp.status_code == 200
    assert resp.json()["shares"] == 5000


def test_grant_update_correct_version_succeeds(client):
    """PUT with correct version → 200, version incremented."""
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    assert created["version"] == 1
    resp = client.put(
        f"/api/grants/{created['id']}",
        json={"shares": 5000, "version": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["shares"] == 5000
    assert data["version"] == 2


def test_grant_update_stale_version_conflicts(client):
    """PUT with stale version → 409 Conflict."""
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    # First update bumps version to 2
    client.put(f"/api/grants/{created['id']}", json={"shares": 5000, "version": 1})
    # Second update with the old version=1 should conflict
    resp = client.put(
        f"/api/grants/{created['id']}",
        json={"shares": 9000, "version": 1},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert body["detail"] == "modified_elsewhere"
    assert body["current_version"] == 2


def test_loan_update_correct_version(client):
    """Loan PUT with correct version → 200, version incremented."""
    register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA).json()
    assert created["version"] == 1
    resp = client.put(
        f"/api/loans/{created['id']}",
        json={"amount": 99999.0, "version": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2


def test_loan_update_stale_version_conflicts(client):
    """Loan PUT with stale version → 409."""
    register_user(client)
    created = client.post("/api/loans", json=LOAN_DATA).json()
    client.put(f"/api/loans/{created['id']}", json={"amount": 50000.0, "version": 1})
    resp = client.put(
        f"/api/loans/{created['id']}",
        json={"amount": 99999.0, "version": 1},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "modified_elsewhere"


def test_price_update_correct_version(client):
    """Price PUT with correct version → 200, version incremented."""
    register_user(client)
    created = client.post("/api/prices", json={"effective_date": "2023-03-01", "price": 3.50}).json()
    assert created["version"] == 1
    resp = client.put(
        f"/api/prices/{created['id']}",
        json={"price": 4.25, "version": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2


def test_price_update_stale_version_conflicts(client):
    """Price PUT with stale version → 409."""
    register_user(client)
    created = client.post("/api/prices", json={"effective_date": "2023-03-01", "price": 3.50}).json()
    client.put(f"/api/prices/{created['id']}", json={"price": 4.25, "version": 1})
    resp = client.put(
        f"/api/prices/{created['id']}",
        json={"price": 5.00, "version": 1},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "modified_elsewhere"


def test_version_not_stored_in_update_payload(client):
    """The version field in PUT body is not persisted as a data field; only used for conflict check."""
    register_user(client)
    created = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.put(
        f"/api/grants/{created['id']}",
        json={"shares": 7777, "version": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["shares"] == 7777
    assert data["version"] == 2  # incremented by server, not set to submitted value


# ============================================================
# GRANT UNIQUENESS (one grant per year+type per user)
# ============================================================

def test_duplicate_grant_create_rejected(client):
    """Creating two grants with same year+type returns 409."""
    register_user(client)
    resp1 = client.post("/api/grants", json=GRANT_DATA)
    assert resp1.status_code == 201
    resp2 = client.post("/api/grants", json=GRANT_DATA)
    assert resp2.status_code == 409


def test_duplicate_grant_different_type_allowed(client):
    """Same year but different type (Purchase vs Bonus) is allowed."""
    register_user(client)
    client.post("/api/grants", json=GRANT_DATA)
    bonus = {**GRANT_DATA, "type": "Bonus", "price": 0.0}
    resp = client.post("/api/grants", json=bonus)
    assert resp.status_code == 201


def test_duplicate_grant_different_year_allowed(client):
    """Same type but different year is allowed."""
    register_user(client)
    client.post("/api/grants", json=GRANT_DATA)
    resp = client.post("/api/grants", json={**GRANT_DATA, "year": 2021})
    assert resp.status_code == 201


def test_update_grant_to_conflicting_year_type_rejected(client):
    """Updating a grant's year to match another grant of the same type returns 409."""
    register_user(client)
    client.post("/api/grants", json=GRANT_DATA)
    g2 = client.post("/api/grants", json={**GRANT_DATA, "year": 2021}).json()
    resp = client.put(f"/api/grants/{g2['id']}", json={"year": 2020})
    assert resp.status_code == 409


def test_update_grant_same_year_type_allowed(client):
    """Updating other fields without changing year+type is fine."""
    register_user(client)
    g = client.post("/api/grants", json=GRANT_DATA).json()
    resp = client.put(f"/api/grants/{g['id']}", json={"shares": 99999})
    assert resp.status_code == 200


def test_flow_new_purchase_duplicate_rejected(client):
    """new_purchase for a year that already has a Purchase grant returns 409."""
    register_user(client)
    payload = {
        "year": 2022, "shares": 5000, "price": 3.50,
        "vest_start": "2023-03-01", "periods": 5, "exercise_date": "2022-12-31",
    }
    client.post("/api/flows/new-purchase", json=payload)
    resp = client.post("/api/flows/new-purchase", json=payload)
    assert resp.status_code == 409


def test_duplicate_grants_isolated_between_users(client, make_client):
    """Two different users can each have a Purchase grant for the same year."""
    register_user(client, "a@test.com")
    r_a = client.post("/api/grants", json=GRANT_DATA)
    assert r_a.status_code == 201

    with make_client("b@test.com") as client_b:
        r_b = client_b.post("/api/grants", json=GRANT_DATA)
        assert r_b.status_code == 201


# ============================================================
# LOAN UPDATE WITH REGENERATE PAYOFF SALE
# ============================================================

def test_update_loan_regenerate_payoff_sale_creates_sale(client):
    """PUT /api/loans/{id}?regenerate_payoff_sale=true creates a payoff sale."""
    register_user(client)
    # Need a grant and price for _compute_payoff_sale to work
    client.post("/api/grants", json=GRANT_DATA)
    client.post("/api/prices", json={"effective_date": "2020-12-31", "price": 5.00})
    loan = client.post("/api/loans", json={**LOAN_DATA, "due_date": "2030-12-31"}).json()

    resp = client.put(
        f"/api/loans/{loan['id']}?regenerate_payoff_sale=true",
        json={"amount": 25000.0},
    )
    assert resp.status_code == 200

    sales = client.get("/api/sales").json()
    payoff = [s for s in sales if s["loan_id"] == loan["id"]]
    assert len(payoff) == 1


def test_update_loan_regenerate_payoff_sale_updates_existing(client):
    """Regenerating when a payoff sale already exists updates it rather than creating a duplicate."""
    register_user(client)
    client.post("/api/grants", json=GRANT_DATA)
    client.post("/api/prices", json={"effective_date": "2020-12-31", "price": 5.00})
    loan = client.post(
        "/api/loans?generate_payoff_sale=true",
        json={**LOAN_DATA, "due_date": "2030-12-31"},
    ).json()

    # Regenerate after updating the amount
    client.put(
        f"/api/loans/{loan['id']}?regenerate_payoff_sale=true",
        json={"amount": 30000.0},
    )

    sales = client.get("/api/sales").json()
    payoff = [s for s in sales if s["loan_id"] == loan["id"]]
    assert len(payoff) == 1  # still one, not two
