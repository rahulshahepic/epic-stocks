"""Tests for email notification preferences and notification logic."""
import sys, os
from unittest.mock import patch, MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


# ============================================================
# EMAIL PREFERENCE ENDPOINTS
# ============================================================

def test_email_pref_default_disabled(client):
    token = register_user(client)
    resp = client.get("/api/notifications/email", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_email_pref_enable(client):
    token = register_user(client)
    resp = client.put("/api/notifications/email?enabled=true", json={}, headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True
    # Verify persistence
    resp = client.get("/api/notifications/email", headers=auth_header(token))
    assert resp.json()["enabled"] is True


def test_email_pref_disable(client):
    token = register_user(client)
    client.put("/api/notifications/email?enabled=true", json={}, headers=auth_header(token))
    resp = client.put("/api/notifications/email?enabled=false", json={}, headers=auth_header(token))
    assert resp.json()["enabled"] is False


def test_email_pref_requires_auth(client):
    resp = client.get("/api/notifications/email")
    assert resp.status_code == 401


def test_email_pref_user_isolation(client):
    token1 = register_user(client, "user1@test.com")
    token2 = register_user(client, "user2@test.com")
    client.put("/api/notifications/email?enabled=true", json={}, headers=auth_header(token1))
    resp = client.get("/api/notifications/email", headers=auth_header(token2))
    assert resp.json()["enabled"] is False


# ============================================================
# CONFIG ENDPOINT
# ============================================================

def test_config_no_smtp(client):
    with patch.dict(os.environ, {"SMTP_HOST": ""}, clear=False):
        resp = client.get("/api/config")
        assert resp.json()["email_notifications_available"] is False


def test_config_with_smtp(client):
    with patch.dict(os.environ, {"SMTP_HOST": "smtp.test.com"}):
        resp = client.get("/api/config")
        assert resp.json()["email_notifications_available"] is True


# ============================================================
# EMAIL SENDER
# ============================================================

def test_build_event_email():
    from email_sender import build_event_email
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
    from email_sender import send_email
    with patch.dict(os.environ, {"SMTP_HOST": ""}):
        result = send_email("test@test.com", "subj", "body")
        assert result is False


def test_send_email_success():
    from email_sender import send_email
    with patch.dict(os.environ, {
        "SMTP_HOST": "smtp.test.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "user",
        "SMTP_PASSWORD": "pass",
        "SMTP_FROM": "noreply@test.com",
        "SMTP_TLS": "true",
    }):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server
            result = send_email("test@test.com", "Test Subject", "Test Body", "<p>Test</p>")
            assert result is True
            mock_server.starttls.assert_called_once()
            mock_server.login.assert_called_once_with("user", "pass")
            mock_server.sendmail.assert_called_once()
            mock_server.quit.assert_called_once()


# ============================================================
# DAILY NOTIFICATION LOGIC
# ============================================================

def test_notification_build_payload():
    from notifications import build_notification_payload
    assert build_notification_payload([]) is None
    payload = build_notification_payload([{"event_type": "Vesting"}])
    assert payload["title"] == "Equity Tracker"
    assert "1 event" in payload["body"]


def test_send_daily_notifications_with_email(client, db_session):
    """Integration: user with email pref enabled gets email for today's events."""
    from models import User, Grant, Price, EmailPreference
    from datetime import date

    token = register_user(client)
    # Get user
    user = db_session.query(User).first()
    # Enable email
    pref = EmailPreference(user_id=user.id, enabled=True)
    db_session.add(pref)
    # Add a grant that vests today (we'll mock the date)
    db_session.add(Grant(
        user_id=user.id, year=2020, type="Purchase", shares=100, price=5.0,
        vest_start=date(2025, 3, 20), periods=5,
        exercise_date=date(2030, 3, 20), dp_shares=0,
    ))
    db_session.add(Price(
        user_id=user.id, effective_date=date(2020, 1, 1), price=5.0,
    ))
    db_session.commit()

    with patch.dict(os.environ, {"SMTP_HOST": "smtp.test.com", "SMTP_USER": "u", "SMTP_PASSWORD": "p", "SMTP_FROM": "n@t.com"}):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server

            from notifications import send_daily_notifications
            send_daily_notifications(today=date(2026, 3, 20))

            # Should have sent an email
            assert mock_server.sendmail.call_count >= 1
