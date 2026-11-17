"""Changes an admin's AI assistant asked for, which an admin approves in the browser.

The admin MCP's write tools make reversible, access-narrowing changes directly.
Anything that would let more assistants connect is filed here instead: the
assistant reads text strangers wrote, so a planted instruction must not be able
to widen access on its own. Approval re-runs the same validation as the admin
page and records who decided.
"""
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .models import AdminActionRequest, OAuthRedirectHost
from .settings import RuleConflict, add_redirect_rule, normalize_rule, set_rule_enabled

ADD_RULE = "add_redirect_rule"
ENABLE_RULE = "enable_redirect_rule"
ACTIONS = (ADD_RULE, ENABLE_RULE)

PENDING, APPROVED, REJECTED, EXPIRED, FAILED = "pending", "approved", "rejected", "expired", "failed"

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
    """Mark old pending requests expired and keep only recent decided ones."""
    cutoff = _now() - REQUEST_TTL
    changed = False
    for row in db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING).all():
        if _aware(row.requested_at) and _aware(row.requested_at) < cutoff:
            row.status, row.decided_at, row.outcome = EXPIRED, _now(), "Not decided within 7 days"
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
        "payload": json.loads(row.payload), "reason": row.reason, "status": row.status,
        "client_name": row.client_name, "outcome": row.outcome, "decided_by": row.decided_by,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
    }


def file_request(db: Session, action: str, args: dict, *, reason, client_name: str | None,
                 grant_id: int | None) -> tuple[AdminActionRequest, bool]:
    """Validate and queue a request. Returns (row, created). Raises ValueError."""
    expire_stale(db)
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
    existing = db.query(AdminActionRequest).filter(
        AdminActionRequest.status == PENDING, AdminActionRequest.action == action,
        AdminActionRequest.payload == body,
    ).first()
    if existing is not None:
        return existing, False
    if db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING).count() >= MAX_PENDING_REQUESTS:
        raise ValueError(f"{MAX_PENDING_REQUESTS} requests are already waiting for approval in "
                         "Admin → AI Connections; ask the admin to clear them first")
    row = AdminActionRequest(action=action, payload=body, reason=_clean(reason, MAX_REASON_LEN),
                             status=PENDING, client_name=_clean(client_name, 120),
                             grant_id=grant_id, requested_at=_now())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, True


def pending(db: Session, limit: int = 50) -> list[AdminActionRequest]:
    expire_stale(db)
    return (db.query(AdminActionRequest).filter(AdminActionRequest.status == PENDING)
            .order_by(AdminActionRequest.requested_at.desc()).limit(limit).all())


def recent(db: Session, limit: int = 20) -> list[AdminActionRequest]:
    expire_stale(db)
    return (db.query(AdminActionRequest).order_by(AdminActionRequest.id.desc()).limit(limit).all())


class NotPending(ValueError):
    pass


def decide(db: Session, request_id: int, *, approve: bool, admin_email: str) -> AdminActionRequest | None:
    """Approve (and carry out) or reject a pending request. None if it does not exist."""
    expire_stale(db)
    row = db.get(AdminActionRequest, request_id)
    if row is None:
        return None
    if row.status != PENDING:
        raise NotPending(f"This request is already {row.status}")
    row.decided_by, row.decided_at = admin_email, _now()
    if not approve:
        row.status, row.outcome = REJECTED, "Rejected"
        db.commit()
        return row

    payload = json.loads(row.payload)
    try:
        if row.action == ADD_RULE:
            kind, pattern = normalize_rule(payload["pattern"], payload["match_type"])
            add_redirect_rule(db, payload["label"], kind, pattern)
            row.outcome = f"Added {kind} rule {pattern}"
        elif row.action == ENABLE_RULE:
            rule = set_rule_enabled(db, payload["rule_id"], True)
            if rule is None:
                raise ValueError("That rule no longer exists")
            row.outcome = f"Switched {rule.pattern} on"
        row.status = APPROVED
    except (RuleConflict, ValueError) as exc:
        db.rollback()
        row = db.get(AdminActionRequest, request_id)
        row.decided_by, row.decided_at = admin_email, _now()
        row.status, row.outcome = FAILED, str(exc)[:300]
    db.commit()
    return row
