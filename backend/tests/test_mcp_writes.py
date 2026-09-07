"""The write tools.

Two things these guard, on top of what test_mcp_tools.py already holds for the
reads. First, a write has to land where the app looks: the assertions go
through the app's own endpoints rather than re-reading the column, so a tool
that quietly stored a differently-shaped row would fail here.

Second, writing is a permission the user has to have granted on purpose. It is
not in the default scope set, a connection without it is refused readably, and
a connection that holds only comp:write must not be able to read the history
back out through the answer to a write.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.oauth import scopes
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp

SALARY = {"type": "salary", "effective_date": "2023-04-01", "amount": 180000}
RAISE = {"type": "salary", "effective_date": "2025-04-01", "amount": 205000}
BONUS = {"type": "bonus", "date": "2024-02-15", "amount": 22000, "note": "annual"}


@pytest.fixture()
def mcp(client):
    """A connected assistant that may write. No equity seeding needed."""
    register_user(client)
    return Mcp(client)


def held(client):
    """The history as the app itself reads it."""
    return client.get("/api/retirement/comp-entries").json()["entries"]


def params(client):
    return client.get("/api/retirement/params").json()["params"] or {}


# ── the permission ──────────────────────────────────────────────────────────

def test_writing_is_not_granted_by_default():
    """Nothing that changes data may arrive just because a client did not
    narrow its request — most MCP clients do not narrow."""
    assert scopes.COMP_WRITE not in scopes.DEFAULT_SCOPES
    assert scopes.COMP_WRITE in scopes.SUPPORTED_SCOPES


def test_granting_it_stops_the_connection_being_read_only():
    assert scopes.writes_anything([scopes.COMP_WRITE])
    assert not scopes.writes_anything(list(scopes.DEFAULT_SCOPES))


def test_it_has_a_label_for_the_consent_screen():
    """The screen renders SCOPE_LABELS[s] directly and would KeyError without
    one — for a scope, that is a broken authorization page."""
    for scope in scopes.SUPPORTED_SCOPES:
        assert scopes.SCOPE_LABELS[scope]


def test_a_reader_cannot_write(client):
    register_user(client)
    reader = Mcp(client, scope="comp:read")
    message = reader.error("add_compensation", entries=[SALARY])
    assert "comp:write" in message
    assert held(client) == []


def test_a_reader_is_not_even_shown_the_write_tools(client):
    register_user(client)
    reader = Mcp(client, scope="comp:read")
    names = {t["name"] for t in reader.list_tools()}
    assert "get_compensation" in names
    assert "add_compensation" not in names


def test_a_writer_cannot_read_the_history_through_a_write(client):
    """comp:write is grantable without comp:read, so the answer to a write must
    carry back only what the caller already sent."""
    register_user(client)
    reader = Mcp(client, scope="comp:read comp:write")
    reader.call("add_compensation", entries=[SALARY, BONUS])

    writer = Mcp(client, scope="comp:write")
    answer = writer.call("add_compensation", entries=[RAISE])
    assert [e["amount"] for e in answer["added"]] == [205000]
    assert "180000" not in str(answer) and "22000" not in str(answer)

    # Same for the retirement blob: only the field that was set comes back.
    reader.call("set_retirement_accounts", traditional_401k=0.9)
    assert writer.call("set_retirement_accounts", roth=0.3)["set"] == {"roth": 0.3}


# ── salary and bonus history ────────────────────────────────────────────────

def test_a_salary_entry_lands_where_the_app_reads_it(mcp, client):
    mcp.call("add_compensation", entries=[SALARY])
    stored = held(client)
    assert len(stored) == 1
    assert stored[0]["type"] == "salary"
    assert stored[0]["effective_date"] == "2023-04-01"
    assert stored[0]["amount"] == 180000
    assert stored[0]["id"], "the app keys rows by id"


def test_a_bonus_keeps_its_own_date_key_and_note(mcp, client):
    """The comp tab reads `date` for a bonus and `effective_date` for a salary
    rate. Storing the wrong key drops the row off the chart silently."""
    mcp.call("add_compensation", entries=[BONUS])
    stored = held(client)[0]
    assert stored["type"] == "bonus"
    assert stored["date"] == "2024-02-15"
    assert "effective_date" not in stored
    assert stored["note"] == "annual"


def test_either_date_spelling_is_accepted(mcp, client):
    """A model should not have to remember which shape takes which key."""
    mcp.call("add_compensation", entries=[
        {"type": "salary", "date": "2022-01-01", "amount": 150000},
        {"type": "bonus", "effective_date": "2022-12-01", "amount": 9000},
    ])
    by_type = {e["type"]: e for e in held(client)}
    assert by_type["salary"]["effective_date"] == "2022-01-01"
    assert by_type["bonus"]["date"] == "2022-12-01"


def test_adding_appends_rather_than_replacing(mcp, client):
    mcp.call("add_compensation", entries=[SALARY])
    mcp.call("add_compensation", entries=[RAISE, BONUS])
    assert len(held(client)) == 3
    assert sorted(e["amount"] for e in held(client)) == [22000, 180000, 205000]


def test_ids_are_unique_across_calls(mcp, client):
    mcp.call("add_compensation", entries=[SALARY])
    mcp.call("add_compensation", entries=[RAISE])
    mcp.call("add_compensation", entries=[BONUS])
    ids = [e["id"] for e in held(client)]
    assert len(set(ids)) == len(ids)


def test_repeating_a_call_does_not_double_a_raise(mcp, client):
    """A model that retries a call it never saw the answer to must not leave
    two identical rows the user cannot tell apart."""
    mcp.call("add_compensation", entries=[SALARY, BONUS])
    again = mcp.call("add_compensation", entries=[SALARY, BONUS])
    assert again["added"] == []
    assert again["skipped_as_duplicates"] == 2
    assert len(held(client)) == 2


def test_a_duplicate_within_one_call_is_collapsed(mcp, client):
    mcp.call("add_compensation", entries=[SALARY, dict(SALARY)])
    assert len(held(client)) == 1


def test_the_same_amount_on_a_different_date_is_not_a_duplicate(mcp, client):
    mcp.call("add_compensation", entries=[SALARY])
    mcp.call("add_compensation", entries=[
        {"type": "salary", "effective_date": "2024-04-01", "amount": 180000},
    ])
    assert len(held(client)) == 2


def test_what_was_written_reads_back_through_the_read_tool(mcp):
    mcp.call("add_compensation", entries=[SALARY, BONUS])
    assert len(mcp.call("get_compensation")["entries"]) == 2


# ── correcting a mistake ────────────────────────────────────────────────────

def test_removing_an_entry_by_id(mcp, client):
    mcp.call("add_compensation", entries=[SALARY, RAISE])
    victim = held(client)[0]["id"]
    answer = mcp.call("remove_compensation", ids=[victim])
    assert answer["removed"] == 1
    assert [e["id"] for e in held(client)] != [victim]
    assert len(held(client)) == 1


def test_a_stale_id_is_named_rather_than_silently_ignored(mcp):
    """Usually means the model is working from a list that has since changed."""
    mcp.call("add_compensation", entries=[SALARY])
    answer = mcp.call("remove_compensation", ids=["no-such-entry"])
    assert answer["removed"] == 0
    assert answer["not_found"] == ["no-such-entry"]


def test_removing_everything_leaves_an_empty_history(mcp, client):
    mcp.call("add_compensation", entries=[SALARY, RAISE, BONUS])
    mcp.call("remove_compensation", ids=[e["id"] for e in held(client)])
    assert held(client) == []


# ── retirement balances ─────────────────────────────────────────────────────

def test_setting_balances_lands_where_the_app_reads_them(mcp, client):
    mcp.call("set_retirement_accounts", traditional_401k=0.85, roth=0.3,
             taxable_brokerage=1.2, brokerage_basis=0.7)
    stored = params(client)
    assert stored["traditional"] == 0.85
    assert stored["roth"] == 0.3
    assert stored["taxableAdditional"] == 1.2
    assert stored["additionalBasis"] == 0.7


def test_only_the_named_fields_change(mcp, client):
    """The blob holds the whole scenario — ages, spending, glidepath. A write
    that returned three fields and dropped the other twenty would wipe it."""
    client.put("/api/retirement/params", json={"params": {
        "currentAge": 52, "endAge": 95, "defaultSpend": 180, "roth": 0.1,
        "glidePoints": [{"yearsAfter": 10, "stockPct": 0.5}],
    }})
    mcp.call("set_retirement_accounts", roth=0.4)
    stored = params(client)
    assert stored["roth"] == 0.4
    assert stored["currentAge"] == 52
    assert stored["endAge"] == 95
    assert stored["defaultSpend"] == 180
    assert stored["glidePoints"] == [{"yearsAfter": 10, "stockPct": 0.5}]


def test_splitting_the_buckets_opens_the_breakdown(mcp, client):
    """The simple view shows one 'additional portfolio' box and folds 401(k)
    and Roth into it. Storing them while it is closed hides the figure from the
    person who asked for it."""
    mcp.call("set_retirement_accounts", traditional_401k=0.85)
    assert params(client)["advanced"] is True


def test_a_brokerage_total_alone_does_not_force_the_breakdown(mcp, client):
    mcp.call("set_retirement_accounts", taxable_brokerage=1.0)
    assert not params(client).get("advanced")


def test_dollars_where_millions_were_wanted_is_refused(mcp, client):
    """The likeliest way to be wrong here is by a factor of a million, and it
    would not look wrong in the app — just enormous."""
    message = mcp.error("set_retirement_accounts", traditional_401k=850000)
    assert "millions" in message
    assert "0.85" in message
    assert params(client) == {}


def test_a_basis_above_the_balance_is_refused(mcp):
    message = mcp.error("set_retirement_accounts",
                        taxable_brokerage=1.0, brokerage_basis=1.5)
    assert "basis" in message.lower()


def test_a_basis_is_checked_against_a_balance_already_stored(mcp):
    mcp.call("set_retirement_accounts", taxable_brokerage=1.0)
    assert "basis" in mcp.error("set_retirement_accounts", brokerage_basis=2.0).lower()


def test_setting_nothing_is_a_readable_refusal(mcp):
    assert "at least one" in mcp.error("set_retirement_accounts")


# ── bad arguments are findings, never crashes ───────────────────────────────

@pytest.mark.parametrize("entry, expected", [
    ({"type": "wages", "date": "2024-01-01", "amount": 1}, "salary"),
    ({"effective_date": "2024-01-01", "amount": 1}, "type"),
    ({"type": "salary", "effective_date": "last April", "amount": 1}, "YYYY-MM-DD"),
    ({"type": "salary", "effective_date": "2024-01-01"}, "amount"),
    ({"type": "salary", "effective_date": "2024-01-01", "amount": "lots"}, "number"),
    ({"type": "salary", "effective_date": "2024-01-01", "amount": -5}, "negative"),
    ({"type": "salary", "effective_date": "1066-01-01", "amount": 1}, "1950"),
    ({"type": "salary", "amount": 1}, "required"),
])
def test_a_bad_entry_is_a_readable_error(mcp, client, entry, expected):
    assert expected in mcp.error("add_compensation", entries=[entry])
    assert held(client) == [], "a rejected batch must not half-land"


def test_an_empty_batch_is_refused(mcp):
    assert "non-empty" in mcp.error("add_compensation", entries=[])


def test_a_batch_is_capped(mcp):
    entries = [{"type": "bonus", "date": "2024-01-01", "amount": n}
               for n in range(1, 200)]
    assert "smaller batches" in mcp.error("add_compensation", entries=entries)


def test_the_history_has_a_ceiling(mcp, client):
    """The list is a column on the users table, not rows of its own."""
    from app.mcp.comp_tools import MAX_COMP_ENTRIES

    client.put("/api/retirement/comp-entries", json={"entries": [
        {"id": str(n), "type": "bonus", "date": "2024-01-01", "amount": n}
        for n in range(MAX_COMP_ENTRIES)
    ]})
    assert "past" in mcp.error("add_compensation", entries=[SALARY])


def test_the_app_endpoint_has_the_same_ceiling(client):
    from app.mcp.comp_tools import MAX_COMP_ENTRIES

    register_user(client)
    too_many = [{"id": str(n), "type": "bonus", "date": "2024-01-01", "amount": 1}
                for n in range(MAX_COMP_ENTRIES + 1)]
    assert client.put("/api/retirement/comp-entries",
                      json={"entries": too_many}).status_code == 422


def test_a_note_is_bounded(mcp, client):
    from app.mcp.comp_tools import MAX_NOTE_LEN

    mcp.call("add_compensation", entries=[
        {"type": "bonus", "date": "2024-01-01", "amount": 1, "note": "x" * 5000},
    ])
    assert len(held(client)[0]["note"]) == MAX_NOTE_LEN


def test_an_implausible_salary_is_refused(mcp):
    assert "implausibly" in mcp.error("add_compensation", entries=[
        {"type": "salary", "effective_date": "2024-01-01", "amount": 1e12},
    ])


@pytest.mark.parametrize("name, arguments", [
    ("add_compensation", {"entries": [SALARY]}),
    ("remove_compensation", {"ids": ["x"]}),
    ("set_retirement_accounts", {"roth": 0.2}),
])
def test_writes_refuse_another_account(mcp, name, arguments):
    """Own account only, and a write is the one that must not slip through."""
    assert "Unknown account" in mcp.error(name, account="7", **arguments)
