"""Resolve the real client IP when the app sits behind a reverse proxy.

In production Caddy proxies to `app:8000` on a docker network, and uvicorn runs
without --proxy-headers, so `request.client.host` is Caddy's container address
for every request on earth. Every anonymous rate limit keyed on it therefore
shared one bucket: one person hitting /api/report 30 times locked out everyone,
and an attacker spreading requests over many source addresses was never
distinguished from a single user.

X-Forwarded-For is only trusted when TRUSTED_PROXY_HOPS says how many proxies
are actually in front, because the header is caller-supplied and a
directly-exposed deployment must never believe it. With the count set, the
entry `hops` from the right is the address the innermost trusted proxy saw;
everything to its left is client-supplied and ignored.

  TRUSTED_PROXY_HOPS=0  (default)  no proxy — use the socket peer
  TRUSTED_PROXY_HOPS=1             Caddy only
  TRUSTED_PROXY_HOPS=2             Cloudflare in front of Caddy
"""
import ipaddress
import logging
import os

logger = logging.getLogger(__name__)

UNKNOWN = "unknown"


def trusted_proxy_hops() -> int:
    """Read at call time, not import time, so tests and reloads see changes."""
    raw = os.getenv("TRUSTED_PROXY_HOPS", "").strip()
    if not raw:
        return 0
    try:
        return max(0, int(raw))
    except ValueError:
        logger.warning("TRUSTED_PROXY_HOPS is not an integer: %r — treating as 0", raw)
        return 0


def _valid_ip(candidate: str) -> str | None:
    candidate = candidate.strip()
    if not candidate:
        return None
    # IPv6 in a forwarded header may be bracketed, with or without a port.
    if candidate.startswith("["):
        candidate = candidate[1:].split("]", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_ip(request) -> str:
    """The caller's address, or UNKNOWN when it cannot be established.

    UNKNOWN is deliberately a single shared bucket: an unidentifiable caller
    should be limited together with every other unidentifiable caller, not
    given a free pass.
    """
    hops = trusted_proxy_hops()
    if hops:
        forwarded = request.headers.get("X-Forwarded-For", "")
        parts = [p for p in (p.strip() for p in forwarded.split(",")) if p]
        if len(parts) >= hops:
            ip = _valid_ip(parts[-hops])
            if ip:
                return ip
        # A proxy is configured but sent nothing usable. Falling back to the
        # socket peer would mean the proxy's own address — one bucket for
        # everyone, the bug this module exists to fix — so refuse to guess.
        return UNKNOWN

    if request.client and request.client.host:
        return request.client.host
    return UNKNOWN
