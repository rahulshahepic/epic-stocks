"""Admin changes to AI connection settings, shared by the admin page and the admin MCP.

Each one writes its journal intent first (fail closed), makes the change, and
records the outcome with safe before/after state. The HTTP endpoints call these
with a browser actor; the MCP tools call the same functions with an MCP actor,
so the two can never disagree about what a change does or how it is recorded.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from . import admin_journal
from .settings import RuleConflict, add_redirect_rule, invalidate, rule_state, set_mcp_enabled


@dataclass(frozen=True)
class Actor:
    via: str  # "browser" or "mcp"
    email: str | None
    grant_id: int | None = None
    client_name: str | None = None


class NotFound(LookupError):
    pass


def _run(db: Session, actor: Actor, action: str, target_type: str | None, target_id: int | None,
         before, change):
    """Journal intent, run `change() -> (result, after)`, record the outcome."""
    journal_id = admin_journal.begin(
        db, via=actor.via, action=action, actor_email=actor.email, grant_id=actor.grant_id,
        client_name=actor.client_name, target_type=target_type, target_id=target_id, before=before,
    )
    try:
        result, after = change()
    except Exception as exc:
        db.rollback()
        admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED,
                             detail=str(exc)[:300] if isinstance(exc, (ValueError, LookupError)) else type(exc).__name__)
        raise
    admin_journal.finish(db, journal_id, outcome=admin_journal.OK, after=after,
                         target_id=(after or {}).get("id") if isinstance(after, dict) else None)
    return result


def set_report_status(db: Session, actor: Actor, report_id: int, status: str):
    from scaffold.models import UserReport

    if status not in ("new", "resolved"):
        raise ValueError("Invalid status")
    entry = db.get(UserReport, report_id)
    if entry is None:
        raise NotFound("Report not found")

    def change():
        entry.status = status
        db.commit()
        return entry, {"id": report_id, "status": status}
    return _run(db, actor, "set_report_status", "report", report_id,
                {"id": report_id, "status": entry.status}, change)


def dismiss_refused(db: Session, actor: Actor, refused_id: int):
    from urllib.parse import urlparse
    from .models import OAuthRejectedRedirect

    row = db.get(OAuthRejectedRedirect, refused_id)
    if row is None:
        raise NotFound("Not found")
    try:
        host = urlparse(row.redirect_uri).hostname
    except ValueError:
        host = None
    # A refused URI is stranger-supplied: the journal keeps its id and host only.
    before = {"id": refused_id, "host": host, "attempts": row.attempts}

    def change():
        db.delete(row)
        db.commit()
        return None, {"id": refused_id, "dismissed": True}
    return _run(db, actor, "dismiss_refused_redirect", "refused_redirect", refused_id, before, change)


def set_rule_enabled(db: Session, actor: Actor, rule_id: int, enabled: bool):
    from .models import OAuthRedirectHost
    from .settings import set_rule_enabled as _set

    row = db.get(OAuthRedirectHost, rule_id)
    if row is None:
        raise NotFound("Host not found")

    def change():
        updated = _set(db, rule_id, enabled)
        return updated, rule_state(updated)
    return _run(db, actor, "enable_redirect_rule" if enabled else "disable_redirect_rule",
                "redirect_rule", rule_id, rule_state(row), change)


def add_rule(db: Session, actor: Actor, label: str, kind: str, pattern: str):
    def change():
        row = add_redirect_rule(db, label, kind, pattern)
        return row, rule_state(row)
    return _run(db, actor, "add_redirect_rule", "redirect_rule", None, None, change)


def delete_rule(db: Session, actor: Actor, rule_id: int):
    from .models import OAuthRedirectHost

    row = db.get(OAuthRedirectHost, rule_id)
    if row is None:
        raise NotFound("Host not found")

    def change():
        db.delete(row)
        db.commit()
        invalidate()
        return None, {"id": rule_id, "deleted": True}
    return _run(db, actor, "delete_redirect_rule", "redirect_rule", rule_id, rule_state(row), change)


def set_connections_enabled(db: Session, actor: Actor, enabled: bool):
    from .settings import mcp_enabled

    def change():
        set_mcp_enabled(db, enabled)
        return None, {"ai_connections_enabled": enabled}
    return _run(db, actor, "resume_ai_connections" if enabled else "pause_ai_connections",
                "setting", None, {"ai_connections_enabled": mcp_enabled()}, change)


def revoke_connection(db: Session, actor: Actor, grant_id: int):
    from scaffold.models import User
    from .connections import revoke_grant
    from .models import OAuthGrant

    grant = db.get(OAuthGrant, grant_id)
    if grant is None:
        raise NotFound("No live connection with that id")
    owner = db.get(User, grant.user_id)
    before = {"id": grant.id, "user_id": grant.user_id,
              "account_email": owner.email if owner else None,
              "client_name": grant.client_name, "scopes": grant.scope.split()}

    def change():
        revoke_grant(db, grant)
        return None, {"id": grant_id, "revoked": True}
    return _run(db, actor, "revoke_connection", "connection", grant_id, before, change)


__all__ = ["Actor", "NotFound", "RuleConflict", "set_report_status", "dismiss_refused",
           "set_rule_enabled", "add_rule", "delete_rule", "set_connections_enabled",
           "revoke_connection"]
