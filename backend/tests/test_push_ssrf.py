"""A push endpoint is a URL the server is made to fetch, chosen by the caller.

Unchecked, storing one and calling POST /api/push/test turns any signed-in
account into an SSRF primitive: the backend issues the request from inside the
network, and the {"sent": n} count distinguishes a delivered request from a
refused one, which is enough to probe.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.push_endpoints import (
    PushEndpointRejected,
    is_sendable,
    validate_push_endpoint,
)
from tests.conftest import register_user


@pytest.fixture()
def enforcing(monkeypatch):
    """Turn off the local-dev bypass so the real checks run.

    Every address used below is a literal, so getaddrinfo answers without
    touching the network and the tests stay hermetic.
    """
    monkeypatch.delenv("E2E_TEST", raising=False)
    monkeypatch.delenv("PUSH_ALLOW_PRIVATE_ENDPOINTS", raising=False)


BLOCKED = [
    "https://169.254.169.254/latest/meta-data/iam/security-credentials/",  # AWS/GCP/Azure metadata
    "https://127.0.0.1/api/admin/users",
    "https://127.0.0.1:8000/anything",
    "https://10.0.0.5/internal",
    "https://192.168.1.1/router",
    "https://172.16.0.1/internal",
    "https://[::1]/loopback",
    "https://[::ffff:127.0.0.1]/ipv4-mapped-loopback",
    "https://[::ffff:10.0.0.1]/ipv4-mapped-private",
    "https://[fe80::1]/link-local",
    "https://0.0.0.0/unspecified",
]


@pytest.mark.parametrize("endpoint", BLOCKED)
def test_non_public_destinations_are_rejected(endpoint, enforcing):
    with pytest.raises(PushEndpointRejected):
        validate_push_endpoint(endpoint)


@pytest.mark.parametrize("endpoint", [
    "http://93.184.216.34/insecure",          # plain http, public address
    "https://user:pass@93.184.216.34/creds",  # credentials in the URL
    "ftp://93.184.216.34/file",
    "file:///etc/passwd",
    "gopher://93.184.216.34/",
    "",
    "https://",
    "not-a-url",
])
def test_malformed_or_non_https_endpoints_are_rejected(endpoint, enforcing):
    with pytest.raises(PushEndpointRejected):
        validate_push_endpoint(endpoint)


def test_an_over_long_endpoint_is_rejected(enforcing):
    with pytest.raises(PushEndpointRejected):
        validate_push_endpoint("https://93.184.216.34/" + "a" * 2100)


def test_a_public_https_endpoint_is_accepted(enforcing):
    endpoint = "https://93.184.216.34/fcm/send/abc"
    assert validate_push_endpoint(endpoint) == endpoint


def test_is_sendable_never_raises(enforcing):
    """The send-time check runs inside a loop over subscriptions; it must not throw."""
    assert is_sendable("https://93.184.216.34/ok") is True
    assert is_sendable("https://169.254.169.254/metadata") is False
    assert is_sendable("nonsense") is False
    assert is_sendable("https://a-name-that-does-not-resolve.invalid/x") is False


# ── Through the API ─────────────────────────────────────────────────────────

def test_subscribe_refuses_a_metadata_endpoint(client, db_session, monkeypatch):
    from scaffold.models import PushSubscription
    register_user(client)
    monkeypatch.delenv("E2E_TEST", raising=False)

    resp = client.post("/api/push/subscribe", json={
        "endpoint": "https://169.254.169.254/latest/meta-data/",
        "keys": {"p256dh": "p", "auth": "a"},
    })

    assert resp.status_code == 422
    assert db_session.query(PushSubscription).count() == 0


def test_subscribe_refuses_a_loopback_endpoint(client, db_session, monkeypatch):
    from scaffold.models import PushSubscription
    register_user(client)
    monkeypatch.delenv("E2E_TEST", raising=False)

    resp = client.post("/api/push/subscribe", json={
        "endpoint": "https://127.0.0.1:8000/api/admin/users",
        "keys": {"p256dh": "p", "auth": "a"},
    })

    assert resp.status_code == 422
    assert db_session.query(PushSubscription).count() == 0


def test_send_push_refuses_an_endpoint_that_turned_private(db_session, monkeypatch):
    """DNS rebinding: the row was stored when the host was public.

    Nothing may reach pywebpush — the point is that no request is made at all.
    """
    from scaffold.models import PushSubscription
    import scaffold.notifications as notifications

    monkeypatch.setattr(notifications, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.delenv("E2E_TEST", raising=False)

    sub = PushSubscription(
        user_id=1, endpoint="https://169.254.169.254/latest/meta-data/",
        p256dh="p", auth="a",
    )

    def _explode(*a, **kw):
        raise AssertionError("send_push reached the network for a private endpoint")

    monkeypatch.setattr("pywebpush.webpush", _explode)

    assert notifications.send_push(sub, {"title": "x"}) is notifications.PushResult.FAILED
