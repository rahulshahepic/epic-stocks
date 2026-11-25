"""UI reads retain the connector's account, encryption, audit and scope guards."""
import json

import pytest

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, seed
from app.mcp.ui_tools import RESOURCE_URI
from app.mcp.retirement_tools import RETIREMENT_COMPARE_RESOURCE_URI, RETIREMENT_RESOURCE_URI


@pytest.fixture()
def mcp(client):
    register_user(client)
    seed(client)
    return Mcp(client, scope="equity:read")


@pytest.mark.parametrize("view,tool", [("summary", "get_dashboard"), ("grants", "list_grants"), ("loans", "list_loans")])
def test_view_is_shared_service_result(mcp, view, tool):
    result = mcp.raw_call("show_equity", view=view)
    assert result["structuredContent"]["data"] == mcp.call(tool)
    assert json.loads(result["content"][0]["text"]) == result["structuredContent"]
    assert result["structuredContent"]["account"] == "me"


def test_events_are_bounded_and_keep_projection_flags(mcp):
    result = mcp.call("show_equity", view="events", from_date="2020-01-01", to_date="2030-01-01")
    expected = mcp.call("list_events", from_date="2020-01-01", to_date="2030-01-01", limit=100)
    assert result["data"] == expected
    assert "truncated" in result["data"]
    assert all("valuation_is_projected" in event for event in result["data"]["events"])


def test_resource_and_metadata(mcp):
    assert "resources" in mcp.rpc("initialize")["result"]["capabilities"]
    assert mcp.rpc("resources/list")["result"]["resources"][0]["uri"] == RESOURCE_URI
    resource = mcp.rpc("resources/read", {"uri": RESOURCE_URI})["result"]["contents"][0]
    assert resource["mimeType"] == "text/html;profile=mcp-app"
    assert resource["_meta"]["ui"]["csp"] == {"connectDomains": [], "resourceDomains": []}
    assert "access_token" not in resource["text"]
    tools = {t["name"]: t for t in mcp.list_tools()}
    assert tools["show_equity"]["_meta"]["ui"]["resourceUri"] == RESOURCE_URI
    assert tools["refresh_equity_view"]["_meta"]["ui"]["visibility"] == ["app"]
    assert "resourceUri" not in tools["get_dashboard"].get("_meta", {}).get("ui", {})
    assert tools["show_equity"]["outputSchema"]["required"] == ["view", "account", "as_of", "data"]


def test_scope_denies_tools_and_resources(client):
    register_user(client)
    mcp = Mcp(client, scope="comp:read")
    assert "show_equity" not in {t["name"] for t in mcp.list_tools()}
    assert "permission" in mcp.error("show_equity")
    assert "permission" in mcp.error("refresh_equity_view")
    assert {r["uri"] for r in mcp.rpc("resources/list")["result"]["resources"]} == {
        RETIREMENT_RESOURCE_URI, RETIREMENT_COMPARE_RESOURCE_URI,
    }
    assert "error" in mcp.rpc("resources/read", {"uri": RESOURCE_URI})


@pytest.mark.parametrize("args", [{"view": []}, {"view": "admin"}, {"account": "someone-else"}, {"view": "summary", "from_date": "2020-01-01"}, {"view": "events", "from_date": "nope"}, {"view": "events", "from_date": "2030-01-01", "to_date": "2020-01-01"}, {"view": "events", "from_date": []}, {"balance": 999}])
def test_invalid_input_is_tool_error(mcp, args):
    assert mcp.error("show_equity", **args)


def test_unknown_resource_is_not_a_file_reader(mcp):
    assert "error" in mcp.rpc("resources/read", {"uri": "file:///etc/passwd"})


def test_no_price_stays_unknown(client):
    register_user(client)
    mcp = Mcp(client, scope="equity:read")
    assert mcp.call("show_equity")["data"]["net_equity"] is None


def test_resource_has_no_user_data_and_read_is_audited(mcp, db_session):
    from scaffold.oauth.models import McpAudit
    result = mcp.call("refresh_equity_view", view="grants")
    assert result["data"]["grants"]
    entry = db_session.query(McpAudit).filter_by(tool="refresh_equity_view").one()
    assert entry.outcome == "ok"


def test_ui_reads_refuse_revoked_connection(mcp):
    connections = mcp.client.get("/api/oauth/connections").json()
    assert mcp.client.delete(f"/api/oauth/connections/{connections[0]['id']}").status_code == 204
    response = mcp.client.post("/mcp", headers=mcp.auth, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "refresh_equity_view", "arguments": {"view": "summary"}},
    })
    assert response.status_code == 401


def test_ui_reads_are_isolated_to_connected_user(mcp):
    owner_grants = mcp.call("show_equity", view="grants")["data"]["grants"]
    register_user(mcp.client, email="other-ui@example.com")
    other = Mcp(mcp.client, scope="equity:read")
    assert other.call("show_equity", view="grants")["data"]["grants"] == []
    assert mcp.call("refresh_equity_view", view="grants")["data"]["grants"] == owner_grants


def test_component_origin_is_validated(mcp, monkeypatch):
    monkeypatch.setenv("CHATGPT_UI_ORIGIN", "https://widgets.example.com")
    resource = mcp.rpc("resources/read", {"uri": RESOURCE_URI})["result"]["contents"][0]
    assert resource["_meta"]["ui"]["domain"] == "https://widgets.example.com"
    monkeypatch.setenv("CHATGPT_UI_ORIGIN", "https://widgets.example.com/path")
    assert "error" in mcp.rpc("resources/read", {"uri": RESOURCE_URI})


CACHED_UI_RESOURCES = [
    ("equity:read", f"ui://epic-stocks/portfolio-v{version}.html", RESOURCE_URI)
    for version in (1, 2)
] + [
    ("comp:read", f"ui://epic-stocks/retirement-v{version}.html", RETIREMENT_RESOURCE_URI)
    for version in (1, 2, 3)
]


@pytest.mark.parametrize("scope,uri,current", CACHED_UI_RESOURCES)
def test_cached_ui_descriptors_remain_loadable(client, scope, uri, current):
    register_user(client)
    connection = Mcp(client, scope=scope)
    response = connection.rpc("resources/read", {"uri": uri})
    assert "error" not in response, response
    contents = response["result"]["contents"][0]
    assert contents["uri"] == uri
    assert contents["mimeType"] == "text/html;profile=mcp-app"
    canonical = connection.rpc("resources/read", {"uri": current})["result"]["contents"][0]
    assert contents["text"] == canonical["text"]
    assert contents["_meta"] == canonical["_meta"]
    assert "access_token" not in contents["text"]
    # New discovery advertises only the current version, not every compatibility URI.
    expected = {current, RETIREMENT_COMPARE_RESOURCE_URI} if scope == "comp:read" else {current}
    assert {r["uri"] for r in connection.rpc("resources/list")["result"]["resources"]} == expected


@pytest.mark.parametrize("scope,uri,current", CACHED_UI_RESOURCES)
def test_cached_ui_resources_keep_the_original_scope_guard(client, scope, uri, current):
    register_user(client)
    other_scope = "comp:read" if scope == "equity:read" else "equity:read"
    connection = Mcp(client, scope=other_scope)
    for requested in (uri, current):
        response = connection.rpc("resources/read", {"uri": requested})
        assert response["error"]["code"] == -32602
        assert scope in response["error"]["message"]


@pytest.mark.parametrize("uri", [None, [], {}, "file:///etc/passwd",
                                 "ui://epic-stocks/retirement-v99.html",
                                 "ui://epic-stocks/retirement-v3.html?file=/etc/passwd"])
def test_resource_compatibility_is_not_an_arbitrary_file_reader(mcp, uri):
    response = mcp.rpc("resources/read", {"uri": uri})
    assert response["error"]["code"] == -32602
