import os
import hmac
import hashlib
import json
import base64
import time
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User
from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key

_JWT_SECRET_DEFAULT = "dev-secret-change-me"
_is_test_env = os.getenv("E2E_TEST") == "1"

# E2E_TEST is the master switch for "this is not a real deployment": it turns
# off every rate limit, skips redirect_uri validation, drops the SSRF checks on
# push endpoints, accepts a default JWT secret, and registers /api/auth/test-login,
# which mints a session for any address asked for. Only that last one checked
# whether it was running somewhere real. Set alongside a domain it is a full
# authentication bypass, so refuse to start rather than serve one.
if _is_test_env and (os.getenv("DOMAIN") or os.getenv("APP_ENV") == "production"):
    raise RuntimeError(
        "E2E_TEST=1 disables authentication, rate limiting and SSRF checks, and "
        "must never be set on a deployment with DOMAIN or APP_ENV=production set. "
        "Unset E2E_TEST."
    )

JWT_SECRET = os.getenv("JWT_SECRET", _JWT_SECRET_DEFAULT if _is_test_env else "")
if not _is_test_env:
    if not JWT_SECRET or JWT_SECRET == _JWT_SECRET_DEFAULT or len(JWT_SECRET) < 32:
        raise RuntimeError(
            "JWT_SECRET must be set to a cryptographically random value of at least "
            "32 characters. Generate one with: openssl rand -hex 32"
        )

# 30 days sliding window — long enough for installed PWAs to stay signed in.
# Server-set HttpOnly cookies are not subject to iOS Safari's 7-day cap.
JWT_EXPIRE_HOURS = 24 * 30
COOKIE_MAX_AGE = JWT_EXPIRE_HOURS * 3600
# Absolute ceiling regardless of sliding refreshes (90 days).
ABSOLUTE_SESSION_HOURS = 24 * 90


def get_admin_emails() -> set[str]:
    """Parse ADMIN_EMAIL env var (semicolon-delimited) into a set of lowercase emails."""
    raw = os.getenv("ADMIN_EMAIL", "")
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(";") if e.strip()}


def cookie_secure() -> bool:
    """True when running behind HTTPS (production with DOMAIN set)."""
    return bool(os.getenv("DOMAIN"))


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


# What a token is *for*. A session token drives the app; a connector token
# drives the MCP server on behalf of an AI assistant the user has authorized.
# The two must never substitute for each other: a connector token that worked
# against /api/* would turn one leaked assistant credential into a full account
# session, admin endpoints included. Enforced in both directions —
# get_current_user below rejects anything that is not a session token, and the
# MCP dependency rejects anything that is not a connector token.
#
# Session tokens minted before this claim existed carry no "typ" at all, so
# absent reads as SESSION and nobody is signed out by the upgrade.
TOKEN_TYPE_SESSION = "session"
TOKEN_TYPE_MCP = "mcp"


def sign_jwt(payload: dict) -> str:
    """Sign a payload with the app's HMAC secret. No opinion about its claims."""
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    sig_input = f"{header}.{body}".encode()
    signature = _b64url_encode(hmac.new(JWT_SECRET.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{body}.{signature}"


def create_token(user_id: int, session_version: int = 0, siat: int | None = None) -> str:
    """Mint a signed session JWT.

    siat (session-issued-at) is set on first login and carried forward unchanged
    on every sliding refresh, enforcing an absolute session ceiling.
    """
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=JWT_EXPIRE_HOURS)
    return sign_jwt({
        "sub": str(user_id),
        "exp": int(exp.timestamp()),
        "sv": int(session_version),
        "siat": siat if siat is not None else int(now.timestamp()),
        "typ": TOKEN_TYPE_SESSION,
    })


def decode_jwt(token: str) -> dict:
    """Verify signature and expiry. Says nothing about what the token is for.

    Callers that act on a token MUST check its "typ" — see token_type(). This
    is the raw form because the middleware needs the subject of *either* kind
    to put the right encryption key in context.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("bad token")
    sig_input = f"{parts[0]}.{parts[1]}".encode()
    expected = hmac.new(JWT_SECRET.encode(), sig_input, hashlib.sha256).digest()
    actual = _b64url_decode(parts[2])
    if not hmac.compare_digest(expected, actual):
        raise ValueError("bad signature")
    payload = json.loads(_b64url_decode(parts[1]))
    if payload.get("exp", 0) < time.time():
        raise ValueError("expired")
    return payload


def token_type(payload: dict) -> str:
    """The token's purpose, treating a missing claim as a session token."""
    return payload.get("typ") or TOKEN_TYPE_SESSION


# Retained under its old name: main.py's middleware imports it, and there it
# genuinely wants either kind.
_decode_token = decode_jwt


def set_session_cookies(response, token: str) -> None:
    """Set the HttpOnly session cookie and a non-HttpOnly auth hint readable by JS."""
    secure = cookie_secure()
    response.set_cookie(
        key="session",
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key="auth_hint",
        value="1",
        max_age=COOKIE_MAX_AGE,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response) -> None:
    """Clear both auth cookies."""
    response.delete_cookie(key="session", path="/", httponly=True, samesite="lax")
    response.delete_cookie(key="auth_hint", path="/", httponly=False, samesite="lax")


def _token_from_request(request: Request) -> str | None:
    """Extract the JWT from the session cookie, or an Authorization: Bearer header.

    The cookie is the web path and keeps precedence: it is HttpOnly, so script
    on the page cannot read it, which is the stronger option wherever cookies
    work at all. A native shell cannot use it — its WebView origin is not the
    server's, so the cookie is never attached — and presents a Bearer token
    instead. The browser never sends that header, so this does not change any
    existing request.
    """
    cookie_token = request.cookies.get("session")
    if cookie_token:
        return cookie_token

    header = request.headers.get("Authorization", "")
    scheme, _, credential = header.partition(" ")
    if scheme.lower() == "bearer" and credential.strip():
        return credential.strip()

    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_jwt(token)
        user_id = int(payload["sub"])
        token_sv = int(payload.get("sv", 0))
        siat = int(payload.get("siat", 0))
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from None
    # A connector token authorizes an AI assistant against /mcp and nothing
    # else. Presented here it is not a weaker session, it is the wrong
    # credential entirely.
    if token_type(payload) != TOKEN_TYPE_SESSION:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if siat and time.time() - siat > ABSOLUTE_SESSION_HOURS * 3600:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired — please log in again")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # "Sign out everywhere" bumps session_version, invalidating older tokens.
    if token_sv != int(user.session_version):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
    # Refresh admin flag on every request so env changes take effect immediately
    is_admin = user.email.lower() in get_admin_emails()
    if bool(user.is_admin) != is_admin:
        user.is_admin = is_admin
        db.commit()
    if encryption_enabled() and user.encrypted_key:
        set_current_key(decrypt_user_key(user.encrypted_key))
    else:
        set_current_key(None)
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    """Verify the authenticated user has the is_admin flag (set on login from ADMIN_EMAIL)."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def get_content_admin_user(user: User = Depends(get_current_user)) -> User:
    """Admins and users with is_content_admin=1 can edit grant-program content."""
    if not (user.is_admin or user.is_content_admin):
        raise HTTPException(status_code=403, detail="Content admin access required")
    return user
