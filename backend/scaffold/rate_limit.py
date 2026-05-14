"""Per-user rate limiters for expensive API endpoints.

check_rate      — in-memory, per-process. Effective limit scales with replica
                  count, but still provides meaningful DoS protection for
                  compute-heavy endpoints.
check_rate_db   — DB-backed via system_settings JSON. Shared across all replicas;
                  use for endpoints where a per-replica limit is insufficient.
"""
import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

from fastapi import HTTPException

_calls: dict[tuple, list[float]] = defaultdict(list)
_lock = Lock()


def check_rate(user_id: int, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Raise HTTP 429 if user_id has exceeded max_calls within window_secs for endpoint.

    No-op when E2E_TEST=1 so the test suite can call endpoints freely.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    key = (user_id, endpoint)
    now = time.monotonic()
    with _lock:
        recent = [t for t in _calls[key] if now - t < window_secs]
        if len(recent) >= max_calls:
            raise HTTPException(status_code=429, detail="Too many requests — please slow down")
        recent.append(now)
        _calls[key] = recent


def check_rate_db(user_id: int, endpoint: str, max_calls: int, window_secs: int, db) -> None:
    """DB-backed rate limit shared across all replicas.

    Counts are stored in system_settings as JSON under key
    'rate_limit:<endpoint>'. Each entry is keyed by '<user_id>:<window_start>'
    where window_start is a Unix timestamp floored to window_secs.
    Stale windows are pruned on every call.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    from sqlalchemy import text
    now_ts = int(datetime.now(timezone.utc).timestamp())
    window_start = (now_ts // window_secs) * window_secs
    full_key = f"{user_id}:{window_start}"
    settings_key = f"rate_limit:{endpoint}"
    row = db.execute(
        text("SELECT value FROM system_settings WHERE key = :k"), {"k": settings_key}
    ).scalar()
    counts: dict = json.loads(row) if row else {}
    # Prune entries outside the current window
    counts = {k: v for k, v in counts.items() if k.endswith(f":{window_start}")}
    if counts.get(full_key, 0) >= max_calls:
        raise HTTPException(status_code=429, detail="Too many requests — please slow down")
    counts[full_key] = counts.get(full_key, 0) + 1
    serialized = json.dumps(counts)
    if row is not None:
        db.execute(
            text("UPDATE system_settings SET value = :v WHERE key = :k"),
            {"v": serialized, "k": settings_key},
        )
    else:
        db.execute(
            text("INSERT INTO system_settings (key, value) VALUES (:k, :v)"),
            {"k": settings_key, "v": serialized},
        )
    db.commit()
