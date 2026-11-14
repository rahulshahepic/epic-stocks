"""The guide an assistant reads before entering someone's equity, and the
consent that lets it write."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, seed

READ_ONLY = "equity:read comp:read"


@pytest.fixture()
def mcp(client):
    register_user(client)
    return Mcp(client)


def test_the_guide_carries_the_fields_and_the_company_schedule(mcp):
    guide = mcp.call("get_import_guide")
    assert "fraction" in guide["fields"]["loan"]
    assert "vesting" in guide["fields"]["grant"]
    assert "apply_changes" in guide["example"]
    # The schedule comes from the content tables, not from the model's memory.
    assert "vest_start" in guide["company_grant_schedule"]
    assert "down payment" in guide["down_payment_policy"].lower()


def test_the_guide_says_preview_then_confirm(mcp):
    """A model that reports "done" after a preview would be lying to the user."""
    steps = mcp.call("get_import_guide")["start_here"]
    assert "WITHOUT confirm" in steps and "confirm token" in steps


def test_the_guide_explains_epic_purchase_paperwork(mcp):
    docs = mcp.call("get_import_guide")["reading_documents"]
    assert "ELECTED" in docs and "Loan amount" in docs and "rounds each part down" in docs
    assert "current state" in docs


def test_the_guide_needs_only_read_access(client):
    register_user(client)
    reader = Mcp(client, scope=READ_ONLY)
    assert reader.call("get_import_guide")["start_here"]


def test_the_guide_shows_the_accounts_own_schedule(mcp, client):
    client.post("/api/grants", json={"year": 2021, "type": "Purchase", "shares": 1000, "price": 2.0,
                                     "vest_start": "2022-09-30", "periods": 2, "exercise_date": "2021-12-31"})
    now = mcp.call("get_import_guide")["account_now"]
    assert now["grants"][0]["vesting"] == [{"date": "2022-09-30", "shares": 500},
                                           {"date": "2023-09-30", "shares": 500}]
    assert now["grants"][0]["version"] >= 1


def test_consent_does_not_make_a_fixed_promise_before_user_chooses_permissions(client):
    from tests.test_oauth_server import authorize, pkce_pair, register_client

    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    for requested in (READ_ONLY, "equity:read equity:write"):
        page = authorize(client, reg["client_id"], challenge, scope=requested).text
        assert "Only checked permissions will be granted" in page
        assert "this connection is read-only" not in page
        expected = 'value="equity:write"' + (' checked' if 'equity:write' in requested else '') + '>'
        assert expected in page


def test_a_client_that_names_no_scope_gets_every_tool(client):
    """ChatGPT names none. A read-only default left people unable to find how
    to let it edit, so the default is everything grantable."""
    register_user(client)
    seed(client)
    default = Mcp(client, scope="")
    names = {t["name"] for t in default.list_tools()}
    assert {"apply_changes", "get_import_guide", "add_compensation"} <= names
