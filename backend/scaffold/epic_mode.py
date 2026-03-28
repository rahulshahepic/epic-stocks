"""Epic-mode state backed by the system_settings DB table.

When epic_mode is active, write endpoints for grants, prices, loans, and
imports return 403 — data is owned by Epic's systems.  Users can still take
actions (sales, loan payments, tax settings).

Setting EPIC_MODE=true in the environment hard-enables epic mode regardless of
the DB value (useful for the production Epic deployment where the flag should
never be toggled off at runtime).
"""
import os
import time

_cache: tuple[bool, float] | None = None
_CACHE_TTL: float = 1.0  # seconds


def is_epic_mode() -> bool:
    """Return whether epic mode is currently active.

    Environment variable EPIC_MODE=true takes precedence over the DB value.
    Uses a 1-second TTL cache to avoid a DB round-trip on every request.
    """
    if os.environ.get("EPIC_MODE", "").lower() in ("1", "true", "yes"):
        return True

    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[1] < _CACHE_TTL:
        return _cache[0]

    active = False
    try:
        import database
        from sqlalchemy import text
        db = database.SessionLocal()
        try:
            row = db.execute(
                text("SELECT value FROM system_settings WHERE key = 'epic_mode'")
            ).scalar()
            active = (row == "true") if row is not None else False
        finally:
            db.close()
    except Exception:
        if _cache is not None:
            return _cache[0]

    _cache = (active, now)
    return active


def set_epic_mode(db, active: bool) -> None:
    """Write epic mode state to DB and invalidate the local TTL cache.

    Callers must pass an open SQLAlchemy session; this function commits it.
    """
    global _cache
    from sqlalchemy import text
    db.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'epic_mode'"),
        {"v": "true" if active else "false"},
    )
    db.commit()
    _cache = (active, time.monotonic())
