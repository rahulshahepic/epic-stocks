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
connect to this deployment at all. oauth_rejected_redirects records what that
policy refused, so an admin can allow a new assistant.
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
    """A rule saying where an assistant may be sent back to after authorizing.

    Dynamic client registration is anonymous, so without an allowlist a stranger
    could register a client whose redirect URI points at their own server and
    then phish a signed-in user through the consent screen. This table is that
    allowlist, and it is admin policy rather than deployment configuration —
    turning ChatGPT off should not need a redeploy.

    `match_type` says how `pattern` is compared with a registered redirect URI
    (scaffold/oauth/settings.py:uri_allowed):
      exact     the whole URI, character for character
      prefix    the URI starts with the pattern (which must include a path)
      host      any https URI on this host or a subdomain of it
      loopback  http(s) on this loopback host, any port and path

    `label` groups rules by the product a person recognises: Claude is two
    callbacks, and an admin should see one thing to switch off, not two.
    """

    __tablename__ = "oauth_redirect_hosts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    pattern: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    match_type: Mapped[str] = mapped_column(String, nullable=False, server_default="host", default="host")
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class OAuthRejectedRedirect(Base):
    """A redirect URI that dynamic registration refused, kept so an admin can allow it.

    New assistants appear faster than anyone can look up their callbacks; the
    refusal itself is the most reliable source. Registration is anonymous, so
    the table is bounded: one row per URI (a repeat bumps `attempts`), the URI
    clipped, and the oldest rows dropped past REJECTED_REDIRECT_CAP. No user is
    attached — registration happens before anyone signs in.
    """

    __tablename__ = "oauth_rejected_redirects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    redirect_uri: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    client_name: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=_now)


class McpAudit(Base):
    """What an AI assistant did, and when.

    The point of the whole feature is sending someone's financial data to an
    outside company, so "a connection was used at some point" — which is all
    `oauth_grants.last_used_at` says — is not enough for either party. A user
    should be able to see whether their assistant read their salary or only
    their vesting dates, and an operator looking into a report should have more
    than one timestamp.

    **No financial data, ever.** Tool names and scopes, never arguments,
    figures or results — the same rule problem reports live under, for the same
    reason: the values would be the user's own share counts and prices. A test
    walks the columns to keep it that way.

    grant_id is a plain integer with no foreign key on purpose. Disconnecting
    deletes the grant, and the record of what that connection did has to
    outlive it — an audit trail that disappears when someone revokes access is
    an audit trail that is missing exactly when it is wanted.
    """

    __tablename__ = "mcp_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    grant_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    # "tool_call", "connected" or "disconnected".
    event: Mapped[str] = mapped_column(String, nullable=False, index=True)
    tool: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    scope: Mapped[str | None] = mapped_column(String, nullable=True)
    # "pending" until the call returns. A row left pending means the process
    # died mid-call, which is worth being able to see.
    outcome: Mapped[str] = mapped_column(String, nullable=False, server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class AdminActionRequest(Base):
    """A change an admin's AI assistant asked for, waiting for the admin.

    Anything that widens access or changes what every user sees — a new
    redirect rule, a rule switched back on, an unblock, maintenance ended, a
    site feature switched — is never done by a tool call alone. The assistant
    reads text strangers wrote (refused registrations, problem reports), so a
    planted instruction could otherwise open the door by itself. The tool
    files a row here and a one-time code goes to the filing admin's own
    devices (their push and email settings); the change runs when that code
    comes back through `admin_approve_request`, or when an admin approves it
    in the browser. The same validation runs again either way.

    No user_id: the requester is a connection (`grant_id`, no foreign key so
    the record outlives a disconnect), the decider is recorded by email. The
    table is bounded (MAX_PENDING_REQUESTS) and pending rows expire.
    """

    __tablename__ = "admin_action_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    client_name: Mapped[str | None] = mapped_column(String, nullable=True)
    grant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # The out-of-band approval code: only its keyed hash, bound to the request,
    # its payload and the admin it was sent to. Cleared when used.
    approval_code_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    approval_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approval_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    approval_codes_sent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class AdminActionJournal(Base):
    """What an admin changed in AI connection settings, from the browser or an assistant.

    The generic MCP audit says a tool ran; this says what it did to which row,
    so "rule 4 switched off by Claude diagnostics at 10:02" is answerable. The
    intent is written and committed before the change runs, so a change cannot
    happen off the books; the outcome is filled in after.

    Safe fields only: ids, labels, validated rule patterns, statuses and
    scopes. Never tokens, report bodies, financial figures, tracebacks or a
    refused (stranger-supplied) URL — those are referred to by id or host.
    No user_id column: the actor is recorded by email and grant id, so the
    history outlives a disconnect or a deleted account.
    """

    __tablename__ = "admin_action_journal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    via: Mapped[str] = mapped_column(String, nullable=False)
    actor_email: Mapped[str | None] = mapped_column(String, nullable=True)
    grant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    before: Mapped[str | None] = mapped_column(String, nullable=True)
    after: Mapped[str | None] = mapped_column(String, nullable=True)
    outcome: Mapped[str] = mapped_column(String, nullable=False, default="started")
    detail: Mapped[str | None] = mapped_column(String, nullable=True)
