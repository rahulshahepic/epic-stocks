import sys
import os
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    """Register a user whose email matches ADMIN_EMAIL via the test-login endpoint."""
    client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})


# ============================================================
# ADMIN AUTH SECURITY
# ============================================================

def test_admin_requires_admin_email(client):
    """Non-admin user gets 403 on admin endpoints."""
    with _admin_env():
        register_user(client, "regular@test.com")
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 403
        assert "Admin access required" in resp.json()["detail"]


def test_admin_no_admin_configured(client):
    """When ADMIN_EMAIL is not set, no user gets admin flag."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": ""}):
        register_user(client)
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 403
        assert "Admin access required" in resp.json()["detail"]


def test_admin_requires_auth(client):
    """Admin endpoints require authentication."""
    resp = client.get("/api/admin/stats")
    assert resp.status_code == 401


def test_admin_access_case_insensitive(client):
    """Admin email check is case-insensitive."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "ADMIN@EXAMPLE.COM"}):
        _register_admin(client)
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 200


def test_admin_multiple_emails(client, make_client):
    """ADMIN_EMAIL supports semicolon-delimited list."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com; other@admin.com"}):
        _register_admin(client)
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 200

        # Second admin email also works
        with make_client("other@admin.com") as client2:
            resp = client2.get("/api/admin/stats")
            assert resp.status_code == 200


def test_admin_revoked_on_env_change(client, make_client):
    """Removing email from ADMIN_EMAIL revokes admin on next login."""
    with _admin_env():
        _register_admin(client)
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 200

    # Re-login with admin removed from env — should lose admin on next login
    with patch.dict(os.environ, {"ADMIN_EMAIL": ""}):
        with make_client(ADMIN_EMAIL) as client2:
            resp = client2.get("/api/admin/stats")
            assert resp.status_code == 403


# ============================================================
# ADMIN STATS
# ============================================================

def test_admin_stats(client, make_client):
    with _admin_env():
        _register_admin(client)
        # Create a regular user with some data
        with make_client("user@test.com") as client_user:
            client_user.post("/api/grants", json={
                "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
                "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
            })

        resp = client.get("/api/admin/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_users"] == 2
        assert data["total_grants"] == 1


# ============================================================
# ADMIN USER LIST
# ============================================================

def test_admin_user_list(client, make_client):
    with _admin_env():
        _register_admin(client)
        with make_client("alice@test.com"):
            pass
        with make_client("bob@test.com"):
            pass

        resp = client.get("/api/admin/users")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3  # admin + alice + bob
        emails = {u["email"] for u in data["users"]}
        assert "alice@test.com" in emails
        assert "bob@test.com" in emails


def test_admin_user_list_shows_counts(client, make_client):
    with _admin_env():
        _register_admin(client)
        with make_client("user@test.com") as client_user:
            client_user.post("/api/grants", json={
                "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
                "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
            })
            client_user.post("/api/prices", json={
                "effective_date": "2021-01-01", "price": 3.0,
            })

        resp = client.get("/api/admin/users")
        users = resp.json()["users"]
        user_entry = next(u for u in users if u["email"] == "user@test.com")
        assert user_entry["grant_count"] == 1
        assert user_entry["price_count"] == 1


def test_admin_user_list_no_financial_data(client):
    """User list should NOT expose financial data — only counts."""
    with _admin_env():
        _register_admin(client)
        resp = client.get("/api/admin/users")
        users = resp.json()["users"]
        for u in users:
            assert "shares" not in u
            assert "price" not in u
            assert "amount" not in u


# ============================================================
# DELETE USER
# ============================================================

def test_admin_delete_user(client, make_client):
    with _admin_env():
        _register_admin(client)
        with make_client("delete-me@test.com"):
            pass
        # Get user id
        resp = client.get("/api/admin/users")
        user_entry = next(u for u in resp.json()["users"] if u["email"] == "delete-me@test.com")

        resp = client.delete(f"/api/admin/users/{user_entry['id']}")
        assert resp.status_code == 204

        # Verify user is gone
        resp = client.get("/api/admin/users")
        emails = {u["email"] for u in resp.json()["users"]}
        assert "delete-me@test.com" not in emails


def test_admin_cannot_delete_self(client):
    with _admin_env():
        _register_admin(client)
        resp = client.get("/api/me")
        admin_id = resp.json()["id"]

        resp = client.delete(f"/api/admin/users/{admin_id}")
        assert resp.status_code == 400
        assert "Cannot delete yourself" in resp.json()["detail"]


def test_admin_delete_cascades(client, make_client):
    """Deleting a user removes their grants, loans, prices too."""
    with _admin_env():
        _register_admin(client)
        with make_client("cascade@test.com") as client_user:
            client_user.post("/api/grants", json={
                "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
                "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
            })

        resp = client.get("/api/admin/users")
        user_entry = next(u for u in resp.json()["users"] if u["email"] == "cascade@test.com")
        client.delete(f"/api/admin/users/{user_entry['id']}")

        # Stats should show 0 grants now (only admin user left, with no data)
        resp = client.get("/api/admin/stats")
        assert resp.json()["total_grants"] == 0


def test_admin_cannot_delete_admin_user(client, make_client):
    """Admins cannot delete other admin users."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com;admin2@example.com"}):
        _register_admin(client)
        # Register second admin
        with make_client("admin2@example.com"):
            pass
        resp = client.get("/api/admin/users")
        admin2 = next(u for u in resp.json()["users"] if u["email"] == "admin2@example.com")

        resp = client.delete(f"/api/admin/users/{admin2['id']}")
        assert resp.status_code == 400
        assert "Cannot delete an admin" in resp.json()["detail"]


def test_admin_user_list_includes_is_admin(client, make_client):
    """User list includes is_admin flag."""
    with _admin_env():
        _register_admin(client)
        with make_client("regular@test.com"):
            pass

        resp = client.get("/api/admin/users")
        users = resp.json()["users"]
        admin_entry = next(u for u in users if u["email"] == ADMIN_EMAIL)
        assert admin_entry["is_admin"] is True
        regular = next(u for u in users if u["email"] == "regular@test.com")
        assert regular["is_admin"] is False


def test_admin_user_search(client, make_client):
    """User list supports search by email."""
    with _admin_env():
        _register_admin(client)
        with make_client("alice@test.com"):
            pass
        with make_client("bob@test.com"):
            pass

        resp = client.get("/api/admin/users?q=alice")
        data = resp.json()
        assert data["total"] == 1
        assert data["users"][0]["email"] == "alice@test.com"


def test_admin_user_pagination(client, make_client):
    """User list supports limit and offset."""
    with _admin_env():
        _register_admin(client)
        for i in range(5):
            with make_client(f"user{i}@test.com"):
                pass

        resp = client.get("/api/admin/users?limit=2&offset=0")
        data = resp.json()
        assert data["total"] == 6  # admin + 5 users
        assert len(data["users"]) == 2

        resp = client.get("/api/admin/users?limit=2&offset=4")
        data = resp.json()
        assert len(data["users"]) == 2  # last 2


def test_admin_user_sorted_by_last_login(client, make_client):
    """User list is sorted by last_login descending."""
    with _admin_env():
        _register_admin(client)
        with make_client("old@test.com"):
            pass
        with make_client("new@test.com"):
            pass

        # All users logged in during registration; admin was first, so new@test.com is most recent
        resp = client.get("/api/admin/users?limit=100")
        users = resp.json()["users"]
        # First user should have the most recent last_login
        logins = [u["last_login"] for u in users if u["last_login"]]
        assert logins == sorted(logins, reverse=True)


# ============================================================
# BLOCK / UNBLOCK EMAIL
# ============================================================

def test_block_email(client):
    with _admin_env():
        _register_admin(client)
        resp = client.post("/api/admin/blocked", json={
            "email": "bad@evil.com", "reason": "Spam account",
        })
        assert resp.status_code == 201
        assert resp.json()["email"] == "bad@evil.com"


def test_blocked_email_prevents_login(client):
    with _admin_env():
        _register_admin(client)
        client.post("/api/admin/blocked", json={
            "email": "blocked@test.com", "reason": "Testing",
        })

        # Attempt login with blocked email
        resp = client.post("/api/auth/test-login", json={"email": "blocked@test.com"})
        assert resp.status_code == 403
        assert "blocked" in resp.json()["detail"].lower()


def test_list_blocked(client):
    with _admin_env():
        _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "a@test.com"})
        client.post("/api/admin/blocked", json={"email": "b@test.com"})

        resp = client.get("/api/admin/blocked")
        assert resp.status_code == 200
        assert len(resp.json()) == 2


def test_unblock_email(client):
    with _admin_env():
        _register_admin(client)
        resp = client.post("/api/admin/blocked", json={"email": "unblock@test.com"})
        block_id = resp.json()["id"]

        resp = client.delete(f"/api/admin/blocked/{block_id}")
        assert resp.status_code == 204

        # Should be able to login now
        resp = client.post("/api/auth/test-login", json={"email": "unblock@test.com"})
        assert resp.status_code == 200


def test_block_duplicate_email(client):
    with _admin_env():
        _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "dup@test.com"})
        resp = client.post("/api/admin/blocked", json={"email": "dup@test.com"})
        assert resp.status_code == 409


def test_block_normalizes_email(client):
    with _admin_env():
        _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "UPPER@TEST.COM"})

        resp = client.post("/api/auth/test-login", json={"email": "upper@test.com"})
        assert resp.status_code == 403


# ============================================================
# /api/me ENDPOINT
# ============================================================

def test_me_non_admin(client):
    with _admin_env():
        register_user(client, "regular@test.com")
        resp = client.get("/api/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "regular@test.com"
        assert data["is_admin"] is False


def test_me_admin(client):
    with _admin_env():
        _register_admin(client)
        resp = client.get("/api/me")
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True


# ============================================================
# LAST LOGIN
# ============================================================

def test_last_login_set_on_login(client, make_client):
    with _admin_env():
        _register_admin(client)
        with make_client("user@test.com"):
            pass

        resp = client.get("/api/admin/users")
        for u in resp.json()["users"]:
            assert u["last_login"] is not None


# ============================================================
# TEST-LOGIN ADMIN FLAG (unit-level, route registered at import time)
# ============================================================

def test_test_login_sets_admin_flag(client, db_session):
    """test-login should set is_admin and last_login just like google login."""
    from scaffold.auth import create_token, get_admin_emails
    from scaffold.models import User
    from scaffold.crypto import encryption_enabled, generate_user_key, encrypt_user_key
    from datetime import datetime, timezone

    with _admin_env():
        # Simulate what the test-login endpoint does
        email = ADMIN_EMAIL
        enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
        user = User(email=email, google_id=f"test-{email}", name="Admin", encrypted_key=enc_key)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        user.is_admin = user.email.lower() in get_admin_emails()
        user.last_login = datetime.now(timezone.utc)
        db_session.commit()

        assert user.is_admin
        assert user.last_login is not None

        client.post("/api/auth/test-login", json={"email": email})
        resp = client.get("/api/me")
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True


def test_test_login_non_admin_flag(client, db_session):
    """test-login should NOT set is_admin for non-admin emails."""
    from scaffold.auth import create_token, get_admin_emails
    from scaffold.models import User
    from scaffold.crypto import encryption_enabled, generate_user_key, encrypt_user_key
    from datetime import datetime, timezone

    with _admin_env():
        email = "nobody@test.com"
        enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
        user = User(email=email, google_id=f"test-{email}", name="Nobody", encrypted_key=enc_key)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        user.is_admin = user.email.lower() in get_admin_emails()
        user.last_login = datetime.now(timezone.utc)
        db_session.commit()

        assert not user.is_admin

        client.post("/api/auth/test-login", json={"email": email})
        resp = client.get("/api/me")
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False


# ============================================================
# TEST NOTIFY
# ============================================================

def test_admin_test_notify_push(client, db_session, make_client):
    """Admin can send a test push notification to a user."""
    from unittest.mock import MagicMock, patch as upatch
    from scaffold.models import PushSubscription

    with _admin_env():
        _register_admin(client)
        with make_client("target@test.com") as client_target:
            target_id = client_target.get("/api/me").json()["id"]

        sub = PushSubscription(
            user_id=target_id,
            endpoint="https://example.com/push/1",
            p256dh="key",
            auth="auth",
        )
        db_session.add(sub)
        db_session.commit()

        with upatch("scaffold.notifications.send_push", return_value=True) as mock_push:
            resp = client.post(
                "/api/admin/test-notify",
                json={"user_id": target_id, "title": "Hello", "body": "World"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["push_sent"] == 1
        assert data["push_failed"] == 0
        assert data["email_sent"] is False
        mock_push.assert_called_once()


def test_admin_test_notify_expired_sub_deleted(client, db_session, make_client):
    """Expired push subscription (send_push returns False) is deleted."""
    from unittest.mock import patch as upatch
    from scaffold.models import PushSubscription

    with _admin_env():
        _register_admin(client)
        with make_client("expired@test.com") as client_target:
            target_id = client_target.get("/api/me").json()["id"]

        sub = PushSubscription(
            user_id=target_id,
            endpoint="https://example.com/push/expired",
            p256dh="key",
            auth="auth",
        )
        db_session.add(sub)
        db_session.commit()

        with upatch("scaffold.notifications.send_push", return_value=False):
            resp = client.post(
                "/api/admin/test-notify",
                json={"user_id": target_id, "title": "Hi", "body": "Test"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["push_sent"] == 0
        assert data["push_failed"] == 1

        # Subscription should be deleted
        remaining = db_session.query(PushSubscription).filter(
            PushSubscription.user_id == target_id
        ).count()
        assert remaining == 0


def test_admin_test_notify_user_not_found(client):
    """Returns 404 for unknown user_id."""
    with _admin_env():
        _register_admin(client)
        resp = client.post(
            "/api/admin/test-notify",
            json={"user_id": 999999, "title": "Hi", "body": "Test"},
        )
        assert resp.status_code == 404


def test_admin_test_notify_non_admin_forbidden(client):
    """Non-admin cannot use test-notify endpoint."""
    with _admin_env():
        register_user(client, "notadmin@test.com")
        resp = client.post(
            "/api/admin/test-notify",
            json={"user_id": 1, "title": "Hi", "body": "Test"},
        )
        assert resp.status_code == 403


def test_admin_test_notify_no_subscriptions(client, make_client):
    """User with no push subscriptions returns push_sent=0, no error."""
    with _admin_env():
        _register_admin(client)
        with make_client("nosub@test.com") as client_target:
            target_id = client_target.get("/api/me").json()["id"]

        resp = client.post(
            "/api/admin/test-notify",
            json={"user_id": target_id, "title": "Hi", "body": "Test"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["push_sent"] == 0
        assert data["push_failed"] == 0
        assert data["email_sent"] is False


def test_admin_test_notify_rate_limited(client, make_client):
    """test-notify is rate-limited to 5 per hour per admin."""
    from scaffold.routers import admin as admin_router
    # Clear the in-memory counter before test
    admin_router._test_notify_counts.clear()

    with _admin_env():
        _register_admin(client)
        with make_client("ratelimit@test.com") as client_target:
            target_id = client_target.get("/api/me").json()["id"]

        for i in range(5):
            resp = client.post(
                "/api/admin/test-notify",
                json={"user_id": target_id, "title": "Hi", "body": "Test"},
            )
            assert resp.status_code == 200, f"Call {i+1} failed unexpectedly"

        # 6th call should be rate-limited
        resp = client.post(
            "/api/admin/test-notify",
            json={"user_id": target_id, "title": "Hi", "body": "Test"},
        )
        assert resp.status_code == 429
        assert "Rate limit" in resp.json()["detail"]

    admin_router._test_notify_counts.clear()
