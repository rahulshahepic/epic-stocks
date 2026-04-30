"""Tests for sliding-session refresh and 'sign out everywhere' revocation."""
import sys
import os
import time
import json
import base64

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from scaffold.models import User


def _decode_payload(token: str) -> dict:
    parts = token.split(".")
    pad = 4 - len(parts[1]) % 4
    return json.loads(base64.urlsafe_b64decode(parts[1] + "=" * pad))


# ── /api/auth/refresh ───────────────────────────────────────────────────────


def test_refresh_issues_new_cookie_with_extended_exp(client):
    register_user(client)
    old_token = client.cookies.get("session")
    old_exp = _decode_payload(old_token)["exp"]
    # Clocks have second-level resolution; sleep so the new exp is strictly larger.
    time.sleep(1.1)
    resp = client.post("/api/auth/refresh")
    assert resp.status_code == 200
    new_token = client.cookies.get("session")
    assert new_token != old_token
    new_exp = _decode_payload(new_token)["exp"]
    assert new_exp > old_exp


def test_refresh_rejected_without_session(client):
    resp = client.post("/api/auth/refresh")
    assert resp.status_code == 401


def test_refresh_rejected_with_expired_token(client):
    register_user(client)
    # Forge an expired token signed by the same secret to exercise the expiry path.
    from scaffold.auth import _b64url_encode, JWT_SECRET
    import hmac
    import hashlib
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({"sub": "1", "exp": int(time.time()) - 60, "sv": 0}).encode())
    sig = _b64url_encode(hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    bad = f"{header}.{payload}.{sig}"
    resp = client.post("/api/auth/refresh", cookies={"session": bad})
    assert resp.status_code == 401


# ── /api/auth/logout-everywhere ─────────────────────────────────────────────


def test_logout_everywhere_revokes_other_sessions(client, make_client):
    """Two sessions for the same user; sign out everywhere from one invalidates both."""
    register_user(client, email="user@test.com")
    with make_client("user@test.com") as other:
        # Both sessions are valid initially.
        assert client.get("/api/me").status_code == 200
        assert other.get("/api/me").status_code == 200

        # Sign out everywhere from `client`.
        resp = client.post("/api/auth/logout-everywhere")
        assert resp.status_code == 200

        # Both clients now hold revoked tokens.
        # `client` had its cookie cleared explicitly:
        assert client.get("/api/me").status_code == 401
        # `other` still carries the old token but it now fails the sv check:
        assert other.get("/api/me").status_code == 401


def test_logout_everywhere_bumps_session_version(client, db_session):
    register_user(client, email="bump@test.com")
    user = db_session.query(User).filter_by(email="bump@test.com").first()
    initial_sv = user.session_version
    resp = client.post("/api/auth/logout-everywhere")
    assert resp.status_code == 200
    db_session.refresh(user)
    assert user.session_version == initial_sv + 1


def test_login_after_revocation_works(client, make_client):
    """After 'sign out everywhere', logging in fresh issues a token with the new sv."""
    register_user(client, email="relogin@test.com")
    client.post("/api/auth/logout-everywhere")
    # Re-login via test-login (mirrors a real OIDC callback flow).
    with make_client("relogin@test.com") as fresh:
        assert fresh.get("/api/me").status_code == 200


# ── sv claim tampering ──────────────────────────────────────────────────────


def test_token_with_wrong_sv_rejected(client):
    """A signed token with a stale sv must be rejected."""
    register_user(client, email="sv@test.com")
    from scaffold.auth import create_token
    # Forge a properly-signed token with sv=999 (not the user's current sv=0).
    bad = create_token(1, session_version=999)
    resp = client.get("/api/me", cookies={"session": bad})
    assert resp.status_code == 401
