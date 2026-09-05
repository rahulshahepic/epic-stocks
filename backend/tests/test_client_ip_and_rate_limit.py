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
