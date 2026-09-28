"""Importing by talking to an assistant, as the ordinary way in.

The person shares a grant letter, a statement or what they remember; their
assistant drafts the import, walks them through it and stages it. These pin the
parts that make that work for someone who does not know the vocabulary, and for
paperwork the company schedule has never seen. Figures are invented.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp

# The test content's schedule ends in 2025, so 2026 is a year an admin has not
# added yet — the case every autumn produces.
NEW_YEAR_GRANT = {
    "year": 2026, "type": "Purchase", "shares": 2000, "price": 5.0,
    "vest_start": "2027-09-30", "periods": 4, "exercise_date": "2026-12-31",
    "loans": [{"loan_number": "900001", "loan_type": "Purchase", "loan_year": 2026,
               "amount": 9000.0, "interest_rate": 0.04, "due_date": "2035-12-31"}],
}
RETENTION = {
    "year": 2025, "type": "Retention", "shares": 500, "price": 0,
    "vest_start": "2026-03-01", "periods": 2, "exercise_date": "2025-12-31",
}
ON_SCHEDULE = {"year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0, "loans": []}


@pytest.fixture()
def mcp(client):
    register_user(client)
    return Mcp(client)


def stage(mcp, *grants, **extra):
    return mcp.call("stage_import", payload={"grants": list(grants), **extra})


def codes(result, code):
    return [f for f in result["findings"] if f["code"] == code]


# ── the guide asks for a conversation, not a file ───────────────────────────

def test_the_guide_does_not_demand_a_bare_json_answer(mcp):
    """That instruction belongs to the paste-back repair brief. In a connector
    conversation the assistant is meant to talk to the person, not reply with
    an object."""
    text = json.dumps(mcp.call("get_import_guide"))
    assert "ONE JSON object" not in text
    assert "Do not estimate anything" not in text


def test_the_guide_asks_for_best_guesses_confirmed_in_plain_words(mcp):
    guide = mcp.call("get_import_guide")
    assert "best guess" in guide["making_best_guesses"]
    assert "assumptions" in guide["making_best_guesses"]
    # Jargon is translated, not used.
    talk = guide["talking_to_the_user"]
    assert "what you paid per share" in talk
    assert "become fully yours" in talk
    assert "confirm" in guide["start_here"]


def test_the_guide_still_forbids_guessing_what_only_the_person_knows(mcp):
    never = mcp.call("get_import_guide")["making_best_guesses"].split("Never guess")[1]
    assert "shares" in never and "sale" in never and "future share price" in never


def test_the_guide_says_what_the_account_already_holds(mcp, client):
    client.post("/api/grants", json={
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2022-09-30", "periods": 5, "exercise_date": "2021-12-31"})
    now = mcp.call("get_import_guide")["account_now"]
    assert now["grants"] == [{"year": 2021, "type": "Purchase", "shares": 1000, "loans": 0}]


def test_the_guide_expects_grants_off_the_schedule(mcp):
    unusual = mcp.call("get_import_guide")["unusual_grants"]
    assert "vest_start" in unusual and "price" in unusual


# ── paperwork the schedule has not seen ─────────────────────────────────────

def test_a_grant_after_the_schedule_ends_keeps_its_own_vesting(mcp):
    result = stage(mcp, NEW_YEAR_GRANT)
    grant = result["prepared"]["grants"][0]
    assert (grant["vest_start"], grant["periods"]) == ("2027-09-30", 4)
    assert grant["loans"][0]["amount"] == 9000.0
    assert codes(result, "S2"), "the review must say this came from the paperwork"
    assert not [f for f in codes(result, "S1") if f["severity"] == "error"]


def test_a_one_off_award_under_its_own_name_is_kept(mcp):
    result = stage(mcp, RETENTION)
    grant = result["prepared"]["grants"][0]
    assert grant["type"] == "Retention"
    assert (grant["vest_start"], grant["periods"]) == ("2026-03-01", 2)
    assert codes(result, "S2")


def test_the_schedule_still_wins_for_a_grant_it_covers(mcp):
    meddled = {**ON_SCHEDULE, "vest_start": "2030-01-01", "periods": 9,
               "exercise_date": "2021-12-31"}
    result = stage(mcp, meddled)
    grant = result["prepared"]["grants"][0]
    assert (grant["vest_start"], grant["periods"]) == ("2022-09-30", 5)
    assert codes(result, "C10") and not codes(result, "S2")


def test_an_implausible_supplied_schedule_is_not_used(mcp):
    result = stage(mcp, {**NEW_YEAR_GRANT, "periods": 400})
    assert result["prepared"]["grants"][0]["periods"] != 400
    assert any("not plausible" in f["message"] for f in codes(result, "S2"))


def test_without_a_supplied_schedule_the_nearest_template_is_shifted(mcp):
    bare = {k: v for k, v in NEW_YEAR_GRANT.items()
            if k not in ("vest_start", "periods", "exercise_date")}
    result = stage(mcp, bare)
    assert result["prepared"]["grants"][0]["vest_start"] == "2027-09-30"
    assert codes(result, "S1") and not codes(result, "S2")


def test_the_app_review_carries_the_off_schedule_grant(mcp, client):
    stage(mcp, NEW_YEAR_GRANT, RETENTION)
    prefill = client.get("/api/import/proposal").json()["wizard_prefill"]
    keys = {(g["year"], g["type"]) for g in prefill["grants"]}
    assert {(2026, "Purchase"), (2025, "Retention")} <= keys
    assert any(l["grant_year"] == 2026 for l in prefill["loans"])


# ── what the assistant guessed ──────────────────────────────────────────────

def test_assumptions_reach_the_review(mcp, client):
    result = stage(mcp, ON_SCHEDULE, assumptions=[
        {"subject": "2021 Purchase", "note": "Price per share taken as the 2021 price."},
        "83(b) assumed not filed.",
        42, {"note": ""},
    ])
    expected = [
        {"subject": "2021 Purchase", "note": "Price per share taken as the 2021 price."},
        {"subject": "", "note": "83(b) assumed not filed."},
    ]
    assert result["assumptions"] == expected
    assert client.get("/api/import/proposal").json()["assumptions"] == expected


def test_assumptions_are_bounded(mcp):
    result = stage(mcp, ON_SCHEDULE, assumptions=["x" * 600] * 60)
    assert len(result["assumptions"]) == 50
    assert all(len(a["note"]) == 500 for a in result["assumptions"])


# ── what accepting would change ─────────────────────────────────────────────

@pytest.fixture()
def holding(client):
    """An account that already has a grant with two loans."""
    client.post("/api/grants", json={
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
        "vest_start": "2022-09-30", "periods": 5, "exercise_date": "2021-12-31"})
    for n, kind in (("111", "Purchase"), ("222", "Interest")):
        assert client.post("/api/loans", json={
            "grant_year": 2021, "grant_type": "Purchase", "loan_type": kind,
            "loan_year": 2021, "amount": 1000.0, "interest_rate": 0.02,
            "due_date": "2030-12-31", "loan_number": n}).status_code == 201


def test_adding_one_grant_keeps_everything_else(mcp, client, holding):
    result = stage(mcp, NEW_YEAR_GRANT)
    changes = result["changes_vs_account"]
    assert changes["grants_added"] == ["2026 Purchase: 2,000 shares"]
    assert changes["grants_kept"] == ["2021 Purchase"]
    assert changes["loans_removed"] == []

    # The review must carry the kept grant's loans, or accepting deletes them.
    loans = client.get("/api/import/proposal").json()["wizard_prefill"]["loans"]
    assert {l["loan_number"] for l in loans if l["grant_year"] == 2021} == {"111", "222"}


def test_restating_a_grant_without_a_loan_says_the_loan_goes(mcp, holding):
    restated = {**ON_SCHEDULE, "shares": 1200, "loans": [
        {"loan_number": "111", "loan_type": "Purchase", "loan_year": 2021,
         "amount": 1000.0, "interest_rate": 0.02, "due_date": "2030-12-31"}]}
    changes = stage(mcp, restated)["changes_vs_account"]
    assert changes["grants_updated"] == ["2021 Purchase: shares 1,000 → 1,200"]
    assert changes["loans_removed"] == ["2021 Purchase: interest loan of $1,000.00 (no. 222)"]


def test_the_review_reads_changes_against_the_account_as_it_is_now(mcp, client, holding):
    stage(mcp, NEW_YEAR_GRANT)
    client.post("/api/grants", json={
        "year": 2026, "type": "Purchase", "shares": 2000, "price": 5.0,
        "vest_start": "2027-09-30", "periods": 4, "exercise_date": "2026-12-31"})
    changes = client.get("/api/import/proposal").json()["changes"]
    assert changes["grants_added"] == []


def test_staging_hands_back_words_for_the_person(mcp):
    result = stage(mcp, ON_SCHEDULE)
    assert "Nothing has been saved yet" in result["tell_the_user"]
    assert "Import" in result["tell_the_user"]
    assert "ChatGPT" in result["tell_the_user"]
    assert "changes_vs_account" in result["next_step"]


def test_findings_on_a_staged_draft_keep_their_severity(mcp):
    """They describe the draft being staged, not an earlier parse it replaced."""
    result = stage(mcp, {**ON_SCHEDULE, "shares": 0}, NEW_YEAR_GRANT)
    r1 = codes(result, "R1")
    assert r1 and r1[0]["severity"] == "error"
    assert all("before your correction" not in f["message"] for f in result["findings"])
    assert codes(result, "S2")[0]["severity"] == "warning"
