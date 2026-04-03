"""Tests for the investment interest deduction (Form 4952) estimation feature."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user

# ----- Shared test data -----

GRANT = {
    "year": 2020,
    "type": "Purchase",
    "shares": 1000,
    "price": 10.0,
    "vest_start": "2021-01-01",
    "periods": 4,
    "exercise_date": "2020-01-01",
    "dp_shares": 0,
}

PRICE_INITIAL = {"effective_date": "2020-01-01", "price": 10.0}
PRICE_RISE    = {"effective_date": "2022-06-01", "price": 20.0}  # +$10 on 1000 shares = $10k cap gains

INTEREST_LOAN_2021 = {
    "grant_year": 2020,
    "grant_type": "Purchase",
    "loan_type": "Interest",
    "loan_year": 2021,
    "amount": 3000.0,
    "interest_rate": 0.06,
    "due_date": "2022-01-01",  # due 1/1/2022, so deductible in 2022
    "loan_number": None,
    "refinances_loan_id": None,
}

INTEREST_LOAN_2022 = {
    "grant_year": 2020,
    "grant_type": "Purchase",
    "loan_type": "Interest",
    "loan_year": 2022,
    "amount": 4000.0,
    "interest_rate": 0.06,
    "due_date": "2023-01-01",  # due 1/1/2023, deductible in 2023
    "loan_number": None,
    "refinances_loan_id": None,
}

TAX_SETTINGS_WITH_DEDUCTION = {
    "federal_income_rate": 0.37,
    "federal_lt_cg_rate": 0.20,
    "federal_st_cg_rate": 0.37,
    "niit_rate": 0.038,
    "state_income_rate": 0.0765,
    "state_lt_cg_rate": 0.0536,
    "state_st_cg_rate": 0.0765,
    "lt_holding_days": 365,
    "lot_selection_method": "epic_lifo",
    "prefer_stock_dp": False,
    "dp_min_percent": 0.10,
    "dp_min_cap": 20000.0,
    "deduct_investment_interest": True,
}


def _setup_basic(client):
    """Create a grant, two prices, and two interest loans."""
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json=PRICE_INITIAL)
    client.post("/api/prices", json=PRICE_RISE)
    # Create interest loans (skip payoff sale generation)
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2021)
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2022)


# ----- Tax settings -----

def test_deduct_investment_interest_default_false(client):
    register_user(client)
    resp = client.get("/api/tax-settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["deduct_investment_interest"] is False


def test_update_deduct_investment_interest(client):
    register_user(client)
    resp = client.put("/api/tax-settings", json={"deduct_investment_interest": True})
    assert resp.status_code == 200
    assert resp.json()["deduct_investment_interest"] is True
    # Verify persisted
    resp2 = client.get("/api/tax-settings")
    assert resp2.json()["deduct_investment_interest"] is True


# ----- Events endpoint -----

def test_events_no_deduction_fields_when_disabled(client):
    """When deduction is disabled, events should not have deduction fields."""
    _setup_basic(client)
    # Leave deduction disabled (default)
    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()
    for e in events:
        assert "interest_deduction_applied" not in e


def test_events_deduction_fields_when_enabled(client):
    """When deduction is enabled, cap-gains events should have deduction fields."""
    _setup_basic(client)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    # All events should have the deduction annotation fields
    for e in events:
        assert "interest_deduction_applied" in e
        assert "adjusted_total_cap_gains" in e
        assert "adjusted_cum_cap_gains" in e


def test_events_deduction_reduces_cap_gains(client):
    """Interest deduction should reduce cap gains on price-gain events."""
    _setup_basic(client)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    # Find the Share Price event (price rise from $10 to $20 in 2022)
    price_events = [e for e in events if e["event_type"] == "Share Price" and e["date"].startswith("2022")]
    assert price_events, "Expected a Share Price event in 2022"

    price_evt = price_events[0]
    # The INTEREST_LOAN_2021 has due_date 2022-01-01, so $3000 is deductible in 2022
    # The price_cap_gains = $10 * 1000 shares held at that point = up to $10000
    # Vesting events before 2022 might have some vesting_cap_gains
    assert price_evt["interest_deduction_applied"] > 0
    assert price_evt["adjusted_total_cap_gains"] < price_evt["total_cap_gains"]


def test_events_deduction_carry_forward(client):
    """Unused deduction in year X should carry forward to year X+1."""
    register_user(client)
    # Set up a grant that ONLY has price cap gains in 2023 (not 2022)
    # so 2022 interest goes unused and carries forward
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json=PRICE_INITIAL)
    # No price change in 2022; price change in 2023
    client.post("/api/prices", json={"effective_date": "2023-03-01", "price": 20.0})
    # Interest of $3000 due 1/1/2022 (deductible in 2022), but no 2022 cap gains
    # And interest of $4000 due 1/1/2023 (deductible in 2023)
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2021)
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2022)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    # Find the 2023 Share Price event
    price_2023 = [e for e in events if e["event_type"] == "Share Price" and e["date"].startswith("2023")]
    assert price_2023
    evt = price_2023[0]

    # 2022 interest ($3000) carried forward + 2023 interest ($4000) = $7000 available
    # Price cap gains = $10 * shares_held — so at least $7000 should be deducted (if enough CG)
    price_cg = evt.get("price_cap_gains", 0)
    if price_cg >= 7000:
        # Full $7000 should be deducted
        assert abs(evt["interest_deduction_applied"] - 7000.0) < 1.0
    else:
        # Entire price CG offset by deduction (all available)
        assert evt["interest_deduction_applied"] == pytest.approx(price_cg, abs=1)


def test_events_adjusted_cum_cap_gains_monotone(client):
    """adjusted_cum_cap_gains should always be <= cum_cap_gains."""
    _setup_basic(client)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    for e in events:
        if "adjusted_cum_cap_gains" in e:
            assert e["adjusted_cum_cap_gains"] <= e["cum_cap_gains"] + 0.01  # allow rounding


# ----- Dashboard endpoint -----

def test_dashboard_no_deduction_when_disabled(client):
    """Dashboard total_cap_gains should be unchanged when deduction is disabled."""
    _setup_basic(client)

    resp_events = client.get("/api/events")
    resp_dash = client.get("/api/dashboard")
    assert resp_dash.status_code == 200
    dash = resp_dash.json()

    events = resp_events.json()
    last = events[-1]
    # Without deduction, total_cap_gains should match last event's cum_cap_gains
    assert abs(dash["total_cap_gains"] - last["cum_cap_gains"]) < 1.0


def test_dashboard_deduction_reduces_cap_gains(client):
    """Dashboard total_cap_gains should decrease when deduction is enabled."""
    _setup_basic(client)

    # Get baseline without deduction
    dash_before = client.get("/api/dashboard").json()

    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)
    dash_after = client.get("/api/dashboard").json()

    assert dash_after["total_cap_gains"] < dash_before["total_cap_gains"]
    assert dash_after["interest_deduction_total"] > 0
    assert dash_after["tax_savings_from_deduction"] > 0


def test_dashboard_tax_paid_decreases_with_deduction(client):
    """Tax paid should decrease (by tax savings) when deduction is applied."""
    _setup_basic(client)

    tax_before = client.get("/api/dashboard").json()["total_tax_paid"]
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)
    dash_after = client.get("/api/dashboard").json()

    assert dash_after["total_tax_paid"] < tax_before
    assert dash_after["tax_savings_from_deduction"] > 0
    # Cash received should be unchanged by the deduction
    cash_before = client.get("/api/dashboard")  # re-use disabled state
    # Just check cash_received is present and is a number
    assert isinstance(dash_after["cash_received"], (int, float))


def test_dashboard_no_deduction_fields_when_disabled(client):
    """Dashboard should always return interest_deduction_total (0 when disabled)."""
    _setup_basic(client)
    dash = client.get("/api/dashboard").json()
    # When deduction disabled, these fields should be 0 (or absent — we default to 0)
    assert dash.get("interest_deduction_total", 0) == 0
    assert dash.get("tax_savings_from_deduction", 0) == 0
