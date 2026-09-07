"""The authorization server, and the boundary it draws around connector tokens.

The tests that matter most here are the two directions of token separation: a
session token must be useless at /mcp, and a connector token must be useless
against /api/*. Everything else in this file guards the flow that issues them.
"""
import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from scaffold.models import User
from scaffold.oauth.models import OAuthAuthCode, OAuthGrant

REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"


def pkce_pair(verifier: str = "a" * 64) -> tuple[str, str]:
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def register_client(client, name="ChatGPT", uris=None, auth_method="none"):
    resp = client.post("/oauth/register", json={
        "client_name": name,
        "redirect_uris": uris or [REDIRECT],
        "token_endpoint_auth_method": auth_method,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def authorize(client, client_id, challenge, scope="equity:read comp:read",
              state="xyz", redirect_uri=REDIRECT, **extra):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    params.update(extra)
    return client.get("/oauth/authorize", params=params, follow_redirects=False)


def consent(client, page_html, decision="allow"):
    """Submit the consent form the way a browser would.

    Posts to the action the page actually declares rather than to a hardcoded
    path. The form had no action at all for a while, which means a browser
    posted it to whatever URL it was already on — /oauth/authorize/resume after
    a sign-in, which has no POST route — and Connect silently did nothing. A
    test that knew the right path could not see that.
    """
    action = page_html.split('<form method="post" action="')[1].split('"')[0]
    request_token = page_html.split('name="request" value="')[1].split('"')[0]
    csrf = page_html.split('name="csrf" value="')[1].split('"')[0]
    return client.post(action, data={
        "request": request_token, "csrf": csrf, "decision": decision,
    }, follow_redirects=False)


def code_from(resp) -> str:
    assert resp.status_code == 302, resp.text
    return parse_qs(urlparse(resp.headers["location"]).query)["code"][0]


def connect(client, scope="equity:read comp:read") -> dict:
    """Register, authorize, consent and exchange. Returns the token response."""
    reg = register_client(client)
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge, scope=scope)
    assert page.status_code == 200, page.text
    code = code_from(consent(client, page.text))
    resp = client.post("/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT,
        "client_id": reg["client_id"],
        "code_verifier": verifier,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── discovery ───────────────────────────────────────────────────────────────

def test_protected_resource_metadata_names_this_server(client):
    doc = client.get("/.well-known/oauth-protected-resource").json()
    assert doc["resource"].endswith("/mcp")
    assert doc["authorization_servers"]
    assert "equity:read" in doc["scopes_supported"]


def test_well_known_paths_are_json_not_the_spa_shell(client):
    """spa_fallback answers unmatched non-/api paths with index.html and a 200.

    These routes are not under /api/, so a registration that landed after the
    static mount would serve HTML here and an MCP client would fail obscurely.
    """
    for url in ("/.well-known/oauth-protected-resource",
                "/.well-known/oauth-protected-resource/mcp",
                "/.well-known/oauth-authorization-server"):
        resp = client.get(url)
        assert resp.status_code == 200, url
        assert resp.headers["content-type"].startswith("application/json"), url
        json.loads(resp.text)


def test_authorization_server_metadata_requires_s256(client):
    doc = client.get("/.well-known/oauth-authorization-server").json()
    assert doc["code_challenge_methods_supported"] == ["S256"]
    assert "authorization_code" in doc["grant_types_supported"]
    assert "refresh_token" in doc["grant_types_supported"]


# ── registration ────────────────────────────────────────────────────────────

def test_dynamic_registration_returns_a_public_client(client):
    reg = register_client(client)
    assert reg["client_id"]
    assert "client_secret" not in reg
    assert reg["token_endpoint_auth_method"] == "none"


def test_registration_issues_a_secret_when_one_is_asked_for(client):
    reg = register_client(client, auth_method="client_secret_post")
    assert reg["client_secret"]


def test_registration_refuses_an_unlisted_redirect_host(client):
    resp = client.post("/oauth/register", json={
        "client_name": "Evil",
        "redirect_uris": ["https://evil.example.com/callback"],
    })
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_client_metadata"


def test_registration_refuses_plain_http(client):
    resp = client.post("/oauth/register", json={
        "client_name": "Evil",
        "redirect_uris": ["http://chatgpt.com/callback"],
    })
    assert resp.status_code == 400


def test_registration_allowlist_is_not_relaxed_by_e2e_test(client):
    """E2E_TEST=1 is set for this whole suite.

    It already turns off redirect_uri validation for the OIDC login flow. An
    authorization server that inherited that would hand authorization codes to
    any address a caller named.
    """
    assert os.getenv("E2E_TEST") == "1"
    resp = client.post("/oauth/register", json={
        "client_name": "Evil", "redirect_uris": ["https://evil.example.com/cb"],
    })
    assert resp.status_code == 400


# ── authorize ───────────────────────────────────────────────────────────────

def test_authorize_shows_consent_to_a_signed_in_user(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = authorize(client, reg["client_id"], challenge)
    assert resp.status_code == 200
    assert "wants to connect" in resp.text
    assert "chatgpt.com" in resp.text
    assert "read-only" in resp.text


def test_authorize_sends_a_signed_out_user_to_login_and_back(client):
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = authorize(client, reg["client_id"], challenge)
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith("/login?next=")
    assert "%2Foauth%2Fauthorize%2Fresume" in location


def test_authorize_refuses_an_unregistered_redirect_uri_without_redirecting(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = authorize(client, reg["client_id"], challenge,
                     redirect_uri="https://chatgpt.com/somewhere-else")
    assert resp.status_code == 400
    assert "location" not in resp.headers


def test_authorize_refuses_an_unknown_client(client):
    register_user(client)
    _, challenge = pkce_pair()
    resp = authorize(client, "not-a-client", challenge)
    assert resp.status_code == 400
    assert "location" not in resp.headers


def test_authorize_rejects_pkce_downgrade_to_plain(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": reg["client_id"],
        "redirect_uri": REDIRECT, "state": "s",
        "code_challenge": challenge, "code_challenge_method": "plain",
    }, follow_redirects=False)
    assert resp.status_code == 302
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["error"] == ["invalid_request"]


def test_authorize_requires_pkce_at_all(client):
    register_user(client)
    reg = register_client(client)
    resp = client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": reg["client_id"],
        "redirect_uri": REDIRECT, "state": "s",
    }, follow_redirects=False)
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["error"] == ["invalid_request"]


def test_authorize_rejects_a_write_scope_that_does_not_exist_yet(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = authorize(client, reg["client_id"], challenge, scope="equity:write")
    assert resp.status_code == 302
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["error"] == ["invalid_scope"]


def test_authorize_rejects_a_resource_naming_another_server(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    resp = authorize(client, reg["client_id"], challenge,
                     resource="https://someone-else.example.com/mcp")
    assert resp.status_code == 302
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["error"] == ["invalid_target"]


def test_declining_returns_access_denied_and_mints_no_code(client, db_session):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    resp = consent(client, page.text, decision="deny")
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["error"] == ["access_denied"]
    assert db_session.query(OAuthAuthCode).count() == 0


def test_consent_post_requires_the_csrf_token(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    request_token = page.text.split('name="request" value="')[1].split('"')[0]
    resp = client.post("/oauth/authorize", data={
        "request": request_token, "csrf": "wrong", "decision": "allow",
    }, follow_redirects=False)
    assert resp.status_code == 400
    assert "location" not in resp.headers


def test_state_is_returned_unchanged(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge, state="opaque-value")
    resp = consent(client, page.text)
    query = parse_qs(urlparse(resp.headers["location"]).query)
    assert query["state"] == ["opaque-value"]


# ── token ───────────────────────────────────────────────────────────────────

def test_full_authorization_code_round_trip(client):
    register_user(client)
    tokens = connect(client)
    assert tokens["token_type"] == "Bearer"
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["scope"] == "equity:read comp:read"
    assert tokens["expires_in"] > 0


def test_an_authorization_code_cannot_be_used_twice(client):
    register_user(client)
    reg = register_client(client)
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))
    body = {
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    }
    assert client.post("/oauth/token", data=body).status_code == 200
    second = client.post("/oauth/token", data=body)
    assert second.status_code == 400
    assert second.json()["error"] == "invalid_grant"


def test_a_wrong_pkce_verifier_is_refused_and_spends_the_code(client):
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))
    resp = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": "b" * 64,
    })
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_grant"
    # A presented code is spent even when the rest of the request was wrong,
    # so a stolen code cannot be brute-forced against.
    verifier, _ = pkce_pair()
    again = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    })
    assert again.status_code == 400


def test_an_expired_code_is_refused(client, db_session):
    register_user(client)
    reg = register_client(client)
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))

    row = db_session.query(OAuthAuthCode).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db_session.commit()

    resp = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    })
    assert resp.status_code == 400
    assert "expired" in resp.json()["error_description"].lower()


def test_a_code_cannot_be_redeemed_by_another_client(client):
    register_user(client)
    reg = register_client(client)
    other = register_client(client, name="Someone else")
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))
    resp = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": other["client_id"],
        "code_verifier": verifier,
    })
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_grant"


def test_a_confidential_client_must_present_its_secret(client):
    register_user(client)
    reg = register_client(client, auth_method="client_secret_post")
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))
    body = {
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    }
    resp = client.post("/oauth/token", data=body)
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_client"


def test_refresh_rotates_and_kills_the_previous_token(client):
    register_user(client)
    tokens = connect(client)
    first = tokens["refresh_token"]

    refreshed = client.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": first,
    })
    assert refreshed.status_code == 200
    second = refreshed.json()["refresh_token"]
    assert second != first

    reused = client.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": first,
    })
    assert reused.status_code == 400
    assert reused.json()["error"] == "invalid_grant"


def test_unsupported_grant_type_is_a_clean_error(client):
    resp = client.post("/oauth/token", data={"grant_type": "password"})
    assert resp.status_code == 400
    assert resp.json()["error"] == "unsupported_grant_type"


def test_token_responses_are_not_cacheable(client):
    register_user(client)
    reg = register_client(client)
    verifier, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge)
    code = code_from(consent(client, page.text))
    resp = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    })
    assert resp.headers["cache-control"] == "no-store"


# ── revocation ──────────────────────────────────────────────────────────────

def test_revoke_disconnects_and_is_immediate(client, db_session):
    register_user(client)
    tokens = connect(client)
    assert db_session.query(OAuthGrant).count() == 1

    resp = client.post("/oauth/revoke", data={"token": tokens["refresh_token"]})
    assert resp.status_code == 200
    assert db_session.query(OAuthGrant).count() == 0

    mcp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert mcp.status_code == 401


def test_revoking_an_unknown_token_still_returns_200(client):
    assert client.post("/oauth/revoke", data={"token": "nope"}).status_code == 200


def test_disconnecting_from_settings_revokes_the_connection(client):
    register_user(client)
    tokens = connect(client)

    listed = client.get("/api/oauth/connections").json()
    assert len(listed) == 1
    assert listed[0]["client_name"] == "ChatGPT"
    assert listed[0]["scopes"] == ["equity:read", "comp:read"]

    assert client.delete(f"/api/oauth/connections/{listed[0]['id']}").status_code == 204
    assert client.get("/api/oauth/connections").json() == []

    mcp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert mcp.status_code == 401


def test_signing_out_everywhere_cuts_the_connector_loose(client, db_session):
    register_user(client)
    tokens = connect(client)

    assert client.post("/api/auth/logout-everywhere").status_code in (200, 204)

    mcp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert mcp.status_code == 401

    refreshed = client.post("/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
    })
    assert refreshed.status_code == 400
    assert db_session.query(OAuthGrant).count() == 0


def test_deleting_the_account_removes_its_connections(client, db_session):
    register_user(client)
    connect(client)
    assert db_session.query(OAuthGrant).count() == 1
    assert client.delete("/api/me").status_code == 204
    assert db_session.query(OAuthGrant).count() == 0


# ── the boundary, in both directions ────────────────────────────────────────

def test_a_session_token_is_refused_at_mcp(client, db_session):
    """The app's own session credential must not drive the connector."""
    register_user(client)
    from scaffold.auth import create_token
    user = db_session.query(User).one()
    session_token = create_token(user.id, int(user.session_version))

    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                       headers={"Authorization": f"Bearer {session_token}"})
    assert resp.status_code == 401
    assert "resource_metadata" in resp.headers.get("www-authenticate", "")


def test_a_connector_token_is_refused_by_the_app_api(client):
    """The reverse, and the one that would turn a leaked connector token into
    a full account session — admin endpoints included."""
    register_user(client)
    tokens = connect(client)

    fresh = client.__class__(client.app)  # no session cookie
    for path in ("/api/grants", "/api/me", "/api/prices", "/api/admin/stats"):
        resp = fresh.get(path, headers={"Authorization": f"Bearer {tokens['access_token']}"})
        assert resp.status_code == 401, f"{path} accepted a connector token"


def test_a_session_cookie_alone_does_not_reach_mcp(client):
    register_user(client)
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert resp.status_code == 401


def test_a_token_minted_for_another_audience_is_refused(client, db_session):
    """Audience binding. This server signed it, which is exactly why the check
    has to be on `aud` rather than on the signature."""
    register_user(client)
    connect(client)
    grant = db_session.query(OAuthGrant).one()
    user = db_session.query(User).one()
    from scaffold.oauth.tokens import mint_access_token
    foreign, _ = mint_access_token(
        grant_id=grant.id, user_id=user.id, session_version=int(user.session_version),
        scope=grant.scope, audience="https://someone-else.example.com/mcp",
        client_id=grant.client_id,
    )
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                       headers={"Authorization": f"Bearer {foreign}"})
    assert resp.status_code == 401


# ── the MCP transport ───────────────────────────────────────────────────────

def test_handshake_and_ping(client):
    register_user(client)
    tokens = connect(client)
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}

    init = client.post("/mcp", headers=auth, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "test", "version": "1"}},
    })
    assert init.status_code == 200
    result = init.json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["serverInfo"]["name"] == "epic-stocks"

    notified = client.post("/mcp", headers=auth, json={
        "jsonrpc": "2.0", "method": "notifications/initialized",
    })
    assert notified.status_code == 202

    pong = client.post("/mcp", headers=auth, json={"jsonrpc": "2.0", "id": 2, "method": "ping"})
    assert pong.json() == {"jsonrpc": "2.0", "id": 2, "result": {}}


def test_tools_list_is_scoped_to_the_grant(client):
    register_user(client)
    tokens = connect(client, scope="equity:read")
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                       headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert resp.status_code == 200
    listed = resp.json()["result"]["tools"]
    assert all(t["annotations"]["readOnlyHint"] for t in listed)


def test_get_on_mcp_is_405_not_an_sse_stream(client):
    assert client.get("/mcp").status_code == 405


@pytest.mark.parametrize("body", [
    "not json at all",
    '{"jsonrpc":"2.0"}',
    '[{"jsonrpc":"2.0","id":1,"method":"ping"}]',
    '"a bare string"',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope"}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"not an object"}',
    '{"jsonrpc":"2.0","id":1,"method":"no/such/method"}',
])
def test_a_malformed_request_is_an_error_object_never_a_500(client, body):
    """A 500 writes an error_logs row, and the nightly job trims that table to
    500 rows — a confused assistant must not be able to evict real tracebacks."""
    register_user(client)
    tokens = connect(client)
    resp = client.post("/mcp", content=body, headers={
        "Authorization": f"Bearer {tokens['access_token']}",
        "Content-Type": "application/json",
    })
    assert resp.status_code == 200
    assert "error" in resp.json() or resp.json()["result"].get("isError")


def test_the_encryption_key_is_in_context_for_a_connector_request(client, db_session):
    """The failure that only shows up in production.

    EncryptionMiddleware puts the per-user data key in the ASGI context by
    decoding the bearer token, and it has to recognise a connector token as
    well as a session one — otherwise every encrypted column read under /mcp
    fails closed on a deployment with KEY_ENCRYPTION_KEY set, which is every
    real one and none of the test ones unless it is asserted here.
    """
    from scaffold.crypto import encryption_enabled, get_current_key

    assert encryption_enabled(), "this test is meaningless without encryption on"

    register_user(client)
    tokens = connect(client)

    seen = {}
    import app.mcp.transport as transport
    original = transport._dispatch

    def _capture(method, params, request_id, connector):
        seen["key"] = get_current_key()
        seen["user"] = connector.user.email
        return original(method, params, request_id, connector)

    transport._dispatch = _capture
    try:
        resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                           headers={"Authorization": f"Bearer {tokens['access_token']}"})
    finally:
        transport._dispatch = original

    assert resp.status_code == 200
    assert seen["user"] == "test@example.com"
    assert seen["key"] is not None, (
        "no data key in context for a connector request — every encrypted "
        "column read under /mcp would fail closed in production"
    )


# ── the page a browser actually renders ─────────────────────────────────────

def test_the_consent_page_links_its_stylesheet_rather_than_inlining_it(client):
    """`style-src 'self'` blocks an inline <style>, and the page rendered as
    unstyled browser defaults on staging until this was a real file."""
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge).text

    assert '<link rel="stylesheet" href="/oauth/consent.css">' in page
    assert "<style" not in page, "an inline style block is blocked by the site CSP"


def test_the_stylesheet_is_served_as_css(client):
    resp = client.get("/oauth/consent.css")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/css")
    assert ".card" in resp.text


def test_the_form_posts_somewhere_that_accepts_a_post(client):
    """Without an explicit action a browser posts to the current URL, which
    after a sign-in is the resume path — GET only."""
    register_user(client)
    reg = register_client(client)
    _, challenge = pkce_pair()
    page = authorize(client, reg["client_id"], challenge).text

    action = page.split('<form method="post" action="')[1].split('"')[0]
    assert action == "/oauth/authorize"


def test_the_whole_flow_works_when_the_user_has_to_sign_in_first(client, db_session):
    """The path a real user takes: an assistant sends them to /oauth/authorize
    with no session, they sign in, and they come back to approve.

    This is the one that was broken — the consent form posted to the resume URL
    and got a 405, so Connect appeared to do nothing.
    """
    from urllib.parse import parse_qs, unquote, urlparse

    reg = register_client(client)
    verifier, challenge = pkce_pair()

    bounced = authorize(client, reg["client_id"], challenge)
    assert bounced.status_code == 302
    resume = unquote(bounced.headers["location"].split("next=", 1)[1])
    assert resume.startswith("/oauth/authorize/resume?request=")

    register_user(client)

    page = client.get(resume)
    assert page.status_code == 200
    assert "wants to connect" in page.text

    redirected = consent(client, page.text)
    assert redirected.status_code == 302, redirected.text
    code = parse_qs(urlparse(redirected.headers["location"]).query)["code"][0]

    tokens = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": REDIRECT, "client_id": reg["client_id"],
        "code_verifier": verifier,
    })
    assert tokens.status_code == 200, tokens.text
    assert tokens.json()["access_token"]
