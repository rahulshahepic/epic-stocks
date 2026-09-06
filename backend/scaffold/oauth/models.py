"""The three tables the authorization server needs.

Secrets are never stored in a usable form, following the invitation-token rule:
`oauth_auth_codes.code`, `oauth_grants.refresh_token` and
`oauth_clients.client_secret` hold HMAC verifiers, so a database read yields
nothing redeemable. Lookup hashes what the caller presents and compares — still
a single indexed equality match.

oauth_clients has no user_id on purpose: dynamic client registration happens
before anyone signs in, so a client row belongs to nobody. Grants and codes do
belong to a user, and are listed in USER_OWNED_TABLES.

oauth_redirect_hosts is admin policy, not user data: which AI providers may
connect to this deployment at all.
"""
from datetime import datetime, timezone

from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OAuthClient(Base):
    """An AI client that registered itself, or was registered by hand."""

    __tablename__ = "oauth_clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    # HMAC verifier, or NULL for a public client authenticating with PKCE alone
    # — which is what ChatGPT and Claude use.
    client_secret: Mapped[str | None] = mapped_column(String, nullable=True)
    client_name: Mapped[str] = mapped_column(String, nullable=False)
    # JSON arrays, stored as text: these are read whole and never queried into.
    redirect_uris: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OAuthAuthCode(Base):
    """A redeemable authorization code. Single-use, and short-lived."""

    __tablename__ = "oauth_auth_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    redirect_uri: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String, nullable=False)
    # The RFC 8707 resource the client asked the token be bound to, when it
    # sent one. Carried through so the token's audience matches what was
    # authorized rather than whatever the token request claims.
    resource: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class OAuthGrant(Base):
    """A live connection: this user has authorized this client, at this scope.

    Access tokens carry the row id, and every /mcp request loads it. That costs
    a query per request and buys instant revocation — disconnecting deletes the
    row and the outstanding access token stops working on its next call rather
    than at its next expiry.
    """

    __tablename__ = "oauth_grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # Denormalised so the connections list stays readable after a client row is
    # pruned, and so the audit trail does not need a join.
    client_name: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    scope: Mapped[str] = mapped_column(String, nullable=False)
    # The account's session_version when the connection was authorized. "Sign
    # out everywhere" bumps that counter, and a connector is a signed-in thing
    # — losing a phone should cut the assistant loose along with the browsers.
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    # HMAC verifier of the current refresh token. Rotated on every use, so the
    # previous one stops working the moment a new pair is issued.
    refresh_token: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OAuthRedirectHost(Base):
    """A provider an assistant may be sent back to after authorizing.

    Dynamic client registration is anonymous, so without an allowlist a stranger
    could register a client whose redirect URI points at their own server and
    then phish a signed-in user through the consent screen. This table is that
    allowlist, and it is admin policy rather than deployment configuration —
    turning ChatGPT off should not need a redeploy.

    `label` groups hosts by the product a person recognises: Claude is two
    hosts, and an admin should see one thing to switch off, not two.
    """

    __tablename__ = "oauth_redirect_hosts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    host: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
