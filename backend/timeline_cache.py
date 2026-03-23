"""
In-process content-addressed cache for compute_timeline.

Keyed by (user_id, sha256 of serialised inputs) so no explicit invalidation
is needed — if grants/prices/loans change the hash changes and we recompute.
One entry per user; old entry is overwritten on data change.
"""
import hashlib
import json

from core import generate_all_events, compute_timeline

# user_id -> (input_hash, timeline)
_cache: dict[int, tuple[str, list]] = {}


def _hash(grants: list, prices: list, loans: list, initial_price: float) -> str:
    payload = json.dumps([grants, prices, loans, initial_price], default=str, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def get_timeline(user_id: int, grants: list, prices: list, loans: list, initial_price: float) -> list:
    key = _hash(grants, prices, loans, initial_price)
    cached = _cache.get(user_id)
    if cached and cached[0] == key:
        return cached[1]
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    _cache[user_id] = (key, timeline)
    return timeline
