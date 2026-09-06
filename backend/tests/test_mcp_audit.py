"""What an assistant read, and the bounds on how fast it may read.

`oauth_grants.last_used_at` was the only trace a connection left — one
timestamp, overwritten each request. For a feature whose whole purpose is
sending someone's financial figures to an outside company that is not enough
for the user or for whoever has to look into a report later.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.oauth import audit
from scaffold.oauth.models import McpAudit, OAuthAuthCode, OAuthClient, OAuthGrant
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, seed
from tests.test_oauth_server import connect, register_client


@pytest.fixture()
def mcp(client):
    register_user(client)
    seed(client)
    return Mcp(client)


# ── every read is recorded ──────────────────────────────────────────────────

def test_a_tool_call_is_recorded(mcp, db_session):
    mcp.call("get_dashboard")
    row = db_session.query(McpAudit).filter(McpAudit.event == audit.TOOL_CALL).one()
    assert row.tool == "get_dashboard"
    assert row.outcome == audit.OK
    assert row.client_name == "ChatGPT"
    assert row.scope == "equity:read"


def test_each_call_gets_its_own_entry(mcp, db_session):
    mcp.call("get_dashboard")
    mcp.call("list_grants")
    mcp.call("get_dashboard")
    tools = [r.tool for r in db_session.query(McpAudit).filter(
        McpAudit.event == audit.TOOL_CALL).order_by(McpAudit.id).all()]
    assert tools == ["get_dashboard", "list_grants", "get_dashboard"]


def test_a_failed_call_is_recorded_as_an_error(mcp, db_session):
    mcp.error("explain", topic="nonsense")
    row = db_session.query(McpAudit).filter(McpAudit.tool == "explain").one()
    assert row.outcome == audit.ERROR


def test_a_call_outside_the_granted_scope_is_recorded_as_denied(client, db_session):
    register_user(client)
    seed(client)
    equity_only = Mcp(client, scope="equity:read")
    equity_only.error("get_compensation")
    row = db_session.query(McpAudit).filter(McpAudit.tool == "get_compensation").one()
    assert row.outcome == audit.DENIED


def test_an_unknown_tool_is_not_recorded_as_a_read(mcp, db_session):
    """Nothing was read, so there is nothing to account for."""
    mcp.rpc("tools/call", {"name": "no_such_tool", "arguments": {}})
    assert db_session.query(McpAudit).filter(McpAudit.event == audit.TOOL_CALL).count() == 0


def test_listing_tools_is_not_a_read(mcp, db_session):
    mcp.list_tools()
    mcp.rpc("ping")
    assert db_session.query(McpAudit).filter(McpAudit.event == audit.TOOL_CALL).count() == 0


def test_a_read_cannot_happen_without_a_record(mcp, monkeypatch):
    """The entry is written before the tool runs, so a broken audit refuses the
    call rather than serving data off the books."""
    def _explode(*args, **kwargs):
        raise RuntimeError("audit is down")

    monkeypatch.setattr(audit, "start_tool_call", _explode)
    response = mcp.rpc("tools/call", {"name": "get_dashboard", "arguments": {}})

    assert "error" in response, "the call should have been refused"
    assert "result" not in response, "data was served without an audit entry"


# ── the connection lifecycle ────────────────────────────────────────────────

def test_connecting_and_disconnecting_are_recorded(client, db_session):
    register_user(client)
    connect(client)
    assert db_session.query(McpAudit).filter(McpAudit.event == audit.CONNECTED).count() == 1

    grant_id = db_session.query(OAuthGrant).one().id
    client.delete(f"/api/oauth/connections/{grant_id}")

    assert db_session.query(McpAudit).filter(McpAudit.event == audit.DISCONNECTED).count() == 1


def test_the_trail_outlives_the_connection(client, db_session):
    """An audit trail that vanishes when someone revokes access is missing
    exactly when it is wanted."""
    register_user(client)
    seed(client)
    view = Mcp(client)
    view.call("get_dashboard")

    grant_id = db_session.query(OAuthGrant).one().id
    client.delete(f"/api/oauth/connections/{grant_id}")

    assert db_session.query(OAuthGrant).count() == 0
    kept = db_session.query(McpAudit).filter(McpAudit.tool == "get_dashboard").one()
    assert kept.grant_id == grant_id
    assert kept.client_name == "ChatGPT"


# ── no financial data ───────────────────────────────────────────────────────

def test_the_audit_table_carries_no_financial_columns():
    """Same rule as problem reports, for the same reason: any value here would
    be the user's own share counts and prices."""
    columns = set(McpAudit.__table__.columns.keys())
    assert columns == {
        "id", "user_id", "grant_id", "client_name", "event", "tool", "scope",
        "outcome", "created_at",
    }, "a column was added to mcp_audit — does it carry financial data?"


def test_no_figures_reach_the_audit_row(mcp, db_session):
    mcp.call("estimate_sale", price_per_share=4.0, shares=100)
    row = db_session.query(McpAudit).filter(McpAudit.tool == "estimate_sale").one()
    written = " ".join(str(getattr(row, c)) for c in McpAudit.__table__.columns.keys())
    for figure in ("4.0", "100", "400"):
        assert figure not in written.replace(str(row.id), "").replace(str(row.user_id), "")


def test_deleting_the_account_removes_its_trail(mcp, db_session, client):
    mcp.call("get_dashboard")
    assert db_session.query(McpAudit).count() > 0
    assert client.delete("/api/me").status_code == 204
    assert db_session.query(McpAudit).count() == 0


# ── what the user sees ──────────────────────────────────────────────────────

def test_the_user_can_see_what_their_assistant_did(mcp, client):
    mcp.call("get_dashboard")
    mcp.call("get_compensation")

    activity = client.get("/api/oauth/activity").json()
    tools = [a["tool"] for a in activity if a["event"] == "tool_call"]
    assert tools == ["get_compensation", "get_dashboard"], "newest first"
    assert all(a["client_name"] == "ChatGPT" for a in activity)
    assert any(a["event"] == "connected" for a in activity)


def test_activity_is_per_account(client, make_client):
    register_user(client, "owner@example.com")
    seed(client)
    Mcp(client).call("get_dashboard")

    with make_client("other@example.com") as other:
        assert other.get("/api/oauth/activity").json() == []


def test_activity_needs_a_session(client):
    assert client.get("/api/oauth/activity").status_code == 401


# ── rate limits ─────────────────────────────────────────────────────────────

def test_a_connection_is_rate_limited(client, monkeypatch):
    """Nothing else covers /mcp: the mutation middleware only inspects /api/
    paths, and an IP limit would count the provider's servers, not the user."""
    register_user(client)
    seed(client)
    view = Mcp(client)
    monkeypatch.delenv("E2E_TEST", raising=False)

    from app.mcp import transport
    monkeypatch.setattr(transport, "PER_CONNECTION_LIMIT", 3)

    for _ in range(3):
        assert client.post("/mcp", headers=view.auth, json={
            "jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 200

    refused = client.post("/mcp", headers=view.auth,
                          json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert refused.status_code == 429
    assert refused.headers.get("Retry-After")


def test_the_account_limit_covers_every_connection(client, monkeypatch):
    """One runaway assistant must not be able to spend the whole account's
    budget by opening a second connection."""
    register_user(client)
    seed(client)
    first = Mcp(client)
    second_reg = register_client(client, name="Claude",
                                 uris=["https://claude.ai/api/mcp/auth_callback"])
    assert second_reg["client_id"]

    monkeypatch.delenv("E2E_TEST", raising=False)
    from app.mcp import transport
    monkeypatch.setattr(transport, "PER_CONNECTION_LIMIT", 1000)
    monkeypatch.setattr(transport, "PER_ACCOUNT_LIMIT", 2)

    for _ in range(2):
        assert client.post("/mcp", headers=first.auth, json={
            "jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 200
    assert client.post("/mcp", headers=first.auth, json={
        "jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 429


def test_the_limits_are_low_enough_to_matter_and_high_enough_to_use():
    from app.mcp import transport
    assert 30 <= transport.PER_CONNECTION_LIMIT <= 600
    assert transport.PER_ACCOUNT_LIMIT >= transport.PER_CONNECTION_LIMIT


# ── the nightly prune ───────────────────────────────────────────────────────

def test_a_client_that_never_connected_is_pruned(client, db_session):
    """Registration is anonymous, so these accumulate on their own."""
    from scaffold.oauth.cleanup import UNUSED_CLIENT_DAYS, prune

    register_client(client, name="Abandoned")
    row = db_session.query(OAuthClient).one()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=UNUSED_CLIENT_DAYS + 1)
    db_session.commit()

    assert prune(db_session)["clients"] == 1
    assert db_session.query(OAuthClient).count() == 0


def test_a_client_with_a_live_connection_is_never_pruned(client, db_session):
    from scaffold.oauth.cleanup import UNUSED_CLIENT_DAYS, prune

    register_user(client)
    connect(client)
    row = db_session.query(OAuthClient).one()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=UNUSED_CLIENT_DAYS + 10)
    db_session.commit()

    prune(db_session)
    assert db_session.query(OAuthClient).count() == 1


def test_a_recent_registration_is_left_alone(client, db_session):
    from scaffold.oauth.cleanup import prune

    register_client(client, name="Still trying")
    assert prune(db_session)["clients"] == 0
    assert db_session.query(OAuthClient).count() == 1


def test_an_abandoned_authorization_code_is_pruned(client, db_session):
    """Approved and never exchanged: nothing else would ever touch the row."""
    from scaffold.oauth.cleanup import prune

    register_user(client)
    db_session.add(OAuthAuthCode(
        code="stale", user_id=db_session.query(OAuthGrant).count() or 1,
        client_id="x", redirect_uri="https://chatgpt.com/cb", scope="equity:read",
        code_challenge="c", expires_at=datetime.now(timezone.utc) - timedelta(days=2),
    ))
    db_session.commit()
    assert prune(db_session)["auth_codes"] == 1


def test_audit_entries_past_the_retention_window_are_pruned(mcp, db_session):
    mcp.call("get_dashboard")
    row = db_session.query(McpAudit).filter(McpAudit.tool.isnot(None)).one()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=audit.RETAIN_DAYS + 1)
    db_session.commit()

    assert audit.prune(db_session) >= 1
    assert db_session.query(McpAudit).filter(McpAudit.tool.isnot(None)).count() == 0


def test_one_busy_account_cannot_fill_the_window(mcp, db_session, monkeypatch):
    monkeypatch.setattr(audit, "MAX_ROWS_PER_USER", 5)
    for _ in range(8):
        mcp.call("get_dashboard")

    audit.prune(db_session)
    assert db_session.query(McpAudit).count() == 5
