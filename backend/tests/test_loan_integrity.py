"""A loan row is not automatically a debt, and not automatically attached.

Two shapes of bad loan data reached the dashboard's totals. A *refinance chain*
keeps every link as a row, so any aggregate that sums `amount` across all rows
charges one debt once per link — a four-link chain on one 76k loan reported
305k. An *orphan* is a loan whose (grant_year, grant_type) matches no grant:
invisible to the payoff schedule, the interest pool and the cost basis, yet
still counted as money owed. Both were live on a real account.
"""
import copy
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp
from tests.test_wizard import MINIMAL_PAYLOAD

GRANT = {"year": 2020, "type": "Purchase", "shares": 10000, "price": 1.5,
         "vest_start": "2021-03-01", "periods": 5, "exercise_date": "2020-12-31"}
PRINCIPAL = 100_000.0


def loan(**kw):
    body = {"grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
            "loan_year": 2020, "amount": PRINCIPAL, "interest_rate": 0.03,
            "due_date": "2030-12-31"}
    body.update(kw)
    return body


@pytest.fixture()
def account(client):
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json={"effective_date": "2021-06-01", "price": 2.0})
    return client


def chain(client, length, **kw):
    """A refinance chain of `length` links, each carrying the same principal."""
    previous = None
    for i in range(length):
        body = loan(loan_number=f"L{i}", **kw)
        if previous is not None:
            body["refinances_loan_id"] = previous
        previous = client.post("/api/loans", json=body).json()["id"]
    return previous


# ── refinance chains ────────────────────────────────────────────────────────

def test_principal_counts_the_debt_once_not_once_per_link(account):
    chain(account, 4)
    dash = account.get("/api/dashboard").json()
    assert dash["total_loan_principal"] == PRINCIPAL


def test_the_principal_agrees_with_the_payoff_schedule(account):
    """The two disagreeing was the tell: the schedule already deduped."""
    chain(account, 3)
    dash = account.get("/api/dashboard").json()
    scheduled = sum(y["payoff_sale"] + y["cash_in"] for y in dash["loan_payment_by_year"])
    assert dash["total_loan_principal"] == pytest.approx(scheduled)


def test_tax_loans_count_the_debt_once_too(account):
    chain(account, 3, loan_type="Tax")
    assert account.get("/api/dashboard").json()["total_tax_paid"] == PRINCIPAL


def test_projected_interest_accrues_on_the_live_link_only(db_session, account):
    """A superseded link's principal is carried by its successor, so projecting
    interest on both charged the same debt twice."""
    from app.routers.events import _build_interest_pool
    from scaffold.models import Loan, User
    from tests.conftest import user_key

    chain(account, 2)
    user = db_session.query(User).one()
    with user_key(user):
        pool = _build_interest_pool(db_session.query(Loan).filter(Loan.user_id == user.id).all())
    assert pool, "a purchase loan should project interest"
    assert set(pool.values()) == {PRINCIPAL * 0.03}


def test_one_unrefinanced_loan_is_unaffected(account):
    """The dedup must not eat a loan nothing supersedes."""
    chain(account, 1)
    assert account.get("/api/dashboard").json()["total_loan_principal"] == PRINCIPAL


# ── a loan may not refinance itself ─────────────────────────────────────────

def test_the_crud_path_refuses_a_self_reference(account):
    created = account.post("/api/loans", json=loan(loan_number="A")).json()
    resp = account.put(f"/api/loans/{created['id']}",
                       json={"refinances_loan_id": created["id"], "version": created["version"]})
    assert resp.status_code == 400
    assert "itself" in resp.json()["detail"]


def test_the_wizard_does_not_link_a_loan_to_itself(client):
    """The bulk resolvers matched on loan_number and never compared ids. A row
    naming its own number was dropped by the payoff schedule while the dashboard
    still counted its principal — the loan was both settled and owed.
    """
    register_user(client)
    payload = copy.deepcopy(MINIMAL_PAYLOAD)
    payload["grants"][0]["loans"] = [{
        "loan_number": "SELF", "loan_type": "Purchase", "loan_year": 2021,
        "amount": 5000.0, "interest_rate": 0.03, "due_date": "2030-12-31",
        "refinances_loan_number": "SELF",
    }]
    assert client.post("/api/wizard/submit", json=payload).status_code == 201

    rows = client.get("/api/loans").json()
    assert [r["refinances_loan_id"] for r in rows] == [None]
    dash = client.get("/api/dashboard").json()
    assert dash["total_loan_principal"] == 5000.0
    assert dash["loan_payment_by_year"], "a live loan must appear in the schedule"


def test_a_genuine_wizard_refinance_still_links(client):
    """The guard compares ids; it must not drop a real chain."""
    register_user(client)
    payload = copy.deepcopy(MINIMAL_PAYLOAD)
    payload["grants"][0]["loans"] = [
        {"loan_number": "OLD", "loan_type": "Purchase", "loan_year": 2021,
         "amount": 5000.0, "interest_rate": 0.03, "due_date": "2030-12-31",
         "refinances_loan_number": ""},
        {"loan_number": "NEW", "loan_type": "Purchase", "loan_year": 2022,
         "amount": 5000.0, "interest_rate": 0.04, "due_date": "2030-12-31",
         "refinances_loan_number": "OLD"},
    ]
    assert client.post("/api/wizard/submit", json=payload).status_code == 201

    rows = {r["loan_number"]: r for r in client.get("/api/loans").json()}
    assert rows["NEW"]["refinances_loan_id"] == rows["OLD"]["id"]
    assert client.get("/api/dashboard").json()["total_loan_principal"] == 5000.0


# ── every loan hangs off a grant ────────────────────────────────────────────

def test_a_loan_for_a_grant_that_does_not_exist_is_refused(account):
    resp = account.post("/api/loans", json=loan(grant_year=2019, grant_type="Bonus"))
    assert resp.status_code == 400
    assert "2019 Bonus" in resp.json()["detail"]


def test_the_bulk_path_refuses_one_too(account):
    resp = account.post("/api/loans/bulk", json=[loan(grant_year=2019, grant_type="Bonus")])
    assert resp.status_code == 400
    assert account.get("/api/loans").json() == []


def test_repointing_a_loan_at_a_missing_grant_is_refused(account):
    created = account.post("/api/loans", json=loan()).json()
    resp = account.put(f"/api/loans/{created['id']}",
                       json={"grant_year": 2019, "version": created["version"]})
    assert resp.status_code == 400


def test_editing_an_unrelated_field_is_not_blocked(account):
    """The check fires on re-pointing, not on every edit. Checking always would
    trap an existing orphan: its owner could not correct anything, only delete."""
    created = account.post("/api/loans", json=loan()).json()
    resp = account.put(f"/api/loans/{created['id']}",
                       json={"amount": 123.0, "version": created["version"]})
    assert resp.status_code == 200


def test_a_loan_may_hang_off_any_grant_the_account_holds(account):
    account.post("/api/grants", json={**GRANT, "year": 2021, "type": "Bonus", "price": 0})
    resp = account.post("/api/loans", json=loan(grant_year=2021, grant_type="Bonus"))
    assert resp.status_code == 201


# ── the dashboard says which basis each figure is on ────────────────────────

@pytest.fixture()
def mcp(client):
    """Vesting still to come, so the two bases differ."""
    register_user(client)
    year = date.today().year
    client.post("/api/grants", json={
        "year": year - 1, "type": "Bonus", "shares": 4000, "price": 0,
        "vest_start": f"{year}-03-01", "periods": 5,
        "exercise_date": f"{year - 1}-12-31",
    })
    client.post("/api/prices", json={"effective_date": "2021-06-01", "price": 2.0})
    return Mcp(client)


def test_the_bounded_figures_carry_bounded_names(mcp):
    """`total_shares` meant the whole position in the app and the vested count in
    the tool. Same key, two bases, and a reader could not tell."""
    dash = mcp.call("get_dashboard")
    assert "total_shares" not in dash
    assert "total_income" not in dash
    assert "total_cap_gains" not in dash
    assert dash["vested_shares"] < dash["shares_at_end_of_schedule"]
    assert dash["income_to_date"] >= 0


def test_the_full_position_is_reported_as_a_share_count(mcp, client):
    """Share counts follow the vesting schedule, so the lifetime figure is a
    fact. There is deliberately no lifetime income or gains: those would be
    computed from prices the user assumed."""
    unbounded = client.get("/api/dashboard").json()
    assert mcp.call("get_dashboard")["shares_at_end_of_schedule"] == unbounded["total_shares"]
    assert "lifetime_income" not in mcp.call("get_dashboard")


def test_the_basis_is_stated_not_implied(mcp):
    basis = mcp.call("get_dashboard")["basis"]
    assert date.today().isoformat() in basis
    assert "shares_at_end_of_schedule" in basis


def test_the_app_keeps_the_keys_it_always_had(client):
    """as_of=None is the app's call and must be untouched by the rename."""
    register_user(client)
    client.post("/api/grants", json=GRANT)
    dash = client.get("/api/dashboard").json()
    assert "total_shares" in dash and "vested_shares" not in dash
    assert dash["as_of"] is None


def test_an_empty_account_answers_in_the_same_shape(client):
    """Otherwise a caller reads total_shares here and vested_shares everywhere else."""
    register_user(client)
    dash = Mcp(client).call("get_dashboard")
    assert dash["vested_shares"] == 0
    assert dash["shares_at_end_of_schedule"] == 0
    assert "total_shares" not in dash


# ── the workbook importer ───────────────────────────────────────────────────

SCHEDULE_HEADERS = ["Year", "Type", "Shares", "Price", "Vest Start", "Periods",
                    "Exercise Date", "DP Shares"]
LOAN_HEADERS = ["Loan #", "Grant Year", "Grant Type", "Loan Type", "Loan Year",
                "Amount", "Rate", "Due Date", "Refinances Loan #"]


def workbook(loan_rows, grant_rows=((2020, "Purchase"),)):
    import io

    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(SCHEDULE_HEADERS)
    for year, gtype in grant_rows:
        ws.append([year, gtype, 10000, 1.99, f"{year + 1}-03-01", 5, f"{year}-12-31", 0])
    wl = wb.create_sheet("Loans")
    wl.append(LOAN_HEADERS)
    for row in loan_rows:
        wl.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def upload(client, buf):
    return client.post(
        "/api/import/excel",
        files={"file": ("book.xlsx", buf,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )


def test_an_import_carrying_an_orphan_loan_is_refused(client):
    """This is the likeliest way one got in: a file naming a grant it does not
    carry. Refused before anything is wiped, so the account survives it."""
    register_user(client)
    client.post("/api/grants", json=GRANT)

    resp = upload(client, workbook([["X1", 2019, "Bonus", "Purchase", 2019,
                                     50000, 0.03, "2030-12-31", ""]]))
    assert resp.status_code == 400
    assert "no 2019 Bonus grant" in resp.json()["detail"]
    assert len(client.get("/api/grants").json()) == 1, "the account must be untouched"


def test_an_import_whose_loans_match_its_grants_is_accepted(client):
    register_user(client)
    resp = upload(client, workbook([["X1", 2020, "Purchase", "Purchase", 2020,
                                     50000, 0.03, "2030-12-31", ""]]))
    assert resp.status_code == 201, resp.text
    assert client.get("/api/dashboard").json()["total_loan_principal"] == 50000.0


def test_an_import_does_not_link_a_loan_to_itself(client):
    register_user(client)
    resp = upload(client, workbook([["SELF", 2020, "Purchase", "Purchase", 2020,
                                     50000, 0.03, "2030-12-31", "SELF"]]))
    assert resp.status_code == 201, resp.text
    assert [r["refinances_loan_id"] for r in client.get("/api/loans").json()] == [None]
    assert client.get("/api/dashboard").json()["total_loan_principal"] == 50000.0


def test_an_imported_refinance_chain_counts_once(client):
    register_user(client)
    resp = upload(client, workbook([
        ["OLD", 2020, "Purchase", "Purchase", 2020, 50000, 0.03, "2030-12-31", ""],
        ["NEW", 2020, "Purchase", "Purchase", 2022, 50000, 0.04, "2030-12-31", "OLD"],
    ]))
    assert resp.status_code == 201, resp.text
    assert client.get("/api/dashboard").json()["total_loan_principal"] == 50000.0


# ── a loan pointing at itself supersedes nothing ────────────────────────────

def self_referencing_loan(client, db_session, **kw):
    """The state a real account is in: a live loan whose refinances_loan_id is
    its own id. Writes have refused that since the bulk resolvers compared ids,
    so straight SQL is the only way to reach it — and the only way to test that
    the read side still handles rows written before the guard existed.
    """
    from sqlalchemy import text

    created = client.post("/api/loans?generate_payoff_sale=false", json=loan(**kw)).json()
    db_session.execute(text("UPDATE loans SET refinances_loan_id = id WHERE id = :i"),
                       {"i": created["id"]})
    db_session.commit()
    return created["id"]


def test_a_loan_that_points_at_itself_is_still_owed(account, db_session):
    """Reading a self-reference as supersession dropped a live 6,432.84 debt
    out of every total. A row supersedes nothing but itself, which is nothing."""
    self_referencing_loan(account, db_session)
    assert account.get("/api/dashboard").json()["total_loan_principal"] == PRINCIPAL


def test_it_stays_on_the_payoff_schedule_too(account, db_session):
    """The aggregate and the schedule were wrong by the same amount, which is
    why they agreed and neither looked suspect."""
    self_referencing_loan(account, db_session)
    dash = account.get("/api/dashboard").json()
    scheduled = sum(y["payoff_sale"] + y["cash_in"] for y in dash["loan_payment_by_year"])
    assert scheduled == pytest.approx(PRINCIPAL)
    assert dash["total_loan_principal"] == pytest.approx(scheduled)


def test_a_self_referencing_tax_loan_still_counts(account, db_session):
    self_referencing_loan(account, db_session, loan_type="Tax")
    assert account.get("/api/dashboard").json()["total_tax_paid"] == PRINCIPAL


def test_it_still_accrues_projected_interest(db_session, account):
    """`_build_interest_pool` walks the same exclusion set, so it was
    understating the deduction by this loan's interest every year."""
    from app.routers.events import _build_interest_pool
    from scaffold.models import Loan, User
    from tests.conftest import user_key

    self_referencing_loan(account, db_session)
    user = db_session.query(User).one()
    with user_key(user):
        pool = _build_interest_pool(db_session.query(Loan).filter(Loan.user_id == user.id).all())
    assert pool, "a live purchase loan must project interest"
    assert set(pool.values()) == {PRINCIPAL * 0.03}


def test_the_connector_does_not_report_it_as_refinanced(account, db_session):
    """list_loans builds its own successor map and had the same bug: the loan
    came back `refinanced` with a zero balance."""
    loan_id = self_referencing_loan(account, db_session)
    row = next(r for r in Mcp(account).call("list_loans")["loans"] if r["id"] == loan_id)
    assert row["status"] == "outstanding"
    assert row["superseded_by_loan_id"] is None
    assert row["balance"] == PRINCIPAL


def test_a_real_chain_beside_a_self_reference_is_still_deduped(account, db_session):
    """Both rules at once: three links collapse to one, the self-link stands."""
    chain(account, 3)
    self_referencing_loan(account, db_session, loan_number="SELF")
    dash = account.get("/api/dashboard").json()
    assert dash["total_loan_principal"] == pytest.approx(PRINCIPAL * 2)
    scheduled = sum(y["payoff_sale"] + y["cash_in"] for y in dash["loan_payment_by_year"])
    assert dash["total_loan_principal"] == pytest.approx(scheduled)


def test_the_error_names_the_grant_types_that_year_had(account):
    """"2019 Bonus" is not a near miss — 2019 had Catch-Up and Purchase. Saying
    which is the difference between a rejection and a usable one."""
    from app.epic_import.skeleton import build_skeleton

    schedule, _ = build_skeleton(load_content_for(account))
    year = next((t.year for t in schedule.templates), None)
    if year is None:
        pytest.skip("no company grant schedule seeded in this environment")
    types = sorted({t.type for t in schedule.templates if t.year == year})

    resp = account.post("/api/loans", json=loan(grant_year=year, grant_type="Nonexistent"))
    assert resp.status_code == 400
    for t in types:
        assert t in resp.json()["detail"]


def load_content_for(client):
    from app.content_service import load_content
    from database import SessionLocal

    db = SessionLocal()
    try:
        return load_content(db)
    finally:
        db.close()
