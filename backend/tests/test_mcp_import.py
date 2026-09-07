"""Preparing an import by talking to an assistant.

epic_import/ already builds a brief for this and assumes the user pastes it
into a chat window. These tools close that loop, and stop deliberately short of
closing it entirely: acceptance goes through the wizard and never a file, which
holds however the draft was produced.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.models import Grant, ImportProposal, Price
from scaffold.models import User
from tests.conftest import register_user, user_key
from tests.test_mcp_tools import IMPORT_PAYLOAD, Mcp, seed

READ_ONLY = "equity:read comp:read"


@pytest.fixture()
def mcp(client):
    register_user(client)
    return Mcp(client)


# ── the guide ───────────────────────────────────────────────────────────────

def test_the_guide_carries_the_contract_and_the_company_schedule(mcp):
    guide = mcp.call("get_import_guide")

    assert '"grants"' in guide["output_format"], "the JSON shape must be spelled out"
    assert "interest_rate is a decimal fraction" in guide["rules"]
    # The schedule comes from the content tables, not from the model's memory.
    assert "vest_start" in guide["company_grant_schedule"]
    assert "Purchase" in guide["company_grant_schedule"]
    assert "down payment" in guide["down_payment_policy"].lower()


def test_the_guide_tells_the_assistant_the_user_still_has_to_accept(mcp):
    """A model that reports "done" after staging would be lying to the user."""
    guide = mcp.call("get_import_guide")
    assert "review" in guide["how_to_submit"].lower()
    assert "stage_import" in guide["how_to_submit"]


def test_the_guide_needs_only_read_access(client):
    register_user(client)
    reader = Mcp(client, scope=READ_ONLY)
    assert reader.call("get_import_guide")["output_format"]


# ── staging ─────────────────────────────────────────────────────────────────

def test_staging_records_a_proposal_and_changes_nothing(mcp, db_session):
    result = mcp.call("stage_import", payload=IMPORT_PAYLOAD)

    assert result["staged"] is True
    assert result["grants"] == 1
    # The point of the whole design: no financial row was written.
    assert db_session.query(Grant).count() == 0
    assert db_session.query(Price).count() == 0
    assert db_session.query(ImportProposal).count() == 1


def test_staging_fills_the_schedule_from_the_company_tables(mcp):
    """The payload carries no vest_start or periods; the skeleton supplies them,
    and an assistant is not allowed to invent them."""
    prepared = mcp.call("stage_import", payload=IMPORT_PAYLOAD)["prepared"]
    grant = prepared["grants"][0]
    assert grant["vest_start"], "the schedule was not filled in"
    assert grant["periods"] > 0
    assert grant["exercise_date"]


def test_staging_ignores_a_schedule_the_assistant_tried_to_supply(mcp):
    """Vest dates are company-wide. A model that sends its own must not win."""
    meddled = json.loads(json.dumps(IMPORT_PAYLOAD))
    meddled["grants"][0]["vest_start"] = "1999-01-01"
    meddled["grants"][0]["periods"] = 99

    grant = mcp.call("stage_import", payload=meddled)["prepared"]["grants"][0]
    assert not grant["vest_start"].startswith("1999")
    assert grant["periods"] != 99


def test_staging_needs_the_propose_scope(client):
    register_user(client)
    reader = Mcp(client, scope=READ_ONLY)
    assert "import:propose" in reader.error("stage_import", payload=IMPORT_PAYLOAD)


def test_a_read_only_connection_is_not_even_shown_the_tool(client):
    register_user(client)
    reader = Mcp(client, scope=READ_ONLY)
    names = {t["name"] for t in reader.list_tools()}
    assert "get_import_guide" in names
    assert "stage_import" not in names


def test_a_second_proposal_replaces_the_first(mcp, db_session):
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    bigger = json.loads(json.dumps(IMPORT_PAYLOAD))
    bigger["grants"][0]["shares"] = 5000
    mcp.call("stage_import", payload=bigger)

    assert db_session.query(ImportProposal).count() == 1
    # payload_json is encrypted, so reading it outside a request needs the
    # owner's key in context — the same rule any direct seeding follows.
    with user_key(db_session.query(User).one()):
        row = db_session.query(ImportProposal).one()
        assert json.loads(row.payload_json)["grants"][0]["shares"] == 5000


@pytest.mark.parametrize("payload,expected", [
    ("not an object", "must be the JSON object"),
    ({}, "non-empty list"),
    ({"grants": []}, "non-empty list"),
    ({"grants": [{}] * 101}, "more than"),
    ({"grants": [{"year": 2021, "type": "Purchase"}], "prices": "nope"}, "must be a list"),
])
def test_a_malformed_payload_is_a_readable_error(mcp, payload, expected):
    assert expected in mcp.error("stage_import", payload=payload)


def test_a_nonsense_draft_is_reported_rather_than_stored_silently(mcp):
    """Findings are the point — the assistant should see what failed."""
    wrong = json.loads(json.dumps(IMPORT_PAYLOAD))
    wrong["grants"][0]["year"] = 1800  # outside the bounded range
    result = mcp.call("stage_import", payload=wrong)
    assert result["findings"], "a grant from 1800 should have been flagged"


def test_staging_is_refused_when_data_is_managed_externally(mcp, monkeypatch, db_session):
    """Epic mode means the fact tables are owned elsewhere; proposing an import
    the user could never accept is worse than saying so."""
    monkeypatch.setenv("EPIC_MODE", "true")
    message = mcp.error("stage_import", payload=IMPORT_PAYLOAD)
    assert "externally" in message
    assert db_session.query(ImportProposal).count() == 0


# ── what the app sees ───────────────────────────────────────────────────────

def test_the_app_can_read_and_dismiss_the_proposal(mcp, client):
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)

    proposal = client.get("/api/import/proposal").json()
    assert proposal["client_name"] == "ChatGPT"
    assert proposal["grants"] == 1
    assert proposal["blocked"] is False
    # Handed over in the shape the wizard's own loader takes, so the review
    # screen is the same one an uploaded file gets.
    assert proposal["wizard_prefill"]["grants"][0]["shares"] == 1000
    assert proposal["wizard_prefill"]["grants"][0]["vest_start"]

    assert client.delete("/api/import/proposal").status_code == 204
    assert client.get("/api/import/proposal").json() is None


def test_no_proposal_reads_as_null_rather_than_an_error(client):
    register_user(client)
    assert client.get("/api/import/proposal").json() is None


def test_an_expired_proposal_reads_as_absent(mcp, client, db_session):
    """A stale draft is worse than none — it offers figures the user may have
    changed since."""
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    with user_key(db_session.query(User).one()):
        row = db_session.query(ImportProposal).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.commit()

    assert client.get("/api/import/proposal").json() is None


def test_the_nightly_prune_clears_expired_proposals(mcp, db_session):
    from scaffold.oauth.cleanup import prune

    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    with user_key(db_session.query(User).one()):
        row = db_session.query(ImportProposal).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.commit()

    assert prune(db_session)["import_proposals"] == 1
    assert db_session.query(ImportProposal).count() == 0


def test_a_live_proposal_survives_the_prune(mcp, db_session):
    from scaffold.oauth.cleanup import prune

    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    assert prune(db_session)["import_proposals"] == 0
    assert db_session.query(ImportProposal).count() == 1


def test_a_proposal_belongs_to_one_account(mcp, client, make_client):
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    with make_client("other@example.com") as other:
        assert other.get("/api/import/proposal").json() is None


def test_deleting_the_account_removes_the_proposal(mcp, client, db_session):
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)
    assert client.delete("/api/me").status_code == 204
    assert db_session.query(ImportProposal).count() == 0


# ── the promise on the consent screen ───────────────────────────────────────

def test_the_consent_screen_stops_claiming_read_only_when_it_is_not(client):
    from tests.test_oauth_server import authorize, pkce_pair, register_client

    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()

    read_only = authorize(client, reg["client_id"], challenge, scope=READ_ONLY).text
    assert "this connection is read-only" in read_only

    proposing = authorize(client, reg["client_id"], challenge,
                          scope="equity:read import:propose").text
    assert "this connection is read-only" not in proposing
    assert "waits for you to review" in proposing
    assert "cannot change your data on its own" in proposing


def test_proposing_is_not_granted_by_default(client):
    """A client that names no scope gets the reads. Nothing that leaves a trace
    should arrive without being asked for."""
    register_user(client)
    seed(client)
    default = Mcp(client, scope="")
    assert "stage_import" not in {t["name"] for t in default.list_tools()}


def test_the_prefill_keeps_prices_the_draft_does_not_cover(mcp, client):
    """The wizard deletes rows its payload omits, so a proposal that mentions
    2021 alone must not silently drop a price the user keeps for 2024."""
    client.post("/api/prices", json={"effective_date": "2024-06-01", "price": 9.0})
    mcp.call("stage_import", payload=IMPORT_PAYLOAD)

    prices = client.get("/api/import/proposal").json()["wizard_prefill"]["prices"]
    assert any(p["effective_date"].startswith("2024") for p in prices), (
        "the user's own 2024 price was dropped from the review"
    )
