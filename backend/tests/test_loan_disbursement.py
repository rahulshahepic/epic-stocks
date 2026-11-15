"""An explicit draw date gates principal and refinance state, including within a year."""
from datetime import date
from types import SimpleNamespace

import pytest

from app.routers.events import _compute_outstanding_principal, _live_loans
from tests.test_mcp_loan_status import GRANT, body, by_id
from tests.test_mcp_tools import Mcp
from tests.conftest import register_user


def loan(id=1, **kw):
    return SimpleNamespace(**dict({"id": id, "loan_year": 2026, "amount": 1000,
                                  "disbursed_on": date(2026, 11, 30),
                                  "refinances_loan_id": None}, **kw))


@pytest.mark.parametrize("day,expected", [(date(2026, 11, 15), 0),
                                          (date(2026, 11, 30), 1000),
                                          (date(2026, 12, 1), 1000)])
def test_principal_starts_on_draw_date(day, expected):
    rows = [loan()]
    assert _compute_outstanding_principal(rows, [], [], day) == expected
    assert sum(l.amount for l in _live_loans(rows, day)) == expected


def test_no_date_keeps_legacy_year_behavior():
    rows = [loan(disbursed_on=None)]
    assert _compute_outstanding_principal(rows, [], [], date(2025, 12, 31)) == 0
    assert _compute_outstanding_principal(rows, [], [], date(2026, 1, 1)) == 1000


def test_future_refinance_does_not_remove_existing_debt():
    rows = [loan(disbursed_on=None, loan_year=2020),
            loan(id=2, amount=1200, refinances_loan_id=1)]
    for day, expected in [(date(2026, 11, 15), 1000), (date(2026, 11, 30), 1200)]:
        assert _compute_outstanding_principal(rows, [], [], day) == expected
        assert sum(l.amount for l in _live_loans(rows, day)) == expected


def test_edit_preview_and_mcp_use_draw_date(client, monkeypatch):
    import app.mcp.read_tools as reads

    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 15)

    import app.changes as edits

    monkeypatch.setattr(reads, "date", Today)
    monkeypatch.setattr(edits, "date", Today)
    register_user(client)
    assert client.post("/api/grants", json=GRANT).status_code == 201
    created = client.post("/api/loans?generate_payoff_sale=false",
                          json=body(amount=1000, loan_year=2026)).json()
    changes = [{"kind": "loan", "action": "update", "id": created["id"],
                "version": created["version"], "values": {"disbursed_on": "2026-11-30"}}]
    preview = client.post("/api/changes/preview", json={"changes": changes}).json()
    assert preview["position_before"]["outstanding_loan_balance"] == 1000
    assert preview["position_after"]["outstanding_loan_balance"] == 0
    done = client.post("/api/changes/apply", json={"changes": changes, "confirm": preview["confirm"]})
    assert done.status_code == 200
    mcp = Mcp(client)
    listed = mcp.call("list_loans")
    row = by_id(listed)[created["id"]]
    assert row["disbursed_on"] == "2026-11-30"
    assert row["status"] == "not_yet_drawn"
    assert row["balance"] == listed["total_outstanding"] == 0
    dash = mcp.call("get_dashboard")
    assert dash["total_loan_principal"] == dash["outstanding_loan_balance"] == 0


@pytest.mark.parametrize("day,expected_status,expected", [
    (15, "not_yet_drawn", 0), (30, "outstanding", 1000),
])
def test_mcp_draw_boundary(client, monkeypatch, day, expected_status, expected):
    import app.mcp.read_tools as reads

    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, day)

    monkeypatch.setattr(reads, "date", Today)
    register_user(client)
    client.post("/api/grants", json=GRANT)
    result = client.post("/api/loans?generate_payoff_sale=false", json=body(
        amount=1000, loan_year=2026, disbursed_on="2026-11-30"))
    assert result.status_code == 201
    mcp = Mcp(client)
    listed = mcp.call("list_loans")
    assert listed["loans"][0]["status"] == expected_status
    assert listed["loans"][0]["balance"] == listed["total_outstanding"] == expected
    assert mcp.call("get_dashboard")["outstanding_loan_balance"] == expected


def test_mcp_future_refinance_retains_old_balance(client, monkeypatch):
    import app.mcp.read_tools as reads

    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 15)

    monkeypatch.setattr(reads, "date", Today)
    register_user(client)
    client.post("/api/grants", json=GRANT)
    old = client.post("/api/loans?generate_payoff_sale=false", json=body(amount=1000)).json()
    new = client.post("/api/loans?generate_payoff_sale=false", json=body(
        amount=1200, loan_year=2026, disbursed_on="2026-11-30",
        refinances_loan_id=old["id"])).json()
    mcp = Mcp(client)
    listed = mcp.call("list_loans")
    rows = by_id(listed)
    assert rows[old["id"]]["status"] == "outstanding"
    assert rows[old["id"]]["superseded_by_loan_id"] is None
    assert rows[new["id"]]["status"] == "not_yet_drawn"
    assert sum(row["balance"] for row in rows.values()) == listed["total_outstanding"] == 1000
    assert mcp.call("get_dashboard")["total_loan_principal"] == 1000


@pytest.mark.parametrize("day,expected", [("2026-11-15", 1000), ("2026-11-30", 1200)])
def test_holdings_report_excludes_undrawn_refinance(client, day, expected):
    from io import BytesIO
    from openpyxl import load_workbook

    register_user(client)
    client.post("/api/grants", json=GRANT)
    old = client.post("/api/loans?generate_payoff_sale=false", json=body(amount=1000)).json()
    assert client.post("/api/loans?generate_payoff_sale=false", json=body(
        amount=1200, loan_year=2026, disbursed_on="2026-11-30",
        refinances_loan_id=old["id"])).status_code == 201
    report = client.get("/api/export/holdings-report", params={"as_of": day})
    assert report.status_code == 200
    wb = load_workbook(BytesIO(report.content), data_only=True)
    rows = list(wb.active.values)
    holding = next(row for row in rows if row[0] == "2020 Purchase")
    assert holding[9] == expected
    active_header = next(i for i, row in enumerate(rows) if row[0] == "ACTIVE LOANS")
    active = next(row for row in rows[active_header + 2:] if row[0] == "2020 Purchase")
    assert active[4] == expected
