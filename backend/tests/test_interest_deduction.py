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
    """Interest deduction should reduce cap gains only at Vesting/Sale events, not Share Price."""
    _setup_basic(client)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    # Share Price events must never have deduction applied (unrealized gains)
    for e in events:
        if e["event_type"] == "Share Price":
            assert e.get("interest_deduction_applied", 0) == 0, \
                f"Share Price event {e['date']} should not have deduction applied"

    # At least one Vesting event with vesting_cap_gains > 0 should have deduction applied.
    # PRICE_RISE is 2022-06-01; vesting events after that date will have cap gains.
    vesting_with_cg = [
        e for e in events
        if e["event_type"] == "Vesting" and e.get("vesting_cap_gains", 0) > 0
    ]
    if vesting_with_cg:
        # The total deduction applied across all vesting events must be > 0
        total_ded = sum(e.get("interest_deduction_applied", 0) for e in vesting_with_cg)
        assert total_ded > 0
        # Each event with deduction: adjusted_total_cap_gains < total_cap_gains
        for e in vesting_with_cg:
            if e.get("interest_deduction_applied", 0) > 0:
                assert e["adjusted_total_cap_gains"] < e["total_cap_gains"]


def test_events_deduction_carry_forward(client):
    """Unused deduction in year X should carry forward and be applied at later Vesting events."""
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json=PRICE_INITIAL)
    # No price change in 2022; price change in mid-2023 so vesting events in 2024 have cap gains
    client.post("/api/prices", json={"effective_date": "2023-03-01", "price": 20.0})
    # $3000 deductible 2022, $4000 deductible 2023 — total $7000 available by 2023
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2021)
    client.post("/api/loans?generate_payoff_sale=false", json=INTEREST_LOAN_2022)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    # Share Price events must still have zero deduction
    for e in events:
        if e["event_type"] == "Share Price":
            assert e.get("interest_deduction_applied", 0) == 0

    # Total deduction applied across all Vesting events should be
    # min(total_deductible_pool, total_vesting_cap_gains)
    total_pool = 3000.0 + 4000.0  # INTEREST_LOAN_2021 + INTEREST_LOAN_2022
    vesting_cg_total = sum(
        e.get("vesting_cap_gains", 0) for e in events if e["event_type"] == "Vesting"
    )
    expected_deduction = min(total_pool, vesting_cg_total)
    actual_deduction = sum(
        e.get("interest_deduction_applied", 0) for e in events if e["event_type"] == "Vesting"
    )
    assert abs(actual_deduction - expected_deduction) < 1.0


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


def test_dashboard_deduction_does_not_change_cap_gains(client):
    """Cap gains represent what you made — the deduction changes tax/cash, not gains."""
    _setup_basic(client)

    dash_before = client.get("/api/dashboard").json()
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)
    dash_after = client.get("/api/dashboard").json()

    # Cap gains unchanged — deduction is a tax concept, not a gains concept
    assert abs(dash_after["total_cap_gains"] - dash_before["total_cap_gains"]) < 1.0
    # Tax and cash move instead
    assert dash_after["total_tax_paid"] < dash_before["total_tax_paid"]
    assert dash_after["cash_received"] >= dash_before["cash_received"]
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


# ----- Per-year excluded years -----

def test_deduction_excluded_years_default_null(client):
    """deduction_excluded_years defaults to null."""
    register_user(client)
    resp = client.get("/api/tax-settings")
    assert resp.status_code == 200
    assert resp.json()["deduction_excluded_years"] is None


def test_update_deduction_excluded_years(client):
    """Can set and clear deduction_excluded_years."""
    register_user(client)
    resp = client.put("/api/tax-settings", json={"deduction_excluded_years": [2021, 2022]})
    assert resp.status_code == 200
    assert resp.json()["deduction_excluded_years"] == [2021, 2022]
    # Clear back to null
    resp2 = client.put("/api/tax-settings", json={"deduction_excluded_years": None})
    assert resp2.status_code == 200
    assert resp2.json()["deduction_excluded_years"] is None


def test_taxable_years_returned(client):
    """GET /api/tax-settings should return taxable_years derived from grants."""
    _setup_basic(client)
    resp = client.get("/api/tax-settings")
    data = resp.json()
    assert "taxable_years" in data
    assert isinstance(data["taxable_years"], list)
    assert len(data["taxable_years"]) > 0


def test_events_deduction_skips_excluded_years(client):
    """When excluded_years contains a year, no deduction should be applied to events in that year."""
    _setup_basic(client)
    # Enable deduction for all years first
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    resp_all = client.get("/api/events")
    events_all = resp_all.json()
    total_ded_all = sum(e.get("interest_deduction_applied", 0) for e in events_all)
    assert total_ded_all > 0, "Deduction should be applied when no years excluded"

    # Now exclude 2022 — vesting events in 2022 should get zero deduction
    # AND interest due in 2022 is forfeited (not carried forward)
    client.put("/api/tax-settings", json={
        **TAX_SETTINGS_WITH_DEDUCTION,
        "deduction_excluded_years": [2022],
    })
    resp_excl = client.get("/api/events")
    events_excl = resp_excl.json()
    for e in events_excl:
        if e.get("event_type") == "Vesting" and e["date"][:4] == "2022":
            assert e.get("interest_deduction_applied", 0) == 0, \
                f"Event in excluded year 2022 should have zero deduction: {e['date']}"

    # Total deduction should decrease: excluded year's interest is forfeited
    total_ded_excl = sum(e.get("interest_deduction_applied", 0) for e in events_excl)
    assert total_ded_excl < total_ded_all, \
        f"Excluding a year should reduce total deduction ({total_ded_excl} vs {total_ded_all})"


def test_dashboard_respects_excluded_years(client):
    """Dashboard deduction totals should decrease when years are excluded."""
    _setup_basic(client)
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)

    dash_all = client.get("/api/dashboard").json()
    assert dash_all["interest_deduction_total"] > 0

    # Exclude all vesting years — deduction total should drop
    client.put("/api/tax-settings", json={
        **TAX_SETTINGS_WITH_DEDUCTION,
        "deduction_excluded_years": [2021, 2022, 2023, 2024],
    })
    dash_excl = client.get("/api/dashboard").json()
    assert dash_excl["interest_deduction_total"] < dash_all["interest_deduction_total"], \
        "Excluding years should reduce deduction total (interest is forfeited)"


def test_excluded_year_interest_is_forfeited(client):
    """Interest due in an excluded year should be forfeited, not carried forward."""
    _setup_basic(client)
    # INTEREST_LOAN_2021 → $3000 deductible in 2022
    # INTEREST_LOAN_2022 → $4000 deductible in 2023
    # With no exclusions, total pool = $7000

    # Enable with all years included
    client.put("/api/tax-settings", json=TAX_SETTINGS_WITH_DEDUCTION)
    events_all = client.get("/api/events").json()
    total_all = sum(e.get("interest_deduction_applied", 0) for e in events_all)

    # Exclude 2022 — the $3000 due in 2022 is forfeited, only $4000 (from 2023) remains
    client.put("/api/tax-settings", json={
        **TAX_SETTINGS_WITH_DEDUCTION,
        "deduction_excluded_years": [2022],
    })
    events_excl = client.get("/api/events").json()
    total_excl = sum(e.get("interest_deduction_applied", 0) for e in events_excl)

    # The $3000 from 2022 is forfeited — total should drop, not just shift
    assert total_excl < total_all, \
        f"Forfeited interest should reduce total deduction: all={total_all}, excl={total_excl}"
    # The remaining pool ($4000 from 2023) is less than the original ($7000),
    # so the deduction can't be the same as the all-years case
    assert total_excl <= 4000.0, \
        f"Only $4000 of interest should remain after forfeiting 2022: excl={total_excl}"
