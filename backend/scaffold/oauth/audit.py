"""Recording what a connected assistant did.

Written *before* the tool runs, not after. Logging afterwards means a failed
audit write leaves a read that happened with no record of it, and the read is
the thing being audited. Inserting first makes the guarantee real: no tool call
executes without a row, and if the insert fails the call is refused.

The cost is one insert and one small update per call. At this app's scale that
is nothing, and it is the difference between an audit trail and a hope.
"""
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import McpAudit

logger = logging.getLogger(__name__)

TOOL_CALL = "tool_call"
CONNECTED = "connected"
DISCONNECTED = "disconnected"

PENDING = "pending"
OK = "ok"
ERROR = "error"
DENIED = "denied"

# How long an entry is kept, and how many any one account may accumulate. The
# per-request rate limit bounds the inflow; these bound the total.
RETAIN_DAYS = 90
MAX_ROWS_PER_USER = 5_000


def start_tool_call(db: Session, *, user_id: int, grant_id: int | None,
                    client_name: str, tool: str, scope: str | None) -> int:
    """Record the intent to run a tool. Returns the row id.

    Raises if it cannot be written — deliberately. The caller refuses the tool
    call rather than reading data it cannot account for.
    """
    row = McpAudit(
        user_id=user_id,
        grant_id=grant_id,
        client_name=client_name or "",
        event=TOOL_CALL,
        tool=tool,
        scope=scope,
        outcome=PENDING,
    )
    db.add(row)
    db.commit()
    return row.id


def finish_tool_call(db: Session, row_id: int, outcome: str) -> None:
    """Close out a recorded call.

    Best-effort: the read has already happened, so failing the response here
    would lose the answer as well as the outcome. The row stays "pending",
    which is visible and is itself the signal.
    """
    try:
        db.execute(
            text("UPDATE mcp_audit SET outcome = :o WHERE id = :i"),
            {"o": outcome, "i": row_id},
        )
        db.commit()
    except Exception:
        logger.exception("Could not record the outcome of MCP audit row %s", row_id)


def record(db: Session, *, user_id: int, grant_id: int | None, client_name: str,
           event: str) -> None:
    """Note a connection event. Best-effort — never fails the request."""
    try:
        db.add(McpAudit(
            user_id=user_id,
            grant_id=grant_id,
            client_name=client_name or "",
            event=event,
            outcome=OK,
        ))
        db.commit()
    except Exception:
        logger.exception("Could not record MCP %s for user %s", event, user_id)


def prune(db: Session) -> int:
    """Drop entries past the retention window, and trim any runaway account.

    Returns how many rows went. Called from the nightly job.
    """
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)
    removed = db.query(McpAudit).filter(McpAudit.created_at < cutoff).delete(
        synchronize_session=False
    )

    # Per-account ceiling, so one very busy connection cannot fill the disk
    # inside the retention window.
    busy = db.execute(text(
        "SELECT user_id FROM mcp_audit GROUP BY user_id HAVING COUNT(*) > :cap"
    ), {"cap": MAX_ROWS_PER_USER}).scalars().all()
    for user_id in busy:
        keep = db.execute(text(
            "SELECT id FROM mcp_audit WHERE user_id = :u "
            "ORDER BY created_at DESC, id DESC LIMIT :cap"
        ), {"u": user_id, "cap": MAX_ROWS_PER_USER}).scalars().all()
        if keep:
            removed += db.query(McpAudit).filter(
                McpAudit.user_id == user_id,
                McpAudit.id.notin_(keep),
            ).delete(synchronize_session=False)

    db.commit()
    return removed
