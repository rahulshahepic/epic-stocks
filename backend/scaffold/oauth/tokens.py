"""Minting and checking the credentials the authorization server hands out.

Three kinds, all short of a database secret:

  authorization code   random, stored as an HMAC verifier, single-use, 60s
  refresh token        random, stored as an HMAC verifier, rotated on use
  access token         a signed JWT carrying typ:"mcp" — see scaffold/auth.py
                       for why the type claim matters

The access token is the only stateless one, and even it is checked against its
grant row on every request so that disconnecting takes effect immediately.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from scaffold.auth import JWT_SECRET, TOKEN_TYPE_MCP, sign_jwt

_CODE_LABEL = b"epic-stocks/oauth-code"
_REFRESH_LABEL = b"epic-stocks/oauth-refresh"
_SECRET_LABEL = b"epic-stocks/oauth-client-secret"

AUTH_CODE_TTL = timedelta(seconds=60)
REFRESH_TTL = timedelta(days=90)


def access_token_ttl() -> timedelta:
    """Read at call time so a deployment can change it without a reimport."""
    return timedelta(minutes=int(os.getenv("MCP_ACCESS_TOKEN_MINUTES", "60")))


def _verifier(value: str, label: bytes) -> str:
    return hmac.new(JWT_SECRET.encode(), label + b"\x00" + value.encode(), hashlib.sha256).hexdigest()


def new_secret() -> str:
    return secrets.token_urlsafe(48)


def code_verifier(raw: str) -> str:
    return _verifier(raw, _CODE_LABEL)


def refresh_verifier(raw: str) -> str:
    return _verifier(raw, _REFRESH_LABEL)


def client_secret_verifier(raw: str) -> str:
    return _verifier(raw, _SECRET_LABEL)


def pkce_matches(code_challenge: str, code_verifier_value: str) -> bool:
    """S256 only. `plain` is a downgrade and is refused at the authorize step."""
    import base64

    digest = hashlib.sha256(code_verifier_value.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return hmac.compare_digest(expected, code_challenge)


def canonical_resource(request) -> str:
    """This server's RFC 8707 resource identifier — the URI tokens are bound to.

    DOMAIN wherever it is set, which is every real deployment, because deriving
    it from the request means deriving it from a Host header the caller
    controls. Falling back to the request's own base URL keeps local
    development and the test suite working, where there is no DOMAIN and no
    attacker to care about.
    """
    domain = os.getenv("DOMAIN")
    if domain:
        return f"https://{domain}/mcp"
    base = str(request.base_url).rstrip("/")
    return f"{base}/mcp"


def issuer(request) -> str:
    domain = os.getenv("DOMAIN")
    if domain:
        return f"https://{domain}"
    return str(request.base_url).rstrip("/")


def resource_matches(claimed: str | None, canonical: str) -> bool:
    """Whether a client's `resource` parameter names this server.

    The spec says clients should send the most specific URI they can and that
    implementations should be tolerant about case in scheme and host, and about
    a trailing slash. So compare on those terms rather than by string equality,
    and accept the bare origin as well as the full /mcp path — some clients
    send one, some the other.
    """
    if not claimed:
        return True  # absent is not wrong; the token is bound to canonical anyway

    def norm(value: str) -> tuple[str, str, str]:
        parsed = urlparse(value)
        return (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
        )

    want = norm(canonical)
    got = norm(claimed)
    if got == want:
        return True
    # Bare origin, no path.
    return got == (want[0], want[1], "")


def mint_access_token(*, grant_id: int, user_id: int, session_version: int,
                      scope: str, audience: str, client_id: str) -> tuple[str, int]:
    """Return (token, expires_in_seconds).

    `gid` is what makes revocation immediate; `aud` is what stops a token
    issued for another resource being replayed here.
    """
    ttl = access_token_ttl()
    now = datetime.now(timezone.utc)
    token = sign_jwt({
        "sub": str(user_id),
        "exp": int((now + ttl).timestamp()),
        "iat": int(now.timestamp()),
        "sv": int(session_version),
        "typ": TOKEN_TYPE_MCP,
        "aud": audience,
        "scope": scope,
        "gid": grant_id,
        "cid": client_id,
    })
    return token, int(ttl.total_seconds())
