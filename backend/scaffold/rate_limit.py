"""Per-user in-memory rate limiter for expensive API endpoints.

Intentionally simple — no Redis dependency, no persistence. In a multi-replica
deployment the effective limit is per-process, so the actual cap is
max_calls * N replicas. For the compute-heavy endpoints guarded here this is
still meaningful protection: even at 2-3x the stated limit, the rate is low
enough that server resources are protected.
"""
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException

_calls: dict[tuple, list[float]] = defaultdict(list)
_lock = Lock()


def check_rate(user_id: int, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Raise HTTP 429 if user_id has exceeded max_calls within window_secs for endpoint.

    No-op when E2E_TEST=1 so the test suite can call endpoints freely.
    """
    import os
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
