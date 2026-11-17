"""Changes an admin's AI assistant asked for, which an admin approves in the browser.

The admin MCP's write tools make reversible, access-narrowing changes directly.
Anything that would let more assistants connect is filed here instead: the
assistant reads text strangers wrote, so a planted instruction must not be able
to widen access on its own. Approval re-runs the same validation as the admin
page and records who decided.
"""
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import admin_journal
from .models import AdminActionRequest, OAuthRedirectHost
from .settings import (
    RuleConflict, add_redirect_rule, invalidate, normalize_rule, rule_state, set_rule_enabled,
)

ADD_RULE = "add_redirect_rule"
ENABLE_RULE = "enable_redirect_rule"
ACTIONS = (ADD_RULE, ENABLE_RULE)

PENDING, APPROVED, REJECTED, EXPIRED, FAILED, CANCELLED = (
    "pending", "approved", "rejected", "expired", "failed", "cancelled")

MAX_PENDING_REQUESTS = 20
REQUEST_TTL = timedelta(days=7)
MAX_REASON_LEN = 300
KEEP_DECIDED = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _clean(value, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = "".join(c for c in value if c.isprintable()).strip()
    return text[:limit] or None


def expire_stale(db: Session) -> None:
    """Mark old pending requests expired and keep only recent decided ones.

    Called from read paths too (admin:read tools included) on purpose: expiry
    is housekeeping that must happen whether or not anyone writes, and each
    expiry is journalled.
    """
    cutoff = _now() - REQUEST_TTL
    changed = False
    expired: list[int] = []
    for row in db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING).all():
        if _aware(row.requested_at) and _aware(row.requested_at) < cutoff:
            row.status, row.decided_at, row.outcome = EXPIRED, _now(), "Not decided within 7 days"
            expired.append(row.id)
            changed = True
    decided = (db.query(AdminActionRequest.id)
               .filter(AdminActionRequest.status != PENDING)
               .order_by(AdminActionRequest.id.desc()).offset(KEEP_DECIDED).all())
    if decided:
        db.query(AdminActionRequest).filter(
            AdminActionRequest.id.in_([r.id for r in decided])
        ).delete(synchronize_session=False)
        changed = True
    if changed:
        db.commit()
    for request_id in expired:
        try:
            journal_id = admin_journal.begin(db, via="system", action="expire_request",
                                             actor_email=None, request_id=request_id)
            admin_journal.finish(db, journal_id, outcome=admin_journal.OK,
                                 after={"request_id": request_id, "status": EXPIRED})
        except Exception:
            db.rollback()


CONSEQUENCES = {
    ADD_RULE: ("Assistants that register this redirect address can be sent sign-in codes "
               "after a user approves the consent screen."),
    ENABLE_RULE: ("Clients registered under this rule can authorize and refresh again, and new "
                  "registrations matching it are accepted."),
}


def describe(row: AdminActionRequest) -> str:
    payload = json.loads(row.payload)
    if row.action == ADD_RULE:
        return f"Allow {payload['match_type']} redirect {payload['pattern']} as “{payload['label']}”"
    if row.action == ENABLE_RULE:
        return f"Switch redirect rule {payload.get('pattern', payload['rule_id'])} back on"
    return row.action


def as_dict(row: AdminActionRequest) -> dict:
    return {
        "id": row.id, "action": row.action, "description": describe(row),
        "consequence": CONSEQUENCES.get(row.action),
        "payload": json.loads(row.payload), "reason": row.reason, "status": row.status,
        "grant_id": row.grant_id,
        "client_name": row.client_name, "outcome": row.outcome, "decided_by": row.decided_by,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
    }


def file_request(db: Session, action: str, args: dict, *, reason, client_name: str | None,
                 grant_id: int | None, actor_email: str | None = None) -> tuple[AdminActionRequest, bool]:
    """Validate and queue a request. Returns (row, created). Raises ValueError."""
    expire_stale(db)
    if reason is not None and not isinstance(reason, str):
        raise ValueError("reason must be text")
    if action == ADD_RULE:
        label = _clean(args.get("label"), 60)
        if not label:
            raise ValueError("label is required: the assistant's product name, e.g. Copilot")
        raw = args.get("pattern")
        if not isinstance(raw, str):
            raise ValueError("pattern is required: the full callback URL, or a hostname")
        kind, pattern = normalize_rule(raw, args.get("match_type"))
        if db.query(OAuthRedirectHost).filter(OAuthRedirectHost.pattern == pattern).first():
            raise ValueError(f"{pattern} is already on the list; use admin_ai_connections to see "
                             "whether it is switched off")
        payload = {"label": label, "match_type": kind, "pattern": pattern}
    elif action == ENABLE_RULE:
        rule_id = args.get("rule_id")
        if isinstance(rule_id, bool) or not isinstance(rule_id, int):
            raise ValueError("rule_id must be an integer from admin_ai_connections")
        rule = db.get(OAuthRedirectHost, rule_id)
        if rule is None:
            raise ValueError("No redirect rule with that id")
        if rule.enabled:
            raise ValueError("That rule is already on")
        payload = {"rule_id": rule.id, "label": rule.label, "pattern": rule.pattern,
                   "match_type": rule.match_type}
    else:
        raise ValueError(f"Unknown action '{action}'")

    body = json.dumps(payload, sort_keys=True)
    # Intent first (fails closed), committed before the lock is taken, so the
    # journal's own commit cannot release the lock between check and insert.
    journal_id = admin_journal.begin(
        db, via="mcp", action=f"request_{action}", actor_email=actor_email, grant_id=grant_id,
        client_name=client_name, target_type="redirect_rule", target_id=payload.get("rule_id"),
    )
    try:
        _lock(db)
        existing = db.query(AdminActionRequest).filter(
            AdminActionRequest.status == PENDING, AdminActionRequest.action == action,
            AdminActionRequest.payload == body,
        ).first()
        if existing is not None:
            db.commit()
            admin_journal.finish(db, journal_id, outcome=admin_journal.OK, request_id=existing.id,
                                 detail="Already pending; no new request filed")
            return existing, False
        if db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING).count() >= MAX_PENDING_REQUESTS:
            raise ValueError(f"{MAX_PENDING_REQUESTS} requests are already waiting for approval in "
                             "Admin → AI Connections; ask the admin to clear them first")
        row = AdminActionRequest(action=action, payload=body, reason=_clean(reason, MAX_REASON_LEN),
                                 status=PENDING, client_name=_clean(client_name, 120),
                                 grant_id=grant_id, requested_at=_now())
        db.add(row)
        db.commit()
    except Exception as exc:
        db.rollback()
        admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED,
                             detail=str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
        raise
    db.refresh(row)
    admin_journal.finish(db, journal_id, outcome=admin_journal.OK, request_id=row.id,
                         after={"request_id": row.id, "status": PENDING, **{
                             k: payload[k] for k in ("label", "match_type", "pattern", "rule_id")
                             if k in payload}})
    return row, True


LOCK_KEY = "admin_requests_lock"


def _lock(db: Session) -> None:
    """Serialize the pending-queue check and insert until the caller commits.

    Updating one known row takes its row lock on PostgreSQL and the database
    write lock on SQLite, so a second filer waits here and then sees the first
    one's row. Without it two filers could both pass the cap check.
    """
    statement = text("UPDATE system_settings SET value = value WHERE key = :k")
    if db.execute(statement, {"k": LOCK_KEY}).rowcount:
        return
    try:
        db.execute(text("INSERT INTO system_settings (key, value) VALUES (:k, '0')"), {"k": LOCK_KEY})
        db.commit()
    except IntegrityError:
        db.rollback()
    db.execute(statement, {"k": LOCK_KEY})


def pending(db: Session) -> list[AdminActionRequest]:
    """Every request still waiting, never paged away by newer history.

    Deliberately unlimited: file_request keeps the queue at MAX_PENDING_REQUESTS,
    and if that were ever violated a limit here would hide real requests from
    the only place they can be approved.
    """
    expire_stale(db)
    return (db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING)
            .order_by(AdminActionRequest.requested_at.desc(), AdminActionRequest.id.desc()).all())


def history(db: Session, limit: int = 20, before_id: int | None = None) -> list[AdminActionRequest]:
    """Decided requests, newest first, paged by id."""
    expire_stale(db)
    q = db.query(AdminActionRequest).filter(AdminActionRequest.status != PENDING)
    if before_id:
        q = q.filter(AdminActionRequest.id < before_id)
    return q.order_by(AdminActionRequest.id.desc()).limit(limit).all()


def get(db: Session, request_id: int) -> AdminActionRequest | None:
    expire_stale(db)
    return db.get(AdminActionRequest, request_id)


class NotPending(ValueError):
    pass


def _claim(db: Session, request_id: int, status: str, admin_email: str | None, outcome: str | None) -> bool:
    """Move a request out of pending, atomically. Exactly one caller wins: the
    conditional UPDATE takes the row lock, and a concurrent caller re-reads the
    status after the winner commits and matches nothing."""
    return db.query(AdminActionRequest).filter(
        AdminActionRequest.id == request_id, AdminActionRequest.status == PENDING,
    ).update({AdminActionRequest.status: status, AdminActionRequest.decided_by: admin_email,
              AdminActionRequest.decided_at: _now(), AdminActionRequest.outcome: outcome},
             synchronize_session=False) == 1


def _not_pending(db: Session, request_id: int):
    row = db.get(AdminActionRequest, request_id)
    if row is None:
        return None
    raise NotPending(f"This request is already {row.status}")


def _apply(db: Session, row: AdminActionRequest) -> tuple[str, dict | None, dict | None]:
    """Carry out an approved request without committing. Returns
    (outcome text, before, after) for the journal. Raises on failure."""
    payload = json.loads(row.payload)
    if row.action == ADD_RULE:
        kind, pattern = normalize_rule(payload["pattern"], payload["match_type"])
        rule = add_redirect_rule(db, payload["label"], kind, pattern, commit=False)
        return f"Added {kind} rule {pattern}", None, rule_state(rule)
    if row.action == ENABLE_RULE:
        rule = db.get(OAuthRedirectHost, payload["rule_id"])
        if rule is None:
            raise ValueError("That rule no longer exists")
        before = rule_state(rule)
        rule = set_rule_enabled(db, payload["rule_id"], True, commit=False)
        return f"Switched {rule.pattern} on", before, rule_state(rule)
    raise ValueError(f"Unknown action '{row.action}'")


def decide(db: Session, request_id: int, *, approve: bool, admin_email: str,
           via: str = "browser") -> AdminActionRequest | None:
    """Approve (and carry out) or reject a pending request. None if it does not exist.

    The journal intent is committed first and fails closed. The claim, the
    change and the request's final status then commit together: a failure
    anywhere rolls all three back, and the request is marked failed in a
    separate step. Caches are dropped only after the commit.
    """
    expire_stale(db)
    row = db.get(AdminActionRequest, request_id)
    if row is None:
        return None
    if row.status != PENDING:
        raise NotPending(f"This request is already {row.status}")
    payload = json.loads(row.payload)
    journal_id = admin_journal.begin(
        db, via=via, action=f"{'approve' if approve else 'reject'}_{row.action}",
        actor_email=admin_email, target_type="redirect_rule",
        target_id=payload.get("rule_id"), request_id=row.id,
    )

    if not approve:
        if not _claim(db, request_id, REJECTED, admin_email, "Rejected"):
            db.rollback()
            admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED, detail="Not pending")
            return _not_pending(db, request_id)
        db.commit()
        admin_journal.finish(db, journal_id, outcome=admin_journal.OK)
        db.expire_all()
        return db.get(AdminActionRequest, request_id)

    try:
        if not _claim(db, request_id, APPROVED, admin_email, None):
            db.rollback()
            admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED, detail="Not pending")
            return _not_pending(db, request_id)
        row = db.get(AdminActionRequest, request_id)
        db.refresh(row)
        outcome, before, after = _apply(db, row)
        row.outcome = outcome
        db.commit()
    except NotPending:
        raise
    except Exception as exc:
        db.rollback()
        message = str(exc)[:300] if isinstance(exc, (RuleConflict, ValueError)) else "The change could not be applied"
        _claim(db, request_id, FAILED, admin_email, message)
        db.commit()
        admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED, detail=message)
        db.expire_all()
        return db.get(AdminActionRequest, request_id)
    invalidate()
    admin_journal.finish(db, journal_id, outcome=admin_journal.OK, before=before, after=after,
                         target_id=(after or {}).get("id"))
    db.expire_all()
    return db.get(AdminActionRequest, request_id)


def cancel(db: Session, request_id: int, *, grant_id: int, actor_email: str | None,
           client_name: str | None) -> AdminActionRequest:
    """The connection that filed a request withdraws it while still pending."""
    expire_stale(db)
    row = db.get(AdminActionRequest, request_id)
    if row is None or row.grant_id != grant_id:
        raise ValueError("No pending request with that id was filed by this connection")
    if row.status != PENDING:
        raise ValueError(f"This request is already {row.status}")
    journal_id = admin_journal.begin(
        db, via="mcp", action=f"cancel_{row.action}", actor_email=actor_email,
        grant_id=grant_id, client_name=client_name, request_id=row.id,
    )
    if not _claim(db, request_id, CANCELLED, None, "Withdrawn by the assistant that filed it"):
        db.rollback()
        admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED, detail="Not pending")
        raise ValueError("This request was decided before it could be withdrawn")
    db.commit()
    admin_journal.finish(db, journal_id, outcome=admin_journal.OK)
    db.expire_all()
    return db.get(AdminActionRequest, request_id)
