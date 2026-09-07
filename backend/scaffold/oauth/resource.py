"""The resource-server half: accepting a connector token at /mcp.

The mirror of get_current_user, and deliberately not a variant of it. A session
token is refused here for the same reason a connector token is refused there —
they authorize different things, and a credential that works in both places
turns any leak of one into a leak of the other.

Beyond the type check this does what the spec requires of an OAuth 2.1 resource
server: the token must name this server in its audience (RFC 8707), and a 401
must point the client at the protected-resource metadata so it knows where to
go and get one.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import TOKEN_TYPE_MCP, decode_jwt, token_type
from scaffold.models import User
from .models import OAuthGrant
from .tokens import canonical_resource, issuer


@dataclass
class Connector:
    """Who is calling /mcp, on whose behalf, and what they may do."""

    user: User
    grant: OAuthGrant
    scopes: list[str]

    def require(self, scope: str) -> None:
        if scope not in self.scopes:
            raise HTTPException(
                status_code=403,
                detail=f"This connection was not granted the '{scope}' permission",
            )


def challenge_headers(request: Request) -> dict[str, str]:
    """RFC 9728 §5.1 — the 401 that tells a client where to get a token."""
    url = f"{issuer(request)}/.well-known/oauth-protected-resource"
    return {"WWW-Authenticate": f'Bearer resource_metadata="{url}"'}


def _unauthorized(request: Request, detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers=challenge_headers(request))


def require_connector(request: Request, db: Session = Depends(get_db)) -> Connector:
    header = request.headers.get("Authorization", "")
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise _unauthorized(request, "Not authenticated")

    try:
        payload = decode_jwt(credential.strip())
    except ValueError:
        raise _unauthorized(request, "Invalid token") from None

    # A session token is not a weaker connector token. It is the wrong kind.
    if token_type(payload) != TOKEN_TYPE_MCP:
        raise _unauthorized(request, "Invalid token")

    # Audience binding: a token minted for some other resource must not be
    # spendable here, even though this server signed it.
    if payload.get("aud") != canonical_resource(request):
        raise _unauthorized(request, "This token was not issued for this server")

    grant = db.get(OAuthGrant, int(payload.get("gid") or 0))
    if grant is None:
        # Disconnected. The row is the revocation.
        raise _unauthorized(request, "This connection has been disconnected")

    user = db.get(User, int(payload["sub"]))
    if user is None or grant.user_id != user.id:
        raise _unauthorized(request, "Invalid token")
    if int(payload.get("sv", 0)) != int(user.session_version):
        raise _unauthorized(request, "This connection was signed out")

    grant.last_used_at = datetime.now(timezone.utc)
    db.commit()

    # The scope on the grant row, not the one in the token: narrowing a
    # connection should take effect without waiting for the token to expire.
    return Connector(user=user, grant=grant, scopes=grant.scope.split())
