"""Changes an admin's AI assistant asked for, which an admin then approves.

The admin MCP's write tools make reversible, access-narrowing changes directly.
Anything that widens access or changes what every user sees is filed here
instead: the assistant reads text strangers wrote, so a planted instruction
must not be able to make such a change on its own. Approval takes either an
admin in the browser, or a one-time code sent to the filing admin's own
devices (following their push and email settings) and handed back to the
assistant. The model never sees the code unless the person gives it, so text
it read cannot approve anything. Approval re-runs the same validation as the
admin page and records who decided.
"""
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import admin_actions, admin_journal
from .models import AdminActionRequest, OAuthRedirectHost
from .settings import (
    RuleConflict, add_redirect_rule, invalidate, normalize_rule, rule_state, set_rule_enabled,
)

logger = logging.getLogger(__name__)

REVIEWER_ACCESS = "reviewer_access"
RESUME_ONBOARDING = "resume_onboarding"
ADD_RULE = "add_redirect_rule"
ENABLE_RULE = "enable_redirect_rule"
UNBLOCK_EMAIL = "unblock_email"
UNBLOCK_SENDING = "unblock_invite_sending"
END_MAINTENANCE = "end_maintenance"
SET_FLEXIBLE_PAYOFF = "set_flexible_payoff"
GRANT_CONTENT_ADMIN = "grant_content_admin"
PURGE_REPORT_MATERIAL = "purge_report_material"
ACTIONS = (ADD_RULE, ENABLE_RULE, UNBLOCK_EMAIL, UNBLOCK_SENDING, END_MAINTENANCE,
           SET_FLEXIBLE_PAYOFF, GRANT_CONTENT_ADMIN, RESUME_ONBOARDING, REVIEWER_ACCESS, PURGE_REPORT_MATERIAL)
TARGET_TYPES = {REVIEWER_ACCESS: "reviewer", RESUME_ONBOARDING: "setting", ADD_RULE: "redirect_rule", ENABLE_RULE: "redirect_rule",
                UNBLOCK_EMAIL: "blocked_email", UNBLOCK_SENDING: "user",
                END_MAINTENANCE: "setting", SET_FLEXIBLE_PAYOFF: "setting",
                GRANT_CONTENT_ADMIN: "user", PURGE_REPORT_MATERIAL: "report"}

PENDING, APPROVED, REJECTED, EXPIRED, FAILED, CANCELLED = (
    "pending", "approved", "rejected", "expired", "failed", "cancelled")

MAX_PENDING_REQUESTS = 20
REQUEST_TTL = timedelta(days=7)
MAX_REASON_LEN = 300
KEEP_DECIDED = 100
APPROVAL_CODE_TTL = timedelta(minutes=15)
CODE_DIGITS = 8
MAX_CODE_ATTEMPTS = 5
MAX_CODES_PER_REQUEST = 5
# Across every request, per admin: a model fed planted text could otherwise
# file request after request, buzzing the admin's phone and guessing each code.
MAX_CODES_PER_HOUR = 10
MAX_WRONG_CODES_PER_HOUR = 10


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
    REVIEWER_ACCESS: "Creates or rotates restricted fictional reviewer access for up to 90 days. Existing sessions and connections are invalidated on rotation.",
    RESUME_ONBOARDING: "Resumes optional onboarding attempt collection for users who explicitly opt in; existing opt-outs and Do Not Track still apply.",
    ADD_RULE: ("Assistants that register this redirect address can be sent sign-in codes "
               "after a user approves the consent screen."),
    ENABLE_RULE: ("Clients registered under this rule can authorize and refresh again, and new "
                  "registrations matching it are accepted."),
    UNBLOCK_EMAIL: "This address can sign in again.",
    UNBLOCK_SENDING: "This account can send sharing invitations again.",
    END_MAINTENANCE: "Every user can reach their data and make changes again.",
    SET_FLEXIBLE_PAYOFF: ("Changes how loan payoffs are sized for every account, which changes "
                          "computed figures on every dashboard."),
    GRANT_CONTENT_ADMIN: "This account can edit the company content tables every user's schedule starts from.",
}


def describe(row: AdminActionRequest) -> str:
    payload = json.loads(row.payload)
    if row.action == REVIEWER_ACCESS:
        target = f"rotate reviewer #{payload['reviewer_id']}" if payload.get('reviewer_id') else 'provision a new reviewer'
        return f"{payload['platform']}: {target}, {payload['scenario']} fictional data, {payload['days']} days"
    if row.action == PURGE_REPORT_MATERIAL:
        return f"Delete all sensitive material for report #{payload['report_id']}"
    if row.action == RESUME_ONBOARDING:
        return "Resume optional onboarding measurement"
    if row.action == ADD_RULE:
        return f"Allow {payload['match_type']} redirect {payload['pattern']} as “{payload['label']}”"
    if row.action == ENABLE_RULE:
        return f"Switch redirect rule {payload.get('pattern', payload['rule_id'])} back on"
    if row.action == UNBLOCK_EMAIL:
        return f"Unblock sign-in for {payload['email']}"
    if row.action == UNBLOCK_SENDING:
        return f"Let {payload['email']} send invitations again"
    if row.action == END_MAINTENANCE:
        return "End maintenance mode"
    if row.action == SET_FLEXIBLE_PAYOFF:
        return f"Turn flexible loan payoff {'on' if payload['active'] else 'off'}"
    if row.action == GRANT_CONTENT_ADMIN:
        return f"Make {payload['email']} a content admin"
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


def _int_arg(args: dict, name: str, hint: str) -> int:
    value = args.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be an integer {hint}")
    return value


def _target_id(payload: dict) -> int | None:
    for key in ("rule_id", "block_id", "user_id", "report_id"):
        if key in payload:
            return payload[key]
    return None


def _validate(db: Session, action: str, args: dict) -> dict:
    from scaffold.models import BlockedEmail, GrantProgramSettings, InviteSendingBlock

    if action == REVIEWER_ACCESS:
        from scaffold.reviewers import validate_access
        return validate_access(db, args)
    if action == PURGE_REPORT_MATERIAL:
        from scaffold.sensitive_reports import available_ids
        report_id = _int_arg(args, "report_id", "from admin_user_reports")
        if report_id not in available_ids(db, [report_id]):
            raise ValueError("No sensitive material is available for this report")
        return {"report_id": report_id}
    if action == RESUME_ONBOARDING:
        from scaffold.onboarding import paused
        if not paused(db):
            raise ValueError("Onboarding measurement is not paused")
        return {}
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
        return {"label": label, "match_type": kind, "pattern": pattern}
    if action == ENABLE_RULE:
        rule = db.get(OAuthRedirectHost, _int_arg(args, "rule_id", "from admin_ai_connections"))
        if rule is None:
            raise ValueError("No redirect rule with that id")
        if rule.enabled:
            raise ValueError("That rule is already on")
        return {"rule_id": rule.id, "label": rule.label, "pattern": rule.pattern,
                "match_type": rule.match_type}
    if action == UNBLOCK_EMAIL:
        email = args.get("email")
        if not isinstance(email, str) or len(email) > 254:
            raise ValueError("email must be the blocked address")
        entry = db.query(BlockedEmail).filter(BlockedEmail.email == email.strip().lower()).first()
        if entry is None:
            raise ValueError("That address is not blocked")
        return {"block_id": entry.id, "email": entry.email}
    if action in (UNBLOCK_SENDING, GRANT_CONTENT_ADMIN):
        user = admin_actions._user_by_email(db, args.get("account_email"))
        if action == UNBLOCK_SENDING:
            if not db.query(InviteSendingBlock).filter(InviteSendingBlock.user_id == user.id).first():
                raise ValueError("That account is not blocked from sending")
        elif user.is_synthetic:
            raise ValueError("Fictional accounts cannot receive administrative privileges")
        elif user.is_content_admin:
            raise ValueError("That account is already a content admin")
        return {"user_id": user.id, "email": user.email}
    if action == END_MAINTENANCE:
        from scaffold.maintenance import is_maintenance_active
        if not is_maintenance_active():
            raise ValueError("Maintenance mode is not on")
        return {}
    if action == SET_FLEXIBLE_PAYOFF:
        active = args.get("active")
        if not isinstance(active, bool):
            raise ValueError("active must be true or false")
        row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
        if bool(row.flexible_payoff_enabled if row else False) == active:
            raise ValueError(f"Flexible loan payoff is already {'on' if active else 'off'}")
        return {"active": active}
    raise ValueError(f"Unknown action '{action}'")


def file_request(db: Session, action: str, args: dict, *, reason, client_name: str | None,
                 grant_id: int | None, actor_email: str | None = None) -> tuple[AdminActionRequest, bool]:
    """Validate and queue a request. Returns (row, created). Raises ValueError."""
    expire_stale(db)
    if reason is not None and not isinstance(reason, str):
        raise ValueError("reason must be text")
    payload = _validate(db, action, args)
    body = json.dumps(payload, sort_keys=True)
    # Intent first (fails closed), committed before the lock is taken, so the
    # journal's own commit cannot release the lock between check and insert.
    journal_id = admin_journal.begin(
        db, via="mcp", action=f"request_{action}", actor_email=actor_email, grant_id=grant_id,
        client_name=client_name, target_type=TARGET_TYPES[action], target_id=_target_id(payload),
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
                             k: payload[k] for k in ("label", "match_type", "pattern", "rule_id",
                                                     "email", "active")
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
    """Carry out an approved request without committing, so the claim, the
    change and the request's final status commit together. Returns (outcome
    text, before, after) for the journal. Raises on failure."""
    from sqlalchemy import text as _sql
    from scaffold.models import BlockedEmail, GrantProgramSettings, InviteSendingBlock, User

    payload = json.loads(row.payload)
    if row.action == REVIEWER_ACCESS:
        from scaffold.reviewers import grant_access
        result = grant_access(db, payload)
        return "Reviewer access granted", None, result
    if row.action == PURGE_REPORT_MATERIAL:
        from scaffold.sensitive_reports import erase_material
        report_id = payload["report_id"]
        removed = erase_material(db, report_id)
        return "Sensitive report material removed", {"present": removed}, {"present": False}
    if row.action == RESUME_ONBOARDING:
        from scaffold.onboarding import paused, set_paused
        if not paused(db):
            raise ValueError('Onboarding measurement is no longer paused')
        set_paused(db, False, commit=False)
        return 'Optional onboarding measurement resumed', {'collection_paused': True}, {'collection_paused': False}
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
    # The rest re-check current state, so a request that went stale (already
    # unblocked, maintenance already off) fails rather than acting twice.
    if row.action == UNBLOCK_EMAIL:
        entry = db.get(BlockedEmail, payload["block_id"])
        if entry is None:
            raise ValueError("That address is no longer blocked")
        db.delete(entry)
        return (f"Unblocked {payload['email']}", {"id": entry.id, "email": entry.email, "blocked": True},
                {"id": entry.id, "email": entry.email, "blocked": False})
    if row.action == UNBLOCK_SENDING:
        block = db.query(InviteSendingBlock).filter(InviteSendingBlock.user_id == payload["user_id"]).first()
        if block is None:
            raise ValueError("That account is no longer blocked from sending")
        db.delete(block)
        state = {"id": payload["user_id"], "email": payload["email"]}
        return (f"{payload['email']} can send invitations again", {**state, "sending_blocked": True},
                {**state, "sending_blocked": False})
    if row.action == END_MAINTENANCE:
        current = db.execute(_sql("SELECT value FROM system_settings WHERE key = 'maintenance_active'")).scalar()
        if current != "true":
            raise ValueError("Maintenance mode is no longer on")
        db.execute(_sql("UPDATE system_settings SET value = 'false' WHERE key = 'maintenance_active'"))
        return "Maintenance mode ended", {"maintenance": True}, {"maintenance": False}
    if row.action == SET_FLEXIBLE_PAYOFF:
        settings = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
        if settings is None:
            settings = GrantProgramSettings(id=1, flexible_payoff_enabled=False)
            db.add(settings)
        before = {"flexible_payoff": bool(settings.flexible_payoff_enabled)}
        if before["flexible_payoff"] == payload["active"]:
            raise ValueError(f"Flexible loan payoff is already {'on' if payload['active'] else 'off'}")
        settings.flexible_payoff_enabled = payload["active"]
        return (f"Flexible loan payoff {'on' if payload['active'] else 'off'}", before,
                {"flexible_payoff": payload["active"]})
    if row.action == GRANT_CONTENT_ADMIN:
        user = db.get(User, payload["user_id"])
        if user is None:
            raise ValueError("That account no longer exists")
        if user.is_synthetic:
            raise ValueError("Fictional accounts cannot receive administrative privileges")
        if user.is_content_admin:
            raise ValueError("That account is already a content admin")
        state = {"id": user.id, "email": user.email}
        before = {**state, "content_admin": False}
        user.is_content_admin = 1
        return f"{user.email} is a content admin", before, {**state, "content_admin": True}
    raise ValueError(f"Unknown action '{row.action}'")


def _after_commit(action: str) -> None:
    invalidate()
    if action == END_MAINTENANCE:
        from scaffold import maintenance
        maintenance._cache = None


def decide(db: Session, request_id: int, *, approve: bool, admin_email: str,
           via: str = "browser", grant_id: int | None = None,
           client_name: str | None = None) -> AdminActionRequest | None:
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
        actor_email=admin_email, grant_id=grant_id, client_name=client_name,
        target_type=TARGET_TYPES.get(row.action), target_id=_target_id(payload), request_id=row.id,
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
    _after_commit(row.action)
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


# ── approval by one-time code ───────────────────────────────────────────────
# The code goes to the admin's own devices and never into a tool result, the
# journal or a log. Only a keyed hash is stored, bound to the request, its
# exact payload and the admin it was sent to, so a code cannot approve a
# different change or be used from another admin's connection. Attempts are
# counted before the comparison, so parallel guesses cannot exceed the cap.

class ApprovalError(ValueError):
    pass


def _code_hash(row: AdminActionRequest, email: str, code: str) -> str:
    from scaffold.auth import JWT_SECRET
    message = f"approval:{row.id}:{row.action}:{row.payload}:{email.strip().lower()}:{code}"
    return hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()


def _recent(db: Session, action: str, email: str) -> int:
    from .models import AdminActionJournal
    return db.query(AdminActionJournal).filter(
        AdminActionJournal.action == action, AdminActionJournal.actor_email == email,
        AdminActionJournal.at >= _now() - timedelta(hours=1),
    ).count()


def _check_purge_grant(row: AdminActionRequest, grant_id: int | None, scopes) -> None:
    from .scopes import ADMIN_REPORT_SENSITIVE, ADMIN_WRITE

    if row.action == PURGE_REPORT_MATERIAL and (
        grant_id is None or grant_id != row.grant_id
        or ADMIN_REPORT_SENSITIVE not in scopes or ADMIN_WRITE not in scopes
    ):
        raise ApprovalError(
            "Use the connection that filed this deletion, with sensitive report and write permissions, "
            "or approve it in Admin."
        )


def send_code(db: Session, request_id: int, admin, *, grant_id: int | None = None,
              client_name: str | None = None, scopes: tuple[str, ...] = ()) -> dict:
    """Mint a fresh code for a pending request and deliver it to `admin`.
    Any earlier code for it stops working. Returns where it went."""
    from .approval_delivery import deliver

    expire_stale(db)
    row = db.get(AdminActionRequest, request_id)
    if row is None:
        raise ApprovalError("No request with that id")
    _check_purge_grant(row, grant_id, scopes)
    if row.status != PENDING:
        raise ApprovalError(f"This request is already {row.status}")
    if (row.approval_codes_sent or 0) >= MAX_CODES_PER_REQUEST:
        raise ApprovalError(f"{MAX_CODES_PER_REQUEST} codes were already sent for this request; "
                            "approve or reject it in More → Site Admin → AI Connections")
    if _recent(db, "send_approval_code", admin.email) >= MAX_CODES_PER_HOUR:
        raise ApprovalError(f"{MAX_CODES_PER_HOUR} approval codes were sent in the last hour; "
                            "approve this one in More → Site Admin → AI Connections, or try again later")
    journal_id = admin_journal.begin(
        db, via="mcp", action="send_approval_code", actor_email=admin.email, grant_id=grant_id,
        client_name=client_name, target_type="request", target_id=row.id, request_id=row.id,
    )
    code = f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"
    row.approval_code_hash = _code_hash(row, admin.email, code)
    row.approval_code_expires_at = _now() + APPROVAL_CODE_TTL
    row.approval_attempts = 0
    row.approval_codes_sent = (row.approval_codes_sent or 0) + 1
    db.commit()
    minutes = int(APPROVAL_CODE_TTL.total_seconds() // 60)
    from scaffold.email_sender import app_url
    link = f"{app_url()}/admin" if app_url() else "Admin → AI Connections"
    try:
        channels = deliver(
            db, admin, "Epic Stocks admin approval",
            f"An assistant asked to: {describe(row)}.\n"
            f"Code: {code[:4]} {code[4:]}\n"
            f"It expires in {minutes} minutes and approves only this change. "
            "Give it to the assistant only if you asked for this yourself.",
            email_body=(f"An assistant asked to: {describe(row)}.\n"
                        "For your safety the approval code is sent only to your push devices, never "
                        "by email, because an assistant that can read your mail could approve "
                        f"itself. To approve or reject it here instead, open {link} → AI Connections."),
        )
    except Exception:
        logger.exception("Could not deliver an approval code")
        channels = []
    del code
    delivered = "push" in channels
    if not delivered:
        # Nobody holds this code, so it must not stay redeemable.
        row.approval_code_hash = None
        db.commit()
    admin_journal.finish(db, journal_id, outcome=admin_journal.OK if delivered else admin_journal.FAILED,
                         after={"request_id": row.id, "channels": channels},
                         detail=None if delivered else "No push device accepted the code")
    return {"sent_to": ["push"] if delivered else [],
            "notice_sent_to": [c for c in channels if c != "push"],
            "expires_at": _aware(row.approval_code_expires_at).isoformat() if delivered else None,
            "codes_left": MAX_CODES_PER_REQUEST - row.approval_codes_sent}


def approve_with_code(db: Session, request_id: int, code, *, admin_email: str,
                      grant_id: int | None = None, client_name: str | None = None,
                      scopes: tuple[str, ...] = ()) -> AdminActionRequest:
    expire_stale(db)
    row = db.get(AdminActionRequest, request_id)
    if row is None:
        raise ApprovalError("No request with that id")
    _check_purge_grant(row, grant_id, scopes)
    if row.status != PENDING:
        raise ApprovalError(f"This request is already {row.status}")
    if not isinstance(code, str):
        raise ApprovalError(f"code must be the {CODE_DIGITS}-digit code sent to the admin")
    code = "".join(c for c in code if c.isdigit())
    if not row.approval_code_hash:
        raise ApprovalError("No code is outstanding for this request; send one with "
                            "admin_send_approval_code")
    if _aware(row.approval_code_expires_at) is None or _aware(row.approval_code_expires_at) < _now():
        raise ApprovalError("That code has expired; send a new one with admin_send_approval_code")
    if _recent(db, "wrong_approval_code", admin_email) >= MAX_WRONG_CODES_PER_HOUR:
        raise ApprovalError("Too many wrong codes in the last hour; approve it in "
                            "Admin → AI Connections, or try again later")
    counted = db.query(AdminActionRequest).filter(
        AdminActionRequest.id == request_id,
        AdminActionRequest.approval_attempts < MAX_CODE_ATTEMPTS,
    ).update({AdminActionRequest.approval_attempts: AdminActionRequest.approval_attempts + 1},
             synchronize_session=False)
    db.commit()
    if not counted:
        raise ApprovalError("Too many wrong codes; send a new one with admin_send_approval_code")
    db.refresh(row)
    if len(code) != CODE_DIGITS or not hmac.compare_digest(row.approval_code_hash or "",
                                                  _code_hash(row, admin_email, code)):
        left = MAX_CODE_ATTEMPTS - row.approval_attempts
        try:
            journal_id = admin_journal.begin(
                db, via="mcp", action="wrong_approval_code", actor_email=admin_email,
                grant_id=grant_id, client_name=client_name, target_type="request",
                target_id=row.id, request_id=row.id)
            admin_journal.finish(db, journal_id, outcome=admin_journal.FAILED,
                                 detail=f"{left} attempts left")
        except Exception:
            db.rollback()
        raise ApprovalError(f"That code does not match this request for this admin; {left} "
                            f"{'try' if left == 1 else 'tries'} left")
    # Single use: spent before the change runs, whatever its outcome.
    if not db.query(AdminActionRequest).filter(
        AdminActionRequest.id == request_id,
        AdminActionRequest.approval_code_hash == row.approval_code_hash,
    ).update({AdminActionRequest.approval_code_hash: None}, synchronize_session=False):
        db.rollback()
        raise ApprovalError("That code was already used")
    db.commit()
    return decide(db, request_id, approve=True, admin_email=admin_email, via="mcp",
                  grant_id=grant_id, client_name=client_name)
