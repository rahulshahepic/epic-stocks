"""Rate limiters for expensive API endpoints.

check_rate          — in-memory, per-process, keyed on a user id.
check_rate_ip       — in-memory, keyed on the caller's address.
check_rate_shared   — user id, shared across replicas via Redis.
check_rate_ip_shared— address, shared across replicas via Redis. The one the
                      unauthenticated endpoints use, because they have no user
                      id to key on and are the ones strangers can reach.
check_rate_db       — user id, shared via Redis, falling back to a row in
                      system_settings for deployments without Redis.

Get the address from scaffold.client_ip, never request.client.host: behind the
proxy the socket peer is Caddy for every caller, which collapses the whole
limit into one shared bucket.

Two things make an anonymous limit real, and Redis is only one of them.

*Where the count lives.* An in-process counter is per worker and starts empty
after every deploy and restart, so the effective limit is the stated one times
the number of processes, and it resets on a schedule an attacker can watch.
Redis INCR is atomic and shared, which is also why it is preferred over the DB
fallback: that path is read-modify-write on a JSON blob, so two concurrent
requests can each read 4, each write 5, and together consume one slot.

*What the count is keyed on.* Redis does nothing for this. An IPv6 caller is
normally handed a whole /64 — 18 quintillion addresses — so a limit keyed on
the full address is not a limit: rotating the low bits costs nothing and buys a
fresh bucket every request. Addresses are bucketed by _ip_bucket before they
are counted.
"""
import ipaddress
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

# The in-memory limiters key on (caller, endpoint) and nothing ever removed a
# key once its window passed. Keyed on an address that is one line of the
# unbounded IPv6 space, on endpoints an anonymous caller can reach, that is a
# slow memory leak an attacker sets the pace of. Sweep on a schedule instead of
# on every call: the cost is one pass over the dict, not one per request.
_SWEEP_EVERY = 1000
_MAX_AGE = 3600
_since_sweep = 0


def _sweep_locked(now: float) -> None:
    """Drop keys whose most recent call is older than any window in use.

    Caller holds _lock.
    """
    stale = [k for k, times in _calls.items() if not times or now - times[-1] > _MAX_AGE]
    for k in stale:
        del _calls[k]


def _note_call_locked(key: tuple, now: float) -> None:
    """Count one call against `key`, sweeping the table now and then."""
    global _since_sweep
    _since_sweep += 1
    if _since_sweep >= _SWEEP_EVERY:
        _since_sweep = 0
        _sweep_locked(now)


def _too_many() -> HTTPException:
    return HTTPException(status_code=429, detail="Too many requests — please slow down")


# The smallest IPv6 block a caller cannot trivially expand. Providers hand out a
# /64 to a single customer as a matter of course (often a /56 or shorter), so
# counting per address lets one attacker hold effectively unlimited buckets
# while a legitimate IPv4 caller gets exactly one. Grouping the /64 also groups
# a household, which is the same treatment IPv4 users already get behind NAT.
IPV6_BUCKET_BITS = 64


def _ip_bucket(ip: str) -> str:
    """The key an address is counted under.

    IPv4 is itself. IPv6 collapses to its /64. An address that will not parse —
    client_ip's UNKNOWN, most obviously — is returned unchanged, so those keep
    sharing the single deliberate bucket that value exists to give them.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 4:
        return str(addr)
    # An IPv4 address wearing an IPv6 costume is counted as the IPv4 it is,
    # otherwise ::ffff:203.0.113.7 would be a second bucket for one caller.
    mapped = addr.ipv4_mapped
    if mapped is not None:
        return str(mapped)
    network = ipaddress.ip_network(f"{addr}/{IPV6_BUCKET_BITS}", strict=False)
    return f"{network.network_address}/{IPV6_BUCKET_BITS}"


_redis_client = None
_redis_checked = False


def _redis():
    """A Redis client for the counters, or None when REDIS_URL is not set.

    Connects on its own rather than borrowing app.event_cache's client:
    scaffold is the forkable infra layer and must not import app (enforced by
    .importlinter). A second pool against the same server costs a connection
    and keeps the layering honest.
    """
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    url = os.getenv("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis
        client = redis.Redis.from_url(
            url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3
        )
        client.ping()
        _redis_client = client
    except Exception:
        logger.warning("Redis unavailable for rate limiting, using the DB fallback", exc_info=True)
        _redis_client = None
    return _redis_client


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
        _note_call_locked(key, now)
        recent = [t for t in _calls[key] if now - t < window_secs]
        if len(recent) >= max_calls:
            raise _too_many()
        recent.append(now)
        _calls[key] = recent


def check_rate_ip(ip: str, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Raise HTTP 429 if the caller has exceeded max_calls within window_secs.

    Counted per _ip_bucket, so an IPv6 caller cannot mint a fresh bucket per
    request. Per-process — prefer check_rate_ip_shared on anything a stranger
    can reach.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    key = (_ip_bucket(ip), endpoint)
    now = time.monotonic()
    with _lock:
        _note_call_locked(key, now)
        recent = [t for t in _calls[key] if now - t < window_secs]
        if len(recent) >= max_calls:
            raise _too_many()
        recent.append(now)
        _calls[key] = recent


def check_rate_shared(user_id: int, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Rate limit shared across replicas when Redis is up, per-process otherwise.

    Same guarantee as check_rate_db minus the DB fallback, so it is safe to
    call from places that hold no session — middleware, for one, where opening
    a session and committing a counter row on every write request would cost
    more than the limit saves.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    client = _redis()
    if client is not None and _check_rate_redis(client, f"{endpoint}:{user_id}", max_calls, window_secs):
        return
    check_rate(user_id, endpoint, max_calls, window_secs)


def check_rate_ip_shared(ip: str, endpoint: str, max_calls: int, window_secs: int) -> None:
    """Anonymous rate limit, shared across replicas and across restarts.

    What the unauthenticated endpoints use. There is no user id to key on
    there, so the address is all there is, and those are the endpoints a
    stranger reaches — a limit that resets on deploy and multiplies by worker
    count is not much of one.

    Falls back to the per-process counter when Redis is unreachable: a limiter
    that stops limiting when its store blips is worse than a leaky one.

    No-op when E2E_TEST=1.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    bucket = _ip_bucket(ip)
    client = _redis()
    if client is not None and _check_rate_redis(
        client, f"{endpoint}:ip:{bucket}", max_calls, window_secs
    ):
        return
    check_rate_ip(bucket, endpoint, max_calls, window_secs)


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
