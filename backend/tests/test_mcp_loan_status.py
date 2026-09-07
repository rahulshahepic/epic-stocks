"""A loan on the list is not automatically a loan you owe.

`list_loans` returned every row flat, each with a balance. A refinance chain
keeps every link, so one 76k debt appeared four times at 76k — and an assistant
totalling the column reported four debts. #516 fixed the dashboard's
aggregates; the list itself still invited the same mistake, one endpoint away.

The rows stay: refinance history is worth having. What changed is that each
row says which of four states it is in, and carries a balance that matches.
"""
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp

GRANT = {"year": 2020, "type": "Purchase", "shares": 10000, "price": 1.5,
         "vest_start": "2021-03-01", "periods": 5, "exercise_date": "2020-12-31"}
PRINCIPAL = 76_296.60


def body(**kw):
    out = {"grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
           "loan_year": 2020, "amount": PRINCIPAL, "interest_rate": 0.03,
           "due_date": "2030-12-31"}
    out.update(kw)
    return out


@pytest.fixture()
def account(client):
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json={"effective_date": "2021-06-01", "price": 2.0})
    return client


def chain(client, length):
    previous = None
    ids = []
    for i in range(length):
        payload = body(loan_number=f"L{i}")
        if previous is not None:
            payload["refinances_loan_id"] = previous
        previous = client.post("/api/loans?generate_payoff_sale=false",
                               json=payload).json()["id"]
        ids.append(previous)
    return ids


def by_id(listed):
    return {row["id"]: row for row in listed["loans"]}


# ── the chain ───────────────────────────────────────────────────────────────

def test_superseded_links_are_marked_and_carry_no_balance(account):
    """The report verbatim: four links of one 76,296.60 debt, four balances."""
    ids = chain(account, 4)
    listed = Mcp(account).call("list_loans")
    rows = by_id(listed)

    assert [rows[i]["status"] for i in ids] == ["refinanced"] * 3 + ["outstanding"]
    assert [rows[i]["balance"] for i in ids[:3]] == [0.0, 0.0, 0.0]
    assert rows[ids[-1]]["balance"] == PRINCIPAL


def test_the_history_is_kept_not_hidden(account):
    """Dropping the old links would lose what the debt has cost over time."""
    ids = chain(account, 4)
    rows = by_id(Mcp(account).call("list_loans"))
    assert len(rows) == 4
    assert all(rows[i]["amount"] == PRINCIPAL for i in ids)


def test_each_link_names_the_loan_that_replaced_it(account):
    ids = chain(account, 3)
    rows = by_id(Mcp(account).call("list_loans"))
    assert [rows[i]["superseded_by_loan_id"] for i in ids] == [ids[1], ids[2], None]


def test_totalling_the_balances_gives_the_reported_total(account):
    """The invariant that makes the naive read correct rather than merely warned
    against: a reader who sums the column lands on the same number."""
    chain(account, 4)
    listed = Mcp(account).call("list_loans")
    assert sum(r["balance"] for r in listed["loans"]) == pytest.approx(
        listed["total_outstanding"])


def test_the_total_is_the_apps_own_figure(account, db_session):
    from app.routers.events import _compute_outstanding_principal
    from scaffold.models import Loan, LoanPayment, Sale, User
    from tests.conftest import user_key

    chain(account, 3)
    user = db_session.query(User).one()
    with user_key(user):
        expected = _compute_outstanding_principal(
            db_session.query(Loan).filter(Loan.user_id == user.id).all(),
            db_session.query(LoanPayment).filter(LoanPayment.user_id == user.id).all(),
            db_session.query(Sale).filter(Sale.user_id == user.id).all(),
            date.today(),
        )
    assert Mcp(account).call("list_loans")["total_outstanding"] == pytest.approx(expected)


# ── the other three states ──────────────────────────────────────────────────

def test_an_ordinary_loan_is_outstanding(account):
    account.post("/api/loans?generate_payoff_sale=false", json=body(loan_number="A"))
    row = Mcp(account).call("list_loans")["loans"][0]
    assert row["status"] == "outstanding"
    assert row["balance"] == PRINCIPAL


def test_an_early_payment_comes_off_the_balance(account):
    created = account.post("/api/loans?generate_payoff_sale=false",
                           json=body(loan_number="A")).json()
    account.post("/api/loan-payments", json={
        "loan_id": created["id"], "date": "2024-01-15", "amount": 296.60,
    })
    row = Mcp(account).call("list_loans")["loans"][0]
    assert row["paid_early"] == 296.60
    assert row["balance"] == pytest.approx(PRINCIPAL - 296.60)


def test_a_loan_drawn_in_a_later_year_is_not_owed_yet(account):
    account.post("/api/loans?generate_payoff_sale=false",
                 json=body(loan_number="F", loan_year=date.today().year + 2,
                           due_date=f"{date.today().year + 5}-12-31"))
    row = Mcp(account).call("list_loans")["loans"][0]
    assert row["status"] == "not_yet_drawn"
    assert row["balance"] == 0.0


def test_a_loan_a_sale_has_paid_off_is_settled(account):
    created = account.post("/api/loans?generate_payoff_sale=false",
                           json=body(loan_number="A")).json()
    account.post("/api/sales", json={
        "date": "2024-06-01", "shares": 1000, "price_per_share": 80.0,
        "loan_id": created["id"],
    })
    row = Mcp(account).call("list_loans")["loans"][0]
    assert row["status"] == "settled"
    assert row["balance"] == 0.0


# ── what the model is told ──────────────────────────────────────────────────

def test_the_note_warns_against_totalling_amount(account):
    chain(account, 2)
    note = Mcp(account).call("list_loans")["note"]
    assert "never total `amount`" in note
    assert "total_loan_principal" in note, "the two totals must be told apart"


def test_the_two_totals_are_reconcilable(account):
    """They differ only by early payments, and the note says so. A model seeing
    a discrepancy it cannot explain will pick one and be wrong half the time."""
    created = account.post("/api/loans?generate_payoff_sale=false",
                           json=body(loan_number="A")).json()
    account.post("/api/loan-payments", json={
        "loan_id": created["id"], "date": "2024-01-15", "amount": 296.60,
    })
    mcp = Mcp(account)
    gross = mcp.call("get_dashboard")["total_loan_principal"]
    net = mcp.call("list_loans")["total_outstanding"]
    assert gross - net == pytest.approx(296.60)
