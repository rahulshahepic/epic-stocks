"""Validation for browser push endpoints.

A push subscription is a URL the server is made to POST to, supplied by
whoever is signed in. Without a check that is an authenticated SSRF: store
http://169.254.169.254/... or http://127.0.0.1:8000/api/... as an "endpoint",
call POST /api/push/test, and the backend makes the request from inside the
network. The reply body never comes back, but /push/test returns a count that
distinguishes delivered from refused, which is enough to probe for open ports.

Three checks, because no one of them is enough on its own:

  * At subscribe time, so a bad endpoint is refused with a clear 422 rather
    than stored and silently dropped later.
  * At send time, because DNS is not stable. A name that resolved to a public
    address when it was stored can resolve to 127.0.0.1 by the time the daily
    job runs — classic rebinding — and subscriptions outlive their check by
    months.
  * Against a host allowlist, because the two checks above only establish
    that the destination is *somewhere public*. A push endpoint always
    belongs to one of a handful of browser vendors, so anything else is not
    a push endpoint. PUSH_ALLOWED_HOSTS overrides the built-in list; "*"
    turns the allowlist off for a deployment that needs a provider not
    listed here.

Redirects are the other half of this and cannot be handled from a URL check:
see scaffold/push_transport.py.

This does not replace network egress policy; it is the part that lives in the
app. A deployment that can restrict outbound traffic to the push services it
actually uses should still do so.
"""
import ipaddress
import os
import socket
from urllib.parse import urlsplit

# Hosts allowed to be plain http:// — local development only. Anything else
# must be https, which is also what the Web Push spec requires.
_LOCAL_HTTP_HOSTS = {"localhost", "127.0.0.1", "::1"}

# The push services browsers actually hand out endpoints for. Entries starting
# with a dot match any subdomain (Edge hands out wns2-<region>.notify.windows.com,
# Safari web.push.apple.com); the rest are exact hosts.
DEFAULT_ALLOWED_PUSH_HOSTS = (
    "fcm.googleapis.com",                    # Chrome, Edge (Chromium), Brave
    "android.googleapis.com",                # older Chrome endpoints
    "updates.push.services.mozilla.com",     # Firefox
    ".push.services.mozilla.com",            # Firefox autopush shards
    ".push.apple.com",                       # Safari / iOS web push
    ".notify.windows.com",                   # Edge (WNS)
    ".wns.windows.com",                      # Edge (WNS)
)


class PushEndpointRejected(ValueError):
    """The endpoint URL is not somewhere this server will send a request."""


def _allow_private() -> bool:
    """True in test and local-dev environments, where endpoints are fixtures.

    E2E_TEST is already the switch the rest of the scaffold uses for "this is
    not a real deployment"; PUSH_ALLOW_PRIVATE_ENDPOINTS exists separately so a
    developer running against a local push relay does not have to pretend to be
    a test.
    """
    return (
        os.getenv("E2E_TEST") == "1"
        or os.getenv("PUSH_ALLOW_PRIVATE_ENDPOINTS") == "1"
    )


def _allowed_hosts() -> tuple[str, ...] | None:
    """The host allowlist, or None when it has been switched off.

    PUSH_ALLOWED_HOSTS is a comma-separated override; "*" disables the check
    for a deployment whose browser vendor is not in the built-in list.
    """
    raw = os.getenv("PUSH_ALLOWED_HOSTS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_PUSH_HOSTS
    if raw == "*":
        return None
    return tuple(h.strip().lower() for h in raw.split(",") if h.strip())


def _host_allowed(host: str) -> bool:
    allowed = _allowed_hosts()
    if allowed is None:
        return True
    host = host.lower().rstrip(".")
    for entry in allowed:
        if entry.startswith("."):
            if host.endswith(entry):
                return True
        elif host == entry:
            return True
    return False


def _is_forbidden_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Addresses no user-supplied URL may point at.

    link_local covers 169.254.0.0/16, which is where the cloud metadata
    services live (169.254.169.254 on AWS, GCP and Azure alike).
    """
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        return True
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return True
    # An IPv4 address wearing an IPv6 costume: ::ffff:127.0.0.1, ::ffff:10.0.0.1
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None and _is_forbidden_ip(mapped):
        return True
    sixtofour = getattr(ip, "sixtofour", None)
    if sixtofour is not None and _is_forbidden_ip(sixtofour):
        return True
    return False


def _resolve(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise PushEndpointRejected(f"endpoint host does not resolve: {host}") from exc
    addrs = []
    for info in infos:
        try:
            addrs.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not addrs:
        raise PushEndpointRejected(f"endpoint host does not resolve: {host}")
    return addrs


def validate_push_endpoint(endpoint: str) -> str:
    """Return the endpoint unchanged, or raise PushEndpointRejected.

    Every address the host resolves to must be public: a name with one public
    and one private A record is rejected, because which one the HTTP client
    picks is not ours to decide.
    """
    if not endpoint or len(endpoint) > 2000:
        raise PushEndpointRejected("endpoint must be a URL under 2000 characters")

    parts = urlsplit(endpoint)
    host = parts.hostname
    if not host:
        raise PushEndpointRejected("endpoint has no host")

    if parts.scheme == "http":
        if not (_allow_private() and host in _LOCAL_HTTP_HOSTS):
            raise PushEndpointRejected("endpoint must use https")
    elif parts.scheme != "https":
        raise PushEndpointRejected("endpoint must use https")

    if parts.username or parts.password:
        raise PushEndpointRejected("endpoint must not carry credentials")

    if _allow_private():
        return endpoint

    # A public address is not enough: a push endpoint belongs to a browser
    # vendor's push service, and nothing else has any business being one.
    if not _host_allowed(host):
        raise PushEndpointRejected(
            "endpoint is not a supported push service"
        )

    for ip in _resolve(host):
        if _is_forbidden_ip(ip):
            raise PushEndpointRejected(
                "endpoint resolves to a non-public address"
            )
    return endpoint


def is_sendable(endpoint: str) -> bool:
    """Re-check at send time. Never raises — a bad endpoint is just not sent to."""
    try:
        validate_push_endpoint(endpoint)
        return True
    except PushEndpointRejected:
        return False
