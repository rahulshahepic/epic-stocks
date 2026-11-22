"""Admin changes, shared by the admin page and the admin MCP.

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


class NotFound(LookupError, ValueError):
    """Missing row. Also a ValueError, so a tool argument naming nothing is a
    tool error rather than a 500."""


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


# ── errors, reports and housekeeping ───────────────────────────────────────

MAX_BATCH = 50
MAX_NOTE_LEN = 300


def _note(value) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("note must be text")
    text = "".join(c for c in value if c.isprintable()).strip()
    return text[:MAX_NOTE_LEN] or None


def set_errors_resolved(db: Session, actor: Actor, *, error_ids: list[int] | None = None,
                        through_id: int | None = None, resolved: bool = True,
                        note: str | None = None) -> list[int]:
    """Mark application errors resolved (or reopen them). Rows are kept: the
    traceback stays in Admin → Errors. Either explicit ids (up to MAX_BATCH) or
    every unresolved error up to and including `through_id`. Returns the ids changed."""
    from datetime import datetime, timezone
    from scaffold.models import ErrorLog

    if (error_ids is None) == (through_id is None):
        raise ValueError("Give either error_ids or through_id")
    note = _note(note)
    q = db.query(ErrorLog)
    if error_ids is not None:
        if not error_ids or len(error_ids) > MAX_BATCH:
            raise ValueError(f"error_ids takes 1 to {MAX_BATCH} ids")
        rows = q.filter(ErrorLog.id.in_(error_ids)).all()
        missing = sorted(set(error_ids) - {r.id for r in rows})
        if missing:
            raise NotFound(f"No application error with id {missing[0]}")
    else:
        if not resolved:
            raise ValueError("Reopen errors by id")
        rows = q.filter(ErrorLog.id <= through_id, ErrorLog.resolved_at.is_(None)).all()
    rows = [r for r in rows if (r.resolved_at is None) == resolved]
    ids = sorted(r.id for r in rows)

    def change():
        now = datetime.now(timezone.utc)
        for row in rows:
            row.resolved_at = now if resolved else None
            row.resolved_by = actor.email if resolved else None
            row.resolved_note = note if resolved else None
        db.commit()
        return ids, {"ids": ids[:MAX_BATCH], "count": len(ids), "resolved": resolved}
    return _run(db, actor, "resolve_errors" if resolved else "reopen_errors", "error",
                ids[0] if len(ids) == 1 else None, {"count": len(ids)}, change)


def prune_connector_tables(db: Session, actor: Actor) -> dict:
    from .cleanup import prune

    def change():
        result = prune(db)
        return result, {k: v for k, v in result.items() if isinstance(v, int)}
    return _run(db, actor, "prune_connector_tables", "setting", None, None, change)


# ── access: narrowing changes run directly, widening ones via admin_requests ──

def _user_by_email(db: Session, email) -> "object":
    from scaffold.models import User
    if not isinstance(email, str) or "@" not in email or len(email) > 254:
        raise ValueError("account_email must be an email address")
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None:
        raise NotFound("No account with that email")
    return user


def block_email(db: Session, actor: Actor, email: str, reason: str | None):
    from scaffold.auth import get_admin_emails
    from scaffold.models import BlockedEmail

    email = (email or "").strip().lower() if isinstance(email, str) else ""
    if not email or "@" not in email or len(email) > 254:
        raise ValueError("Email required")
    if email in get_admin_emails():
        raise ValueError("An admin's email cannot be blocked")
    if db.query(BlockedEmail).filter(BlockedEmail.email == email).first():
        raise ValueError("Email already blocked")
    reason = _note(reason)

    def change():
        entry = BlockedEmail(email=email, reason=reason)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry, {"id": entry.id, "email": email, "blocked": True}
    return _run(db, actor, "block_email", "blocked_email", None, None, change)


def unblock_email(db: Session, actor: Actor, block_id: int):
    from scaffold.models import BlockedEmail

    entry = db.get(BlockedEmail, block_id)
    if entry is None:
        raise NotFound("Blocked entry not found")
    before = {"id": entry.id, "email": entry.email, "blocked": True}

    def change():
        db.delete(entry)
        db.commit()
        return None, {"id": block_id, "email": before["email"], "blocked": False}
    return _run(db, actor, "unblock_email", "blocked_email", block_id, before, change)


def block_sending(db: Session, actor: Actor, user_id: int, reason: str | None):
    from scaffold.models import InviteSendingBlock, User

    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    if db.query(InviteSendingBlock).filter(InviteSendingBlock.user_id == user_id).first():
        raise ValueError("User is already blocked from sending")
    reason = _note(reason) or ""

    def change():
        db.add(InviteSendingBlock(user_id=user_id, reason=reason))
        db.commit()
        return None, {"id": user_id, "email": user.email, "sending_blocked": True}
    return _run(db, actor, "block_invite_sending", "user", user_id,
                {"id": user_id, "sending_blocked": False}, change)


def unblock_sending(db: Session, actor: Actor, user_id: int):
    from scaffold.models import InviteSendingBlock

    block = db.query(InviteSendingBlock).filter(InviteSendingBlock.user_id == user_id).first()
    if block is None:
        raise NotFound("No sending block found for this user")

    def change():
        db.delete(block)
        db.commit()
        return None, {"id": user_id, "sending_blocked": False}
    return _run(db, actor, "unblock_invite_sending", "user", user_id,
                {"id": user_id, "sending_blocked": True}, change)


def set_maintenance(db: Session, actor: Actor, active: bool):
    from scaffold.maintenance import is_maintenance_active, set_maintenance as _set

    def change():
        _set(db, active)
        return None, {"maintenance": active}
    return _run(db, actor, "start_maintenance" if active else "end_maintenance", "setting", None,
                {"maintenance": is_maintenance_active()}, change)


def set_flexible_payoff(db: Session, actor: Actor, active: bool):
    from scaffold.models import GrantProgramSettings

    row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
    before = {"flexible_payoff": bool(row.flexible_payoff_enabled) if row else False}

    def change():
        target = row
        if target is None:
            target = GrantProgramSettings(id=1, flexible_payoff_enabled=active)
            db.add(target)
        else:
            target.flexible_payoff_enabled = active
        db.commit()
        return None, {"flexible_payoff": active}
    return _run(db, actor, "set_flexible_payoff", "setting", None, before, change)


def set_content_admin(db: Session, actor: Actor, user_id: int, granted: bool):
    from scaffold.models import User

    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    before = {"id": user_id, "email": user.email, "content_admin": bool(user.is_content_admin)}

    def change():
        user.is_content_admin = 1 if granted else 0
        db.commit()
        return None, {**before, "content_admin": granted}
    return _run(db, actor, "grant_content_admin" if granted else "revoke_content_admin", "user",
                user_id, before, change)


def revoke_account_connections(db: Session, actor: Actor, user_id: int) -> list[int]:
    from .connections import revoke_grant
    from .models import OAuthGrant

    grants = db.query(OAuthGrant).filter(OAuthGrant.user_id == user_id).all()
    ids = sorted(g.id for g in grants)

    def change():
        for grant in grants:
            revoke_grant(db, grant)
        return ids, {"user_id": user_id, "revoked": ids}
    return _run(db, actor, "revoke_account_connections", "user", user_id,
                {"user_id": user_id, "connections": ids}, change)


__all__ = ["Actor", "NotFound", "RuleConflict", "set_report_status", "dismiss_refused",
           "set_rule_enabled", "add_rule", "delete_rule", "set_connections_enabled",
           "revoke_connection", "set_errors_resolved", "prune_connector_tables", "block_email",
           "unblock_email", "block_sending", "unblock_sending", "set_maintenance",
           "set_flexible_payoff", "set_content_admin", "revoke_account_connections"]
