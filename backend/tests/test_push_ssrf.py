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
    """Turn off the local-dev bypass so the address checks run.

    Every address used below is a literal, so getaddrinfo answers without
    touching the network and the tests stay hermetic. The host allowlist is
    off here for the same reason — a real push host would have to be resolved.
    It has its own tests further down.
    """
    monkeypatch.delenv("E2E_TEST", raising=False)
    monkeypatch.delenv("PUSH_ALLOW_PRIVATE_ENDPOINTS", raising=False)
    monkeypatch.setenv("PUSH_ALLOWED_HOSTS", "*")


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


# ── The host allowlist ──────────────────────────────────────────────────────

@pytest.fixture()
def allowlisted(monkeypatch):
    """Enforce the allowlist, with resolution stubbed so the tests stay offline.

    _resolve is only reached by a host the allowlist already accepted, so
    stubbing it here tests the allowlist and nothing else.
    """
    import ipaddress

    import scaffold.push_endpoints as pe

    monkeypatch.delenv("E2E_TEST", raising=False)
    monkeypatch.delenv("PUSH_ALLOW_PRIVATE_ENDPOINTS", raising=False)
    monkeypatch.delenv("PUSH_ALLOWED_HOSTS", raising=False)
    monkeypatch.setattr(pe, "_resolve", lambda host: [ipaddress.ip_address("93.184.216.34")])


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://autopush-1.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QABC123",
    "https://wns2-by3p.notify.windows.com/w/?token=abc",
])
def test_real_push_services_are_accepted(endpoint, allowlisted):
    assert validate_push_endpoint(endpoint) == endpoint


@pytest.mark.parametrize("endpoint", [
    "https://attacker.example.com/collect",
    "https://fcm.googleapis.com.attacker.example/fcm/send/abc",  # suffix trick
    "https://notfcm.googleapis.com/fcm/send/abc",
    "https://internal-admin.corp/",
])
def test_a_public_host_that_is_not_a_push_service_is_rejected(endpoint, allowlisted):
    """Public is not the same as legitimate: only browser push services qualify."""
    with pytest.raises(PushEndpointRejected):
        validate_push_endpoint(endpoint)


def test_the_allowlist_can_be_overridden(allowlisted, monkeypatch):
    monkeypatch.setenv("PUSH_ALLOWED_HOSTS", "push.internal.example")
    assert validate_push_endpoint("https://push.internal.example/x")
    with pytest.raises(PushEndpointRejected):
        validate_push_endpoint("https://fcm.googleapis.com/fcm/send/abc")


# ── Redirects ───────────────────────────────────────────────────────────────
#
# The URL checks above all run against the endpoint that was stored. None of
# them sees where a 3xx would send the request next, and requests follows
# redirects by default — so a push service answering
# "302 Location: http://169.254.169.254/" walks the request past every one of
# them, from inside the network. The guarded session refuses to follow.

_PRIVATE_TARGET = "http://169.254.169.254/latest/meta-data/"


def _subscription():
    from scaffold.models import PushSubscription
    from tests.test_push import _real_subscriber_keys

    p256dh, auth = _real_subscriber_keys()
    return PushSubscription(
        user_id=1, endpoint="https://fcm.googleapis.com/fcm/send/abc",
        p256dh=p256dh, auth=auth,
    )


def _redirect_then_ok(request, calls):
    if len(calls) == 1:
        return 302, {"Location": _PRIVATE_TARGET}, b""
    return 200, {}, b"internal secret"


def test_a_redirect_to_a_private_address_is_not_followed(monkeypatch):
    from unittest.mock import patch

    import scaffold.notifications as notifications
    from tests.conftest import push_transport
    from tests.test_push import _real_vapid_private_key

    with patch.object(notifications, "VAPID_PRIVATE_KEY", _real_vapid_private_key()):
        with push_transport(_redirect_then_ok) as calls:
            result = notifications.send_push(_subscription(), {"title": "x"})

    assert calls == ["https://fcm.googleapis.com/fcm/send/abc"], (
        f"the redirect was followed: {calls}"
    )
    assert _PRIVATE_TARGET not in calls
    assert result is notifications.PushResult.FAILED


def test_a_redirect_does_not_delete_the_subscription(monkeypatch):
    """A 3xx says nothing about whether the device is still registered.

    GONE is the one outcome that deletes a subscription, so a push service
    behind a redirect must not cost the user their notifications.
    """
    from unittest.mock import patch

    import scaffold.notifications as notifications
    from tests.conftest import push_transport
    from tests.test_push import _real_vapid_private_key

    for status in (301, 302, 303, 307, 308):
        with patch.object(notifications, "VAPID_PRIVATE_KEY", _real_vapid_private_key()):
            with push_transport(
                lambda request, calls, s=status: (s, {"Location": _PRIVATE_TARGET}, b"")
            ) as calls:
                result = notifications.send_push(_subscription(), {"title": "x"})
        assert result is notifications.PushResult.FAILED, status
        assert len(calls) == 1, f"{status} was followed: {calls}"


def test_the_guarded_session_re_validates_every_url(monkeypatch):
    """Belt and braces: a URL that reaches the session another way still cannot leave."""
    from scaffold.push_transport import push_session
    from tests.conftest import push_transport

    monkeypatch.delenv("E2E_TEST", raising=False)
    monkeypatch.delenv("PUSH_ALLOW_PRIVATE_ENDPOINTS", raising=False)

    with push_transport(lambda request, calls: (200, {}, b"")) as calls:
        with push_session() as session:
            with pytest.raises(PushEndpointRejected):
                session.post(_PRIVATE_TARGET, data=b"x")
    assert calls == []


def test_a_plain_session_would_have_followed_the_redirect():
    """The negative control: this is the behaviour the guarded session replaces."""
    import requests

    from tests.conftest import push_transport

    with push_transport(_redirect_then_ok) as calls:
        with requests.Session() as session:
            resp = session.post("https://fcm.googleapis.com/fcm/send/abc", data=b"x")

    assert calls == ["https://fcm.googleapis.com/fcm/send/abc", _PRIVATE_TARGET]
    assert resp.status_code == 200
