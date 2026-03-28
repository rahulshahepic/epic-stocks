"""Tests for admin notifications, dedup, and new notification features."""
import sys, os
from datetime import date, datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


def _mock_resend_env():
    return patch.dict(os.environ, {
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "Equity Tracker <n@t.com>",
    })


def _mock_resend_post():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    return patch("scaffold.providers.email.resend.httpx.post", return_value=mock_response)


# ============================================================
# DEDUP: last_notified_at prevents duplicate notifications
# ============================================================

def test_dedup_skips_already_notified_user(client, db_session):
    from scaffold.models import User, Grant, Price, EmailPreference
    from scaffold.notifications import send_daily_notifications

    register_user(client)
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

    with _mock_resend_env():
        with _mock_resend_post() as mock_post:
            # First run — should send
            send_daily_notifications(today=today)
            first_count = mock_post.call_count
            assert first_count >= 1

            # Second run — should skip (already notified today)
            send_daily_notifications(today=today)
            assert mock_post.call_count == first_count  # no additional sends


def test_dedup_allows_next_day(client, db_session):
    from scaffold.models import User, Grant, Price, EmailPreference
    from scaffold.notifications import _already_notified_today

    register_user(client)
    user = db_session.query(User).first()
    user.last_notified_at = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)
    db_session.commit()

    assert _already_notified_today(user, date(2026, 3, 19)) is True
    assert _already_notified_today(user, date(2026, 3, 20)) is False


def test_dedup_none_last_notified(client, db_session):
    from scaffold.models import User
    from scaffold.notifications import _already_notified_today

    register_user(client)
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
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "n@t.com",
    }):
        with _mock_resend_post() as mock_post:
            register_user(client, "newuser@test.com")
            assert mock_post.call_count >= 1
            call_kwargs = mock_post.call_args
            payload = call_kwargs.kwargs["json"]
            assert "admin@test.com" in payload["to"]


def test_admin_no_notification_without_resend(client, db_session):
    """No crash when Resend not configured."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@test.com", "RESEND_API_KEY": ""}):
        register_user(client, "newuser2@test.com")


# ============================================================
# ADMIN: milestone notifications
# ============================================================

def test_milestone_notification_at_10_users(client, db_session, make_client):
    from scaffold.notifications import check_user_milestone
    from scaffold.models import User

    for i in range(9):
        with make_client(f"user{i}@test.com"):
            pass

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "n@t.com",
    }):
        with _mock_resend_post() as mock_post:
            register_user(client, "user10@test.com")
            check_user_milestone(db_session)
            assert mock_post.call_count >= 1


def test_no_milestone_at_7_users(client, db_session, make_client):
    from scaffold.notifications import check_user_milestone

    for i in range(7):
        with make_client(f"u{i}@test.com"):
            pass

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "n@t.com",
    }):
        with _mock_resend_post() as mock_post:
            check_user_milestone(db_session)
            assert mock_post.call_count == 0


# ============================================================
# ADMIN: daily digest
# ============================================================

def test_admin_daily_digest(client, db_session, make_client):
    from scaffold.notifications import send_admin_daily_digest

    with make_client("u1@test.com"):
        pass
    with make_client("u2@test.com"):
        pass

    with patch.dict(os.environ, {
        "ADMIN_EMAIL": "admin@test.com",
        "RESEND_API_KEY": "re_test_key",
        "RESEND_FROM": "n@t.com",
    }):
        with _mock_resend_post() as mock_post:
            send_admin_daily_digest()
            assert mock_post.call_count == 1
            payload = mock_post.call_args.kwargs["json"]
            assert "2" in payload["text"]  # total users


def test_admin_daily_digest_no_resend(client, db_session):
    from scaffold.notifications import send_admin_daily_digest
    with patch.dict(os.environ, {"RESEND_API_KEY": ""}):
        send_admin_daily_digest()  # should not raise


def test_admin_daily_digest_no_admins(client, db_session):
    from scaffold.notifications import send_admin_daily_digest
    with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key", "ADMIN_EMAIL": ""}):
        send_admin_daily_digest()  # should not raise


# ============================================================
# MIGRATION: last_notified_at column exists
# ============================================================

def test_last_notified_at_column_exists(client, db_session):
    from scaffold.models import User
    register_user(client)
    user = db_session.query(User).first()
    assert hasattr(user, "last_notified_at")
    assert user.last_notified_at is None

    user.last_notified_at = datetime.now(timezone.utc)
    db_session.commit()
    db_session.refresh(user)
    assert user.last_notified_at is not None
