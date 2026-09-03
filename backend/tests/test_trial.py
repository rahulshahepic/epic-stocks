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
