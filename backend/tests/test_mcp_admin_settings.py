"""AI connection settings, which are admin policy rather than deployment config.

They used to be MCP_ENABLED and MCP_ALLOWED_REDIRECT_HOSTS in the environment,
which made "stop accepting connections from ChatGPT" a redeploy — and the
deployment rule in CLAUDE.md is that fixing production by hand is exactly what
leaves the repo out of sync with reality. An admin toggle is the version of
that which survives the next deploy.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.oauth.models import OAuthGrant, OAuthRedirectHost
from tests.conftest import register_user
from tests.test_oauth_server import (REDIRECT, authorize, connect,
                                     pkce_pair, register_client)


def as_admin(client, email="admin@example.com", monkeypatch=None):
    monkeypatch.setenv("ADMIN_EMAIL", email)
    register_user(client, email)
    return client


@pytest.fixture()
def admin(client, monkeypatch):
    return as_admin(client, monkeypatch=monkeypatch)


# ── what a fresh deployment starts with ─────────────────────────────────────

def test_the_defaults_are_seeded_on_boot(admin):
    status = admin.get("/api/admin/mcp").json()
    assert status["enabled"] is True
    by_label = {(h["label"], h["host"]): h["enabled"] for h in status["hosts"]}
    assert by_label == {
        ("ChatGPT", "chatgpt.com"): True,
        ("Claude", "claude.ai"): True,
        ("Claude", "claude.com"): True,
    }


def test_the_settings_are_admin_only(client):
    register_user(client, "nobody@example.com")
    assert client.get("/api/admin/mcp").status_code == 403
    assert client.post("/api/admin/mcp", json={"enabled": False}).status_code == 403
    assert client.post("/api/admin/mcp/hosts",
                       json={"label": "X", "host": "x.com"}).status_code == 403


def test_the_environment_no_longer_decides_this(admin, monkeypatch):
    """The old env vars are gone. Setting them must not change anything —
    otherwise a stale value in a deployment's environment quietly overrides
    what the admin page says."""
    monkeypatch.setenv("MCP_ENABLED", "0")
    monkeypatch.setenv("MCP_ALLOWED_REDIRECT_HOSTS", "evil.example.com")

    assert admin.get("/api/admin/mcp").json()["enabled"] is True
    resp = admin.post("/oauth/register", json={
        "client_name": "Evil", "redirect_uris": ["https://evil.example.com/cb"],
    })
    assert resp.status_code == 400


def test_no_mcp_env_vars_are_read_anywhere(admin):
    import subprocess
    backend = os.path.join(os.path.dirname(__file__), "..")
    found = subprocess.run(
        ["grep", "-rn", "MCP_ENABLED\\|MCP_ALLOWED_REDIRECT_HOSTS",
         os.path.join(backend, "app"), os.path.join(backend, "scaffold")],
        capture_output=True, text=True,
    ).stdout
    assert not found.strip(), f"the env vars were supposed to be deleted:\n{found}"


# ── the master switch ───────────────────────────────────────────────────────

def test_turning_connections_off_stops_the_mcp_endpoint(admin):
    tokens = connect(admin)
    assert admin.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"Authorization": f"Bearer {tokens['access_token']}"}
                      ).status_code == 200

    admin.post("/api/admin/mcp", json={"enabled": False})

    resp = admin.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert resp.status_code == 503, "an admin switch should read as temporary, not missing"


def test_turning_connections_off_stops_new_registrations(admin):
    admin.post("/api/admin/mcp", json={"enabled": False})
    resp = admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    })
    assert resp.status_code == 400
    assert "turned off" in resp.json()["error_description"]


def test_turning_connections_off_stops_the_consent_screen(admin):
    reg = register_client(admin)
    admin.post("/api/admin/mcp", json={"enabled": False})
    _, challenge = pkce_pair()
    resp = authorize(admin, reg["client_id"], challenge)
    assert resp.status_code == 404
    assert "location" not in resp.headers


def test_the_switch_is_a_pause_not_a_purge(admin, db_session):
    """Switching off should not silently disconnect everyone.

    An admin stopping new connections for an afternoon getting every user's
    assistant unlinked would be a worse surprise than the pause itself.
    """
    connect(admin)
    assert db_session.query(OAuthGrant).count() == 1
    admin.post("/api/admin/mcp", json={"enabled": False})
    assert db_session.query(OAuthGrant).count() == 1
    admin.post("/api/admin/mcp", json={"enabled": True})
    assert db_session.query(OAuthGrant).count() == 1


def test_the_switch_round_trips(admin):
    assert admin.post("/api/admin/mcp", json={"enabled": False}).json()["enabled"] is False
    assert admin.get("/api/admin/mcp").json()["enabled"] is False
    assert admin.post("/api/admin/mcp", json={"enabled": True}).json()["enabled"] is True
    assert admin.get("/api/admin/mcp").json()["enabled"] is True


# ── the provider allowlist ──────────────────────────────────────────────────

def test_disabling_a_provider_refuses_new_registrations_from_it(admin, db_session):
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "chatgpt.com").one()
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": False})

    resp = admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    })
    assert resp.status_code == 400
    assert "chatgpt.com" in resp.json()["error_description"]

    # Claude is a separate label and stays on.
    assert admin.post("/oauth/register", json={
        "client_name": "Claude",
        "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
    }).status_code == 201


def test_disabling_a_provider_stops_its_consent_screen(admin, db_session):
    reg = register_client(admin)
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "chatgpt.com").one()
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": False})

    _, challenge = pkce_pair()
    resp = authorize(admin, reg["client_id"], challenge)
    assert resp.status_code == 400
    assert "turned off" in resp.text


def test_disabling_a_provider_kills_its_live_connections_at_refresh(admin, db_session):
    """Not at the end of the refresh window. An admin who turns ChatGPT off
    means now, not in ninety days."""
    tokens = connect(admin)
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "chatgpt.com").one()
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": False})

    resp = admin.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
    })
    assert resp.status_code == 400
    assert "turned off" in resp.json()["error_description"]
    assert db_session.query(OAuthGrant).count() == 0


def test_re_enabling_a_provider_works_again(admin, db_session):
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "chatgpt.com").one()
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": False})
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": True})
    assert admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    }).status_code == 201


def test_adding_a_provider_allows_it(admin):
    added = admin.post("/api/admin/mcp/hosts",
                       json={"label": "Copilot", "host": "copilot.microsoft.com"})
    assert added.status_code == 201
    assert ("Copilot", "copilot.microsoft.com") in {
        (h["label"], h["host"]) for h in added.json()["hosts"]
    }
    assert admin.post("/oauth/register", json={
        "client_name": "Copilot",
        "redirect_uris": ["https://copilot.microsoft.com/callback"],
    }).status_code == 201


@pytest.mark.parametrize("typed,stored", [
    ("https://example.com/callback", "example.com"),
    ("HTTPS://Example.COM/", "example.com"),
    ("  example.com  ", "example.com"),
    ("example.com/", "example.com"),
    ("*.example.com", "example.com"),
])
def test_a_pasted_url_is_stored_as_a_hostname(admin, typed, stored):
    """Admins paste URLs. Storing what they typed means an allowlist that
    silently matches nothing and an admin concluding the feature is broken."""
    resp = admin.post("/api/admin/mcp/hosts", json={"label": "Test", "host": typed})
    assert resp.status_code == 201, resp.text
    assert stored in {h["host"] for h in resp.json()["hosts"]}


@pytest.mark.parametrize("bad", ["", "  ", "not a host", "localhost", "///"])
def test_a_value_that_is_not_a_hostname_is_refused(admin, bad):
    assert admin.post("/api/admin/mcp/hosts",
                      json={"label": "Test", "host": bad}).status_code in (422, 400)


def test_the_same_host_cannot_be_added_twice(admin):
    assert admin.post("/api/admin/mcp/hosts",
                      json={"label": "Again", "host": "chatgpt.com"}).status_code == 409


def test_deleting_a_provider_removes_it(admin, db_session):
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "claude.com").one()
    remaining = admin.delete(f"/api/admin/mcp/hosts/{host.id}").json()
    assert "claude.com" not in {h["host"] for h in remaining["hosts"]}
    assert "claude.ai" in {h["host"] for h in remaining["hosts"]}


def test_deleting_a_host_that_is_not_there_is_a_404(admin):
    assert admin.delete("/api/admin/mcp/hosts/999999").status_code == 404
    assert admin.patch("/api/admin/mcp/hosts/999999", json={"enabled": False}).status_code == 404


def test_an_empty_allowlist_refuses_everything_and_says_why(admin, db_session):
    for row in db_session.query(OAuthRedirectHost).all():
        admin.delete(f"/api/admin/mcp/hosts/{row.id}")
    resp = admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    })
    assert resp.status_code == 400
    assert "administrator" in resp.json()["error_description"]


def test_the_status_reports_how_many_connections_exist(admin):
    assert admin.get("/api/admin/mcp").json()["connections"] == 0
    connect(admin)
    assert admin.get("/api/admin/mcp").json()["connections"] == 1


# ── the seed does not fight the admin ───────────────────────────────────────

def test_boot_does_not_re_enable_what_an_admin_switched_off(admin, db_session):
    """seed_defaults runs on every boot. It must be additive, or a deploy
    silently undoes the admin page."""
    from scaffold.oauth.settings import seed_defaults

    admin.post("/api/admin/mcp", json={"enabled": False})
    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "chatgpt.com").one()
    admin.patch(f"/api/admin/mcp/hosts/{host.id}", json={"enabled": False})

    seed_defaults(db_session)

    status = admin.get("/api/admin/mcp").json()
    assert status["enabled"] is False
    assert {h["host"]: h["enabled"] for h in status["hosts"]}["chatgpt.com"] is False


def test_boot_does_not_re_add_a_deleted_provider(admin, db_session):
    from scaffold.oauth.settings import seed_defaults

    host = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.host == "claude.com").one()
    admin.delete(f"/api/admin/mcp/hosts/{host.id}")

    seed_defaults(db_session)

    assert "claude.com" not in {h["host"] for h in admin.get("/api/admin/mcp").json()["hosts"]}


def test_the_client_config_says_whether_to_offer_connections(admin):
    """Settings hides the whole section when an admin has switched this off.

    Instructions for a feature that cannot work are worse than no instructions,
    so the SPA needs to know before it renders them.
    """
    assert admin.get("/api/config").json()["ai_connections"] is True
    admin.post("/api/admin/mcp", json={"enabled": False})
    assert admin.get("/api/config").json()["ai_connections"] is False


# ── usage metrics ───────────────────────────────────────────────────────────

def test_usage_reports_who_is_connected_and_how_much(admin):
    from tests.test_mcp_tools import Mcp, seed

    seed(admin)
    view = Mcp(admin)
    view.call("get_dashboard")
    view.call("get_dashboard")
    view.call("list_grants")

    report = admin.get("/api/admin/mcp/usage").json()

    assert report["calls_24h"] == 3
    assert report["calls_7d"] == 3
    assert report["calls_30d"] == 3

    person = report["users"][0]
    assert person["email"] == "admin@example.com"
    assert person["connections"] == 1
    assert person["clients"] == ["ChatGPT"]
    assert person["calls_7d"] == 3
    assert person["last_used_at"]

    by_tool = {t["tool"]: t["calls_30d"] for t in report["tools"]}
    assert by_tool == {"get_dashboard": 2, "list_grants": 1}
    assert report["tools"][0]["tool"] == "get_dashboard", "busiest first"


def test_usage_counts_errors_and_refusals_separately(client, monkeypatch):
    from tests.test_mcp_tools import Mcp, seed

    as_admin(client, monkeypatch=monkeypatch)
    seed(client)
    view = Mcp(client, scope="equity:read")
    view.error("explain", topic="nonsense")
    view.error("get_compensation")

    report = client.get("/api/admin/mcp/usage").json()
    assert report["errors_7d"] == 1
    assert report["denied_7d"] == 1


def test_usage_survives_a_disconnection(admin, db_session):
    """Hiding a disconnected account's usage would make the record vanish
    exactly when someone looks into it."""
    from scaffold.oauth.models import OAuthGrant
    from tests.test_mcp_tools import Mcp, seed

    seed(admin)
    Mcp(admin).call("get_dashboard")
    grant_id = db_session.query(OAuthGrant).one().id
    admin.delete(f"/api/oauth/connections/{grant_id}")

    report = admin.get("/api/admin/mcp/usage").json()
    assert report["calls_30d"] == 1
    person = report["users"][0]
    assert person["connections"] == 0
    assert person["calls_30d"] == 1


def test_usage_is_admin_only(client):
    register_user(client, "nobody@example.com")
    assert client.get("/api/admin/mcp/usage").status_code == 403


def test_usage_reports_nothing_gracefully_on_a_quiet_deployment(admin):
    report = admin.get("/api/admin/mcp/usage").json()
    assert report["users"] == []
    assert report["tools"] == []
    assert report["calls_30d"] == 0
    assert report["audit_rows"] == 0


def test_usage_exposes_no_financial_data(admin):
    """Admin endpoints never expose financial data, and the audit table has
    none to expose — this pins that the report did not add any."""
    from tests.test_mcp_tools import Mcp, seed

    seed(admin)
    Mcp(admin).call("estimate_sale", price_per_share=4.0, shares=100)

    body = admin.get("/api/admin/mcp/usage").text
    for figure in ('"400', '"price', '"shares', '"amount', '"balance'):
        assert figure not in body
