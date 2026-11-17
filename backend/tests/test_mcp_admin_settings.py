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

from app.mcp.tools import REGISTRY
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
    from scaffold.oauth.settings import DEFAULT_REDIRECT_RULES

    status = admin.get("/api/admin/mcp").json()
    assert status["enabled"] is True
    seeded = {(h["label"], h["match_type"], h["pattern"]) for h in status["hosts"]}
    assert seeded == set(DEFAULT_REDIRECT_RULES)
    assert all(h["enabled"] for h in status["hosts"])
    assert {label for label, _, _ in DEFAULT_REDIRECT_RULES} >= {
        "Claude", "ChatGPT", "Gemini", "Grok", "Muse", "Perplexity",
        "Mistral Le Chat", "Manus", "Local clients",
    }


def _rows(db_session, label):
    return db_session.query(OAuthRedirectHost).filter(OAuthRedirectHost.label == label).all()


def _set_provider(admin, db_session, label, enabled):
    for row in _rows(db_session, label):
        admin.patch(f"/api/admin/mcp/hosts/{row.id}", json={"enabled": enabled})


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

@pytest.mark.parametrize("uri", [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/abc123",
    "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-42",
    "https://grok.com/connectors-oauth-exchange-code/",
    "https://grok.com/connectors/oauth/callback",
    "https://agent.meta.ai/api/hatch/oauth/callback",
    "https://muse.ai/api/hatch/oauth/callback",
    "https://www.perplexity.ai/rest/connections/oauth_callback",
    "https://enterprise.perplexity.ai/rest/connections/oauth_callback",
    "https://callback.mistral.ai/oauth/anything",
    "https://manus.im/api/webhook/mcp/callback",
])
def test_every_default_callback_registers_on_a_real_deployment(admin, monkeypatch, uri):
    monkeypatch.setenv("DOMAIN", "epic-stocks.example")
    resp = admin.post("/oauth/register", json={"client_name": "X", "redirect_uris": [uri]})
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("uri", [
    "https://claude.ai/somewhere-else",
    "https://claude.ai/api/mcp/auth_callback/extra",
    "https://chatgpt.com/connector/oauth/../../evil",
    "https://chatgpt.com/connector/oauth/%2e%2e/evil",
    "https://chatgpt.com:8443/connector/oauth/x",
    "https://chatgpt.com.evil.net/connector/oauth/x",
    "https://oauth-redirect.googleusercontent.com/r/other",
    "https://grok.com/connectors/oauth/callback?next=https://evil.net",
    "https://callback.mistral.ai.evil.net/cb",
    "http://callback.mistral.ai/cb",
    "https://evil.net@claude.ai/api/mcp/auth_callback",
    "http://localhost.evil.net/cb",
    "http://[::1]:5000/cb",
])
def test_near_misses_are_refused(admin, monkeypatch, uri):
    monkeypatch.setenv("DOMAIN", "epic-stocks.example")
    resp = admin.post("/oauth/register", json={"client_name": "X", "redirect_uris": [uri]})
    assert resp.status_code == 400, uri


def test_a_refused_redirect_is_logged_for_the_admin(admin, db_session, caplog):
    from scaffold.oauth.models import OAuthRejectedRedirect

    uri = "https://copilot.microsoft.com/oauth/callback"
    for _ in range(2):
        resp = admin.post("/oauth/register", json={"client_name": "Copilot", "redirect_uris": [uri]})
        assert resp.status_code == 400
    assert uri in caplog.text

    rejected = admin.get("/api/admin/mcp").json()["rejected"]
    assert [(r["redirect_uri"], r["client_name"], r["attempts"]) for r in rejected] == [
        (uri, "Copilot", 2)
    ]

    # Allowing it clears it from the review list, and registration then works.
    admin.post("/api/admin/mcp/hosts", json={"label": "Copilot", "pattern": uri})
    assert admin.get("/api/admin/mcp").json()["rejected"] == []
    assert db_session.query(OAuthRejectedRedirect).count() == 0
    assert admin.post("/oauth/register", json={
        "client_name": "Copilot", "redirect_uris": [uri]}).status_code == 201


def test_a_refused_redirect_can_be_dismissed(admin):
    admin.post("/oauth/register", json={"client_name": "X", "redirect_uris": ["https://x.example/cb"]})
    row = admin.get("/api/admin/mcp").json()["rejected"][0]
    assert admin.delete(f"/api/admin/mcp/rejected/{row['id']}").json()["rejected"] == []
    assert admin.delete(f"/api/admin/mcp/rejected/{row['id']}").status_code == 404


def test_the_refusal_log_is_bounded(admin, db_session, monkeypatch):
    """Registration is anonymous: a stranger must not be able to grow it."""
    from scaffold.oauth import settings
    from scaffold.oauth.models import OAuthRejectedRedirect

    monkeypatch.setattr(settings, "REJECTED_REDIRECT_CAP", 3)
    for i in range(6):
        settings.record_rejection(db_session, f"https://x{i}.example/cb", "X", "no")
    settings.record_rejection(db_session, "https://y.example/" + "a" * 5000, "X", "no")
    rows = db_session.query(OAuthRejectedRedirect).all()
    assert len(rows) == 3
    assert max(len(r.redirect_uri) for r in rows) <= settings.REJECTED_URI_MAX


def test_the_refusal_log_is_admin_only(client):
    register_user(client, "nobody@example.com")
    assert client.delete("/api/admin/mcp/rejected/1").status_code == 403


def test_a_client_registered_under_an_older_host_rule_keeps_working(admin, db_session):
    """Tightening the allowlist to exact callbacks must not cut off people
    already connected: authorize and refresh check the provider's host."""
    from scaffold.oauth.models import OAuthClient

    tokens = connect(admin)
    client_row = db_session.query(OAuthClient).one()
    client_row.redirect_uris = '["https://chatgpt.com/aip/legacy/oauth/callback"]'
    db_session.commit()
    resp = admin.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
    })
    assert resp.status_code == 200, resp.text

def test_disabling_a_provider_refuses_new_registrations_from_it(admin, db_session):
    _set_provider(admin, db_session, "ChatGPT", False)

    resp = admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    })
    assert resp.status_code == 400
    assert REDIRECT in resp.json()["error_description"]

    # Claude is a separate label and stays on.
    assert admin.post("/oauth/register", json={
        "client_name": "Claude",
        "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
    }).status_code == 201


def test_disabling_a_provider_stops_its_consent_screen(admin, db_session):
    reg = register_client(admin)
    _set_provider(admin, db_session, "ChatGPT", False)

    _, challenge = pkce_pair()
    resp = authorize(admin, reg["client_id"], challenge)
    assert resp.status_code == 400
    assert "turned off" in resp.text


def test_disabling_a_provider_kills_its_live_connections_at_refresh(admin, db_session):
    """Not at the end of the refresh window. An admin who turns ChatGPT off
    means now, not in ninety days."""
    tokens = connect(admin)
    _set_provider(admin, db_session, "ChatGPT", False)

    resp = admin.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
    })
    assert resp.status_code == 400
    assert "turned off" in resp.json()["error_description"]
    assert db_session.query(OAuthGrant).count() == 0


def test_re_enabling_a_provider_works_again(admin, db_session):
    _set_provider(admin, db_session, "ChatGPT", False)
    _set_provider(admin, db_session, "ChatGPT", True)
    assert admin.post("/oauth/register", json={
        "client_name": "ChatGPT", "redirect_uris": [REDIRECT],
    }).status_code == 201


def test_adding_a_host_rule_allows_any_path_on_it(admin):
    added = admin.post("/api/admin/mcp/hosts",
                       json={"label": "Copilot", "host": "copilot.microsoft.com"})
    assert added.status_code == 201
    assert ("Copilot", "host", "copilot.microsoft.com") in {
        (h["label"], h["match_type"], h["pattern"]) for h in added.json()["hosts"]
    }
    assert admin.post("/oauth/register", json={
        "client_name": "Copilot",
        "redirect_uris": ["https://copilot.microsoft.com/callback"],
    }).status_code == 201


@pytest.mark.parametrize("typed,stored", [
    ("HTTPS://Example.COM", "example.com"),
    ("  example.com  ", "example.com"),
    ("example.com/", "example.com"),
    ("*.example.com", "example.com"),
])
def test_a_typed_host_is_stored_as_a_hostname(admin, typed, stored):
    resp = admin.post("/api/admin/mcp/hosts",
                      json={"label": "Test", "pattern": typed, "match_type": "host"})
    assert resp.status_code == 201, resp.text
    assert stored in {h["pattern"] for h in resp.json()["hosts"]}


def test_a_pasted_url_becomes_an_exact_callback(admin):
    """Paste a callback, get that callback and nothing else on its host."""
    url = "https://copilot.microsoft.com/oauth/callback"
    resp = admin.post("/api/admin/mcp/hosts", json={"label": "Copilot", "pattern": url})
    assert resp.status_code == 201, resp.text
    assert ("exact", url) in {(h["match_type"], h["pattern"]) for h in resp.json()["hosts"]}

    assert admin.post("/oauth/register", json={
        "client_name": "Copilot", "redirect_uris": [url],
    }).status_code == 201
    assert admin.post("/oauth/register", json={
        "client_name": "Copilot", "redirect_uris": [url + "/x"],
    }).status_code == 400


@pytest.mark.parametrize("bad,match", [
    ("", None), ("  ", None), ("not a host", None), ("localhost", None), ("///", None),
    ("http://example.com/cb", "exact"), ("https://example.com", "prefix"),
    ("https://a@example.com/cb", "exact"), ("example.com", "loopback"),
    ("example.com", "regex"),
])
def test_a_value_that_is_not_a_usable_rule_is_refused(admin, bad, match):
    body = {"label": "Test", "pattern": bad}
    if match:
        body["match_type"] = match
    assert admin.post("/api/admin/mcp/hosts", json=body).status_code in (422, 400)


def test_the_same_rule_cannot_be_added_twice(admin):
    assert admin.post("/api/admin/mcp/hosts", json={
        "label": "Again", "pattern": "https://claude.ai/api/mcp/auth_callback",
    }).status_code == 409


def test_deleting_a_rule_removes_it(admin, db_session):
    row = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.pattern == "https://claude.com/api/mcp/auth_callback").one()
    remaining = {h["pattern"] for h in admin.delete(f"/api/admin/mcp/hosts/{row.id}").json()["hosts"]}
    assert "https://claude.com/api/mcp/auth_callback" not in remaining
    assert "https://claude.ai/api/mcp/auth_callback" in remaining


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
    _set_provider(admin, db_session, "ChatGPT", False)

    seed_defaults(db_session)

    status = admin.get("/api/admin/mcp").json()
    assert status["enabled"] is False
    assert not any(h["enabled"] for h in status["hosts"] if h["label"] == "ChatGPT")


def test_boot_does_not_re_add_a_deleted_provider(admin, db_session):
    from scaffold.oauth.settings import seed_defaults

    pattern = "https://claude.com/api/mcp/auth_callback"
    row = db_session.query(OAuthRedirectHost).filter(OAuthRedirectHost.pattern == pattern).one()
    admin.delete(f"/api/admin/mcp/hosts/{row.id}")

    seed_defaults(db_session)

    assert pattern not in {h["pattern"] for h in admin.get("/api/admin/mcp").json()["hosts"]}


def test_boot_seeds_a_default_added_later_exactly_once(admin, db_session, monkeypatch):
    """Extending DEFAULT_REDIRECT_RULES is the whole procedure for a new
    assistant: the next boot adds it, and a later removal sticks."""
    from scaffold.oauth import settings

    extra = ("Copilot", "exact", "https://copilot.microsoft.com/oauth/callback")
    monkeypatch.setattr(settings, "DEFAULT_REDIRECT_RULES", settings.DEFAULT_REDIRECT_RULES + (extra,))
    settings.seed_defaults(db_session)
    row = db_session.query(OAuthRedirectHost).filter(OAuthRedirectHost.pattern == extra[2]).one()
    assert (row.label, row.match_type, row.enabled) == ("Copilot", "exact", 1)

    admin.delete(f"/api/admin/mcp/hosts/{row.id}")
    settings.seed_defaults(db_session)
    assert db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.pattern == extra[2]).count() == 0


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
    none to expose — this pins that the report did not add any.

    Asserted against the shape rather than by searching the body for "400" and
    the like. That search could not really fail (a JSON number renders as
    `:400`, never `"400`) and what it could match was a timestamp's digits, so
    it was flaky and vacuous at once.
    """
    from tests.test_mcp_tools import Mcp, seed

    seed(admin)
    Mcp(admin).call("estimate_sale", price_per_share=4.0, shares=100)

    report = admin.get("/api/admin/mcp/usage").json()
    assert set(report) == {
        "users", "tools", "calls_24h", "calls_7d", "calls_30d",
        "errors_7d", "denied_7d", "audit_rows",
    }
    for key in ("calls_24h", "calls_7d", "calls_30d", "errors_7d", "denied_7d", "audit_rows"):
        assert isinstance(report[key], int)

    for person in report["users"]:
        assert set(person) == {
            "user_id", "email", "connections", "clients", "last_used_at",
            "calls_7d", "calls_30d",
        }
        # Counts and identity only: nothing here is a figure from the account.
        assert isinstance(person["connections"], int)
        assert all(isinstance(name, str) for name in person["clients"])

    for tool in report["tools"]:
        assert set(tool) == {"tool", "calls_7d", "calls_30d"}
        assert tool["tool"] in REGISTRY
        assert isinstance(tool["calls_30d"], int)


# ── the migration ───────────────────────────────────────────────────────────

def _migration():
    import importlib.util
    from pathlib import Path
    path = Path(__file__).parents[1] / "alembic/versions/o6p7q8r9s0t1_oauth_redirect_rules.py"
    spec = importlib.util.spec_from_file_location("redirect_rules_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_turns_legacy_hosts_into_callbacks_and_back():
    """chatgpt.com, claude.ai and claude.com become exact callbacks, keeping
    each one's switch; an admin's own host rows are left alone; Claude and
    ChatGPT are marked seeded so a provider deleted before the upgrade stays
    deleted."""
    import json
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    migration = _migration()
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE system_settings (key VARCHAR PRIMARY KEY, value VARCHAR)"))
        conn.execute(text(
            "CREATE TABLE oauth_redirect_hosts (id INTEGER PRIMARY KEY, label VARCHAR NOT NULL, "
            "host VARCHAR NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at DATETIME)"))
        conn.execute(text("CREATE UNIQUE INDEX ix_oauth_redirect_hosts_host ON oauth_redirect_hosts (host)"))
        conn.execute(text(
            "INSERT INTO oauth_redirect_hosts (label, host, enabled) VALUES "
            "('ChatGPT', 'chatgpt.com', 0), ('Claude', 'claude.ai', 1), ('Meta', 'meta.ai', 1)"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            rows = {tuple(r) for r in conn.execute(text(
                "SELECT label, match_type, pattern, enabled FROM oauth_redirect_hosts"))}
            assert rows == {
                ("ChatGPT", "exact", "https://chatgpt.com/connector_platform_oauth_redirect", 0),
                ("ChatGPT", "prefix", "https://chatgpt.com/connector/oauth/", 0),
                ("Claude", "exact", "https://claude.ai/api/mcp/auth_callback", 1),
                ("Meta", "host", "meta.ai", 1),
            }
            seeded = json.loads(conn.execute(text(
                "SELECT value FROM system_settings WHERE key = 'oauth_default_redirects_seeded'")).scalar())
            assert "https://claude.com/api/mcp/auth_callback" in seeded, "deleted before; stays deleted"
            assert "oauth_rejected_redirects" in inspect(conn).get_table_names()

            migration.downgrade()
            assert "oauth_rejected_redirects" not in inspect(conn).get_table_names()
            rows = {tuple(r) for r in conn.execute(text(
                "SELECT label, host, enabled FROM oauth_redirect_hosts"))}
            assert rows == {("ChatGPT", "chatgpt.com", 0), ("Claude", "claude.ai", 1), ("Meta", "meta.ai", 1)}
    engine.dispose()


def test_a_malformed_refused_uri_cannot_break_adding_a_rule(admin):
    """Refused URIs are anonymous input stored unparsed; matching them against
    a new rule must not raise."""
    bad = admin.post("/oauth/register", json={
        "client_name": "X", "redirect_uris": ["https://[not-ipv6/callback"]})
    assert bad.status_code == 400
    assert admin.get("/api/admin/mcp").json()["rejected"]
    resp = admin.post("/api/admin/mcp/hosts", json={
        "label": "Copilot", "pattern": "https://copilot.microsoft.com/oauth/callback"})
    assert resp.status_code == 201, resp.text


def test_rule_matching_never_raises_on_malformed_input():
    from scaffold.oauth.settings import rule_matches
    for match, pattern in (("exact", "https://a.example/cb"), ("prefix", "https://a.example/cb/"),
                           ("host", "a.example"), ("loopback", "localhost")):
        for uri in ("https://[not-ipv6/cb", "https://a.example:99999/cb", "http://[::1/cb"):
            assert rule_matches(match, pattern, uri) is False


def test_loopback_is_seeded_off_on_a_real_deployment(db_session, monkeypatch, client):
    """Hosted assistants never use loopback, and on production an attacker's
    localhost is the victim's machine: an admin turns it on deliberately."""
    from scaffold.oauth import settings

    db_session.query(OAuthRedirectHost).delete()
    db_session.execute(settings.text("DELETE FROM system_settings WHERE key = :k"),
                       {"k": settings.SEEDED_KEY})
    db_session.commit()
    monkeypatch.setenv("DOMAIN", "epic-stocks.example")
    settings.seed_defaults(db_session)

    loopback = db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.match_type == "loopback").all()
    assert loopback and not any(r.enabled for r in loopback)
    assert all(r.enabled for r in db_session.query(OAuthRedirectHost).filter(
        OAuthRedirectHost.match_type != "loopback"))
    for uri in ("http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/"):
        resp = client.post("/oauth/register", json={"client_name": "X", "redirect_uris": [uri]})
        assert resp.status_code == 400, uri


def test_loopback_works_on_a_deployment_once_an_admin_enables_it(admin, db_session, monkeypatch):
    monkeypatch.setenv("DOMAIN", "epic-stocks.example")
    _set_provider(admin, db_session, "Local clients", True)
    resp = admin.post("/oauth/register", json={
        "client_name": "Inspector", "redirect_uris": ["http://localhost:6274/oauth/callback"]})
    assert resp.status_code == 201, resp.text
