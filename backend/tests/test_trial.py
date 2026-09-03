"""Tests for the no-account trial preview: /api/trial/analyze.

Same synthetic fixtures as test_epic_import.py — no real Epic data.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.test_epic_import import csv_bytes, make_pdf, statement_lines, upload_files


def test_trial_analyze_computes_a_timeline_without_an_account(client):
    resp = client.post("/api/trial/analyze", files=upload_files())
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["summary"]["grants"] == 8
    assert body["summary"]["loans"] == 9
    assert body["summary"]["total_shares"] == 679000
    assert body["reconciles"] is True
    assert body["blocked"] is False
    assert len(body["timeline"]) > 0
    assert all("cum_shares" in e and "cum_income" in e and "cum_cap_gains" in e
               for e in body["timeline"])

    # wizard_payload is exactly what /api/wizard/submit accepts after signup
    assert set(body["wizard_payload"].keys()) == {"grants", "prices"}
    assert len(body["wizard_payload"]["grants"]) == 8
    assert len(body["wizard_payload"]["prices"]) == 3


def test_trial_analyze_returns_dashboard_shaped_data(client):
    """The preview renders the real dashboard, so it needs the real shapes."""
    body = client.post("/api/trial/analyze", files=upload_files()).json()

    assert len(body["grants"]) == 8
    assert len(body["loans"]) == 9
    assert len(body["prices"]) == 3
    # Negative ids — nothing here is a saved row.
    assert all(g["id"] < 0 for g in body["grants"])
    assert all(l["id"] < 0 for l in body["loans"])
    assert all(p["id"] < 0 for p in body["prices"])
    for key in ("year", "type", "shares", "price", "vest_start", "periods", "exercise_date"):
        assert key in body["grants"][0]
    for key in ("grant_year", "grant_type", "loan_type", "loan_year", "amount",
                "interest_rate", "due_date"):
        assert key in body["loans"][0]


def test_trial_tax_defaults_match_a_brand_new_account(client):
    """A preview that assumed different rates than signup gives would mislead."""
    from scaffold.models import TaxSettings

    defaults = client.post("/api/trial/analyze", files=upload_files()).json()["tax_defaults"]
    cols = TaxSettings.__table__.columns
    for name in ("federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
                 "niit_rate", "state_income_rate", "state_lt_cg_rate",
                 "state_st_cg_rate", "lt_holding_days"):
        assert defaults[name] == cols[name].default.arg


def test_trial_analyze_requires_no_login(client):
    # No register_user() call anywhere in this test — that's the point.
    resp = client.post("/api/trial/analyze", files=upload_files())
    assert resp.status_code == 200, resp.text


def test_trial_analyze_writes_nothing_to_the_database(client):
    from tests.conftest import register_user
    resp = client.post("/api/trial/analyze", files=upload_files())
    assert resp.status_code == 200, resp.text

    register_user(client)
    assert client.get("/api/grants").json() == []
    assert client.get("/api/loans").json() == []
    assert client.get("/api/prices").json() == []


def test_trial_analyze_requires_at_least_one_file(client):
    resp = client.post("/api/trial/analyze", files={})
    assert resp.status_code == 400


def test_a_misread_statement_blocks(client):
    broken = [l.replace("$500,000.00", "$500,000.99") for l in statement_lines()]
    resp = client.post("/api/trial/analyze", files={
        "share_csv": ("shares.csv", csv_bytes(), "text/csv"),
        "statement_pdf": ("s.pdf", make_pdf(broken), "application/pdf"),
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["blocked"] is True
    assert "C1" in [f["code"] for f in body["findings"]]


def test_trial_wizard_payload_round_trips_through_signup(client):
    from tests.conftest import register_user
    trial_body = client.post("/api/trial/analyze", files=upload_files()).json()

    register_user(client)
    resp = client.post("/api/wizard/submit", json={
        **trial_body["wizard_payload"], "clear_existing": True,
        "generate_payoff_sales": False})
    assert resp.status_code == 201, resp.text
    assert len(client.get("/api/grants").json()) == 8
    assert len(client.get("/api/loans").json()) == 9
    assert len(client.get("/api/prices").json()) == 3


def test_trial_analyze_is_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    for _ in range(10):
        resp = client.post("/api/trial/analyze", files=upload_files())
        assert resp.status_code == 200, resp.text
    resp = client.post("/api/trial/analyze", files=upload_files())
    assert resp.status_code == 429
