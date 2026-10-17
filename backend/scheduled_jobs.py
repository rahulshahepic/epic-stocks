"""Run due daily jobs from a short-lived container on either hosting platform.

Invoke every 15 minutes. A successful UTC day is recorded in PostgreSQL so a
missed timer firing can run later that day, and overlapping invocations do not
send the same batch concurrently. The date marker follows the work: retries
after a crash may repeat an external send, as with the previous web scheduler.
"""
import logging
import json
from contextlib import nullcontext
from datetime import date, datetime, time, timezone

from sqlalchemy import text

import database
from scaffold.models import SystemSettings

logger = logging.getLogger(__name__)


def _notifications(day: date) -> None:
    from scaffold.notifications import send_daily_notifications

    send_daily_notifications(today=day)


def _admin_digest(day: date) -> None:
    from scaffold.notifications import send_admin_daily_digest

    send_admin_daily_digest(today=day)


def _maintenance(_day: date) -> None:
    from main import _aggregate_old_metrics
    from app.routers.prices import _cleanup_epic_past_estimates
    from scaffold.oauth.cleanup import prune

    _aggregate_old_metrics()
    db = database.SessionLocal()
    try:
        _cleanup_epic_past_estimates(db)
        db.commit()
        prune(db)
    finally:
        db.close()


_JOBS = (
    ("maintenance", time(3, 0), 444444444, _maintenance),
    ("notifications", time(7, 0), 555555555, _notifications),
    ("admin_digest", time(7, 0), 666666666, _admin_digest),
)


def _record_runner_state(values: dict[str, str]) -> None:
    db = database.SessionLocal()
    try:
        for name, value in values.items():
            key = f"scheduled:runner:{name}"
            row = db.get(SystemSettings, key)
            if row is None:
                db.add(SystemSettings(key=key, value=value))
            else:
                row.value = value
        db.commit()
    finally:
        db.close()


def _run_once(name: str, day: date, lock_id: int, action) -> bool:
    lock_connection = database.engine.connect() if not database._is_sqlite else nullcontext(None)
    with lock_connection as connection:
        if connection is not None:
            acquired = connection.execute(
                text("SELECT pg_try_advisory_lock(:lock_id)"), {"lock_id": lock_id}
            ).scalar()
            connection.commit()
            if not acquired:
                return False
        try:
            db = database.SessionLocal()
            try:
                key = f"scheduled:{name}:last_completed"
                state = db.get(SystemSettings, key)
                if state and state.value >= day.isoformat():
                    return False
                action(day)
                if state is None:
                    db.add(SystemSettings(key=key, value=day.isoformat()))
                else:
                    state.value = day.isoformat()
                db.commit()
                logger.info("Completed %s job for %s", name, day)
                return True
            finally:
                db.close()
        finally:
            if connection is not None:
                connection.execute(text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id})
                connection.commit()


def run_due(now: datetime | None = None) -> dict[str, str]:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("run_due requires a timezone-aware datetime")
    now = now.astimezone(timezone.utc)
    _record_runner_state({"last_started_at": datetime.now(timezone.utc).isoformat()})
    result = {}
    try:
        # A one-off job container never enters FastAPI lifespan. Notifications
        # decrypt user keys, so load the same shared master key before doing work.
        from scaffold.crypto import initialize_master_key

        db = database.SessionLocal()
        try:
            initialize_master_key(db)
        finally:
            db.close()
        for name, start, lock_id, action in _JOBS:
            if now.time() < start:
                result[name] = "not_due"
                continue
            try:
                ran = _run_once(name, now.date(), lock_id, action)
                result[name] = "completed" if ran else "already_done_or_running"
            except Exception:
                logger.exception("Scheduled %s job failed", name)
                result[name] = "failed"
        return result
    except Exception:
        result["runner"] = "failed"
        raise
    finally:
        _record_runner_state({
            "last_finished_at": datetime.now(timezone.utc).isoformat(),
            "last_results": json.dumps(result),
        })


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    statuses = run_due()
    logger.info("Scheduled job status: %s", statuses)
    if "failed" in statuses.values():
        sys.exit(1)
