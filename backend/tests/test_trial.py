"""Tests for the no-account trial preview: /api/trial/analyze.

Same synthetic fixtures as test_epic_import.py — no real Epic data.
"""
import os
import sys
from datetime import date
from unittest.mock import patch

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
    """The endpoint honours the limiter.

    Deliberately not pinned to the configured budget: that number is tuned for
    a shared office network, where everyone leaves through one address, and it
    is raised whenever that turns out to be too tight. What must not change is
    that the limit is wired up and that exceeding it is a 429.
    """
    monkeypatch.delenv("E2E_TEST", raising=False)
    from scaffold import rate_limit

    real = rate_limit.check_rate_ip_shared
    monkeypatch.setattr(
        rate_limit, "check_rate_ip_shared",
        lambda ip, endpoint, max_calls, window_secs: real(ip, endpoint, 3, window_secs),
    )
    monkeypatch.setattr(rate_limit, "_redis", lambda: None)
    rate_limit._calls.clear()

    for _ in range(3):
        assert client.post("/api/trial/analyze", files=upload_files()).status_code == 200
    resp = client.post("/api/trial/analyze", files=upload_files())
    assert resp.status_code == 429
    # And it tells a blameless caller on a shared network what happened.
    assert "your network" in resp.json()["detail"]
    assert resp.headers.get("Retry-After")


# ── Funnel counters ──────────────────────────────────────────────────────────
# Three integers a day and nothing else. The tests below pin both halves of
# that: that the counts are right, and that the row holds nothing about who
# caused them.

def test_previews_are_counted_per_day(client):
    from scaffold.models import TrialDailyStat
    from tests.conftest import TestSession

    for _ in range(3):
        assert client.post("/api/trial/analyze", files=upload_files()).status_code == 200

    with TestSession() as db:
        rows = db.query(TrialDailyStat).all()
        assert len(rows) == 1
        assert rows[0].previews == 3
        assert rows[0].save_clicked == 0
        assert rows[0].signups_from_trial == 0


def test_save_intent_and_conversion_are_counted(client):
    from scaffold.models import TrialDailyStat
    from tests.conftest import TestSession, register_user

    client.post("/api/trial/analyze", files=upload_files())
    assert client.post("/api/trial/save-intent").status_code == 204

    register_user(client)
    assert client.post("/api/trial/converted").status_code == 204

    with TestSession() as db:
        row = db.query(TrialDailyStat).one()
        assert (row.previews, row.save_clicked, row.signups_from_trial) == (1, 1, 1)


def test_the_counter_row_holds_nothing_about_a_visitor(client):
    """The privacy claim is only true while this stays a bare daily tally."""
    from scaffold.models import TrialDailyStat

    assert set(TrialDailyStat.__table__.columns.keys()) == {
        "day", "previews", "save_clicked", "signups_from_trial"}


def test_save_intent_needs_no_account(client):
    assert client.post("/api/trial/save-intent").status_code == 204


def test_conversion_count_needs_an_account(client):
    assert client.post("/api/trial/converted").status_code == 401


def test_counting_never_breaks_the_preview():
    """A funnel counter is never worth failing the request it counts."""
    from app.routers.trial import _bump

    class BrokenSession:
        def execute(self, *_a, **_kw):
            raise RuntimeError("counter table is mid-migration")

        def commit(self):
            raise RuntimeError("unreachable")

        def rollback(self):
            pass

    _bump(BrokenSession(), "previews")   # swallowed, not raised


ADMIN_EMAIL = "admin@example.com"


def test_admin_sees_the_funnel_with_a_conversion_rate(client):
    for _ in range(4):
        client.post("/api/trial/analyze", files=upload_files())
    client.post("/api/trial/save-intent")

    with patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL}):
        client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})
        client.post("/api/trial/converted")
        body = client.get("/api/admin/trial-funnel").json()
    assert body["previews"] == 4
    assert body["save_clicked"] == 1
    assert body["signups_from_trial"] == 1
    assert body["conversion_rate"] == 0.25
    assert len(body["days"]) == 1


def test_funnel_is_admin_only(client):
    from tests.conftest import register_user

    with patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL}):
        register_user(client, email="nobody@example.com", name="Nobody")
        assert client.get("/api/admin/trial-funnel").status_code == 403


# ── Current share price ──────────────────────────────────────────────────────
# The files carry only prices Epic has already announced. Between announcements
# the newest one can be a year or more old, and valuing a position at it
# understates the whole thing silently.

def test_stale_price_is_flagged_so_the_ui_can_ask(client):
    body = client.post("/api/trial/analyze", files=upload_files()).json()
    latest = max(p["effective_date"] for p in body["prices"])
    assert latest[:4] < date.today().strftime("%Y")
    assert body["price_is_stale"] is True


def test_a_supplied_price_is_used_everywhere_not_just_labelled(client):
    """Charts read `prices`, cards read `timeline`. They must not disagree."""
    before = client.post("/api/trial/analyze", files=upload_files()).json()
    after = client.post("/api/trial/analyze", files=upload_files(),
                        data={"current_price": "99.50"}).json()

    today = date.today().isoformat()
    assert len(after["prices"]) == len(before["prices"]) + 1
    newest = after["prices"][-1]
    assert (newest["effective_date"], newest["price"]) == (today, 99.50)

    def price_today(body):
        return [e for e in body["timeline"] if e["date"] <= today][-1]["share_price"]

    assert price_today(after) == 99.50
    assert price_today(after) != price_today(before)
    # Capital gains move with it — the price is computed from, not pasted on.
    assert after["timeline"][-1]["cum_cap_gains"] != before["timeline"][-1]["cum_cap_gains"]
    # And the position is no longer stale once today's price is known.
    assert after["price_is_stale"] is False


def test_a_supplied_price_carries_into_signup(client):
    """Someone who tells us today's price should not have to tell us again."""
    body = client.post("/api/trial/analyze", files=upload_files(),
                       data={"current_price": "99.50"}).json()
    prices = body["wizard_payload"]["prices"]
    assert {"effective_date": date.today().isoformat(), "price": 99.50} in prices


def test_a_price_no_newer_than_the_files_is_ignored(client):
    body = client.post("/api/trial/analyze", files=upload_files(),
                       data={"current_price": "0"}).json()
    assert len(body["prices"]) == 3
