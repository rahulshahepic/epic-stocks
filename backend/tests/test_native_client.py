"""Support for a cookie-less client (a native shell) calling this API.

A native app loads its bundle from the WebView's own origin, not from this
server, so its requests are cross-origin and carry no session cookie. That
needs three things the browser path never did: a Bearer credential, CORS, and
a way to obtain the token in the first place.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException

import main
from main import NATIVE_APP_ORIGINS, spa_fallback
from tests.conftest import register_user


def _login_and_take_token(client) -> str:
    """Authenticate, then strip the cookie so only the Bearer token remains."""
    register_user(client)
    token = client.cookies.get("session")
    assert token
    client.cookies.clear()
    return token


# ── Bearer authentication ───────────────────────────────────────────────────


def test_bearer_token_authenticates_without_a_cookie(client):
    token = _login_and_take_token(client)

    resp = client.get("/api/grants", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json() == []


def test_no_cookie_and_no_header_is_unauthorized(client):
    _login_and_take_token(client)

    assert client.get("/api/grants").status_code == 401


def test_bearer_scheme_is_case_insensitive(client):
    token = _login_and_take_token(client)

    resp = client.get("/api/grants", headers={"Authorization": f"bearer {token}"})

    assert resp.status_code == 200


@pytest.mark.parametrize("header", [
    "Bearer",
    "Bearer ",
    "Basic c2VjcmV0",
    "Bearer not-a-jwt",
    "Bearer a.b.c",
    "",
])
def test_malformed_or_bogus_authorization_is_rejected(client, header):
    _login_and_take_token(client)

    resp = client.get("/api/grants", headers={"Authorization": header})

    assert resp.status_code == 401


def test_cookie_still_works_and_takes_precedence(client):
    """The web path is unchanged, and a cookie is never overridden by a header."""
    register_user(client)
    assert client.get("/api/grants").status_code == 200

    # A valid Bearer alongside a junk cookie must not rescue the request:
    # the cookie is what the server reads.
    good_token = client.cookies.get("session")
    client.cookies.set("session", "tampered.token.value")
    resp = client.get("/api/grants", headers={"Authorization": f"Bearer {good_token}"})
    assert resp.status_code == 401


def test_bearer_token_is_revoked_by_sign_out_everywhere(client):
    """Bearer tokens honour session_version, so revocation is not cookie-only."""
    token = _login_and_take_token(client)
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/grants", headers=auth).status_code == 200

    resp = client.post("/api/auth/logout-everywhere", headers=auth)
    assert resp.status_code == 200

    assert client.get("/api/grants", headers=auth).status_code == 401


def test_bearer_token_is_rejected_after_the_user_is_deleted(client):
    token = _login_and_take_token(client)
    auth = {"Authorization": f"Bearer {token}"}

    assert client.delete("/api/me", headers=auth).status_code == 204
    assert client.get("/api/grants", headers=auth).status_code == 401


def test_bearer_token_scopes_data_to_its_own_user(client):
    """A token authenticates one user, not merely 'someone'."""
    token = _login_and_take_token(client)
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


# ── CORS ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("origin", NATIVE_APP_ORIGINS)
def test_preflight_allowed_from_native_origins(client, origin):
    resp = client.options("/api/grants", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    })

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == origin


def test_native_origins_are_the_two_capacitor_schemes():
    """Pinned so a change to capacitor.config.ts has to be mirrored here."""
    assert NATIVE_APP_ORIGINS == ["capacitor://localhost", "https://localhost"]


@pytest.mark.parametrize("origin", [
    "https://evil.example.com",
    "http://localhost",           # scheme matters: only https is allowed
    "capacitor://evil",
    "null",
])
def test_preflight_refused_from_unknown_origins(client, origin):
    resp = client.options("/api/grants", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
    })

    assert "access-control-allow-origin" not in resp.headers


def test_actual_request_from_unknown_origin_gets_no_cors_header(client):
    """Without the header the browser withholds the response from the caller."""
    token = _login_and_take_token(client)

    resp = client.get("/api/grants", headers={
        "Origin": "https://evil.example.com",
        "Authorization": f"Bearer {token}",
    })

    assert "access-control-allow-origin" not in resp.headers


def test_credentials_are_not_allowed_cross_origin(client):
    """Native auth is Bearer-only, so cookies must never ride a CORS request."""
    resp = client.options("/api/grants", headers={
        "Origin": "capacitor://localhost",
        "Access-Control-Request-Method": "GET",
    })

    assert "access-control-allow-credentials" not in resp.headers


def test_cors_headers_survive_the_maintenance_guard(client, monkeypatch):
    """CORS sits outermost, so a native client sees the real status, not a
    CORS failure, while maintenance is on."""
    from scaffold import maintenance
    monkeypatch.setattr(maintenance, "is_maintenance_active", lambda: True)

    token = _login_and_take_token(client)
    resp = client.get("/api/grants", headers={
        "Origin": "capacitor://localhost",
        "Authorization": f"Bearer {token}",
    })

    assert resp.status_code == 503
    assert resp.headers["access-control-allow-origin"] == "capacitor://localhost"


# ── Obtaining the token ─────────────────────────────────────────────────────


class _StubProvider:
    """Stands in for a real IdP exchange."""

    def exchange_code(self, code, code_verifier, redirect_uri):
        from scaffold.providers.auth.base import UserIdentity
        return UserIdentity(
            provider_name="google",
            provider_sub="sub-123",
            email="native@example.com",
            email_verified=True,
            name="Native User",
            picture=None,
        )


@pytest.fixture()
def stub_provider(monkeypatch):
    # auth_callback imports get_provider inside the function body, so patching
    # the module attribute is what the call actually resolves.
    monkeypatch.setattr(
        "scaffold.providers.auth.get_provider", lambda name: _StubProvider()
    )


def _callback(client, **extra):
    body = {
        "provider": "google",
        "code": "auth-code",
        "code_verifier": "verifier",
        "redirect_uri": "https://app.test/auth/callback",
    }
    body.update(extra)
    return client.post("/api/auth/callback", json=body)


def test_callback_withholds_the_token_by_default(client, stub_provider):
    """The web app has the HttpOnly cookie and must not be handed a readable
    copy of the same credential."""
    resp = _callback(client)

    assert resp.status_code == 200
    assert "access_token" not in resp.json()
    assert client.cookies.get("session")


def test_callback_returns_the_token_when_asked(client, stub_provider):
    resp = _callback(client, return_token=True)

    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert token

    # The returned token is a working credential on its own.
    client.cookies.clear()
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_returned_token_belongs_to_the_authenticated_user(client, stub_provider):
    token = _callback(client, return_token=True).json()["access_token"]

    client.cookies.clear()
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.json()["email"] == "native@example.com"


# ── Unknown /api paths ──────────────────────────────────────────────────────


@pytest.mark.parametrize("path", ["api/nope", "api/grants/typo", "api/"])
def test_spa_fallback_404s_unknown_api_paths(path):
    """Serving index.html here would answer a mistyped endpoint with 200 HTML."""
    with pytest.raises(HTTPException) as exc:
        spa_fallback(path)

    assert exc.value.status_code == 404


@pytest.mark.parametrize("path", ["dashboard", "settings", "", "apidocs"])
def test_spa_fallback_still_serves_client_routes(path, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)
    monkeypatch.setattr(main, "_STATIC_ROOT", tmp_path.resolve())
    (tmp_path / "index.html").write_text("<!doctype html>")

    resp = spa_fallback(path)

    assert resp.path == tmp_path / "index.html"


def test_unknown_api_route_is_404_over_http(client):
    """Belt and braces: no router matches, so FastAPI 404s regardless."""
    assert client.get("/api/definitely-not-a-route").status_code == 404
