"""A bounded record of admin changes to AI connection settings.

`begin` commits the intent before the change runs and raises if it cannot, so
nothing changes off the books. `finish` records the outcome and never raises:
the change has already happened by then, and losing its outcome line is better
than reporting a completed change as a failure.
"""
import hashlib
import hmac
import json
import logging
import os
import re
from urllib.parse import urlparse
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import AdminActionJournal

logger = logging.getLogger(__name__)

MAX_ROWS = 5000
MAX_STATE_LEN = 1000

STARTED, OK, FAILED = "started", "ok", "failed"


# Free text: everything from a scheme to the next whitespace is one address.
# Stopping at quotes or brackets would copy the rest of a crafted URL verbatim.
_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://\S+")
# Fields that hold an address are replaced whole, never regex-matched.
ADDRESS_FIELDS = frozenset({"pattern", "redirect_uri", "uri", "url", "address"})
_SAFE = re.compile(r"^(?:[a-z][a-z0-9+.-]*://[a-z0-9.\-\[\]:]*/… |<address )#[0-9a-f]{16}>?$")


def _fingerprint(value: str) -> str:
    """Keyed, so a low-entropy secret cannot be confirmed by guessing offline."""
    from scaffold.auth import JWT_SECRET
    return hmac.new(f"journal:{JWT_SECRET}".encode(), value.encode(), hashlib.sha256).hexdigest()[:16]


def safe_url(url: str) -> str:
    """Scheme, host and port, plus a keyed fingerprint of the whole address.

    Callback paths and queries can carry secrets, so neither is kept; the
    fingerprint still tells two addresses apart and matches the same address
    across entries. Already-safe values pass through unchanged.
    """
    if _SAFE.match(url):
        return url
    digest = _fingerprint(url)
    try:
        parsed = urlparse(url)
        scheme = re.sub(r"[^a-z0-9+.-]", "", (parsed.scheme or "").lower())
        host = re.sub(r"[^a-z0-9.\-\[\]:]", "", (parsed.hostname or "").lower())
        port = f":{parsed.port}" if parsed.port else ""
    except ValueError:
        return f"<address #{digest}>"
    return f"{scheme}://{host}{port}/… #{digest}" if scheme and host else f"<address #{digest}>"


def scrub(value, key: str | None = None):
    """Make a value safe to journal: address fields whole, URLs in free text."""
    if isinstance(value, str):
        if key in ADDRESS_FIELDS and "://" in value:
            return safe_url(value.strip())
        return _URL.sub(lambda m: safe_url(m.group(0)), value)
    if isinstance(value, dict):
        return {k: scrub(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v, key) for v in value]
    return value


def _state(value) -> str | None:
    if value is None:
        return None
    text = json.dumps(scrub(value), sort_keys=True, default=str)
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
            row.detail = scrub(detail)[:300]
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
        # Scrubbed again on the way out, so rows written before a scrubbing
        # fix (or by any path that missed it) are never served raw.
        "before": scrub(load(row.before)), "after": scrub(load(row.after)),
        "outcome": row.outcome, "detail": scrub(row.detail) if row.detail else None,
    }
