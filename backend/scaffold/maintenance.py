"""Maintenance-mode state backed by the system_settings DB table.

All replicas share the same PostgreSQL database, so toggling maintenance from
any replica is visible to all others within _CACHE_TTL seconds (default 1 s).

The Caddy full_maintenance sentinel (FULL_MAINTENANCE_PATH) is a separate
concern used only by the deploy script during full downtime when the app
container is stopped.  It goes away when Caddy is replaced by a K8s Ingress.
"""
import os
import time
from pathlib import Path

# Caddy deploy-time full-downtime sentinel.  Checked by Caddy, not by the app.
FULL_MAINTENANCE_PATH = Path(os.getenv("FULL_MAINTENANCE_SENTINEL_PATH", "/app/data/full_maintenance"))

# Module-level cache: (active: bool, checked_at: float) or None
_cache: tuple[bool, float] | None = None
_CACHE_TTL: float = 1.0  # seconds — controls how quickly a toggle propagates to other replicas


def is_maintenance_active() -> bool:
    """Return whether app-level maintenance mode is currently active.

    Opens its own short-lived DB session so it can be called from ASGI
    middleware without a request-scoped session.  Uses a 1-second TTL cache
    so the overhead is at most one extra SELECT per second per replica.
    """
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
                text("SELECT value FROM system_settings WHERE key = 'maintenance_active'")
            ).scalar()
            active = (row == "true") if row is not None else False
        finally:
            db.close()
    except Exception:
        # DB unavailable: return cached value if we have one, else assume inactive
        if _cache is not None:
            return _cache[0]

    _cache = (active, now)
    return active


def set_maintenance(db, active: bool) -> None:
    """Write maintenance state to DB and invalidate the local TTL cache immediately.

    Callers must pass an open SQLAlchemy session; this function commits it.
    """
    global _cache
    from sqlalchemy import text
    db.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'maintenance_active'"),
        {"v": "true" if active else "false"},
    )
    db.commit()
    # Invalidate cache on this instance so it reflects the new state immediately
    _cache = (active, time.monotonic())
