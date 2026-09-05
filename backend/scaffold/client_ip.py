"""Resolve the real client IP when the app sits behind a reverse proxy.

In production Caddy proxies to `app:8000` on a docker network, and uvicorn runs
without --proxy-headers, so `request.client.host` is Caddy's container address
for every request on earth. Every anonymous rate limit keyed on it therefore
shared one bucket: one person hitting /api/report 30 times locked out everyone,
and an attacker spreading requests over many source addresses was never
distinguished from a single user.

There are two ways to get the caller's address, and the first is better when
it is available.

**CLIENT_IP_HEADER** names a header that carries exactly one address, put there
by the proxy in front. Behind Cloudflare that is `CF-Connecting-IP`, which is
always the original client and never a list, so there is no counting to get
wrong. Set it and the hop arithmetic below stops mattering.

    CLIENT_IP_HEADER=CF-Connecting-IP

This is only safe when the origin cannot be reached except through that proxy —
for Cloudflare, a firewall allowing 80/443 only from Cloudflare's ranges (see
OPERATIONS.md §1). Without that lock anyone can set the header to anything and
mint a fresh rate-limit bucket per request, which is strictly worse than not
trusting it at all. Leave it unset if you are not sure.

**TRUSTED_PROXY_HOPS** is the fallback, and the only option when the proxy does
not offer a single-address header. X-Forwarded-For is caller-supplied, so it is
believed only as far as the count allows: the entry `hops` from the right is
the address the innermost trusted proxy saw, and everything to its left is
client-supplied and ignored.

  TRUSTED_PROXY_HOPS=0  (default)  no proxy — use the socket peer
  TRUSTED_PROXY_HOPS=1             Caddy only
  TRUSTED_PROXY_HOPS=2             Cloudflare in front of Caddy

Getting that count wrong fails quietly and in the worst direction: with
Cloudflare in front and the count left at 1, every caller on earth resolves to
whichever Cloudflare edge address served them, so the anonymous rate limits
collapse into a handful of shared buckets. GET /api/admin/client-ip reports
what this module actually resolved for the calling request, which is the way to
check rather than assume.
"""
import ipaddress
import logging
import os

logger = logging.getLogger(__name__)

UNKNOWN = "unknown"


def configured_ip_header() -> str:
    """The single-address header to trust, or "" when none is configured."""
    return os.getenv("CLIENT_IP_HEADER", "").strip()


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


def resolve_client_ip(request) -> tuple[str, str]:
    """(address, how it was determined). See client_ip for the address alone.

    The source string is what GET /api/admin/client-ip reports, so a deployment
    can be checked rather than assumed.
    """
    header = configured_ip_header()
    if header:
        raw = request.headers.get(header, "") or ""
        # Documented as a single address, but take the first entry if a proxy
        # ever sends a list rather than reading the whole thing as garbage.
        ip = _valid_ip(raw.split(",")[0]) if raw else None
        if ip:
            return ip, f"header:{header}"
        # Configured but not present. A request that genuinely did not come
        # through the proxy — a health check on the docker network — still
        # deserves the best answer available, so fall through rather than
        # returning UNKNOWN for it.

    hops = trusted_proxy_hops()
    if hops:
        forwarded = request.headers.get("X-Forwarded-For", "")
        parts = [p for p in (p.strip() for p in forwarded.split(",")) if p]
        if len(parts) >= hops:
            ip = _valid_ip(parts[-hops])
            if ip:
                return ip, f"x-forwarded-for[-{hops}]"
        # A proxy is configured but sent nothing usable. Falling back to the
        # socket peer would mean the proxy's own address — one bucket for
        # everyone, the bug this module exists to fix — so refuse to guess.
        return UNKNOWN, "unresolved"

    if request.client and request.client.host:
        return request.client.host, "socket-peer"
    return UNKNOWN, "unresolved"


def client_ip(request) -> str:
    """The caller's address, or UNKNOWN when it cannot be established.

    UNKNOWN is deliberately a single shared bucket: an unidentifiable caller
    should be limited together with every other unidentifiable caller, not
    given a free pass.
    """
    return resolve_client_ip(request)[0]
