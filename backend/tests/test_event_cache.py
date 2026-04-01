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
