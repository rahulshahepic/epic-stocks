"""The read tools an AI assistant actually calls.

Two things these guard. First, the tools and the web app must agree: a tool is
a thin call through to the same service function the HTTP endpoint uses, and
the tests assert the two answers match rather than re-deriving the expected
figures here. Second, every argument arrives from a language model, so the
whole surface has to turn nonsense into a readable tool error — never a 500,
which would write an error_logs row and push real tracebacks out of the
500-row window the nightly job keeps.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.mcp.tools import REGISTRY
from tests.conftest import register_user
from tests.test_oauth_server import connect

# A draft in the shape get_import_guide describes, for the staging tool.
IMPORT_PAYLOAD = {
    "grants": [{
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2.83,
        "dp_shares": 0, "election_83b": False, "loans": [],
    }],
    "prices": [{"effective_date": "2021-01-01", "price": 2.83}],
}

GRANT = {
    "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.5,
    "vest_start": "2021-03-01", "periods": 5, "exercise_date": "2020-12-31",
}
BONUS = {
    "year": 2021, "type": "Bonus", "shares": 4000, "price": 0,
    "vest_start": "2022-03-01", "periods": 4, "exercise_date": "2021-12-31",
}
PRICES = [
    {"effective_date": "2020-06-01", "price": 1.5},
    {"effective_date": "2021-06-01", "price": 2.0},
    {"effective_date": "2022-06-01", "price": 3.0},
    {"effective_date": "2023-06-01", "price": 4.0},
]
LOAN = {
    "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
    "loan_year": 2020, "amount": 15000.0, "interest_rate": 0.03,
    "due_date": "2028-12-31",
}


def seed(client) -> dict:
    """A small but complete account: two grants, four prices, a loan, a sale."""
    ids = {}
    ids["grant"] = client.post("/api/grants", json=GRANT).json()["id"]
    client.post("/api/grants", json=BONUS)
    for price in PRICES:
        client.post("/api/prices", json=price)
    ids["loan"] = client.post("/api/loans", json=LOAN).json()["id"]
    ids["sale"] = client.post("/api/sales", json={
        "date": "2023-07-01", "shares": 500, "price_per_share": 4.0,
    }).json()["id"]
    return ids


class Mcp:
    """A connected assistant, talking JSON-RPC."""

    def __init__(self, client, scope="equity:read comp:read import:propose"):
        self.client = client
        self.tokens = connect(client, scope=scope)
        self._id = 0

    @property
    def auth(self):
        return {"Authorization": f"Bearer {self.tokens['access_token']}"}

    def rpc(self, method, params=None):
        self._id += 1
        resp = self.client.post("/mcp", headers=self.auth, json={
            "jsonrpc": "2.0", "id": self._id, "method": method,
            "params": params or {},
        })
        assert resp.status_code == 200, resp.text
        return resp.json()

    def list_tools(self):
        return self.rpc("tools/list")["result"]["tools"]

    def raw_call(self, name, **arguments):
        return self.rpc("tools/call", {"name": name, "arguments": arguments})["result"]

    def call(self, name, **arguments):
        """A successful call's payload, decoded."""
        result = self.raw_call(name, **arguments)
        assert not result.get("isError"), result["content"][0]["text"]
        return json.loads(result["content"][0]["text"])

    def error(self, name, **arguments):
        """The message from a call that was supposed to fail."""
        result = self.raw_call(name, **arguments)
        assert result.get("isError"), f"{name} was expected to fail: {result}"
        return result["content"][0]["text"]


@pytest.fixture()
def mcp(client):
    register_user(client)
    seed(client)
    return Mcp(client)


# ── the catalogue ───────────────────────────────────────────────────────────

# The tools that leave something behind. Everything else must claim, and be,
# read-only — a client decides how loudly to confirm from these annotations.
WRITING_TOOLS = {"stage_import"}


def test_every_tool_is_listed_and_annotated_honestly(mcp):
    listed = {t["name"]: t for t in mcp.list_tools()}
    assert set(listed) == set(REGISTRY)
    assert listed, "no tools registered"
    for name, tool in listed.items():
        assert tool["description"].strip(), name
        expected_read_only = name not in WRITING_TOOLS
        assert tool["annotations"]["readOnlyHint"] is expected_read_only, (
            f"{name} claims readOnlyHint={tool['annotations']['readOnlyHint']}"
        )
        if not expected_read_only:
            # A writing tool has to say whether it destroys anything. This one
            # stages a proposal the user accepts elsewhere, so it does not.
            assert tool["annotations"]["destructiveHint"] is False, name


def test_the_only_writing_tool_is_the_one_that_stages_an_import(mcp):
    """A read-only connector is the whole promise on the consent screen; a new
    tool that writes must be a deliberate change, not a slip."""
    writing = {t["name"] for t in mcp.list_tools()
               if not t["annotations"]["readOnlyHint"]}
    assert writing == WRITING_TOOLS


def test_every_input_schema_is_well_formed(mcp):
    """A required field that is not in properties makes a client reject the tool."""
    for tool in mcp.list_tools():
        schema = tool["inputSchema"]
        assert schema["type"] == "object", tool["name"]
        properties = schema.get("properties", {})
        for field in schema.get("required", []):
            assert field in properties, f"{tool['name']} requires undeclared '{field}'"


def test_tools_list_is_narrowed_to_the_granted_scopes(client):
    register_user(client)
    seed(client)
    equity_only = Mcp(client, scope="equity:read")
    names = {t["name"] for t in equity_only.list_tools()}
    assert "get_dashboard" in names
    assert "get_compensation" not in names, "listed a tool this connection cannot call"


def test_calling_a_tool_outside_the_granted_scope_fails_readably(client):
    register_user(client)
    seed(client)
    equity_only = Mcp(client, scope="equity:read")
    message = equity_only.error("get_compensation")
    assert "comp:read" in message


# ── equity reads agree with the app ─────────────────────────────────────────

def test_get_dashboard_matches_the_app(mcp, client):
    assert mcp.call("get_dashboard") == client.get("/api/dashboard").json()


def test_list_events_matches_the_app(mcp, client):
    from_api = client.get("/api/events").json()
    from_tool = mcp.call("list_events")
    assert from_tool["events"] == from_api
    assert from_tool["matched"] == len(from_api)
    assert from_tool["truncated"] is False


def test_list_events_filters_by_date_range(mcp):
    windowed = mcp.call("list_events", from_date="2022-01-01", to_date="2022-12-31")
    assert windowed["events"], "expected some 2022 events in the seeded account"
    assert all("2022-01-01" <= e["date"] <= "2022-12-31" for e in windowed["events"])
    assert windowed["matched"] < mcp.call("list_events")["matched"]


def test_list_events_filters_by_type_case_insensitively(mcp):
    vesting = mcp.call("list_events", event_types=["vEsTiNg"])
    assert vesting["events"]
    assert {e["event_type"] for e in vesting["events"]} == {"Vesting"}


def test_list_events_says_when_it_truncated(mcp):
    """A model that totals a silently truncated list reports a wrong number."""
    capped = mcp.call("list_events", limit=2)
    assert capped["returned"] == 2
    assert capped["truncated"] is True
    assert capped["matched"] > 2


def test_list_events_rejects_a_backwards_range(mcp):
    assert "after" in mcp.error("list_events", from_date="2025-01-01", to_date="2024-01-01")


def test_list_grants_matches_the_app(mcp, client):
    from_tool = mcp.call("list_grants")["grants"]
    from_api = client.get("/api/grants").json()
    assert len(from_tool) == len(from_api) == 2
    assert {g["year"] for g in from_tool} == {2020, 2021}
    assert all("user_id" not in g for g in from_tool)


def test_list_prices_matches_the_app(mcp, client):
    from_tool = mcp.call("list_prices")["prices"]
    assert [p["price"] for p in from_tool] == [1.5, 2.0, 3.0, 4.0]
    assert len(from_tool) == len(client.get("/api/prices").json())


def test_list_sales_matches_the_app(mcp, client):
    """Two sales, not one: creating a loan generates its payoff sale as well."""
    from_tool = mcp.call("list_sales")["sales"]
    from_api = client.get("/api/sales").json()
    assert {s["id"] for s in from_tool} == {s["id"] for s in from_api}
    assert 500 in {s["shares"] for s in from_tool}


def test_list_loans_reports_the_outstanding_balance(mcp, client):
    loan_id = client.get("/api/loans").json()[0]["id"]
    before = mcp.call("list_loans")["loans"][0]
    assert before["balance"] == 15000.0
    assert before["paid_early"] == 0.0

    client.post("/api/loan-payments", json={
        "loan_id": loan_id, "date": "2024-01-15", "amount": 5000.0,
    })
    after = mcp.call("list_loans")["loans"][0]
    assert after["paid_early"] == 5000.0
    assert after["balance"] == 10000.0


# ── the calculators ─────────────────────────────────────────────────────────

def test_estimate_sale_by_share_count_matches_the_app(mcp, client):
    from_tool = mcp.call("estimate_sale", price_per_share=4.0, shares=100,
                         sale_date="2024-01-01")
    from_api = client.get("/api/sales/estimate", params={
        "price_per_share": 4.0, "shares": 100, "sale_date": "2024-01-01",
    }).json()
    assert from_tool == from_api
    assert from_tool["gross_proceeds"] == 400.0


def test_estimate_sale_can_work_back_from_target_cash(mcp):
    result = mcp.call("estimate_sale", price_per_share=4.0, target_net_cash=1000.0,
                      sale_date="2024-01-01")
    assert result["shares_needed"] > 250, "gross-up must cover the tax"
    assert result["net_proceeds"] >= 1000.0


def test_estimate_sale_needs_exactly_one_of_shares_or_target(mcp):
    assert "either" in mcp.error("estimate_sale", price_per_share=4.0)
    assert "not both" in mcp.error("estimate_sale", price_per_share=4.0,
                                   shares=100, target_net_cash=500.0)


def test_estimate_sale_rejects_a_nonsense_price(mcp):
    assert "greater than zero" in mcp.error("estimate_sale", price_per_share=0, shares=10)
    assert "required" in mcp.error("estimate_sale", shares=10)
    assert "not a number" in mcp.error("estimate_sale", price_per_share="four", shares=10)


def test_get_tax_breakdown_agrees_with_the_app_and_adds_the_lot_allocation(mcp, client):
    """Every figure the HTTP endpoint reports, plus the lots behind them.

    The endpoint declares a response_model that drops `lots_consumed`; the tool
    calls the same function and keeps it, because which lots a sale eats is the
    part a model needs to explain the tax rather than just restate it. Same
    account's own data either way.
    """
    sale_id = client.get("/api/sales").json()[0]["id"]
    from_tool = mcp.call("get_tax_breakdown", sale_id=sale_id)
    from_api = client.get(f"/api/sales/{sale_id}/tax").json()

    assert {k: from_tool[k] for k in from_api} == from_api
    assert from_tool["lots_consumed"], "the lot allocation is the point of the extra field"


def test_get_tax_breakdown_on_a_stale_id_is_a_tool_error(mcp):
    """The model citing an id that no longer exists is not a server fault."""
    assert "No sale with id 999999" in mcp.error("get_tax_breakdown", sale_id=999999)


# ── explain ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("topic", ["vesting", "grant_types", "taxes", "lots",
                                   "prices", "data_model"])
def test_explain_answers_every_advertised_topic(mcp, topic):
    result = mcp.call("explain", topic=topic)
    assert result["topic"] == topic
    assert len(result["explanation"]) > 80


def test_explain_advertises_exactly_the_topics_it_serves(mcp):
    tool = next(t for t in mcp.list_tools() if t["name"] == "explain")
    for topic in tool["inputSchema"]["properties"]["topic"]["enum"]:
        assert mcp.call("explain", topic=topic)["topic"] == topic


def test_explain_rejects_an_invented_topic(mcp):
    assert "Unknown topic" in mcp.error("explain", topic="the meaning of life")


# ── compensation ────────────────────────────────────────────────────────────

def test_get_compensation_matches_the_app(mcp, client):
    entries = [{"year": 2024, "salary": 120000}]
    client.put("/api/retirement/comp-entries", json={"entries": entries})
    assert mcp.call("get_compensation")["entries"] == entries


def test_get_retirement_params_matches_the_app(mcp, client):
    params = {"retire_age": 60, "spend": 80000}
    client.put("/api/retirement/params", json={"params": params})
    assert mcp.call("get_retirement_params")["params"] == params


def test_compensation_is_empty_rather_than_missing_when_unset(mcp):
    assert mcp.call("get_compensation")["entries"] == []
    assert mcp.call("get_retirement_params")["params"] == {}


# ── the account seam ────────────────────────────────────────────────────────

def test_account_defaults_to_the_connected_user(mcp, client):
    assert mcp.call("get_dashboard", account="me") == client.get("/api/dashboard").json()


def test_asking_for_another_account_is_a_readable_refusal(mcp):
    """Own data only today. The message has to say so, because the model will
    otherwise keep trying different spellings."""
    message = mcp.error("list_grants", account="rahul@example.com")
    assert "only read your own data" in message
    assert "'me'" in message


def test_a_connector_cannot_reach_another_users_data(client, make_client):
    register_user(client, "owner@example.com")
    seed(client)
    owner_view = Mcp(client)

    with make_client("other@example.com") as other:
        other.post("/api/grants", json={**GRANT, "shares": 777})
        other_view = Mcp(other)

    assert {g["shares"] for g in owner_view.call("list_grants")["grants"]} == {10000, 4000}
    assert [g["shares"] for g in other_view.call("list_grants")["grants"]] == [777]


# ── nothing becomes a 500 ───────────────────────────────────────────────────

@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_every_tool_survives_garbage_arguments(mcp, name):
    """Whatever a confused model sends, the answer is a tool result, not a crash."""
    for arguments in (
        {},
        {"account": 12345},
        {"sale_id": "not a number", "topic": [], "limit": "lots",
         "from_date": "yesterday", "price_per_share": {}, "event_types": "Vesting"},
        {"unexpected": "field"},
    ):
        result = mcp.raw_call(name, **arguments)
        assert "content" in result, f"{name} {arguments} -> {result}"
        assert isinstance(result["content"][0]["text"], str)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_every_successful_tool_result_is_parseable_json(mcp, name):
    """The payload is a JSON text block, so it has to actually parse."""
    required = {
        "estimate_sale": {"price_per_share": 4.0, "shares": 10},
        "get_tax_breakdown": {"sale_id": None},
        "explain": {"topic": "vesting"},
        "stage_import": {"payload": IMPORT_PAYLOAD},
    }
    arguments = dict(required.get(name, {}))
    if name == "get_tax_breakdown":
        arguments["sale_id"] = mcp.call("list_sales")["sales"][0]["id"]
    payload = mcp.call(name, **arguments)
    assert isinstance(payload, (dict, list))
