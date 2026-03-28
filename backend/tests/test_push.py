import sys
import os
from datetime import date, datetime
from unittest.mock import patch, MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


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
    token = register_user(client)
    resp = client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    assert resp.status_code == 201
    data = resp.json()
    assert data["endpoint"] == SUB_DATA["endpoint"]
    assert "id" in data


def test_subscribe_upserts(client):
    token = register_user(client)
    resp1 = client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    resp2 = client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    assert resp1.json()["id"] == resp2.json()["id"]


def test_unsubscribe(client):
    token = register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    resp = client.request("DELETE", "/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    assert resp.status_code == 204


def test_unsubscribe_not_found(client):
    token = register_user(client)
    resp = client.request("DELETE", "/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    assert resp.status_code == 404


def test_push_status_not_subscribed(client):
    token = register_user(client)
    resp = client.get("/api/push/status", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() == {"subscribed": False, "subscription_count": 0}


def test_push_status_subscribed(client):
    token = register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    resp = client.get("/api/push/status", headers=auth_header(token))
    assert resp.json() == {"subscribed": True, "subscription_count": 1}


def test_subscribe_requires_auth(client):
    resp = client.post("/api/push/subscribe", json=SUB_DATA)
    assert resp.status_code == 401


def test_user_isolation(client):
    token1 = register_user(client, "user1@test.com")
    token2 = register_user(client, "user2@test.com")
    client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token1))

    # User2 cannot delete user1's subscription
    resp = client.request("DELETE", "/api/push/subscribe", json=SUB_DATA, headers=auth_header(token2))
    assert resp.status_code == 404

    # User2 shows no subscriptions
    resp = client.get("/api/push/status", headers=auth_header(token2))
    assert resp.json()["subscribed"] is False


# ============================================================
# NOTIFICATION LOGIC
# ============================================================

def test_build_notification_single_event():
    from scaffold.notifications import build_notification_payload
    events = [{"event_type": "Vesting"}]
    result = build_notification_payload(events)
    assert result == {"title": "Equity Tracker", "body": "You have 1 event today: 1 Vesting"}


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
    token = register_user(client)
    resp = client.post("/api/push/test", json={}, headers=auth_header(token))
    assert resp.status_code == 404


def test_push_test_sends_notification(client):
    token = register_user(client)
    client.post("/api/push/subscribe", json=SUB_DATA, headers=auth_header(token))
    with patch("scaffold.notifications.send_push", return_value=True):
        resp = client.post("/api/push/test", json={}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["sent"] == 1


def test_push_test_requires_auth(client):
    resp = client.post("/api/push/test", json={})
    assert resp.status_code == 401


# ============================================================
# ADVANCE DAYS PREFERENCE
# ============================================================

def test_advance_days_default_zero(client):
    token = register_user(client)
    resp = client.get("/api/notifications/email", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["advance_days"] == 0


def test_advance_days_set_and_get(client):
    token = register_user(client)
    resp = client.put("/api/notifications/advance-days?advance_days=7", json={}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["advance_days"] == 7
    resp = client.get("/api/notifications/email", headers=auth_header(token))
    assert resp.json()["advance_days"] == 7


def test_advance_days_clamped(client):
    token = register_user(client)
    resp = client.put("/api/notifications/advance-days?advance_days=99", json={}, headers=auth_header(token))
    assert resp.json()["advance_days"] == 30


def test_get_events_with_advance_days(db_session):
    from scaffold.models import User, Grant, Price
    from scaffold.notifications import get_todays_events_for_user
    from datetime import timedelta

    user = User(email="adv@test.com", google_id="gadv", name="Adv")
    db_session.add(user)
    db_session.commit()

    target = date(2022, 3, 1)
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
