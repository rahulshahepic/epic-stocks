# Redis Cache Invalidation Plan

## Current State

`backend/app/timeline_cache.py` is a single-process, in-memory, content-addressed cache. It hashes the serialised inputs (grants + prices + loans + initial_price) and recomputes only when the hash changes. No explicit invalidation logic is needed today because:

- This app is the sole writer.
- Each request re-fetches source data from the DB before calling `get_timeline()`, so the hash drift is caught immediately.

## Why Redis Is Needed at Epic

At Epic the DB will be written by **external systems** — not by this app. A single in-process cache does not work because:

1. **Multiple replicas** — each replica has its own in-memory cache; cross-replica invalidation is impossible without a shared backing store.
2. **External writers** — Epic's backend processes grants, loans, and prices without going through our API, so our cache never learns the data changed.

---

## Write Taxonomy

Understanding *who* writes *what* drives the invalidation design.

### External writers (Epic's platform, batch jobs)

| Event | Tables touched | Scope |
|---|---|---|
| New stock price published | `prices` | **All users** |
| Purchase / bonus grants processed | `grants`, `loans` | Per-user |
| Interest loans processed | `loans` | Per-user |
| Batch loan payoffs processed | `loans`, `loan_payments` | Per-user (batch) |
| Exit event declared | `prices`, possibly `grants` | **All users** |

### User-initiated writes (go through our API)

| Action | Tables touched | Scope | Notes |
|---|---|---|---|
| Early loan payoff request | `loans`, `loan_payments`, optionally `sales` | That user | Epic uses LIFO for share selection, but skips late-basis lots that would produce STCG where avoidable |
| Stock sale (specific tranche) | `sales`, `loans` | That user | Must first pay off loans attached to that tranche; remainder converts to cash |
| Stock sale with tax withholding | `sales`, `loans` | That user | Sale must cover withholding + loan balance; user will also want an "estimate what gives me $X net" helper |

---

## Proposed Redis Cache Design

### Key structure

```
timeline:{user_id}          # serialised timeline list
```

Keep **one key per user**. Because a cache hit on a valid key skips the DB entirely, we must invalidate aggressively rather than rely on content-addressing in Redis (which would require a DB round-trip to compute the hash anyway, negating the benefit of Redis over the current approach).

### TTL (safety net)

Always set a TTL of **10 minutes** as a last-resort expiry. This is not the primary invalidation mechanism — it is a safeguard against missed invalidations from external writers.

---

## Invalidation Strategy

### 1. User-initiated writes (easy)

Our own API handlers write to the DB and can immediately call `invalidate(user_id)`. No external coordination needed.

```python
# after any write in grants.py / loans.py / sales.py / prices.py:
await cache.invalidate(user_id)
```

### 2. Price writes (hard — affects all users)

A new price affects every user's timeline. Options, ranked by preference:

#### Option A — Postgres LISTEN/NOTIFY (recommended)

Add a Postgres trigger on the `prices` table:

```sql
CREATE OR REPLACE FUNCTION notify_price_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('price_changed', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_changed
  AFTER INSERT OR UPDATE ON prices
  FOR EACH ROW EXECUTE FUNCTION notify_price_change();
```

A background asyncio task in `main.py` listens on the `price_changed` channel and calls `cache.invalidate_all()` (or flushes a Redis key prefix). This is transparent to Epic's platform — they write to the DB as normal.

#### Option B — Internal invalidation endpoint

Expose a protected internal endpoint:

```
POST /internal/cache/invalidate
Body: { "scope": "all" } | { "user_id": 123 }
```

Epic's platform calls this after batch runs. Requires coordination with their platform team and a shared secret / internal network policy. Simpler to implement but adds operational coupling.

#### Option C — Short TTL only

Accept up to 10-minute stale data for price changes. Acceptable if Epic's price updates are infrequent (e.g. monthly) and the batch jobs run overnight when users are not active.

### 3. Batch grant / loan writes (medium)

If Epic's batch jobs can emit a list of affected `user_id`s after processing, we can call `invalidate(user_id)` for each. If not, the LISTEN/NOTIFY pattern can be extended to `grants` and `loans` tables:

```sql
PERFORM pg_notify('user_data_changed', NEW.user_id::text);
```

The listener maps the `user_id` to a Redis key delete — only the affected user's cache is cleared.

---

## Implementation Sketch

```python
# backend/app/redis_cache.py

import redis.asyncio as aioredis

class TimelineCache:
    def __init__(self, redis_url: str, ttl: int = 600):
        self.r = aioredis.from_url(redis_url)
        self.ttl = ttl

    def _key(self, user_id: int) -> str:
        return f"timeline:{user_id}"

    async def get(self, user_id: int) -> list | None:
        raw = await self.r.get(self._key(user_id))
        return json.loads(raw) if raw else None

    async def set(self, user_id: int, timeline: list) -> None:
        await self.r.set(self._key(user_id), json.dumps(timeline), ex=self.ttl)

    async def invalidate(self, user_id: int) -> None:
        await self.r.delete(self._key(user_id))

    async def invalidate_all(self) -> None:
        # SCAN is non-blocking; safe for production
        async for key in self.r.scan_iter("timeline:*"):
            await self.r.delete(key)
```

The existing `get_timeline()` in `timeline_cache.py` stays as a **fallback / test environment path** (no Redis dependency). The Redis cache wraps it:

```
request → try Redis → hit: return
                    → miss: load DB, call get_timeline(), write Redis, return
```

---

## Rollout Considerations

- **Config flag** — `REDIS_URL` env var absent → fall back to current in-process cache. No Redis required for dev/test.
- **Graceful degradation** — if Redis is unreachable, log a warning and fall through to compute (never raise to the user).
- **Encryption** — timelines contain financial data. If `KEY_ENCRYPTION_KEY` is set, encrypt the Redis value with a deterministic key derived from the user's key before writing.
- **Cluster awareness** — if Epic runs Redis Cluster, use hash tags `{user_id}` in the key so all keys for one user land on the same shard (simplifies `invalidate_all` patterns).

---

## Open Questions

1. **Can Epic's batch jobs notify us?** If yes, Option B is simplest. If no, Option A (Postgres triggers) is the cleanest zero-coordination solution.
2. **How frequent are price updates?** If monthly, TTL-only (Option C) may be sufficient for prices.
3. **STCG avoidance in LIFO sales** — the sale engine needs to model Epic's rule of skipping late-basis lots that would produce short-term capital gains. Confirm exact rule with Epic before implementing the early-payoff flow.
4. **"Estimate $X net" helper** — user wants to know what gross sale amount yields a target net-cash figure given taxes + loan payoff. This is a pure computation (no writes) — can it be a stateless endpoint that accepts scenario parameters without touching the DB?
