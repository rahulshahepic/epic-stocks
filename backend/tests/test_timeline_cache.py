from datetime import datetime
import timeline_cache as tc


def _grants():
    return [{
        "year": 2020, "type": "RSU", "shares": 100, "price": 0.0,
        "vest_start": datetime(2021, 1, 1), "periods": 4,
        "exercise_date": datetime(2020, 6, 1), "dp_shares": 0,
    }]


def _prices():
    return [
        {"date": datetime(2020, 1, 1), "price": 10.0},
        {"date": datetime(2021, 1, 1), "price": 20.0},
    ]


def test_cache_hit_returns_same_object():
    tc._cache.clear()
    result1 = tc.get_timeline(1, _grants(), _prices(), [], 10.0)
    result2 = tc.get_timeline(1, _grants(), _prices(), [], 10.0)
    assert result1 is result2  # same object — cache hit


def test_cache_miss_on_changed_data():
    tc._cache.clear()
    result1 = tc.get_timeline(1, _grants(), _prices(), [], 10.0)

    prices2 = _prices() + [{"date": datetime(2022, 1, 1), "price": 30.0}]
    result2 = tc.get_timeline(1, _grants(), prices2, [], 10.0)

    assert result1 is not result2
    assert len(result2) > len(result1)


def test_different_users_isolated():
    tc._cache.clear()
    r1 = tc.get_timeline(1, _grants(), _prices(), [], 10.0)
    r2 = tc.get_timeline(2, _grants(), _prices(), [], 10.0)
    # Different user_id — separate cache entries, but equal content
    assert r1 is not r2
    assert r1 == r2


def test_cache_stores_one_entry_per_user():
    tc._cache.clear()
    tc.get_timeline(1, _grants(), _prices(), [], 10.0)
    assert len(tc._cache) == 1

    prices2 = _prices() + [{"date": datetime(2022, 1, 1), "price": 30.0}]
    tc.get_timeline(1, _grants(), prices2, [], 10.0)
    assert len(tc._cache) == 1  # old entry replaced, not accumulated
