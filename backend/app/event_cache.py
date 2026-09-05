"""
Optional Redis L2 cache for computed timelines.

When REDIS_URL is not set, all public functions are no-ops and the existing
in-process timeline_cache remains the only cache layer.

Redis key format: timeline:{user_id}:{data_hash}
where data_hash matches timeline_cache._hash() for the same input data.
"""
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

import redis

logger = logging.getLogger(__name__)

_client: Optional[redis.Redis] = None
_TTL = 86400  # 24 hours


def init(url: str) -> None:
    global _client
    r = redis.Redis.from_url(url, decode_responses=False, socket_connect_timeout=3, socket_timeout=3)
    r.ping()
    _client = r
    logger.info("Redis cache connected")


def close() -> None:
    global _client
    if _client:
        try:
            _client.close()
        except Exception:
            pass
        _client = None


_CACHE_VERSION = os.getenv("VITE_COMMIT_SHA", "dev")


def _key(user_id: int, data_hash: str) -> str:
    return f"timeline:{_CACHE_VERSION}:{user_id}:{data_hash}"


def get(user_id: int, data_hash: str) -> Optional[list]:
    if not _client:
        return None
    try:
        raw = _client.get(_key(user_id, data_hash))
        if not raw:
            return None
        timeline = json.loads(raw)
        # Restore date strings to datetime objects (serialised as YYYY-MM-DD by put())
        for event in timeline:
            d = event.get("date")
            if isinstance(d, str):
                try:
                    event["date"] = datetime.strptime(d, "%Y-%m-%d")
                except ValueError:
                    pass
        return timeline
    except Exception:
        logger.debug("Redis get failed for user %s", user_id, exc_info=True)
        return None


def put(user_id: int, data_hash: str, timeline: list) -> None:
    if not _client:
        return
    try:
        def _json_default(v):
            if isinstance(v, datetime):
                return v.strftime("%Y-%m-%d")
            return str(v)
        _client.setex(_key(user_id, data_hash), _TTL, json.dumps(timeline, default=_json_default))
    except Exception:
        logger.debug("Redis put failed for user %s", user_id, exc_info=True)


def _do_recompute(user_id: int) -> None:
    """Fetch DB data for user_id, compute timeline, store in Redis."""
    from database import SessionLocal
    from scaffold.models import Grant, Price, Loan, User as UserModel
    from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key
    from app.core import generate_all_events, compute_timeline
    from services.timeline_cache import _hash

    db = SessionLocal()
    try:
        if encryption_enabled():
            user = db.get(UserModel, user_id)
            if user and user.encrypted_key:
                set_current_key(decrypt_user_key(user.encrypted_key))

        grants_db = db.query(Grant).filter(Grant.user_id == user_id).order_by(Grant.year).all()
        prices_db = db.query(Price).filter(Price.user_id == user_id).order_by(Price.effective_date).all()
        loans_db = db.query(Loan).filter(Loan.user_id == user_id).order_by(Loan.due_date).all()

        if not grants_db and not prices_db:
            return

        grants = [{
            "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
            "vest_start": datetime.combine(g.vest_start, datetime.min.time()),
            "periods": g.periods,
            "exercise_date": datetime.combine(g.exercise_date, datetime.min.time()),
            "dp_shares": g.dp_shares or 0,
        } for g in grants_db]
        prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]
        loans = [{
            "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
            "loan_type": ln.loan_type, "loan_year": ln.loan_year,
            "amount": ln.amount, "interest_rate": ln.interest_rate,
            "due": datetime.combine(ln.due_date, datetime.min.time()),
            "loan_number": ln.loan_number,
        } for ln in loans_db]

        initial_price = prices[0]["price"] if prices else 0
        data_hash = _hash(grants, prices, loans, initial_price)
        events = generate_all_events(grants, prices, loans)
        timeline = compute_timeline(events, initial_price)
        put(user_id, data_hash, timeline)
    except Exception:
        logger.warning("Background recompute failed for user %s", user_id, exc_info=True)
    finally:
        try:
            from scaffold.crypto import set_current_key
            set_current_key(None)
        except Exception:
            pass
        db.close()


# One dispatcher thread drains a coalescing queue into a bounded pool, so any
# number of invalidations costs a fixed number of threads. Without this a burst
# of mutations spawned one thread each, and every price change spawned a
# ten-worker fan-out of its own.
_MAX_WORKERS = int(os.getenv("EVENT_CACHE_WORKERS", "4"))
_IDLE_EXIT_SECS = 300

_queue_lock = threading.Lock()
_wake = threading.Event()
_pending: set[int] = set()
_fan_out_pending = False
_dispatcher: Optional[threading.Thread] = None
_pool: Optional[ThreadPoolExecutor] = None


def _start_dispatcher_locked() -> None:
    global _dispatcher
    if _dispatcher is None or not _dispatcher.is_alive():
        _dispatcher = threading.Thread(target=_dispatch, daemon=True, name="event-cache-dispatch")
        _dispatcher.start()


def _all_user_ids() -> list[int]:
    from database import SessionLocal
    from scaffold.models import User as UserModel
    db = SessionLocal()
    try:
        return [row[0] for row in db.query(UserModel.id).all()]
    finally:
        db.close()


def _dispatch() -> None:
    global _dispatcher, _fan_out_pending, _pool
    while True:
        _wake.wait(timeout=_IDLE_EXIT_SECS)
        with _queue_lock:
            _wake.clear()
            fan_out, _fan_out_pending = _fan_out_pending, False
            batch = _pending.copy()
            _pending.clear()
            if not fan_out and not batch:
                _dispatcher = None  # nothing left; the next schedule_* restarts us
                return
        if fan_out:
            try:
                batch.update(_all_user_ids())
            except Exception:
                logger.warning("Fan-out user lookup failed", exc_info=True)
        if not batch:
            continue
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="event-cache")
        # Block until the batch is done: one batch at a time keeps the pool,
        # the DB connections and the recompute load bounded.
        try:
            list(_pool.map(_do_recompute, batch))
        except Exception:
            logger.warning("Recompute batch failed", exc_info=True)


def schedule_recompute(user_id: int) -> None:
    """Queue an async recompute for one user after their grants or loans change.

    Repeated calls for the same user coalesce into one pending recompute.
    """
    if not _client:
        return
    with _queue_lock:
        _pending.add(user_id)
        _start_dispatcher_locked()
        _wake.set()


def redis_info() -> dict:
    if not _client:
        return {"connected": False}
    try:
        mem = _client.info("memory")
        keyspace = _client.info("keyspace")
        timeline_keys = _client.keys("timeline:*")
        db_info = next(iter(keyspace.values()), {}) if keyspace else {}
        return {
            "connected": True,
            "timeline_keys": len(timeline_keys),
            "total_keys": db_info.get("keys", 0),
            "used_memory_bytes": mem.get("used_memory"),
            "used_memory_human": mem.get("used_memory_human"),
            "maxmemory_bytes": mem.get("maxmemory") or None,
            "maxmemory_policy": mem.get("maxmemory_policy"),
        }
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


def schedule_fan_out() -> None:
    """Queue an async recompute for every user.

    Concurrent calls collapse into a single pending fan-out; the user list is
    read once, when the dispatcher picks the work up.
    """
    if not _client:
        return
    global _fan_out_pending
    with _queue_lock:
        _fan_out_pending = True
        _start_dispatcher_locked()
        _wake.set()
