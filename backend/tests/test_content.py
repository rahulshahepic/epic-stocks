"""Regression tests for /api/content and wizard content seeding.

Phase 1 guarantees that the content returned by GET /api/content matches the
previously hardcoded constants in frontend/src/app/components/ImportWizard.tsx
exactly.  If any of these assertions fail, the frontend wizard will behave
differently for existing deployments — do NOT loosen the expected values
without also updating the TS wizard.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


def _get(client):
    register_user(client)
    resp = client.get("/api/content")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_content_requires_auth(client):
    resp = client.get("/api/content")
    assert resp.status_code == 401


def test_grant_schedule_matches_epic(client):
    data = _get(client)
    schedule = data["grant_schedule"]
    expected = [
        (2018, "Purchase", "2020-06-15", 6, "2018-12-31", True,  False),
        (2019, "Purchase", "2021-06-15", 6, "2019-12-31", True,  False),
        (2020, "Purchase", "2021-09-30", 5, "2020-12-31", True,  False),
        (2020, "Bonus",    "2021-09-30", 4, "2020-12-31", False, False),
        (2021, "Purchase", "2022-09-30", 5, "2021-12-31", True,  False),
        (2021, "Bonus",    "2022-09-30", 3, "2021-12-31", False, False),
        (2022, "Purchase", "2023-09-30", 4, "2022-12-31", False, False),
        (2022, "Bonus",    "2023-09-30", 3, "2022-12-31", False, False),
        (2022, "Free",     "2027-09-30", 1, "2022-12-31", False, False),
        (2023, "Purchase", "2024-09-30", 4, "2023-12-31", False, True),
        (2023, "Bonus",    "2024-09-30", 3, "2023-12-31", False, False),
        (2024, "Purchase", "2025-09-30", 4, "2024-12-31", False, True),
        (2024, "Bonus",    "2025-09-30", 3, "2024-12-31", False, False),
        (2025, "Purchase", "2026-09-30", 4, "2025-12-31", False, True),
        (2025, "Bonus",    "2026-09-30", 3, "2025-12-31", False, False),
    ]
    assert len(schedule) == len(expected)
    for actual, (year, typ, vs, periods, ed, dcu, sdp) in zip(schedule, expected):
        assert actual["year"] == year
        assert actual["type"] == typ
        assert actual["vest_start"] == vs
        assert actual["periods"] == periods
        assert actual["exercise_date"] == ed
        assert actual["default_catch_up"] == dcu
        assert actual["show_dp_shares"] == sdp


def test_grant_type_defs(client):
    data = _get(client)
    by_name = {d["name"]: d for d in data["grant_type_defs"]}
    assert by_name["Purchase"]["color_class"] == "bg-rose-700 text-white"
    assert by_name["Purchase"]["is_pre_tax_when_zero_price"] is False
    assert by_name["Catch-Up"]["color_class"] == "bg-sky-700 text-white"
    assert by_name["Catch-Up"]["is_pre_tax_when_zero_price"] is True
    assert by_name["Bonus"]["color_class"] == "bg-emerald-700 text-white"
    assert by_name["Bonus"]["is_pre_tax_when_zero_price"] is True
    assert by_name["Free"]["color_class"] == "bg-amber-600 text-white"
    assert by_name["Free"]["is_pre_tax_when_zero_price"] is True


def test_bonus_schedule_variants(client):
    data = _get(client)
    variants = data["bonus_schedule_variants"]
    assert len(variants) == 3
    by_code = {v["variant_code"]: v for v in variants}
    assert by_code["A"]["periods"] == 2
    assert by_code["B"]["periods"] == 3
    assert by_code["C"]["periods"] == 4
    assert by_code["C"]["is_default"] is True
    assert by_code["A"]["is_default"] is False
    assert by_code["B"]["is_default"] is False
    for v in variants:
        assert v["grant_year"] == 2020
        assert v["grant_type"] == "Bonus"


def test_loan_rates_interest(client):
    data = _get(client)
    interest = data["loan_rates"]["interest"]
    assert interest == {
        "2020": 0.0086,
        "2021": 0.0091,
        "2022": 0.0328,
        "2023": 0.0437,
        "2024": 0.037,
        "2025": 0.0379,
    }


def test_loan_rates_tax(client):
    data = _get(client)
    tax = data["loan_rates"]["tax"]
    assert tax["Catch-Up"] == {
        "2021": 0.0086,
        "2022": 0.0187,
        "2023": 0.0356,
        "2024": 0.043,
        "2025": 0.0407,
    }
    assert tax["Bonus"] == {
        "2021": 0.0086,
        "2022": 0.0293,
        "2023": 0.0385,
        "2024": 0.037,
    }


def test_purchase_original_loans(client):
    data = _get(client)
    po = data["loan_rates"]["purchase_original"]
    assert po["2018"] == {"rate": 0.0307, "due_date": "2025-07-15"}
    assert po["2019"] == {"rate": 0.0307, "due_date": "2026-07-15"}
    assert po["2020"] == {"rate": 0.0038, "due_date": "2025-07-15"}
    assert po["2021"] == {"rate": 0.0086, "due_date": "2030-07-15"}
    assert po["2022"] == {"rate": 0.0187, "due_date": "2031-06-30"}
    assert po["2023"] == {"rate": 0.0356, "due_date": "2032-06-30"}
    assert po["2024"] == {"rate": 0.037,  "due_date": "2033-06-30"}
    assert po["2025"] == {"rate": 0.0406, "due_date": "2034-06-30"}


def test_purchase_refi_chains(client):
    data = _get(client)
    chains = data["refi_chains"]["purchase"]
    assert chains["2018"] == [
        {"date": "2020-01-01", "rate": 0.0169, "loan_year": 2020, "due_date": "2025-07-15"},
        {"date": "2020-06-01", "rate": 0.0043, "loan_year": 2020, "due_date": "2025-07-15"},
        {"date": "2021-11-01", "rate": 0.0086, "loan_year": 2021, "due_date": "2027-07-15"},
    ]
    assert chains["2019"] == [
        {"date": "2020-06-01", "rate": 0.0043, "loan_year": 2020, "due_date": "2026-07-15"},
        {"date": "2021-11-01", "rate": 0.0086, "loan_year": 2021, "due_date": "2028-07-15"},
    ]
    assert chains["2020"] == [
        {"date": "2021-11-01", "rate": 0.0086, "loan_year": 2021, "due_date": "2029-07-15"},
    ]


def test_tax_refi_chains(client):
    data = _get(client)
    tax_chains = data["refi_chains"]["tax"]
    assert tax_chains == {
        "2020-Bonus-2021": [
            {
                "date": "2021-11-01",
                "rate": 0.0086,
                "loan_year": 2021,
                "due_date": "2029-07-15",
                "orig_due_date": "2024-07-15",
            },
        ],
    }


def test_wizard_settings(client):
    data = _get(client)
    settings = data["wizard_settings"]
    assert settings["loan_term_years"] == 10
    assert settings["latest_rate_year"] == 2025
    assert settings["dp_shares_start_year"] == 2023
    assert settings["tax_fallback_federal"] == 0.37
    assert settings["tax_fallback_state"] == 0.0765
    assert settings["default_purchase_due_month_day_pre2022"] == "07-15"
    assert settings["default_purchase_due_month_day_post2022"] == "06-30"
    assert settings["price_years_start"] == 2018
    assert settings["price_years_end"] == 2026


def test_seed_is_idempotent(client, db_session):
    """Calling seed_content_if_empty again after it ran via lifespan must be a no-op."""
    from app.content_service import seed_content_if_empty
    from scaffold.models import ContentGrantTemplate, ContentLoanRate
    before_templates = db_session.query(ContentGrantTemplate).count()
    before_rates = db_session.query(ContentLoanRate).count()
    assert before_templates > 0
    assert before_rates > 0
    seed_content_if_empty(db_session)
    assert db_session.query(ContentGrantTemplate).count() == before_templates
    assert db_session.query(ContentLoanRate).count() == before_rates
