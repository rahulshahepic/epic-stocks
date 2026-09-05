import sys
import os
from datetime import date, datetime
from unittest.mock import patch
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, user_key


SUB_DATA = {
    "endpoint": "https://push.example.com/send/abc123",
    "keys": {
        "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8ljEIGQ",
        "auth": "tBHItJI5svbpC7__Yl_24A",
    },
}


# ============================================================
# SUBSCRIBE / UNSUBSCRIBE
# ============================================================

def test_subscribe(client):
    register_user(client)
    resp = client.post("/api/push/subscribe", json=SUB_DATA)
    assert resp.status_code == 201
    data = resp.json()
    assert data["endpoint"] == SUB_DATA["endpoint"]
    assert "id" in data


def test_subscribe_upserts(client):
    register_user(client)
    resp1 = client.post("/api/push/subscribe", json=SUB_DATA)
    resp2 = client.post("/api/push/subscribe", json=SUB_DATA)
    assert resp1.json()["id"] == resp2.json()["id"]


def test_unsubscribe(client):
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    resp = client.request("DELETE", "/api/push/subscribe", json=SUB_DATA)
    assert resp.status_code == 204


def test_unsubscribe_not_found(client):
    register_user(client)
    resp = client.request("DELETE", "/api/push/subscribe", json=SUB_DATA)
    assert resp.status_code == 404


def test_push_status_not_subscribed(client):
    register_user(client)
    resp = client.post("/api/push/status", json={})
    assert resp.status_code == 200
    assert resp.json() == {"registered_here": False, "total_devices": 0, "intent": False}


def test_push_status_registered_here(client):
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    resp = client.post("/api/push/status", json={"endpoint": SUB_DATA["endpoint"]})
    assert resp.json() == {"registered_here": True, "total_devices": 1, "intent": True}


def test_push_status_other_device_is_not_registered_here(client):
    """The bug this replaces: a laptop subscription made a phone that had never
    been asked look like push was already on."""
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)

    resp = client.post("/api/push/status", json={"endpoint": "https://push.example.com/send/other-device"})

    body = resp.json()
    assert body["registered_here"] is False
    assert body["total_devices"] == 1


def test_push_status_without_an_endpoint_is_never_registered_here(client):
    """A device with no subscription of its own sends no endpoint."""
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)

    resp = client.post("/api/push/status", json={})

    assert resp.json()["registered_here"] is False
    assert resp.json()["total_devices"] == 1


def test_push_status_counts_every_device(client):
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    second = {**SUB_DATA, "endpoint": "https://push.example.com/send/device-2"}
    client.post("/api/push/subscribe", json=second)

    resp = client.post("/api/push/status", json={"endpoint": second["endpoint"]})

    assert resp.json() == {"registered_here": True, "total_devices": 2, "intent": True}


def test_subscribe_requires_auth(client):
    resp = client.post("/api/push/subscribe", json=SUB_DATA)
    assert resp.status_code == 401


def test_user_isolation(client, make_client):
    register_user(client, "user1@test.com")
    client.post("/api/push/subscribe", json=SUB_DATA)

    with make_client("user2@test.com") as client2:
        # User2 cannot delete user1's subscription
        resp = client2.request("DELETE", "/api/push/subscribe", json=SUB_DATA)
        assert resp.status_code == 404

        # User2 shows no subscriptions, even for user1's endpoint
        resp = client2.post("/api/push/status", json={"endpoint": SUB_DATA["endpoint"]})
        assert resp.json()["registered_here"] is False
        assert resp.json()["total_devices"] == 0


# ============================================================
# NOTIFICATION LOGIC
# ============================================================

def test_build_notification_single_event():
    from scaffold.notifications import build_notification_payload
    events = [{"event_type": "Vesting"}]
    result = build_notification_payload(events)
    assert result == {"title": "Upcoming Events", "body": "You have 1 event today: 1 Vesting"}


def test_build_notification_multiple_events():
    from scaffold.notifications import build_notification_payload
    events = [
        {"event_type": "Vesting"},
        {"event_type": "Vesting"},
        {"event_type": "Loan Repayment"},
    ]
    result = build_notification_payload(events)
    assert result["body"] == "You have 3 events today: 1 Loan Repayment, 2 Vesting"


def test_build_notification_no_events():
    from scaffold.notifications import build_notification_payload
    assert build_notification_payload([]) is None


def test_get_todays_events(db_session):
    from scaffold.models import User, Grant, Price
    from scaffold.notifications import get_todays_events_for_user

    user = User(email="test@test.com", google_id="g1", name="Test")
    db_session.add(user)
    db_session.commit()

    # Add a grant that vests starting today
    target = date(2022, 3, 1)
    with user_key(user):
        grant = Grant(
            user_id=user.id, year=2021, type="Purchase", shares=1000, price=2.0,
            vest_start=target, periods=3, exercise_date=date(2021, 12, 31), dp_shares=0,
        )
        price = Price(user_id=user.id, effective_date=date(2021, 1, 1), price=2.0)
        db_session.add_all([grant, price])
        db_session.commit()

        events = get_todays_events_for_user(user, db_session, today=target)
    assert len(events) > 0
    assert all(e["event_type"] in {"Vesting", "Loan Repayment", "Exercise"} for e in events)


def test_get_todays_events_filters_share_price(db_session):
    from scaffold.models import User, Price
    from scaffold.notifications import get_todays_events_for_user

    user = User(email="test@test.com", google_id="g1", name="Test")
    db_session.add(user)
    db_session.commit()

    # Only prices, no grants — only Share Price events, which should be filtered out
    with user_key(user):
        price = Price(user_id=user.id, effective_date=date(2022, 1, 1), price=5.0)
        db_session.add(price)
        db_session.commit()

        events = get_todays_events_for_user(user, db_session, today=date(2022, 1, 1))
    assert len(events) == 0  # Share Price events are not notifiable


def test_config_includes_vapid_key(client):
    with patch.dict(os.environ, {"VAPID_PUBLIC_KEY": "test-vapid-key"}):
        resp = client.get("/api/config")
        assert resp.json()["vapid_public_key"] == "test-vapid-key"


# ============================================================
# PUSH TEST ENDPOINT
# ============================================================

def test_push_test_no_subscriptions(client):
    register_user(client)
    resp = client.post("/api/push/test", json={})
    assert resp.status_code == 404


def test_push_test_sends_notification(client):
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    from scaffold.notifications import PushResult
    with patch("scaffold.notifications.send_push", return_value=PushResult.SENT):
        resp = client.post("/api/push/test", json={})
    assert resp.status_code == 200
    assert resp.json()["sent"] == 1


def test_push_test_requires_auth(client):
    resp = client.post("/api/push/test", json={})
    assert resp.status_code == 401


# ============================================================
# SEND_PUSH — payload must be encrypted per Web Push spec (RFC 8291)
# ============================================================

def _real_subscriber_keys():
    """A syntactically valid p256dh/auth pair, as a real browser subscription would send.

    SUB_DATA's keys are fixture strings, not points on the P-256 curve, so they
    can't round-trip through real ECDH — fine for endpoint tests that mock
    send_push, but not for verifying actual encryption here.
    """
    import base64
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    priv = ec.generate_private_key(ec.SECP256R1())
    pub_bytes = priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    p256dh = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()
    auth = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()
    return p256dh, auth


def _real_vapid_private_key():
    from py_vapid import Vapid
    import base64
    v = Vapid()
    v.generate_keys()
    raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def test_send_push_encrypts_payload():
    """The POST body sent to the push endpoint must be aes128gcm-encrypted,
    not the raw JSON payload — unencrypted pushes are silently dropped by
    strict push services (notably iOS Safari's)."""
    from scaffold.notifications import send_push
    from scaffold.models import PushSubscription
    import json as _json

    from tests.conftest import push_transport

    p256dh, auth = _real_subscriber_keys()
    sub = PushSubscription(endpoint="https://push.example.com/send/abc123", p256dh=p256dh, auth=auth)
    payload = {"title": "Epic Stocks", "body": "Test notification — push is working!"}

    captured = {}

    def responder(request, _calls):
        captured["headers"] = request.headers  # CaseInsensitiveDict, as sent
        captured["data"] = request.body
        return 201, {}, b""

    from scaffold.notifications import PushResult
    with patch("scaffold.notifications.VAPID_PRIVATE_KEY", _real_vapid_private_key()):
        with push_transport(responder):
            result = send_push(sub, payload)

    assert result is PushResult.SENT
    assert captured["headers"]["Content-Encoding"] == "aes128gcm"
    assert "Authorization" in captured["headers"]  # VAPID JWT
    raw_json = _json.dumps(payload).encode()
    assert captured["data"] != raw_json
    with pytest.raises(Exception):
        _json.loads(captured["data"])


def _send_with_status(status: int):
    from scaffold.notifications import send_push
    from scaffold.models import PushSubscription

    from tests.conftest import push_transport

    p256dh, auth = _real_subscriber_keys()
    sub = PushSubscription(endpoint="https://push.example.com/send/x", p256dh=p256dh, auth=auth)

    with patch("scaffold.notifications.VAPID_PRIVATE_KEY", _real_vapid_private_key()):
        with push_transport(lambda request, calls: (status, {}, b"response body")):
            return send_push(sub, {"title": "x", "body": "y"})


@pytest.mark.parametrize("status", [404, 410])
def test_send_push_reports_gone_for_dead_subscriptions(status):
    from scaffold.notifications import PushResult
    assert _send_with_status(status) is PushResult.GONE


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 502, 503])
def test_send_push_reports_transient_failure_not_gone(status):
    """Only the push service saying the subscription is dead may delete it.

    Treating every failure as dead meant one timeout, one 500, or one 403 from
    Apple silently unsubscribed the device for good.
    """
    from scaffold.notifications import PushResult
    assert _send_with_status(status) is PushResult.FAILED


def test_send_push_without_vapid_key_is_a_failure_not_gone():
    """The worst case of the old behaviour: an unset key made every send
    'fail', which deleted every subscription of every user in one pass."""
    from scaffold.notifications import send_push, PushResult
    from scaffold.models import PushSubscription

    sub = PushSubscription(endpoint="https://push.example.com/send/x", p256dh="k", auth="a")
    with patch("scaffold.notifications.VAPID_PRIVATE_KEY", ""):
        assert send_push(sub, {"title": "x"}) is PushResult.FAILED


def test_transient_failure_keeps_the_subscription(client):
    from scaffold.notifications import PushResult
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)

    with patch("scaffold.notifications.send_push", return_value=PushResult.FAILED):
        resp = client.post("/api/push/test", json={})

    assert resp.json()["sent"] == 0
    assert client.post("/api/push/status", json={}).json()["total_devices"] == 1


def test_gone_subscription_is_removed(client):
    from scaffold.notifications import PushResult
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)

    with patch("scaffold.notifications.send_push", return_value=PushResult.GONE):
        resp = client.post("/api/push/test", json={})

    assert resp.json()["sent"] == 0
    assert client.post("/api/push/status", json={}).json()["total_devices"] == 0


# ============================================================
# PUSH INTENT — a user-level wish, never a device state
# ============================================================

def test_intent_defaults_to_false(client):
    register_user(client)
    assert client.post("/api/push/status", json={}).json()["intent"] is False


def test_subscribing_records_intent(client):
    """Enabling push on any device is the clearest statement of intent."""
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    assert client.post("/api/push/status", json={}).json()["intent"] is True


def test_intent_can_be_set_and_cleared(client):
    register_user(client)
    assert client.put("/api/push/intent", json={"enabled": True}).json() == {"intent": True}
    assert client.post("/api/push/status", json={}).json()["intent"] is True
    assert client.put("/api/push/intent", json={"enabled": False}).json() == {"intent": False}
    assert client.post("/api/push/status", json={}).json()["intent"] is False


def test_clearing_intent_does_not_unsubscribe_devices(client):
    """"Stop asking" is not "turn push off" — subscribed devices keep receiving."""
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)

    client.put("/api/push/intent", json={"enabled": False})

    body = client.post("/api/push/status", json={"endpoint": SUB_DATA["endpoint"]}).json()
    assert body["registered_here"] is True
    assert body["total_devices"] == 1


def test_unsubscribing_one_device_leaves_intent_alone(client):
    """Turning it off on a phone must not stop the laptop being offered it."""
    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    client.request("DELETE", "/api/push/subscribe", json=SUB_DATA)

    body = client.post("/api/push/status", json={}).json()
    assert body["total_devices"] == 0
    assert body["intent"] is True


def test_intent_requires_auth(client):
    assert client.put("/api/push/intent", json={"enabled": True}).status_code == 401


def test_status_requires_auth(client):
    assert client.post("/api/push/status", json={}).status_code == 401


# ============================================================
# ADVANCE DAYS PREFERENCE
# ============================================================

def test_advance_days_default_zero(client):
    register_user(client)
    resp = client.get("/api/notifications/email")
    assert resp.status_code == 200
    assert resp.json()["advance_days"] == 0


def test_advance_days_set_and_get(client):
    register_user(client)
    resp = client.put("/api/notifications/advance-days?advance_days=7", json={})
    assert resp.status_code == 200
    assert resp.json()["advance_days"] == 7
    resp = client.get("/api/notifications/email")
    assert resp.json()["advance_days"] == 7


def test_advance_days_clamped(client):
    register_user(client)
    resp = client.put("/api/notifications/advance-days?advance_days=99", json={})
    assert resp.json()["advance_days"] == 30


def test_get_events_with_advance_days(db_session):
    from scaffold.models import User, Grant, Price
    from scaffold.notifications import get_todays_events_for_user
    from datetime import timedelta

    user = User(email="adv@test.com", google_id="gadv", name="Adv")
    db_session.add(user)
    db_session.commit()

    target = date(2022, 3, 1)
    with user_key(user):
        grant = Grant(
            user_id=user.id, year=2021, type="Purchase", shares=1000, price=2.0,
            vest_start=target, periods=3, exercise_date=date(2031, 12, 31), dp_shares=0,
        )
        price = Price(user_id=user.id, effective_date=date(2021, 1, 1), price=2.0)
        db_session.add_all([grant, price])
        db_session.commit()

        # Day before with advance_days=1 should find the event
        events = get_todays_events_for_user(user, db_session, today=target - timedelta(days=1), advance_days=1)
        assert len(events) > 0

        # Day before without advance_days should find nothing
        events = get_todays_events_for_user(user, db_session, today=target - timedelta(days=1), advance_days=0)
    assert len(events) == 0


# ============================================================
# DAILY JOB — pruning is the one thing that must not overreact
# ============================================================

def _user_with_events_and_subscription(client, db_session):
    """A user who has both a push subscription and an event to be told about."""
    from scaffold.models import User, Grant, Price

    register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA)
    user = db_session.query(User).first()
    with user_key(user):
        db_session.add(Grant(
            user_id=user.id, year=2020, type="Purchase", shares=100, price=5.0,
            vest_start=date(2025, 3, 20), periods=5,
            exercise_date=date(2030, 3, 20), dp_shares=0,
        ))
        db_session.add(Price(user_id=user.id, effective_date=date(2020, 1, 1), price=5.0))
        db_session.commit()
    return user


def test_daily_job_keeps_subscriptions_when_a_send_fails(client, db_session):
    """The regression that silently killed push: the daily job deleted a
    subscription on any failure, so one timeout unsubscribed the device
    permanently while the UI went on claiming push was enabled."""
    from scaffold.models import PushSubscription
    from scaffold.notifications import send_daily_notifications, PushResult

    _user_with_events_and_subscription(client, db_session)

    with patch("scaffold.notifications.send_push", return_value=PushResult.FAILED):
        send_daily_notifications(today=date(2026, 3, 20))

    assert db_session.query(PushSubscription).count() == 1


def test_daily_job_removes_subscriptions_the_service_says_are_dead(client, db_session):
    from scaffold.models import PushSubscription
    from scaffold.notifications import send_daily_notifications, PushResult

    _user_with_events_and_subscription(client, db_session)

    with patch("scaffold.notifications.send_push", return_value=PushResult.GONE):
        send_daily_notifications(today=date(2026, 3, 20))

    assert db_session.query(PushSubscription).count() == 0


def test_daily_job_with_no_vapid_key_does_not_wipe_every_subscription(client, db_session):
    """Worst case of the old rule: an unset key made every send fail, which
    deleted every subscription of every user in a single pass."""
    from scaffold.models import PushSubscription
    from scaffold.notifications import send_daily_notifications

    _user_with_events_and_subscription(client, db_session)

    with patch("scaffold.notifications.VAPID_PRIVATE_KEY", ""):
        send_daily_notifications(today=date(2026, 3, 20))

    assert db_session.query(PushSubscription).count() == 1
