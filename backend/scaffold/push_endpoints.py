"""Validation for browser push endpoints.

A push subscription is a URL the server is made to POST to, supplied by
whoever is signed in. Without a check that is an authenticated SSRF: store
http://169.254.169.254/... or http://127.0.0.1:8000/api/... as an "endpoint",
call POST /api/push/test, and the backend makes the request from inside the
network. The reply body never comes back, but /push/test returns a count that
distinguishes delivered from refused, which is enough to probe for open ports.

Two checks, because either alone is bypassable:

  * At subscribe time, so a bad endpoint is refused with a clear 422 rather
    than stored and silently dropped later.
  * At send time, because DNS is not stable. A name that resolved to a public
    address when it was stored can resolve to 127.0.0.1 by the time the daily
    job runs — classic rebinding — and subscriptions outlive their check by
    months.

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
