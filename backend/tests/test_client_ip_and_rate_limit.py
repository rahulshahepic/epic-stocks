"""Anonymous rate limits are only as good as the address they are keyed on.

Behind Caddy, uvicorn runs without --proxy-headers, so request.client.host is
the proxy's container address for every caller alive. Every check_rate_ip limit
was therefore one global bucket: one noisy reporter locked out everyone, and an
attacker rotating source addresses looked like a single caller.
"""
import sys
import os
import threading

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException

from scaffold.client_ip import UNKNOWN, client_ip, trusted_proxy_hops
from scaffold import rate_limit


class _Req:
    """The two things client_ip reads off a request."""
    def __init__(self, peer="10.9.0.2", forwarded=None):
        self.client = type("C", (), {"host": peer})() if peer else None
        self.headers = {"X-Forwarded-For": forwarded} if forwarded else {}


# ── No proxy configured ─────────────────────────────────────────────────────

def test_socket_peer_is_used_when_no_proxy_is_configured(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    assert client_ip(_Req(peer="203.0.113.7")) == "203.0.113.7"


def test_forwarded_header_is_ignored_when_no_proxy_is_configured(monkeypatch):
    """A directly-exposed deployment must never believe a caller-set header."""
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    req = _Req(peer="203.0.113.7", forwarded="1.2.3.4")
    assert client_ip(req) == "203.0.113.7"


def test_unknown_when_there_is_no_peer_at_all(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    assert client_ip(_Req(peer=None)) == UNKNOWN


# ── One proxy (Caddy) ───────────────────────────────────────────────────────

def test_one_hop_takes_the_last_forwarded_entry(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    req = _Req(peer="10.9.0.2", forwarded="203.0.113.7")
    assert client_ip(req) == "203.0.113.7"


def test_one_hop_ignores_a_client_supplied_prefix(monkeypatch):
    """A caller who sets their own XFF prepends to it; only Caddy's entry counts."""
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    req = _Req(peer="10.9.0.2", forwarded="1.2.3.4, 5.6.7.8, 203.0.113.7")
    assert client_ip(req) == "203.0.113.7"


# ── Two proxies (Cloudflare in front of Caddy) ──────────────────────────────

def test_two_hops_skips_the_inner_proxy(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    req = _Req(peer="10.9.0.2", forwarded="203.0.113.7, 172.68.0.1")
    assert client_ip(req) == "203.0.113.7"


def test_two_hops_ignores_a_spoofed_prefix(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    req = _Req(peer="10.9.0.2", forwarded="1.2.3.4, 203.0.113.7, 172.68.0.1")
    assert client_ip(req) == "203.0.113.7"


# ── Degenerate input ────────────────────────────────────────────────────────

@pytest.mark.parametrize("forwarded", [None, "", "not-an-ip", "1.2.3.4"])
def test_a_proxied_deployment_never_falls_back_to_the_proxy_address(forwarded, monkeypatch):
    """Falling back to the socket peer would restore the single-bucket bug.

    "1.2.3.4" is included because with two hops there is no entry at position
    -2, so the header cannot say who the client was.
    """
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert client_ip(_Req(peer="10.9.0.2", forwarded=forwarded)) == UNKNOWN


def test_ipv6_forwarded_entries_are_parsed(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    assert client_ip(_Req(forwarded="2001:db8::1")) == "2001:db8::1"
    assert client_ip(_Req(forwarded="[2001:db8::1]")) == "2001:db8::1"


def test_a_nonsense_hop_count_is_treated_as_no_proxy(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "banana")
    assert trusted_proxy_hops() == 0
    assert client_ip(_Req(peer="203.0.113.7", forwarded="1.2.3.4")) == "203.0.113.7"


def test_a_negative_hop_count_is_clamped(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "-3")
    assert trusted_proxy_hops() == 0


# ── Distinct addresses get distinct buckets ─────────────────────────────────

def test_two_addresses_do_not_share_a_bucket(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    rate_limit._calls.clear()

    for _ in range(3):
        rate_limit.check_rate_ip("203.0.113.7", "t_bucket", max_calls=3, window_secs=60)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_ip("203.0.113.7", "t_bucket", max_calls=3, window_secs=60)
    assert exc.value.status_code == 429

    # A different caller is unaffected — the whole point.
    rate_limit.check_rate_ip("198.51.100.4", "t_bucket", max_calls=3, window_secs=60)


# ── The shared limiter must not lose increments ─────────────────────────────

class _FakeRedis:
    """Enough of the redis client for the counter path, with a real lock."""
    def __init__(self):
        self.store = {}
        self.expiries = {}
        self._lock = threading.Lock()

    def pipeline(self):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.ops = []

    def incr(self, key):
        self.ops.append(("incr", key))

    def expire(self, key, secs):
        self.ops.append(("expire", key, secs))

    def execute(self):
        results = []
        with self.redis._lock:
            for op in self.ops:
                if op[0] == "incr":
                    self.redis.store[op[1]] = self.redis.store.get(op[1], 0) + 1
                    results.append(self.redis.store[op[1]])
                else:
                    self.redis.expiries[op[1]] = op[2]
                    results.append(True)
        return results


def test_redis_counter_admits_exactly_max_calls(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)

    for _ in range(5):
        rate_limit.check_rate_db(7, "t_import", max_calls=5, window_secs=300, db=None)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_db(7, "t_import", max_calls=5, window_secs=300, db=None)
    assert exc.value.status_code == 429


def test_redis_counter_loses_nothing_under_concurrency(monkeypatch):
    """The DB path's read-modify-write drops increments here; INCR does not."""
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)

    allowed = []
    barrier = threading.Barrier(20)

    def hit():
        barrier.wait()
        try:
            rate_limit.check_rate_db(9, "t_race", max_calls=5, window_secs=300, db=None)
            allowed.append(1)
        except HTTPException:
            pass

    threads = [threading.Thread(target=hit) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sum(allowed) == 5, f"20 concurrent callers got {sum(allowed)} slots, expected 5"


def test_users_get_separate_shared_buckets(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)

    for _ in range(5):
        rate_limit.check_rate_db(1, "t_sep", max_calls=5, window_secs=300, db=None)
    with pytest.raises(HTTPException):
        rate_limit.check_rate_db(1, "t_sep", max_calls=5, window_secs=300, db=None)

    rate_limit.check_rate_db(2, "t_sep", max_calls=5, window_secs=300, db=None)


def test_a_redis_outage_falls_back_to_the_database(monkeypatch, db_session):
    """A limiter that stops limiting when Redis blips is worse than a leaky one."""
    monkeypatch.delenv("E2E_TEST", raising=False)

    class _Broken:
        def pipeline(self):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(rate_limit, "_redis", lambda: _Broken())

    for _ in range(2):
        rate_limit.check_rate_db(11, "t_fallback", max_calls=2, window_secs=300, db=db_session)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_db(11, "t_fallback", max_calls=2, window_secs=300, db=db_session)
    assert exc.value.status_code == 429


# ── Which bucket an address is counted under ────────────────────────────────
#
# Redis fixes where the count lives. It does nothing about what the count is
# keyed on, and that is the half that decides whether an anonymous limit means
# anything: an IPv6 caller is handed a whole /64, so counting per address lets
# one attacker hold 18 quintillion buckets while an IPv4 caller gets one.

def test_ipv4_is_its_own_bucket():
    assert rate_limit._ip_bucket("203.0.113.7") == "203.0.113.7"
    assert rate_limit._ip_bucket("203.0.113.8") != rate_limit._ip_bucket("203.0.113.7")


def test_ipv6_addresses_in_one_allocation_share_a_bucket():
    """Rotating the low 64 bits is free, so it must not buy a fresh bucket."""
    a = rate_limit._ip_bucket("2001:db8:1234:5678::1")
    b = rate_limit._ip_bucket("2001:db8:1234:5678:ffff:ffff:ffff:ffff")
    c = rate_limit._ip_bucket("2001:db8:1234:5678:dead:beef:cafe:0001")
    assert a == b == c
    assert a.endswith("/64")


def test_separate_ipv6_allocations_stay_separate():
    """Grouping must not go so wide that unrelated callers collide."""
    assert (rate_limit._ip_bucket("2001:db8:1234:5678::1")
            != rate_limit._ip_bucket("2001:db8:1234:9999::1"))


def test_ipv4_mapped_ipv6_counts_as_the_ipv4():
    """::ffff:203.0.113.7 is one caller, not a second bucket for them."""
    assert rate_limit._ip_bucket("::ffff:203.0.113.7") == "203.0.113.7"


def test_unparseable_address_keeps_sharing_one_bucket():
    """client_ip's UNKNOWN is a deliberate shared bucket, not a free pass."""
    assert rate_limit._ip_bucket(UNKNOWN) == UNKNOWN


def test_ipv6_rotation_cannot_outrun_the_in_memory_limit(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    monkeypatch.setattr(rate_limit, "_redis", lambda: None)
    rate_limit._calls.clear()

    # Five requests, each from a different address in the same /64.
    for i in range(5):
        rate_limit.check_rate_ip(f"2001:db8:abcd:1::{i}", "t_v6", max_calls=5, window_secs=60)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_ip("2001:db8:abcd:1::99", "t_v6", max_calls=5, window_secs=60)
    assert exc.value.status_code == 429
    # A genuinely different allocation is untouched.
    rate_limit.check_rate_ip("2001:db8:abcd:2::1", "t_v6", max_calls=5, window_secs=60)


# ── The anonymous limit now survives a restart and spans replicas ───────────

def test_anonymous_limit_uses_redis(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)
    rate_limit._calls.clear()

    for _ in range(3):
        rate_limit.check_rate_ip_shared("203.0.113.9", "t_shared", max_calls=3, window_secs=300)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_ip_shared("203.0.113.9", "t_shared", max_calls=3, window_secs=300)
    assert exc.value.status_code == 429
    assert any("t_shared:ip:203.0.113.9" in k for k in fake.store), fake.store


def test_a_second_replica_shares_the_anonymous_count(monkeypatch):
    """The per-process counter is what a deploy resets and a worker multiplies."""
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)

    for _ in range(3):
        rate_limit.check_rate_ip_shared("198.51.100.1", "t_replica", max_calls=3, window_secs=300)
    # Standing in for another process: its in-memory table is empty, but the
    # shared counter is not.
    rate_limit._calls.clear()
    with pytest.raises(HTTPException):
        rate_limit.check_rate_ip_shared("198.51.100.1", "t_replica", max_calls=3, window_secs=300)


def test_ipv6_rotation_cannot_outrun_the_shared_limit(monkeypatch):
    monkeypatch.delenv("E2E_TEST", raising=False)
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: fake)

    for i in range(3):
        rate_limit.check_rate_ip_shared(f"2001:db8:5:5::{i}", "t_v6s", max_calls=3, window_secs=300)
    with pytest.raises(HTTPException):
        rate_limit.check_rate_ip_shared("2001:db8:5:5::ff", "t_v6s", max_calls=3, window_secs=300)


def test_anonymous_limit_falls_back_when_redis_is_down(monkeypatch):
    """A limiter that stops limiting when its store blips is worse than a leaky one."""
    monkeypatch.delenv("E2E_TEST", raising=False)

    class _Broken:
        def pipeline(self):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(rate_limit, "_redis", lambda: _Broken())
    rate_limit._calls.clear()

    for _ in range(3):
        rate_limit.check_rate_ip_shared("203.0.113.55", "t_down", max_calls=3, window_secs=300)
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_rate_ip_shared("203.0.113.55", "t_down", max_calls=3, window_secs=300)
    assert exc.value.status_code == 429


def test_unauthenticated_endpoints_use_the_shared_limiter():
    """Wiring check: a per-process limit on these is the bug, not the fix."""
    import inspect
    import app.routers.trial as trial
    import app.routers.sharing as sharing
    import scaffold.routers.reports as reports
    import scaffold.routers.unsubscribe as unsub
    import scaffold.routers.auth_router as auth_router

    for module in (trial, sharing, reports, unsub, auth_router):
        src = inspect.getsource(module)
        assert "check_rate_ip_shared" in src, f"{module.__name__} lost its shared limiter"
        # The per-process variant must not linger on an anonymous route.
        assert "check_rate_ip(" not in src, f"{module.__name__} still calls check_rate_ip"


# ── Behind Cloudflare ───────────────────────────────────────────────────────
#
# Chain: user -> Cloudflare -> Caddy -> app. Cloudflare appends the caller to
# X-Forwarded-For and Caddy appends Cloudflare's edge address, so the caller is
# the second entry from the right, not the first. TRUSTED_PROXY_HOPS defaults
# to 1 in both docker-compose.yml and deploy.yml, and at 1 every caller on
# earth resolves to a Cloudflare edge address — the anonymous limits collapse
# into a handful of shared buckets and nothing says so.

REAL_USER = "203.0.113.50"
CF_EDGE = "172.71.10.5"
CADDY = "10.9.0.2"


def _cloudflare_request(cf_connecting_ip=REAL_USER, forwarded=None, peer=CADDY):
    req = _Req(peer=peer, forwarded=forwarded or f"{REAL_USER}, {CF_EDGE}")
    if cf_connecting_ip:
        req.headers["CF-Connecting-IP"] = cf_connecting_ip
    return req


def test_one_hop_behind_cloudflare_resolves_the_edge_not_the_user(monkeypatch):
    """The misconfiguration this is all about — pinned so it stays visible."""
    monkeypatch.delenv("CLIENT_IP_HEADER", raising=False)
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    assert client_ip(_cloudflare_request()) == CF_EDGE


def test_two_hops_behind_cloudflare_resolves_the_user(monkeypatch):
    monkeypatch.delenv("CLIENT_IP_HEADER", raising=False)
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert client_ip(_cloudflare_request()) == REAL_USER


def test_cf_connecting_ip_is_used_when_configured(monkeypatch):
    """One address, no counting — the hop setting stops mattering."""
    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    for hops in ("0", "1", "2", "3"):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", hops)
        assert client_ip(_cloudflare_request()) == REAL_USER, f"wrong at hops={hops}"


def test_cf_connecting_ip_survives_a_client_supplied_forwarded_prefix(monkeypatch):
    """Cloudflare preserves an XFF the client sent, then appends the real one."""
    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    req = _cloudflare_request(forwarded=f"9.9.9.9, {REAL_USER}, {CF_EDGE}")
    assert client_ip(req) == REAL_USER


def test_configured_header_falls_back_when_absent(monkeypatch):
    """A request that never went through the proxy still gets the best answer."""
    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    req = _cloudflare_request(cf_connecting_ip=None)
    assert client_ip(req) == REAL_USER  # via the hop fallback


def test_garbage_in_the_configured_header_does_not_become_a_bucket(monkeypatch):
    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    req = _cloudflare_request(cf_connecting_ip="not-an-address")
    assert client_ip(req) == REAL_USER  # falls through rather than trusting it


def test_resolve_reports_where_the_address_came_from(monkeypatch):
    from scaffold.client_ip import resolve_client_ip

    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    ip, source = resolve_client_ip(_cloudflare_request())
    assert (ip, source) == (REAL_USER, "header:CF-Connecting-IP")

    monkeypatch.delenv("CLIENT_IP_HEADER", raising=False)
    ip, source = resolve_client_ip(_cloudflare_request())
    assert (ip, source) == (REAL_USER, "x-forwarded-for[-2]")


def test_every_cloudflare_user_would_share_one_bucket_at_one_hop(monkeypatch):
    """Why the misconfiguration matters, not just that it happens."""
    monkeypatch.delenv("CLIENT_IP_HEADER", raising=False)
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    buckets = {
        rate_limit._ip_bucket(client_ip(_cloudflare_request(
            forwarded=f"203.0.113.{n}, {CF_EDGE}")))
        for n in range(1, 40)
    }
    assert buckets == {CF_EDGE}, "39 distinct callers should have collapsed to the edge"

    monkeypatch.setenv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    buckets = {
        rate_limit._ip_bucket(client_ip(_cloudflare_request(
            cf_connecting_ip=f"203.0.113.{n}", forwarded=f"203.0.113.{n}, {CF_EDGE}")))
        for n in range(1, 40)
    }
    assert len(buckets) == 39, "each caller should get its own bucket"
