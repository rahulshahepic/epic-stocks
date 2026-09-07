"""Regression tests: a sale's capital-gains tax must be identical wherever
it's reported — payoff-sale sizing, the timeline (/api/events, which feeds
the Dashboard), the per-sale breakdown (/api/sales/{id}/tax), and dashboard
aggregation (/api/dashboard). These used to diverge, sometimes wildly,
because the timeline and payoff sizing tracked exactly which lots each
earlier sale consumed while the per-sale breakdown and dashboard
aggregation approximated "prior sales" as a same-order reduction
regardless of what those sales actually used.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_flexible_payoff import GRANT_DATA, GRANT_DATA2, _setup_data


def test_payoff_sizing_matches_timeline_and_breakdown_when_tranche_exhausts(client, db_session):
    """Sale-393-like conditions: one loan's payoff sale drains the last of
    its own grant's tranche and must fall through to an older, cheaper one.
    The tax the timeline reports for that sale and the tax its own
    /api/sales/{id}/tax breakdown reports must agree, and the sizing must
    have actually covered the loan under that real tax — not an optimistic
    same-tranche-only estimate.
    """
    register_user(client)
    _setup_data(client)  # 2018 Purchase @ $5/sh (10000 sh), 2020 Purchase @ $8/sh (10000 sh), price $20 from 2020-01-01

    # First loan drains most of the 2020 tranche.
    resp = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Purchase",
        "loan_type": "Interest", "loan_year": 2021,
        "amount": 130000.0, "interest_rate": 0.03,
        "due_date": "2030-01-01",
    })
    assert resp.status_code == 201

    # Second loan on the same tranche needs more shares than remain in it,
    # so it must fall through into the cheaper 2018 tranche for the rest.
    resp = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Purchase",
        "loan_type": "Interest", "loan_year": 2022,
        "amount": 100000.0, "interest_rate": 0.03,
        "due_date": "2030-01-01",
    })
    assert resp.status_code == 201
    loan_id = resp.json()["id"]

    sales = client.get("/api/sales").json()
    sale = next(s for s in sales if s["loan_id"] == loan_id)

    # Confirm the test actually exercises the fall-through: at $20/share, a
    # sale drawing entirely from the 2020 tranche ($8 basis, LT rate 0.2916)
    # nets under $17/share; needing to raise $100k at less than that implies
    # more than 5883 shares, comfortably more than remain in the 10000-share
    # 2020 tranche after the first loan's ~7900-odd shares.
    assert sale["shares"] > 5883, "test setup didn't actually exhaust the 2020 tranche"

    breakdown = client.get(f"/api/sales/{sale['id']}/tax").json()
    events = client.get("/api/events").json()
    sale_event = next(e for e in events if e.get("sale_id") == sale["id"])
    assert sale_event["estimated_tax"] == breakdown["estimated_tax"]

    gross = sale["shares"] * sale["price_per_share"]
    net = gross - breakdown["estimated_tax"]
    assert net + 0.01 >= 100000.0


def test_dashboard_total_tax_paid_reconciles_to_sale_breakdown(client, db_session):
    """/api/dashboard's total_tax_paid must equal Tax-loan amounts (none
    here) plus the tax /api/sales/{id}/tax reports for every sale dated on
    or before today — dashboard aggregation used to compute its own
    approximation (no lot-order or same-tranche resolution at all) instead
    of the authoritative per-sale figure.
    """
    register_user(client)
    _setup_data(client)  # 2018 Purchase fully vests by 2022-01-01; price $20 from 2020-01-01

    resp = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2018, "grant_type": "Purchase",
        "loan_type": "Interest", "loan_year": 2019,
        "amount": 5000.0, "interest_rate": 0.03,
        "due_date": "2023-06-01",  # in the past relative to any real "today"
    })
    assert resp.status_code == 201
    loan_id = resp.json()["id"]

    sales = client.get("/api/sales").json()
    sale = next(s for s in sales if s["loan_id"] == loan_id)
    breakdown = client.get(f"/api/sales/{sale['id']}/tax").json()

    dash = client.get("/api/dashboard").json()
    assert dash["total_tax_paid"] == round(breakdown["estimated_tax"], 2)
