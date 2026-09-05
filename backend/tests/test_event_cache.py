import json
from unittest.mock import MagicMock
import app.event_cache as ec


def test_get_returns_none_without_redis():
    assert ec._client is None
    assert ec.get(1, "abc") is None


def test_put_noop_without_redis():
    ec.put(1, "abc", [{"event_type": "Vesting"}])  # must not raise


def test_schedule_recompute_noop_without_redis():
    ec.schedule_recompute(1)  # must not raise or spawn thread


def test_schedule_fan_out_noop_without_redis():
    ec.schedule_fan_out()  # must not raise


def test_get_returns_cached_timeline():
    from datetime import datetime
    mock_redis = MagicMock()
    # Dates are stored as "YYYY-MM-DD" strings; get() must deserialize them back to datetime
    timeline = [{"event_type": "Vesting", "date": "2021-01-01"}]
    mock_redis.get.return_value = json.dumps(timeline).encode()

    ec._client = mock_redis
    try:
        result = ec.get(42, "hash123")
        assert result[0]["event_type"] == "Vesting"
        assert result[0]["date"] == datetime(2021, 1, 1)
        mock_redis.get.assert_called_once_with(ec._key(42, "hash123"))
    finally:
        ec._client = None


def test_get_returns_none_on_cache_miss():
    mock_redis = MagicMock()
    mock_redis.get.return_value = None

    ec._client = mock_redis
    try:
        assert ec.get(42, "hash123") is None
    finally:
        ec._client = None


def test_put_stores_serialized_timeline():
    mock_redis = MagicMock()
    timeline = [{"event_type": "Vesting", "date": "2021-01-01"}]

    ec._client = mock_redis
    try:
        ec.put(42, "hash123", timeline)
        mock_redis.setex.assert_called_once()
        args = mock_redis.setex.call_args[0]
        assert args[0] == ec._key(42, "hash123")
        assert args[1] == ec._TTL
        assert json.loads(args[2]) == timeline
    finally:
        ec._client = None


def test_get_returns_none_on_redis_error():
    mock_redis = MagicMock()
    mock_redis.get.side_effect = Exception("Connection refused")

    ec._client = mock_redis
    try:
        assert ec.get(42, "hash123") is None  # graceful degradation
    finally:
        ec._client = None


def test_put_silently_fails_on_redis_error():
    mock_redis = MagicMock()
    mock_redis.setex.side_effect = Exception("Connection refused")

    ec._client = mock_redis
    try:
        ec.put(42, "hash123", [])  # must not raise
    finally:
        ec._client = None


# ── Scheduling: coalescing and bounded threads ───────────────────────────────

def _wait_until(cond, timeout=5.0, what="condition"):
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return
        time.sleep(0.01)
    raise AssertionError(f"timed out waiting for {what}")


def _drain(timeout=5.0):
    """Wait for the dispatcher to take and finish the queued batch."""
    def _idle():
        with ec._queue_lock:
            return not ec._pending and not ec._fan_out_pending
    _wait_until(_idle, timeout, "the queue to drain")


class _Scheduler:
    """Runs the module against a stub Redis and records recomputes."""

    def __enter__(self):
        self.calls = []
        self._real = ec._do_recompute
        ec._do_recompute = self.calls.append
        ec._client = MagicMock()
        return self

    def __exit__(self, *exc):
        _drain()
        ec._do_recompute = self._real
        ec._client = None
        with ec._queue_lock:
            ec._pending.clear()
            ec._fan_out_pending = False


def test_repeated_recomputes_for_one_user_coalesce():
    import threading
    before = threading.active_count()
    with _Scheduler() as s:
        # Hold the queue so every call lands in the same batch.
        with ec._queue_lock:
            for _ in range(100):
                ec._pending.add(7)
                ec._start_dispatcher_locked()
                ec._wake.set()
        _drain()
        _wait_until(lambda: s.calls, what="the recompute to run")
        assert s.calls == [7]
    # One dispatcher plus the bounded pool — never one thread per call.
    assert threading.active_count() - before <= ec._MAX_WORKERS + 1


def test_many_schedule_calls_do_not_spawn_a_thread_each():
    import threading
    before = threading.active_count()
    with _Scheduler():
        for uid in range(100):
            ec.schedule_recompute(uid)
        for _ in range(100):
            ec.schedule_fan_out()
        _drain()
    assert threading.active_count() - before <= ec._MAX_WORKERS + 1


def test_fan_out_reads_the_user_list_once_per_batch():
    lookups = []

    def _users():
        lookups.append(1)
        return [1, 2, 3]

    real = ec._all_user_ids
    ec._all_user_ids = _users
    try:
        with _Scheduler() as s:
            with ec._queue_lock:
                for _ in range(50):
                    ec._fan_out_pending = True
                    ec._start_dispatcher_locked()
                    ec._wake.set()
            _drain()
            _wait_until(lambda: len(s.calls) == 3, what="the fan-out to run")
            assert len(lookups) == 1
            assert sorted(s.calls) == [1, 2, 3]
    finally:
        ec._all_user_ids = real


def test_dispatcher_survives_a_failing_user_lookup():
    def _boom():
        raise RuntimeError("db down")

    real = ec._all_user_ids
    ec._all_user_ids = _boom
    try:
        with _Scheduler() as s:
            ec.schedule_fan_out()
            ec.schedule_recompute(9)
            _drain()
            _wait_until(lambda: 9 in s.calls, what="the recompute after a failed lookup")
    finally:
        ec._all_user_ids = real


def test_price_changes_recompute_only_their_owner(client):
    """A price row belongs to one user, so it never triggers an all-user fan-out."""
    from unittest.mock import patch
    from tests.conftest import register_user
    register_user(client)
    with patch("app.event_cache.schedule_fan_out") as fan_out, \
         patch("app.event_cache.schedule_recompute") as recompute:
        resp = client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 5.0})
    assert resp.status_code == 201
    fan_out.assert_not_called()
    recompute.assert_called_once()
