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


def test_grant_templates_match_epic(client):
    data = _get(client)
    schedule = data["grant_templates"]
    expected = [
        # year, type, vest_start, periods, exercise_date, default_catch_up, show_dp_shares, zero_basis, default_purchase_due_date, default_tax_due_date
        (2018, "Purchase", "2020-06-15", 6, "2018-12-31", True,  False, False, "2025-07-15", None),
        (2019, "Purchase", "2021-06-15", 6, "2019-12-31", True,  False, False, "2026-07-15", None),
        (2020, "Purchase", "2021-09-30", 5, "2020-12-31", True,  False, False, "2025-07-15", None),
        (2020, "Bonus",    "2021-09-30", 4, "2020-12-31", False, False, True,  None,         "2025-07-15"),
        (2021, "Purchase", "2022-09-30", 5, "2021-12-31", True,  False, False, "2030-07-15", None),
        (2021, "Bonus",    "2022-09-30", 3, "2021-12-31", False, False, False, None,         None),
        (2022, "Purchase", "2023-09-30", 4, "2022-12-31", False, False, False, "2031-06-30", None),
        (2022, "Bonus",    "2023-09-30", 3, "2022-12-31", False, False, False, None,         None),
        (2022, "Free",     "2027-09-30", 1, "2022-12-31", False, False, True,  None,         "2031-06-30"),
        (2023, "Purchase", "2024-09-30", 4, "2023-12-31", False, True,  False, "2032-06-30", None),
        (2023, "Bonus",    "2024-09-30", 3, "2023-12-31", False, False, False, None,         None),
        (2024, "Purchase", "2025-09-30", 4, "2024-12-31", False, True,  False, "2033-06-30", None),
        (2024, "Bonus",    "2025-09-30", 3, "2024-12-31", False, False, False, None,         None),
        (2025, "Purchase", "2026-09-30", 4, "2025-12-31", False, True,  False, "2034-06-30", None),
        (2025, "Bonus",    "2026-09-30", 3, "2025-12-31", False, False, False, None,         None),
    ]
    assert len(schedule) == len(expected)
    for actual, (year, typ, vs, periods, ed, dcu, sdp, zb, pdd, tdd) in zip(schedule, expected):
        assert actual["year"] == year
        assert actual["type"] == typ
        assert actual["vest_start"] == vs
        assert actual["periods"] == periods
        assert actual["exercise_date"] == ed
        assert actual["default_catch_up"] == dcu
        assert actual["show_dp_shares"] == sdp
        assert actual["zero_basis"] == zb
        assert actual["default_purchase_due_date"] == pdd
        assert actual["default_tax_due_date"] == tdd


def test_grant_types_are_code_not_content(client):
    data = _get(client)
    # grant_type_defs is no longer part of the /api/content blob —
    # the four types live in backend/app/grant_types.py as code.
    assert "grant_type_defs" not in data
    from app.grant_types import GRANT_TYPE_NAMES
    assert GRANT_TYPE_NAMES == ["Purchase", "Catch-Up", "Bonus", "Free"]


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
    chains = data["loan_refinances"]["purchase"]
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
    tax_chains = data["loan_refinances"]["tax"]
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


def test_grant_program_settings(client):
    data = _get(client)
    settings = data["grant_program_settings"]
    assert settings["tax_fallback_federal"] == 0.37
    assert settings["tax_fallback_state"] == 0.0765
    assert settings["dp_min_percent"] == 0.10
    assert settings["dp_min_cap"] == 20000.0
    # Derived from grant_templates / loan_rates, not stored.
    assert settings["price_years_start"] == 2018
    assert settings["price_years_end"] == 2026
    # Removed: loan_term_years, latest_rate_year, dp_shares_start_year,
    # default_purchase_due_month_day_pre/post2022.
    for removed in ("loan_term_years", "latest_rate_year", "dp_shares_start_year",
                    "default_purchase_due_month_day_pre2022",
                    "default_purchase_due_month_day_post2022"):
        assert removed not in settings


def test_seed_is_idempotent(client, db_session):
    """Calling seed_content_if_empty again after it ran via lifespan must be a no-op."""
    from app.content_service import seed_content_if_empty
    from scaffold.models import GrantTemplate, LoanRate
    before_templates = db_session.query(GrantTemplate).count()
    before_rates = db_session.query(LoanRate).count()
    assert before_templates > 0
    assert before_rates > 0
    seed_content_if_empty(db_session)
    assert db_session.query(GrantTemplate).count() == before_templates
    assert db_session.query(LoanRate).count() == before_rates


# ── Phase 2: write endpoints (content-admin gated) ─────────────────────────

ADMIN_EMAIL = "admin@example.com"


def _login_admin(client):
    os.environ["ADMIN_EMAIL"] = ADMIN_EMAIL
    client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL, "name": "Admin"})


def test_content_writes_forbid_non_admin(client):
    register_user(client, "regular@test.com")
    r = client.post("/api/content/grant-templates", json={
        "year": 2030, "type": "Purchase",
        "vest_start": "2031-09-30", "periods": 4,
        "exercise_date": "2030-12-31",
    })
    assert r.status_code == 403


def test_admin_can_write_content(client):
    _login_admin(client)
    try:
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Purchase",
            "vest_start": "2031-09-30", "periods": 4,
            "exercise_date": "2030-12-31",
        })
        assert r.status_code == 201, r.text
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_content_admin_can_write_content(client, make_client, db_session):
    from scaffold.models import User
    # Admin promotes a regular user
    _login_admin(client)
    try:
        with make_client("editor@test.com") as editor_client:
            editor_id = editor_client.get("/api/me").json()["id"]
        r = client.post(f"/api/admin/users/{editor_id}/content-admin")
        assert r.status_code == 204
    finally:
        os.environ.pop("ADMIN_EMAIL", None)

    # Editor logs in fresh — is_content_admin persists across logins
    with make_client("editor@test.com") as editor_client:
        me = editor_client.get("/api/me").json()
        assert me["is_content_admin"] is True
        assert me["is_admin"] is False
        r = editor_client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Bonus",
            "vest_start": "2031-09-30", "periods": 3,
            "exercise_date": "2030-12-31",
        })
        assert r.status_code == 201, r.text


def test_grant_template_crud(client):
    _login_admin(client)
    try:
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Purchase",
            "vest_start": "2031-09-30", "periods": 4,
            "exercise_date": "2030-12-31",
        })
        tpl_id = r.json()["id"]

        # Update
        r = client.put(f"/api/content/grant-templates/{tpl_id}", json={"periods": 5})
        assert r.status_code == 200

        # Visible in GET /api/content
        data = client.get("/api/content").json()
        match = [t for t in data["grant_templates"] if t["year"] == 2030 and t["type"] == "Purchase"]
        assert len(match) == 1
        assert match[0]["periods"] == 5

        # Delete
        r = client.delete(f"/api/content/grant-templates/{tpl_id}")
        assert r.status_code == 204
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_grant_template_validator_purchase_only_flags(client):
    _login_admin(client)
    try:
        # show_dp_shares rejected on Bonus.
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Bonus",
            "vest_start": "2031-09-30", "periods": 3,
            "exercise_date": "2030-12-31",
            "show_dp_shares": True,
        })
        assert r.status_code == 422

        # default_catch_up rejected on Bonus.
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Bonus",
            "vest_start": "2031-09-30", "periods": 3,
            "exercise_date": "2030-12-31",
            "default_catch_up": True,
        })
        assert r.status_code == 422
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_grant_template_validator_tax_due_requires_zero_basis_or_catch_up(client):
    _login_admin(client)
    try:
        # Plain Purchase template — no tax loans generated, tax due date is meaningless.
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Purchase",
            "vest_start": "2031-09-30", "periods": 4,
            "exercise_date": "2030-12-31",
            "default_tax_due_date": "2039-06-30",
        })
        assert r.status_code == 422

        # Bonus without zero_basis — tax due date still rejected (FMV Bonus has no tax loans).
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Bonus",
            "vest_start": "2031-09-30", "periods": 3,
            "exercise_date": "2030-12-31",
            "default_tax_due_date": "2033-06-30",
        })
        assert r.status_code == 422

        # Bonus + zero_basis — allowed.
        r = client.post("/api/content/grant-templates", json={
            "year": 2030, "type": "Bonus",
            "vest_start": "2031-09-30", "periods": 3,
            "exercise_date": "2030-12-31",
            "zero_basis": True,
            "default_tax_due_date": "2033-06-30",
        })
        assert r.status_code == 201, r.text

        # Purchase with catch-up — allowed (catch-up generates tax loans).
        r = client.post("/api/content/grant-templates", json={
            "year": 2031, "type": "Purchase",
            "vest_start": "2032-09-30", "periods": 4,
            "exercise_date": "2031-12-31",
            "default_catch_up": True,
            "default_tax_due_date": "2040-06-30",
        })
        assert r.status_code == 201, r.text

        # Update-path invariant: can't drop catch-up while keeping tax due date.
        tpl_id = r.json()["id"]
        r = client.put(f"/api/content/grant-templates/{tpl_id}", json={"default_catch_up": False})
        assert r.status_code == 422

        # zero_basis rejected on Purchase templates.
        r = client.post("/api/content/grant-templates", json={
            "year": 2032, "type": "Purchase",
            "vest_start": "2033-09-30", "periods": 4,
            "exercise_date": "2032-12-31",
            "zero_basis": True,
        })
        assert r.status_code == 422

        # default_purchase_due_date rejected on non-Purchase templates.
        r = client.post("/api/content/grant-templates", json={
            "year": 2033, "type": "Bonus",
            "vest_start": "2034-09-30", "periods": 3,
            "exercise_date": "2033-12-31",
            "default_purchase_due_date": "2042-06-30",
        })
        assert r.status_code == 422
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_loan_rate_validators(client):
    _login_admin(client)
    try:
        # tax without grant_type
        r = client.post("/api/content/loan-rates", json={
            "loan_kind": "tax", "year": 2030, "rate": 0.05,
        })
        assert r.status_code == 422
        # purchase_original no longer needs a due_date (lives on GrantTemplate now).
        r = client.post("/api/content/loan-rates", json={
            "loan_kind": "purchase_original", "year": 2030, "rate": 0.05,
        })
        assert r.status_code == 201, r.text
        # valid interest rate
        r = client.post("/api/content/loan-rates", json={
            "loan_kind": "interest", "year": 2031, "rate": 0.05,
        })
        assert r.status_code == 201, r.text
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_grant_type_def_endpoints_are_gone(client):
    _login_admin(client)
    try:
        # Type CRUD endpoints were removed when grant types became code.
        r = client.post("/api/content/grant-type-defs", json={
            "name": "Retention",
            "color_class": "bg-indigo-700 text-white",
            "description": "Retention grant",
        })
        assert r.status_code == 404
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_bonus_variant_crud(client):
    _login_admin(client)
    try:
        r = client.post("/api/content/bonus-schedule-variants", json={
            "grant_year": 2030, "grant_type": "Bonus",
            "variant_code": "X", "periods": 5, "label": "X (5 years)",
        })
        assert r.status_code == 201
        vid = r.json()["id"]

        r = client.put(f"/api/content/bonus-schedule-variants/{vid}", json={"label": "Renamed"})
        assert r.status_code == 200

        r = client.delete(f"/api/content/bonus-schedule-variants/{vid}")
        assert r.status_code == 204
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_loan_refinance_crud(client):
    _login_admin(client)
    try:
        r = client.post("/api/content/loan-refinances", json={
            "chain_kind": "purchase", "grant_year": 2030, "grant_type": "Purchase",
            "order_idx": 0, "date": "2032-01-01", "rate": 0.04, "loan_year": 2032,
            "due_date": "2040-07-15",
        })
        assert r.status_code == 201
        rid = r.json()["id"]

        r = client.put(f"/api/content/loan-refinances/{rid}", json={"rate": 0.045})
        assert r.status_code == 200

        r = client.delete(f"/api/content/loan-refinances/{rid}")
        assert r.status_code == 204
    finally:
        os.environ.pop("ADMIN_EMAIL", None)


def test_grant_program_settings_update(client):
    _login_admin(client)
    try:
        r = client.put("/api/content/grant-program-settings", json={
            "tax_fallback_federal": 0.35, "flexible_payoff_enabled": True,
        })
        assert r.status_code == 200
        data = client.get("/api/content").json()
        assert data["grant_program_settings"]["tax_fallback_federal"] == 0.35
        assert data["grant_program_settings"]["flexible_payoff_enabled"] is True
    finally:
        os.environ.pop("ADMIN_EMAIL", None)
