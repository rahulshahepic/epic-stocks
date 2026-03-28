"""Tests for email notification preferences and notification logic."""
import sys, os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


# ============================================================
# EMAIL PREFERENCE ENDPOINTS
# ============================================================

def test_email_pref_default_disabled(client):
    register_user(client)
    resp = client.get("/api/notifications/email")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_email_pref_enable(client):
    register_user(client)
    resp = client.put("/api/notifications/email?enabled=true", json={})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True
    # Verify persistence
    resp = client.get("/api/notifications/email")
    assert resp.json()["enabled"] is True


def test_email_pref_disable(client):
    register_user(client)
    client.put("/api/notifications/email?enabled=true", json={})
    resp = client.put("/api/notifications/email?enabled=false", json={})
    assert resp.json()["enabled"] is False


def test_email_pref_requires_auth(client):
    resp = client.get("/api/notifications/email")
    assert resp.status_code == 401


def test_email_pref_user_isolation(client, make_client):
    register_user(client, "user1@test.com")
    client.put("/api/notifications/email?enabled=true", json={})

    with make_client("user2@test.com") as client2:
        resp = client2.get("/api/notifications/email")
        assert resp.json()["enabled"] is False


# ============================================================
# CONFIG ENDPOINT
# ============================================================

def test_config_no_resend(client):
    with patch.dict(os.environ, {"RESEND_API_KEY": ""}, clear=False):
        resp = client.get("/api/config")
        assert resp.json()["email_notifications_available"] is False


def test_config_with_resend(client):
    with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key", "RESEND_FROM": "noreply@test.com"}):
        resp = client.get("/api/config")
        assert resp.json()["email_notifications_available"] is True


# ============================================================
# EMAIL SENDER
# ============================================================

def test_build_event_email():
    from scaffold.email_sender import build_event_email
    events = [
        {"event_type": "Vesting"},
        {"event_type": "Vesting"},
        {"event_type": "Loan Repayment"},
    ]
    subject, text, html = build_event_email(events)
    assert "3 events" in subject
    assert "2 Vesting" in text
    assert "1 Loan Repayment" in text
    assert "<ul>" in html


def test_send_email_when_not_configured():
    from scaffold.email_sender import send_email
    with patch.dict(os.environ, {"RESEND_API_KEY": ""}):
        result = send_email("test@test.com", "subj", "body")
        assert result is False


def test_send_email_success():
    from scaffold.email_sender import send_email
    with patch.dict(os.environ, {
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "Equity Tracker <noreply@test.com>",
    }):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        with patch("scaffold.providers.email.resend.httpx.post", return_value=mock_response) as mock_post:
            result = send_email("test@test.com", "Test Subject", "Test Body", "<p>Test</p>")
            assert result is True
            mock_post.assert_called_once()
            call_kwargs = mock_post.call_args
            payload = call_kwargs.kwargs["json"]
            assert payload["to"] == ["test@test.com"]
            assert payload["subject"] == "Test Subject"
            assert payload["text"] == "Test Body"
            assert payload["html"] == "<p>Test</p>"
            assert "Bearer re_test_key" in call_kwargs.kwargs["headers"]["Authorization"]


# ============================================================
# DAILY NOTIFICATION LOGIC
# ============================================================

def test_notification_build_payload():
    from scaffold.notifications import build_notification_payload
    assert build_notification_payload([]) is None
    payload = build_notification_payload([{"event_type": "Vesting"}])
    assert payload["title"] == "Equity Tracker"
    assert "1 event" in payload["body"]


def test_sale_included_in_todays_events(client, db_session):
    """A sale dated today appears in today's events."""
    from scaffold.models import User, Sale
    from scaffold.notifications import get_todays_events_for_user
    from datetime import date

    register_user(client)
    user = db_session.query(User).first()
    today = date(2026, 3, 22)
    db_session.add(Sale(user_id=user.id, date=today, shares=200, price_per_share=42.0, notes=""))
    db_session.commit()

    events = get_todays_events_for_user(user, db_session, today)
    sale_events = [e for e in events if e["event_type"] == "Sale"]
    assert len(sale_events) == 1
    assert sale_events[0]["shares"] == 200


def test_future_sale_not_in_todays_events(client, db_session):
    """A sale dated tomorrow does not appear in today's events."""
    from scaffold.models import User, Sale
    from scaffold.notifications import get_todays_events_for_user
    from datetime import date

    register_user(client)
    user = db_session.query(User).first()
    db_session.add(Sale(user_id=user.id, date=date(2026, 3, 23), shares=100, price_per_share=42.0, notes=""))
    db_session.commit()

    events = get_todays_events_for_user(user, db_session, date(2026, 3, 22))
    assert not any(e["event_type"] == "Sale" for e in events)


def test_sale_in_notification_payload():
    """Sale events are included in push/email notification payload."""
    from scaffold.notifications import build_notification_payload
    payload = build_notification_payload([
        {"event_type": "Vesting"},
        {"event_type": "Sale"},
    ])
    assert payload is not None
    assert "Sale" in payload["body"]
    assert "Vesting" in payload["body"]


def test_send_daily_notifications_with_email(client, db_session):
    """Integration: user with email pref enabled gets email for today's events."""
    from scaffold.models import User, Grant, Price, EmailPreference
    from datetime import date

    register_user(client)
    user = db_session.query(User).first()
    pref = EmailPreference(user_id=user.id, enabled=True)
    db_session.add(pref)
    db_session.add(Grant(
        user_id=user.id, year=2020, type="Purchase", shares=100, price=5.0,
        vest_start=date(2025, 3, 20), periods=5,
        exercise_date=date(2030, 3, 20), dp_shares=0,
    ))
    db_session.add(Price(
        user_id=user.id, effective_date=date(2020, 1, 1), price=5.0,
    ))
    db_session.commit()

    with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key", "RESEND_FROM": "n@t.com"}):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        with patch("scaffold.providers.email.resend.httpx.post", return_value=mock_response) as mock_post:
            from scaffold.notifications import send_daily_notifications
            send_daily_notifications(today=date(2026, 3, 20))
            assert mock_post.call_count >= 1
