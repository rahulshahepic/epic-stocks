"""Tests for admin notifications, dedup, and new notification features."""
import sys, os
from datetime import date, datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


# ============================================================
# DEDUP: last_notified_at prevents duplicate notifications
# ============================================================

def test_dedup_skips_already_notified_user(client, db_session):
    from models import User, Grant, Price, EmailPreference
    from notifications import send_daily_notifications

    token = register_user(client)
    user = db_session.query(User).first()

    pref = EmailPreference(user_id=user.id, enabled=True)
    db_session.add(pref)
    db_session.add(Grant(
        user_id=user.id, year=2020, type="Purchase", shares=100, price=5.0,
        vest_start=date(2025, 3, 20), periods=5,
        exercise_date=date(2030, 3, 20), dp_shares=0,
    ))
    db_session.add(Price(user_id=user.id, effective_date=date(2020, 1, 1), price=5.0))
    db_session.commit()

    today = date(2026, 3, 20)

    with patch.dict(os.environ, {"SMTP_HOST": "smtp.test.com", "SMTP_USER": "u", "SMTP_PASSWORD": "p", "SMTP_FROM": "n@t.com"}):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server

            # First run — should send
            send_daily_notifications(today=today)
            first_count = mock_server.sendmail.call_count
            assert first_count >= 1

            # Second run — should skip (already notified today)
            send_daily_notifications(today=today)
            assert mock_server.sendmail.call_count == first_count  # no additional sends


def test_dedup_allows_next_day(client, db_session):
    from models import User, Grant, Price, EmailPreference
    from notifications import _already_notified_today

    token = register_user(client)
    user = db_session.query(User).first()
    user.last_notified_at = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)
    db_session.commit()

    assert _already_notified_today(user, date(2026, 3, 19)) is True
    assert _already_notified_today(user, date(2026, 3, 20)) is False


def test_dedup_none_last_notified(client, db_session):
    from models import User
    from notifications import _already_notified_today

    token = register_user(client)
    user = db_session.query(User).first()
    assert user.last_notified_at is None
    assert _already_notified_today(user, date(2026, 3, 20)) is False


# ============================================================
# ADMIN: new user signup notification
# ============================================================

def test_admin_new_user_notification(client, db_session):
    """Registering a new user sends an email to admins."""
    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "SMTP_HOST": "smtp.test.com",
        "SMTP_USER": "u",
        "SMTP_PASSWORD": "p",
        "SMTP_FROM": "n@t.com",
    }):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server
            # Register triggers _notify_admin_new_user
            register_user(client, "newuser@test.com")
            assert mock_server.sendmail.call_count >= 1
            # Check the email was sent to admin
            call_args = mock_server.sendmail.call_args
            assert call_args[0][1] == ["admin@test.com"]


def test_admin_no_notification_without_smtp(client, db_session):
    """No crash when SMTP not configured."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@test.com", "SMTP_HOST": ""}):
        # Should not raise
        register_user(client, "newuser2@test.com")


# ============================================================
# ADMIN: milestone notifications
# ============================================================

def test_milestone_notification_at_10_users(client, db_session):
    from notifications import check_user_milestone
    from models import User

    # Create 9 users already in db
    for i in range(9):
        register_user(client, f"user{i}@test.com")

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "SMTP_HOST": "smtp.test.com",
        "SMTP_USER": "u",
        "SMTP_PASSWORD": "p",
        "SMTP_FROM": "n@t.com",
    }):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server

            # Register user #10
            register_user(client, "user10@test.com")

            # Now call check_user_milestone explicitly to verify it sends
            check_user_milestone(db_session)
            assert mock_server.sendmail.call_count >= 1


def test_no_milestone_at_7_users(client, db_session):
    from notifications import check_user_milestone

    for i in range(7):
        register_user(client, f"u{i}@test.com")

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "SMTP_HOST": "smtp.test.com",
        "SMTP_USER": "u",
        "SMTP_PASSWORD": "p",
        "SMTP_FROM": "n@t.com",
    }):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server
            check_user_milestone(db_session)
            assert mock_server.sendmail.call_count == 0


# ============================================================
# ADMIN: daily digest
# ============================================================

def test_admin_daily_digest(client, db_session):
    from notifications import send_admin_daily_digest

    register_user(client, "u1@test.com")
    register_user(client, "u2@test.com")

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "SMTP_HOST": "smtp.test.com",
        "SMTP_USER": "u",
        "SMTP_PASSWORD": "p",
        "SMTP_FROM": "n@t.com",
    }):
        with patch("email_sender.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value = mock_server
            send_admin_daily_digest()
            assert mock_server.sendmail.call_count == 1
            # Verify it includes user count info
            call_args = mock_server.sendmail.call_args
            msg_str = call_args[0][2]
            assert "2" in msg_str  # total users


def test_admin_daily_digest_no_smtp(client, db_session):
    from notifications import send_admin_daily_digest
    with patch.dict(os.environ, {"SMTP_HOST": ""}):
        send_admin_daily_digest()  # should not raise


def test_admin_daily_digest_no_admins(client, db_session):
    from notifications import send_admin_daily_digest
    with patch.dict(os.environ, {"SMTP_HOST": "smtp.test.com", "ADMIN_EMAIL": ""}):
        send_admin_daily_digest()  # should not raise


# ============================================================
# MIGRATION: last_notified_at column exists
# ============================================================

def test_last_notified_at_column_exists(client, db_session):
    from models import User
    token = register_user(client)
    user = db_session.query(User).first()
    assert hasattr(user, "last_notified_at")
    assert user.last_notified_at is None

    user.last_notified_at = datetime.now(timezone.utc)
    db_session.commit()
    db_session.refresh(user)
    assert user.last_notified_at is not None
