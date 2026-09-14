"""Coverage for the defects found reviewing PRs #529–#536.

Each test names the failure it pins rather than the function it calls, because
every one of these shipped green: the suites the PRs added asserted the helper
in isolation while the endpoint beside it went the other way.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import inspect as sa_inspect

import schemas
from app.loan_state import interest_accrual_end_year, refinanced_loan_ids, superseded_from_year
from app.routers.events import _compute_outstanding_principal, _live_loans
from scaffold.models import Sale, User

from .conftest import register_user, user_key
from .test_review_regressions import grant, loan


# ── Input bounds must not be enforced on the way out ────────────────────────

OUTPUT_MODELS = [schemas.GrantOut, schemas.LoanOut, schemas.PriceOut,
                 schemas.SaleOut, schemas.LoanPaymentOut]


@pytest.mark.parametrize("model", OUTPUT_MODELS, ids=lambda m: m.__name__)
def test_output_models_never_bound_reads(model):
    """A response model carrying an input bound turns a stored row into a 500.

    The bounds landed on the `*Create` models, which the `*Out` models inherit,
    so rows written before them stopped being readable — and these are list
    endpoints, so one unreadable row takes every other row down with it. A read
    has to show what is stored; that is how the user finds out it is wrong.
    """
    for name, field in model.model_fields.items():
        assert not field.metadata, (
            f"{model.__name__}.{name} carries {field.metadata!r}. Declare the "
            f"field on the Out model with the storage's own type."
        )


def _seed_sale(db_session, **kw):
    uid = db_session.query(User).first().id
    with user_key(db_session.get(User, uid)):
        db_session.add(Sale(user_id=uid, date=date(2024, 1, 1), shares=10,
                            price_per_share=100.0, notes="", **kw))
        db_session.commit()


@pytest.mark.parametrize("column,value", [
    ("federal_income_rate", 37.0),                      # a percentage, not a fraction
    ("lt_holding_days", 0),
    ("actual_tax_paid", -5.0),
    ("lot_overrides", [{"vest_date": "2020-01-01", "basis_price": 1.0, "shares": 0}]),
])
def test_a_row_that_predates_the_bounds_is_still_readable(client, db_session, column, value):
    register_user(client)
    _seed_sale(db_session, **{column: value})
    r = client.get("/api/sales")
    assert r.status_code == 200, r.text
    assert r.json()[0][column] == value


def test_legacy_rows_on_every_list_endpoint_still_read(client, db_session):
    """Grants, loans and prices inherited bounds from their Create models too.

    A loan whose `loan_type` is outside the enum, a zero amount, a rate stored on
    the old percentage scale, a zero-share grant, a zero price — all writable
    before the bounds landed, and all of them 500'd the list they were on.
    """
    from scaffold.models import Grant, Loan, Price
    register_user(client)
    uid = db_session.query(User).first().id
    with user_key(db_session.get(User, uid)):
        db_session.add(Loan(user_id=uid, grant_year=2020, grant_type="Purchase",
                            loan_type="Legacy", loan_year=2020, amount=0.0,
                            interest_rate=3.5, due_date=date(2030, 1, 1)))
        db_session.add(Grant(user_id=uid, year=2020, type="Purchase", shares=0, price=0.0,
                             vest_start=date(2021, 1, 1), periods=0,
                             exercise_date=date(2020, 1, 1)))
        db_session.add(Price(user_id=uid, effective_date=date(2020, 1, 1), price=0.0))
        db_session.commit()
    for path in ("/api/loans", "/api/grants", "/api/prices"):
        r = client.get(path)
        assert r.status_code == 200, (path, r.text)
        assert len(r.json()) == 1, path


# ── Supersession is a fact about a row *and a date* ──────────────────────────

def _chain(refinance_year):
    return [
        SimpleNamespace(id=1, refinances_loan_id=None, loan_year=2020, amount=100),
        SimpleNamespace(id=2, refinances_loan_id=1, loan_year=refinance_year, amount=250),
    ]


def test_the_two_dashboard_debt_totals_agree_on_a_future_refinance():
    """`total_loan_principal` and the outstanding principal must not disagree.

    Both are reported side by side, and the MCP connector tells a model the only
    difference between them is early payments. Making one date-aware and leaving
    the other date-blind had the dashboard reporting the 2030 loan's 250 as
    principal while the debt actually owed was the 2020 loan's 100.
    """
    loans = _chain(2030)
    today = date(2026, 9, 13)
    assert _compute_outstanding_principal(loans, [], [], today) == 100
    assert sum(l.amount for l in _live_loans(loans, today)) == 100


def test_a_refinance_that_has_happened_supersedes_in_both_totals():
    loans = _chain(2024)
    today = date(2026, 9, 13)
    assert _compute_outstanding_principal(loans, [], [], today) == 250
    assert sum(l.amount for l in _live_loans(loans, today)) == 250


def test_as_of_none_means_ever_superseded():
    """The whole-schedule question, which payoff-sale generation asks."""
    assert refinanced_loan_ids(_chain(2030), None) == {1}
    assert refinanced_loan_ids(_chain(2030), date(2026, 1, 1)) == set()


def test_a_self_pointing_row_supersedes_nothing_under_either_reading():
    rows = [SimpleNamespace(id=1, refinances_loan_id=1, loan_year=2020, amount=6432.84)]
    assert refinanced_loan_ids(rows, None) == set()
    assert refinanced_loan_ids(rows, date(2030, 1, 1)) == set()
    assert _compute_outstanding_principal(rows, [], [], date(2030, 1, 1)) == 6432.84


def test_interest_accrues_up_to_the_refinance_and_not_past_it():
    loans = [
        SimpleNamespace(id=1, refinances_loan_id=None, loan_year=2020,
                        due_date=date(2030, 12, 31)),
        SimpleNamespace(id=2, refinances_loan_id=1, loan_year=2024,
                        due_date=date(2035, 12, 31)),
    ]
    first = superseded_from_year(loans)
    assert interest_accrual_end_year(loans[0], first) == 2023
    assert interest_accrual_end_year(loans[1], first) == 2035
    assert interest_accrual_end_year(loans[0], first, cap_year=2022) == 2022


def test_a_loan_the_schedule_replaces_gets_no_payoff_sale(client):
    """The timeline shows it as a $0 "Refinanced" event, so a sale would double it.

    `_regenerate_future_payoff_sales` asked whether the loan was superseded
    *today* while the timeline marker asked whether it ever is, so a loan due in
    2030 and refinanced in 2030 got both a $0 event and a payoff sale.
    """
    register_user(client)
    grant(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    old = loan(client, due_date="2030-01-01")
    loan(client, loan_year=2030, due_date="2035-01-01", refinances_loan_id=old["id"])
    assert client.post("/api/loans/regenerate-all-payoff-sales").status_code == 200
    assert [s["loan_id"] for s in client.get("/api/sales").json()].count(old["id"]) == 0


# ── A computed payoff sale the user has edited is theirs ─────────────────────

def _loan_with_payoff(client, due_date="2030-01-01"):
    grant(client, shares=100_000, price=1.0)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    ln = loan(client, amount=1000, due_date=due_date)
    r = client.post("/api/loans/regenerate-all-payoff-sales")
    assert r.status_code == 200, r.text
    sales = [s for s in client.get("/api/sales").json() if s["loan_id"] == ln["id"]]
    assert sales, "expected a generated payoff sale to work with"
    return ln, sales[0]


def test_a_generated_payoff_sale_is_marked_as_one(client):
    register_user(client)
    _, sale = _loan_with_payoff(client)
    assert sale["is_generated"] is True


def test_editing_a_payoff_sale_stops_the_regenerator_rewriting_it(client):
    """Recording a loan payment must not discard the user's own figures.

    The regenerator runs on every loan and loan-payment write. It skipped past
    sales and ones with recorded actual tax, but had no way to tell a future
    sale it had computed from one the user had deliberately retuned — so it
    overwrote it, or deleted it outright when the recomputed size came out zero.
    """
    register_user(client)
    ln, sale = _loan_with_payoff(client)
    edited = client.put(f"/api/sales/{sale['id']}", json={"shares": 7, "version": sale["version"]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["is_generated"] is False

    r = client.post("/api/loan-payments",
                    json={"loan_id": ln["id"], "date": "2026-01-01", "amount": 1000})
    assert r.status_code == 201, r.text
    after = [s for s in client.get("/api/sales").json() if s["id"] == sale["id"]]
    assert after and after[0]["shares"] == 7


def test_a_rate_override_does_not_claim_a_generated_sale(client):
    """Only the computed figure — date, shares, price — makes the row the user's."""
    register_user(client)
    _, sale = _loan_with_payoff(client)
    r = client.put(f"/api/sales/{sale['id']}",
                   json={"notes": "checked", "niit_rate": 0.038, "version": sale["version"]})
    assert r.status_code == 200, r.text
    assert r.json()["is_generated"] is True


def test_execute_payoff_refuses_to_overwrite_a_sale_the_user_entered(client):
    register_user(client)
    ln, sale = _loan_with_payoff(client)
    client.put(f"/api/sales/{sale['id']}", json={"shares": 7, "version": sale["version"]})
    r = client.post(f"/api/loans/{ln['id']}/execute-payoff")
    assert r.status_code == 409, r.text
    assert [s for s in client.get("/api/sales").json() if s["id"] == sale["id"]][0]["shares"] == 7


def test_executing_a_payoff_early_restamps_the_rates_with_the_new_date(client):
    """The sale moves to today and is re-priced, so its rates must move with it.

    Only the date, shares and price were being updated, so the row kept the
    rates stamped when the future-dated sale was first computed and today's sale
    was taxed at them.
    """
    register_user(client)
    ln, sale = _loan_with_payoff(client)
    assert sale["niit_rate"] != 0.0
    client.put("/api/tax-settings", json={"niit_rate": 0.0})
    r = client.post(f"/api/loans/{ln['id']}/execute-payoff")
    assert r.status_code in (200, 201), r.text
    assert r.json()["niit_rate"] == 0.0
    assert r.json()["date"] == date.today().isoformat()


# ── Narrower, and honest about what it blocks ────────────────────────────────

def test_editing_an_old_sales_notes_is_not_blocked_by_an_uncovered_loan(client):
    """The coverage check asks about the sale's date, so re-running it on an
    unchanged date blocked edits that could not affect coverage."""
    register_user(client)
    grant(client, shares=100_000)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    sale = client.post("/api/sales", json={
        "date": yesterday, "shares": 5, "price_per_share": 10.0, "notes": ""}).json()
    loan(client, due_date=yesterday, amount=500)
    r = client.put(f"/api/sales/{sale['id']}",
                   json={"notes": "kept for the record", "version": sale["version"]})
    assert r.status_code == 200, r.text


def test_moving_a_sale_past_an_uncovered_loan_is_still_blocked(client):
    register_user(client)
    grant(client, shares=100_000)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    sale = client.post("/api/sales", json={
        "date": "2021-01-01", "shares": 5, "price_per_share": 10.0, "notes": ""}).json()
    loan(client, due_date="2022-01-01", amount=500)
    r = client.put(f"/api/sales/{sale['id']}",
                   json={"date": "2023-01-01", "version": sale["version"]})
    assert r.status_code == 422, r.text


# ── A grant is identified by year and type on every path that writes one ─────

def test_a_workbook_with_two_rows_for_one_grant_is_refused(client, make_client):
    """Every other path refuses a duplicate (year, type); the importer wiped and
    inserted, so it created two rows that every loan would attach to both of."""
    import io
    import openpyxl
    register_user(client)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "Exercise Date"])
    ws.append([2020, "Purchase", 100, 1.0, "2021-01-01", 1, "2020-01-01"])
    ws.append([2020, "Purchase", 200, 1.0, "2021-01-01", 1, "2020-01-01"])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post("/api/import/excel",
                    files={"file": ("x.xlsx", buf.getvalue(),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 400, r.text
    assert r.text.count("Duplicate grant: Purchase 2020 appears more than once") == 1
    assert client.get("/api/grants").json() == []


# ── The rate scale ───────────────────────────────────────────────────────────

def test_a_loan_rate_is_a_fraction_everywhere_it_is_written(client):
    """5 meant 500%, and every consumer multiplied by it directly."""
    register_user(client)
    grant(client)
    body = {"grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
            "loan_year": 2020, "amount": 100, "due_date": "2030-01-01"}
    assert client.post("/api/loans", json={**body, "interest_rate": 5}).status_code == 422
    assert client.post("/api/loans", json={**body, "interest_rate": 0.05}).status_code == 201

    from app.routers.import_export import _validate_loan
    imported = {
        "grant_yr": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 100, "interest_rate": 5,
        "due": date(2030, 1, 1),
    }
    assert _validate_loan(imported, 2) == [
        "Row 2: interest_rate cannot exceed 1.0 (100%)"
    ]


@pytest.mark.parametrize("method", ["post", "put"])
def test_refinancing_never_deletes_a_user_owned_payoff_sale(client, method):
    register_user(client)
    old, sale = _loan_with_payoff(client)
    claimed = client.put(
        f"/api/sales/{sale['id']}",
        json={"shares": 7, "version": sale["version"]},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["is_generated"] is False

    if method == "post":
        response = client.post(
            "/api/loans?generate_payoff_sale=false",
            json={
                "grant_year": 2020, "grant_type": "Purchase",
                "loan_type": "Purchase", "loan_year": 2026,
                "amount": 1000, "interest_rate": 0.03,
                "due_date": "2035-01-01", "refinances_loan_id": old["id"],
            },
        )
    else:
        successor = loan(client, loan_year=2026, due_date="2035-01-01")
        response = client.put(
            f"/api/loans/{successor['id']}",
            json={
                "refinances_loan_id": old["id"],
                "version": successor["version"],
            },
        )

    assert response.status_code == 409, response.text
    kept = [s for s in client.get("/api/sales").json() if s["id"] == sale["id"]]
    assert kept and kept[0]["shares"] == 7


def test_the_sale_flag_is_on_the_orm_and_the_deletion_contract(db_session):
    """A new user-owned column still has to travel with the row it belongs to."""
    assert "is_generated" in {c.key for c in sa_inspect(Sale).mapper.column_attrs}
