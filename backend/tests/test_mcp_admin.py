"""Admin diagnostics require separate consent and the current site-admin role."""
import json
import os
from datetime import datetime, timezone
from unittest.mock import patch

from scaffold.models import ErrorLog, SystemMetric
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp
from tests.test_oauth_server import authorize, code_from, pkce_pair, register_client


ADMIN_TOOLS = {"admin_deployment_status", "admin_system_metrics", "admin_recent_errors", "admin_error_stack"}


def _connect_with_checkbox(client):
    reg = register_client(client)
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge, scope="")
    assert page.status_code == 200
    assert 'value="admin">Connect diagnostics only' in page.text
    action = page.text.split('<form method="post" action="')[1].split('"')[0]
    token = page.text.split('name="request" value="')[1].split('"')[0]
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    code = code_from(client.post(action, data={
        "request": token, "csrf": csrf, "decision": "admin",
    }, follow_redirects=False))
    response = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "client_id": reg["client_id"], "code_verifier": verifier,
    })
    assert response.status_code == 200, response.text
    return response.json()


def _rpc(client, token, method, params=None):
    response = client.post("/mcp", headers={"Authorization": f"Bearer {token}"}, json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {},
    })
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_admin_consent_is_opt_in_and_nonadmins_cannot_request_it(client):
    register_user(client)
    ordinary = Mcp(client, scope="equity:read")
    assert not ADMIN_TOOLS.intersection(t["name"] for t in ordinary.list_tools())
    reg = register_client(client)
    _, challenge = pkce_pair()
    response = authorize(client, reg["client_id"], challenge, scope="admin:read")
    assert "access_denied" in response.headers["location"]

    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
        reg = register_client(client)
        _, challenge = pkce_pair()
        page = authorize(client, reg["client_id"], challenge, scope="")
        assert 'value="admin">Connect diagnostics only' in page.text
        assert not ADMIN_TOOLS.intersection(t["name"] for t in Mcp(client, scope="equity:read").list_tools())

        # A client that explicitly requested only equity:read cannot gain an
        # additional scope by forging an unchecked form field.
        explicit = authorize(client, reg["client_id"], challenge, scope="equity:read")
        assert 'value="admin">Connect diagnostics only' not in explicit.text
        action = explicit.text.split('<form method="post" action="')[1].split('"')[0]
        request_token = explicit.text.split('name="request" value="')[1].split('"')[0]
        csrf = explicit.text.split('name="csrf" value="')[1].split('"')[0]
        denied = client.post(action, data={
            "request": request_token, "csrf": csrf, "decision": "admin",
        }, follow_redirects=False)
        assert "invalid_scope" in denied.headers["location"]


def test_admin_tools_redact_exception_content_and_report_utc_context(client, db_session):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com", "APP_ENV": "staging",
                              "COMMIT_SHA": "abcd1234"}):
        register_user(client, "admin@example.com")
        tokens = _connect_with_checkbox(client)
        assert tokens["scope"] == "admin:read"
        names = {t["name"] for t in _rpc(client, tokens["access_token"], "tools/list")["tools"]}
        assert names == ADMIN_TOOLS

        db_session.add(ErrorLog(timestamp=datetime.now(timezone.utc), method="POST",
                                path="/api/users/secret@example.com", error_type="ValueError",
                                error_message="private-message",
                                traceback='Traceback:\n  File "/app/backend/main.py", line 42, in handle\n    private-source\nValueError: private-traceback',
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
        tokens = _connect_with_checkbox(client)
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
        tokens = _connect_with_checkbox(client)
        for name, args in (("admin_recent_errors", {"limit": 500}),
                           ("admin_system_metrics", {"hours": True})):
            result = _rpc(client, tokens["access_token"], "tools/call", {
                "name": name, "arguments": args,
            })
            assert result["isError"] is True
