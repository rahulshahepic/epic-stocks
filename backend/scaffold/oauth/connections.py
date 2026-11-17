"""Revoking one connection — shared by Settings, RFC 7009 revoke and the admin MCP."""
from sqlalchemy.orm import Session

from . import audit
from .models import OAuthGrant


def revoke_grant(db: Session, grant: OAuthGrant) -> None:
    """Delete the grant (every MCP request and refresh loads it, so this is
    immediate) and record the disconnect in the user's activity."""
    user_id, grant_id, name = grant.user_id, grant.id, grant.client_name
    db.delete(grant)
    db.commit()
    audit.record(db, user_id=user_id, grant_id=grant_id, client_name=name,
                 event=audit.DISCONNECTED)


def describe(grant: OAuthGrant, email: str | None) -> dict:
    """Safe fields only: never the refresh-token verifier."""
    return {
        "id": grant.id, "user_id": grant.user_id, "account_email": email,
        "client_name": grant.client_name or "AI assistant", "scopes": grant.scope.split(),
        "created_at_utc": grant.created_at.isoformat() if grant.created_at else None,
        "last_used_at_utc": grant.last_used_at.isoformat() if grant.last_used_at else None,
        "refresh_expires_at_utc": grant.refresh_expires_at.isoformat() if grant.refresh_expires_at else None,
    }
