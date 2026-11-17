"""A bounded record of admin changes to AI connection settings.

`begin` commits the intent before the change runs and raises if it cannot, so
nothing changes off the books. `finish` records the outcome and never raises:
the change has already happened by then, and losing its outcome line is better
than reporting a completed change as a failure.
"""
import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import AdminActionJournal

logger = logging.getLogger(__name__)

MAX_ROWS = 5000
MAX_STATE_LEN = 1000

STARTED, OK, FAILED = "started", "ok", "failed"


def _state(value) -> str | None:
    if value is None:
        return None
    text = json.dumps(value, sort_keys=True, default=str)
    return text if len(text) <= MAX_STATE_LEN else text[:MAX_STATE_LEN - 1] + "…"


def begin(db: Session, *, via: str, action: str, actor_email: str | None,
          grant_id: int | None = None, client_name: str | None = None,
          target_type: str | None = None, target_id: int | None = None,
          request_id: int | None = None, before=None) -> int:
    row = AdminActionJournal(
        at=datetime.now(timezone.utc), environment=os.getenv("APP_ENV", "production"),
        via=via, actor_email=actor_email, grant_id=grant_id,
        client_name=(client_name or None) and client_name[:120],
        action=action, target_type=target_type, target_id=target_id, request_id=request_id,
        before=_state(before), outcome=STARTED,
    )
    db.add(row)
    db.commit()
    return row.id


def finish(db: Session, journal_id: int, *, outcome: str, before=None, after=None,
           detail: str | None = None, target_id: int | None = None,
           request_id: int | None = None) -> None:
    try:
        row = db.get(AdminActionJournal, journal_id)
        if row is None:
            return
        row.outcome = outcome
        if before is not None:
            row.before = _state(before)
        row.after = _state(after)
        if detail:
            row.detail = detail[:300]
        if target_id is not None:
            row.target_id = target_id
        if request_id is not None:
            row.request_id = request_id
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record the outcome of admin action %s", journal_id)


def prune(db: Session) -> int:
    """Keep the newest MAX_ROWS entries."""
    stale = (db.query(AdminActionJournal.id).order_by(AdminActionJournal.id.desc())
             .offset(MAX_ROWS).all())
    if not stale:
        return 0
    removed = db.query(AdminActionJournal).filter(
        AdminActionJournal.id.in_([r.id for r in stale])
    ).delete(synchronize_session=False)
    db.commit()
    return removed


def as_dict(row: AdminActionJournal) -> dict:
    def load(value):
        try:
            return json.loads(value) if value else None
        except ValueError:
            return value
    return {
        "id": row.id, "at_utc": row.at.isoformat() if row.at else None,
        "environment": row.environment, "via": row.via, "actor_email": row.actor_email,
        "grant_id": row.grant_id, "client_name": row.client_name, "action": row.action,
        "target_type": row.target_type, "target_id": row.target_id, "request_id": row.request_id,
        "before": load(row.before), "after": load(row.after),
        "outcome": row.outcome, "detail": row.detail,
    }
