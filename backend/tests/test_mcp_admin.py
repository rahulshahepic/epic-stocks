"""Admin diagnostics require separate consent and the current site-admin role."""
import json
import os
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from scaffold.models import ErrorLog, SystemMetric
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp
from tests.test_oauth_server import code_from, pkce_pair


ADMIN_TOOLS = {"admin_deployment_status", "admin_system_metrics", "admin_recent_errors", "admin_error_stack"}


def test_admin_oauth_login_resumes_on_its_own_consent_page(client):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        reg = client.post("/admin-oauth/register", json={
            "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
        }).json()
        _, challenge = pkce_pair()
        login = client.get("/admin-oauth/authorize", params={
            "response_type": "code", "client_id": reg["client_id"],
            "code_challenge": challenge, "code_challenge_method": "S256",
        }, follow_redirects=False)
        assert login.status_code == 302
        resume = parse_qs(urlparse(login.headers["location"]).query)["next"][0]
        assert resume.startswith("/admin-oauth/authorize/resume?")
        register_user(client, "admin@example.com")
        page = client.get(resume)
        assert 'action="/admin-oauth/authorize"' in page.text
        assert "Read site deployment status" in page.text


def _connect_admin(client):
    reg = client.post("/admin-oauth/register", json={
        "client_name": "ChatGPT diagnostics", "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
    }).json()
    verifier, challenge = pkce_pair()
    page = client.get("/admin-oauth/authorize", params={
        "response_type": "code", "client_id": reg["client_id"],
        "redirect_uri": "https://chatgpt.com/connector_platform_oauth_redirect",
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    assert page.status_code == 200, page.text
    assert "Read site deployment status" in page.text
    assert "equity" not in page.text.lower()
    action = page.text.split('<form method="post" action="')[1].split('"')[0]
    token = page.text.split('name="request" value="')[1].split('"')[0]
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    code = code_from(client.post(action, data={
        "request": token, "csrf": csrf, "decision": "allow",
    }, follow_redirects=False))
    response = client.post("/admin-oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "client_id": reg["client_id"], "code_verifier": verifier,
    })
    assert response.status_code == 200, response.text
    return response.json()


def _rpc(client, token, method, params=None):
    response = client.post("/admin-mcp", headers={"Authorization": f"Bearer {token}"}, json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {},
    })
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_separate_discovery_consent_and_token_boundaries(client):
    data = client.get("/.well-known/oauth-protected-resource/mcp").json()
    admin = client.get("/.well-known/oauth-protected-resource/admin-mcp").json()
    assert data["scopes_supported"] and "admin:read" not in data["scopes_supported"]
    assert admin["scopes_supported"] == ["admin:read"]
    assert admin["resource"].endswith("/admin-mcp")
    challenge = client.post("/admin-mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "ping",
    })
    assert challenge.status_code == 401
    assert "oauth-protected-resource/admin-mcp" in challenge.headers["WWW-Authenticate"]
    metadata = client.get("/.well-known/oauth-authorization-server/admin-oauth").json()
    assert metadata["issuer"].endswith("/admin-oauth")
    assert metadata["authorization_endpoint"].endswith("/admin-oauth/authorize")
    register_user(client)
    nonadmin_reg = client.post("/admin-oauth/register", json={
        "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
    }).json()
    _, nonadmin_challenge = pkce_pair()
    nonadmin_auth = client.get("/admin-oauth/authorize", params={
        "response_type": "code", "client_id": nonadmin_reg["client_id"],
        "code_challenge": nonadmin_challenge, "code_challenge_method": "S256",
    }, follow_redirects=False)
    assert "access_denied" in nonadmin_auth.headers["location"]
    ordinary = Mcp(client, scope="equity:read")
    assert not ADMIN_TOOLS.intersection(t["name"] for t in ordinary.list_tools())
    assert client.post("/admin-mcp", headers=ordinary.auth, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/list",
    }).status_code == 401
    assert client.post("/oauth/register", json={
        "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
        "scope": "admin:read",
    }).json()["error"] == "invalid_scope"
    assert client.post("/admin-oauth/register", json={
        "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
        "scope": "equity:read",
    }).json()["error"] == "invalid_scope"
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
        tokens = _connect_admin(client)
        assert tokens["scope"] == "admin:read"
        refresh = client.post("/oauth/token", data={
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
        })
        assert refresh.json()["error"] == "invalid_grant"
        rotated = client.post("/admin-oauth/token", data={
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
        })
        assert rotated.status_code == 200
        tokens = rotated.json()
        assert client.post("/mcp", headers={"Authorization": f"Bearer {tokens['access_token']}"}, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/list",
        }).status_code == 401
        assert not ADMIN_TOOLS.intersection(t["name"] for t in ordinary.list_tools())
        response = client.post("/admin-mcp", headers={"Authorization": f"Bearer {tokens['access_token']}"}, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "get_dashboard", "arguments": {}},
        })
        assert "Unknown tool" in response.json()["error"]["message"]
        assert _rpc(client, tokens["access_token"], "resources/list")["resources"] == []
        assert client.post("/oauth/revoke", data={"token": tokens["refresh_token"]}).status_code == 200
        assert _rpc(client, tokens["access_token"], "ping") == {}
        assert client.post("/admin-oauth/revoke", data={"token": tokens["refresh_token"]}).status_code == 200
        assert client.post("/admin-mcp", headers={
            "Authorization": f"Bearer {tokens['access_token']}",
        }, json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401


def test_admin_tools_redact_exception_content_and_report_utc_context(client, db_session):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com", "APP_ENV": "staging",
                              "COMMIT_SHA": "abcd1234"}):
        register_user(client, "admin@example.com")
        tokens = _connect_admin(client)
        assert tokens["scope"] == "admin:read"
        names = {t["name"] for t in _rpc(client, tokens["access_token"], "tools/list")["tools"]}
        assert names == ADMIN_TOOLS
        assert "Read-only site diagnostics" in _rpc(
            client, tokens["access_token"], "initialize")["instructions"]

        db_session.add(ErrorLog(timestamp=datetime.now(timezone.utc), method="POST",
                                path="/api/users/secret@example.com", error_type="ValueError",
                                error_message="private-message",
                                traceback=('Traceback:\n  File "/app/backend/main.py", line 42, in handle\n'
                                           '    private-source\n  File "/usr/local/lib/site-packages/sqlalchemy/engine.py", '
                                           'line 5, in execute\nValueError: private-traceback'),
                                error_ref="ref123", user_id=27))
        db_session.add(SystemMetric(timestamp=datetime.now(timezone.utc), cpu_percent=4,
                                    ram_used_mb=100, ram_total_mb=200, db_size_bytes=1000,
                                    error_log_count=1))
        db_session.commit()

        errors = _rpc(client, tokens["access_token"], "tools/call", {
            "name": "admin_recent_errors", "arguments": {"limit": 10},
        })
        payload = json.loads(errors["content"][0]["text"])
        assert payload["environment"] == "staging"
        assert payload["api_build"] == "abcd1234"
        assert payload["records"][0]["error_ref"] == "ref123"
        assert not any(s in json.dumps(payload) for s in
                       ("private-message", "private-traceback", "secret@example.com"))
        assert "user_id" not in payload["records"][0]
        stack = _rpc(client, tokens["access_token"], "tools/call", {
            "name": "admin_error_stack", "arguments": {"error_id": payload["records"][0]["id"]},
        })
        stack_payload = json.loads(stack["content"][0]["text"])
        assert stack_payload["frames"] == [{"file": "main.py", "line": 42, "function": "handle"}]
        assert "private" not in json.dumps(stack_payload)

        metrics = _rpc(client, tokens["access_token"], "tools/call", {
            "name": "admin_system_metrics", "arguments": {"hours": 1},
        })
        assert json.loads(metrics["content"][0]["text"])["samples"][0]["cpu_percent"] == 4
        deployment = _rpc(client, tokens["access_token"], "tools/call", {
            "name": "admin_deployment_status", "arguments": {},
        })
        assert json.loads(deployment["content"][0]["text"])["scheduler"]["environment"] == "staging"


def test_admin_access_revocation_hides_tools_and_denies_direct_calls(client):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
        tokens = _connect_admin(client)
    names = {t["name"] for t in _rpc(client, tokens["access_token"], "tools/list")["tools"]}
    assert not ADMIN_TOOLS.intersection(names)
    denied = _rpc(client, tokens["access_token"], "tools/call", {
        "name": "admin_recent_errors", "arguments": {},
    })
    assert denied["isError"] is True
    assert "revoked" in denied["content"][0]["text"]


def test_admin_tool_bounds_reject_invalid_arguments(client):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
        tokens = _connect_admin(client)
        for name, args in (("admin_recent_errors", {"limit": 500}),
                           ("admin_system_metrics", {"hours": True})):
            result = _rpc(client, tokens["access_token"], "tools/call", {
                "name": name, "arguments": args,
            })
            assert result["isError"] is True
