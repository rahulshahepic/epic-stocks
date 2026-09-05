"""Per-user rate limiters for expensive API endpoints.

check_rate      — in-memory, per-process. Effective limit scales with replica
                  count, but still provides meaningful DoS protection for
                  compute-heavy endpoints.
check_rate_ip   — same, keyed on the caller's address. Get that address from
                  scaffold.client_ip, never request.client.host: behind the
                  proxy the socket peer is Caddy for every caller, which
                  collapses the whole limit into one shared bucket.
check_rate_db   — shared across all replicas. Backed by Redis when REDIS_URL is
                  configured, which it is in production; otherwise by a row in
                  system_settings.

The DB fallback is racy by construction — read JSON, modify, write back — so
two concurrent requests can each read a count of 4, each write 5, and together
consume one slot instead of two. Redis INCR is a single atomic operation and
has no such window, so it is preferred whenever it is available.
"""
import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_calls: dict[tuple, list[float]] = defaultdict(list)
_lock = Lock()


def _too_many() -> HTTPException:
    return HTTPException(status_code=429, detail="Too many requests — please slow down")


def _redis():
    """The shared Redis client, or None when it is not configured or is down."""
    try:
        from app import event_cache
        return event_cache._client
    except Exception:
        return None


def _check_rate_redis(client, key: str, max_calls: int, window_secs: int) -> bool:
    """Atomic counter. Returns False when Redis could not answer.

    INCR then EXPIRE, pipelined: the increment is the decision, so two
    concurrent callers cannot both read the same pre-increment value. The
    expiry is set on every call rather than only on creation — one extra
    command, against the alternative of a key that never expires if the process
    dies between the two.
    """
    try:
        window_start = int(time.time()) // window_secs
        full_key = f"ratelimit:{key}:{window_start}"
        pipe = client.pipeline()
        pipe.incr(full_key)
        pipe.expire(full_key, window_secs * 2)
        count = pipe.execute()[0]
    except Exception:
        logger.warning("Redis rate limit unavailable, falling back", exc_info=True)
        return False
    if int(count) > max_calls:
        raise _too_many()
    return True


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
            raise _too_many()
        recent.append(now)
        _calls[key] = recent


def check_rate_ip(ip: str, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Raise HTTP 429 if the IP has exceeded max_calls within window_secs for endpoint.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    key = (ip, endpoint)
    now = time.monotonic()
    with _lock:
        recent = [t for t in _calls[key] if now - t < window_secs]
        if len(recent) >= max_calls:
            raise _too_many()
        recent.append(now)
        _calls[key] = recent


def check_rate_db(user_id: int, endpoint: str, max_calls: int, window_secs: int, db) -> None:
    """Rate limit shared across all replicas.

    Uses Redis when it is available, because the DB path below is a
    read-modify-write on a JSON blob and loses increments under concurrency —
    two requests reading the same count both write count+1, so the pair
    consumes one slot. Redis INCR has no such window.

    The DB path remains as a fallback for deployments without Redis, and for
    the moments when Redis is unreachable: a limiter that stops limiting when
    its backing store blips is worse than a slightly leaky one.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return

    client = _redis()
    if client is not None and _check_rate_redis(client, f"{endpoint}:{user_id}", max_calls, window_secs):
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
        raise _too_many()
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
