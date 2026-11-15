"""A draft (from Epic's files or an assistant) as the edits it implies.

Templates are starting points: what the draft states is kept. A grant the draft
does not name is never touched; a loan statement is the current state of the
loans it covers. Figures are invented.
"""
import pytest

from tests.conftest import register_user


@pytest.fixture()
def account(client):
    register_user(client)
    client.post("/api/grants", json={
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2022-09-30", "periods": 5, "exercise_date": "2021-12-31"})
    for n, kind in (("111", "Purchase"), ("222", "Interest")):
        assert client.post("/api/loans", json={
            "grant_year": 2021, "grant_type": "Purchase", "loan_type": kind,
            "loan_year": 2021, "amount": 1000.0, "interest_rate": 0.02,
            "due_date": "2030-12-31", "loan_number": n}).status_code == 201
    return client


def changes(client, **draft):
    r = client.post("/api/epic-import/changes", json={"draft": {"grants": [], **draft}})
    assert r.status_code == 200, r.text
    return r.json()


def summary(result):
    return [(c["kind"], c["action"], c["label"]) for c in result["changes"]]


NEW = {"year": 2026, "type": "Purchase", "shares": 2000, "price": 5.0,
       "vest_start": "2027-09-30", "periods": 4, "exercise_date": "2026-11-30",
       "loans": [{"loan_number": "900001", "loan_type": "Purchase", "loan_year": 2026,
                  "amount": 9000.0, "interest_rate": 0.045, "due_date": "2035-06-30"}]}


def test_adding_one_grant_touches_nothing_else(account):
    result = changes(account, grants=[NEW])
    assert summary(result) == [("grant", "create", "2026 Purchase grant"),
                               ("loan", "create", "2026 Purchase purchase loan 900001")]


def test_a_grant_off_the_company_schedule_keeps_its_own_dates(account):
    retention = {"year": 2025, "type": "Retention", "shares": 501, "price": 0,
                 "vesting": [{"date": "2026-03-01", "shares": 250}, {"date": "2027-06-15", "shares": 251}],
                 "exercise_date": "2025-12-31"}
    result = changes(account, grants=[retention])
    assert not result["blocked"]
    assert result["changes"][0]["values"]["vesting"] == retention["vesting"]


def test_a_schedule_that_differs_from_the_template_is_kept_and_noted(account):
    moved = {**NEW, "year": 2024, "vest_start": "2028-01-15", "exercise_date": "2024-12-31", "loans": []}
    result = changes(account, grants=[moved])
    assert result["changes"][0]["values"]["vest_start"] == "2028-01-15"
    assert any(f["code"] == "C10" for f in result["findings"])


def test_a_vesting_list_that_does_not_add_up_is_refused(account):
    bad = {**NEW, "vesting": [{"date": "2027-09-30", "shares": 1}]}
    result = changes(account, grants=[bad])
    assert result["blocked"]


def test_a_re_import_leaves_a_schedule_moved_for_leave_alone(account):
    grant = account.get("/api/grants").json()[0]
    leave = [dict(v) for v in grant["vesting"]]
    leave[2]["date"] = "2025-01-15"
    account.put(f"/api/grants/{grant['id']}", json={"vesting": leave, "version": grant["version"]})
    same = {"year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
            "exercise_date": "2021-12-31", "loans": []}
    assert changes(account, grants=[same])["changes"] == []


def test_a_statement_is_the_current_state_of_its_loans(account):
    """A loan the statement no longer lists is proposed for removal — and only
    when the draft came from a statement."""
    restated = {"year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
                "exercise_date": "2021-12-31",
                "loans": [{"loan_number": "111", "loan_type": "Purchase", "loan_year": 2021,
                           "amount": 800.0, "interest_rate": 0.02, "due_date": "2030-12-31"}]}
    without = summary(changes(account, grants=[restated]))
    assert ("loan", "update", "2021 Purchase purchase loan 111") in without
    assert not any(a == "delete" for _, a, _ in without)

    stated = changes(account, grants=[restated], statement_date="2026-10-31")
    removal = [c for c in stated["changes"] if c["action"] == "delete"]
    assert [c["label"] for c in removal] == ["2021 Purchase interest loan 222"]
    assert "2026-10-31" in removal[0]["detail"] and removal[0]["group"] == "remove"


def test_applying_the_changes_from_a_draft(account):
    result = changes(account, grants=[NEW], prices=[{"effective_date": "2026-01-01", "price": 5.0}])
    token = account.post("/api/changes/preview", json={"changes": result["changes"]}).json()["confirm"]
    done = account.post("/api/changes/apply", json={"changes": result["changes"], "confirm": token})
    assert done.status_code == 200, done.text
    assert {(g["year"], g["type"]) for g in account.get("/api/grants").json()} == {(2021, "Purchase"), (2026, "Purchase")}
    assert len(account.get("/api/loans").json()) == 3


def test_an_unchanged_price_is_not_proposed(account):
    account.post("/api/prices", json={"effective_date": "2021-01-01", "price": 2.0})
    assert changes(account, prices=[{"effective_date": "2021-01-01", "price": 2.0}])["changes"] == []


def test_a_removal_that_would_take_history_with_it_starts_unticked(account):
    """Removing a loan takes its payments, unlinks its sales and drops refinance
    history, so a statement may offer it but never pre-ticks it."""
    loans = {l["loan_number"]: l for l in account.get("/api/loans").json()}
    account.post("/api/loan-payments", json={"loan_id": loans["222"]["id"], "date": "2024-01-01", "amount": 10})
    restated = {"year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0, "exercise_date": "2021-12-31",
                "loans": [{"loan_number": "111", "loan_type": "Purchase", "loan_year": 2021,
                           "amount": 1000.0, "interest_rate": 0.02, "due_date": "2030-12-31"}]}
    removal = [c for c in changes(account, grants=[restated], statement_date="2026-10-31")["changes"]
               if c["action"] == "delete"]
    assert len(removal) == 1 and removal[0]["selected"] is False
    assert "history" in removal[0]["detail"]


def test_a_stated_schedule_survives_into_the_payload_a_draft_is_handed_on_in():
    from app.epic_import.draft import Draft, DraftGrant, to_wizard_payload
    from datetime import date
    g = DraftGrant(year=2025, type="Retention", shares=3, price=0, vest_start=date(2026, 1, 1), periods=2,
                   exercise_date=date(2025, 12, 31), vesting=[(date(2026, 1, 1), 1), (date(2027, 6, 1), 2)])
    assert to_wizard_payload(Draft(grants=[g]))["grants"][0]["vesting"] == [
        {"date": "2026-01-01", "shares": 1}, {"date": "2027-06-01", "shares": 2}]
