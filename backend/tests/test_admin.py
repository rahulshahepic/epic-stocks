import sys
import os
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    """Register a user whose email matches ADMIN_EMAIL."""
    from tests.conftest import _fake_google_info
    info = _fake_google_info(ADMIN_EMAIL)
    with patch("routers.auth_router.verify_google_token", return_value=info):
        resp = client.post("/api/auth/google", json={"token": "admin-token"})
    return resp.json()["access_token"]


# ============================================================
# ADMIN AUTH SECURITY
# ============================================================

def test_admin_requires_admin_email(client):
    """Non-admin user gets 403 on admin endpoints."""
    with _admin_env():
        token = register_user(client, "regular@test.com")
        resp = client.get("/api/admin/stats", headers=auth_header(token))
        assert resp.status_code == 403
        assert "Admin access required" in resp.json()["detail"]


def test_admin_no_admin_configured(client):
    """When ADMIN_EMAIL is not set, no user gets admin flag."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": ""}):
        token = register_user(client)
        resp = client.get("/api/admin/stats", headers=auth_header(token))
        assert resp.status_code == 403
        assert "Admin access required" in resp.json()["detail"]


def test_admin_requires_auth(client):
    """Admin endpoints require authentication."""
    resp = client.get("/api/admin/stats")
    assert resp.status_code == 401


def test_admin_access_case_insensitive(client):
    """Admin email check is case-insensitive."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "ADMIN@EXAMPLE.COM"}):
        token = _register_admin(client)
        resp = client.get("/api/admin/stats", headers=auth_header(token))
        assert resp.status_code == 200


def test_admin_multiple_emails(client):
    """ADMIN_EMAIL supports semicolon-delimited list."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com; other@admin.com"}):
        token = _register_admin(client)
        resp = client.get("/api/admin/stats", headers=auth_header(token))
        assert resp.status_code == 200

        # Second admin email also works
        from tests.conftest import _fake_google_info
        info = _fake_google_info("other@admin.com")
        with patch("routers.auth_router.verify_google_token", return_value=info):
            resp = client.post("/api/auth/google", json={"token": "t"})
        token2 = resp.json()["access_token"]
        resp = client.get("/api/admin/stats", headers=auth_header(token2))
        assert resp.status_code == 200


def test_admin_revoked_on_env_change(client):
    """Removing email from ADMIN_EMAIL revokes admin on next login."""
    # Use a fixed google ID so re-login finds existing user
    fixed_info = {
        "sub": "admin-google-id-fixed",
        "email": ADMIN_EMAIL,
        "email_verified": "true",
        "name": "Admin",
        "picture": "",
        "aud": "",
    }
    with _admin_env():
        with patch("routers.auth_router.verify_google_token", return_value=fixed_info):
            resp = client.post("/api/auth/google", json={"token": "t1"})
        token = resp.json()["access_token"]
        resp = client.get("/api/admin/stats", headers=auth_header(token))
        assert resp.status_code == 200

    # Re-login with admin removed from env — should lose admin on next login
    with patch.dict(os.environ, {"ADMIN_EMAIL": ""}):
        with patch("routers.auth_router.verify_google_token", return_value=fixed_info):
            resp = client.post("/api/auth/google", json={"token": "t2"})
        token2 = resp.json()["access_token"]
        resp = client.get("/api/admin/stats", headers=auth_header(token2))
        assert resp.status_code == 403


# ============================================================
# ADMIN STATS
# ============================================================

def test_admin_stats(client):
    with _admin_env():
        admin_token = _register_admin(client)
        # Create a regular user with some data
        user_token = register_user(client, "user@test.com")
        client.post("/api/grants", json={
            "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
            "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
        }, headers=auth_header(user_token))

        resp = client.get("/api/admin/stats", headers=auth_header(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_users"] == 2
        assert data["total_grants"] == 1


# ============================================================
# ADMIN USER LIST
# ============================================================

def test_admin_user_list(client):
    with _admin_env():
        admin_token = _register_admin(client)
        register_user(client, "alice@test.com")
        register_user(client, "bob@test.com")

        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3  # admin + alice + bob
        emails = {u["email"] for u in data["users"]}
        assert "alice@test.com" in emails
        assert "bob@test.com" in emails


def test_admin_user_list_shows_counts(client):
    with _admin_env():
        admin_token = _register_admin(client)
        user_token = register_user(client, "user@test.com")
        client.post("/api/grants", json={
            "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
            "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
        }, headers=auth_header(user_token))
        client.post("/api/prices", json={
            "effective_date": "2021-01-01", "price": 3.0,
        }, headers=auth_header(user_token))

        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        users = resp.json()["users"]
        user_entry = next(u for u in users if u["email"] == "user@test.com")
        assert user_entry["grant_count"] == 1
        assert user_entry["price_count"] == 1


def test_admin_user_list_no_financial_data(client):
    """User list should NOT expose financial data — only counts."""
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        users = resp.json()["users"]
        for u in users:
            assert "shares" not in u
            assert "price" not in u
            assert "amount" not in u


# ============================================================
# DELETE USER
# ============================================================

def test_admin_delete_user(client):
    with _admin_env():
        admin_token = _register_admin(client)
        user_token = register_user(client, "delete-me@test.com")
        # Get user id
        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        user_entry = next(u for u in resp.json()["users"] if u["email"] == "delete-me@test.com")

        resp = client.delete(f"/api/admin/users/{user_entry['id']}", headers=auth_header(admin_token))
        assert resp.status_code == 204

        # Verify user is gone
        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        emails = {u["email"] for u in resp.json()["users"]}
        assert "delete-me@test.com" not in emails


def test_admin_cannot_delete_self(client):
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.get("/api/me", headers=auth_header(admin_token))
        admin_id = resp.json()["id"]

        resp = client.delete(f"/api/admin/users/{admin_id}", headers=auth_header(admin_token))
        assert resp.status_code == 400
        assert "Cannot delete yourself" in resp.json()["detail"]


def test_admin_delete_cascades(client):
    """Deleting a user removes their grants, loans, prices too."""
    with _admin_env():
        admin_token = _register_admin(client)
        user_token = register_user(client, "cascade@test.com")
        client.post("/api/grants", json={
            "year": 2020, "type": "Purchase", "shares": 1000, "price": 2.0,
            "vest_start": "2021-01-01", "periods": 3, "exercise_date": "2020-12-31", "dp_shares": 0,
        }, headers=auth_header(user_token))

        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        user_entry = next(u for u in resp.json()["users"] if u["email"] == "cascade@test.com")
        client.delete(f"/api/admin/users/{user_entry['id']}", headers=auth_header(admin_token))

        # Stats should show 0 grants now (only admin user left, with no data)
        resp = client.get("/api/admin/stats", headers=auth_header(admin_token))
        assert resp.json()["total_grants"] == 0


def test_admin_cannot_delete_admin_user(client):
    """Admins cannot delete other admin users."""
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com;admin2@example.com"}):
        admin_token = _register_admin(client)
        # Register second admin
        from tests.conftest import _fake_google_info
        info = _fake_google_info("admin2@example.com")
        with patch("routers.auth_router.verify_google_token", return_value=info):
            resp = client.post("/api/auth/google", json={"token": "t"})
        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        admin2 = next(u for u in resp.json()["users"] if u["email"] == "admin2@example.com")

        resp = client.delete(f"/api/admin/users/{admin2['id']}", headers=auth_header(admin_token))
        assert resp.status_code == 400
        assert "Cannot delete an admin" in resp.json()["detail"]


def test_admin_user_list_includes_is_admin(client):
    """User list includes is_admin flag."""
    with _admin_env():
        admin_token = _register_admin(client)
        register_user(client, "regular@test.com")

        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        users = resp.json()["users"]
        admin_entry = next(u for u in users if u["email"] == ADMIN_EMAIL)
        assert admin_entry["is_admin"] is True
        regular = next(u for u in users if u["email"] == "regular@test.com")
        assert regular["is_admin"] is False


def test_admin_user_search(client):
    """User list supports search by email."""
    with _admin_env():
        admin_token = _register_admin(client)
        register_user(client, "alice@test.com")
        register_user(client, "bob@test.com")

        resp = client.get("/api/admin/users?q=alice", headers=auth_header(admin_token))
        data = resp.json()
        assert data["total"] == 1
        assert data["users"][0]["email"] == "alice@test.com"


def test_admin_user_pagination(client):
    """User list supports limit and offset."""
    with _admin_env():
        admin_token = _register_admin(client)
        for i in range(5):
            register_user(client, f"user{i}@test.com")

        resp = client.get("/api/admin/users?limit=2&offset=0", headers=auth_header(admin_token))
        data = resp.json()
        assert data["total"] == 6  # admin + 5 users
        assert len(data["users"]) == 2

        resp = client.get("/api/admin/users?limit=2&offset=4", headers=auth_header(admin_token))
        data = resp.json()
        assert len(data["users"]) == 2  # last 2


def test_admin_user_sorted_by_last_login(client):
    """User list is sorted by last_login descending."""
    with _admin_env():
        admin_token = _register_admin(client)
        register_user(client, "old@test.com")
        register_user(client, "new@test.com")

        # All users logged in during registration; admin was first, so new@test.com is most recent
        resp = client.get("/api/admin/users?limit=100", headers=auth_header(admin_token))
        users = resp.json()["users"]
        # First user should have the most recent last_login
        logins = [u["last_login"] for u in users if u["last_login"]]
        assert logins == sorted(logins, reverse=True)


# ============================================================
# BLOCK / UNBLOCK EMAIL
# ============================================================

def test_block_email(client):
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.post("/api/admin/blocked", json={
            "email": "bad@evil.com", "reason": "Spam account",
        }, headers=auth_header(admin_token))
        assert resp.status_code == 201
        assert resp.json()["email"] == "bad@evil.com"


def test_blocked_email_prevents_login(client):
    with _admin_env():
        admin_token = _register_admin(client)
        client.post("/api/admin/blocked", json={
            "email": "blocked@test.com", "reason": "Testing",
        }, headers=auth_header(admin_token))

        # Attempt login with blocked email
        from tests.conftest import _fake_google_info
        info = _fake_google_info("blocked@test.com")
        with patch("routers.auth_router.verify_google_token", return_value=info):
            resp = client.post("/api/auth/google", json={"token": "fake"})
        assert resp.status_code == 403
        assert "blocked" in resp.json()["detail"].lower()


def test_list_blocked(client):
    with _admin_env():
        admin_token = _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "a@test.com"}, headers=auth_header(admin_token))
        client.post("/api/admin/blocked", json={"email": "b@test.com"}, headers=auth_header(admin_token))

        resp = client.get("/api/admin/blocked", headers=auth_header(admin_token))
        assert resp.status_code == 200
        assert len(resp.json()) == 2


def test_unblock_email(client):
    with _admin_env():
        admin_token = _register_admin(client)
        resp = client.post("/api/admin/blocked", json={"email": "unblock@test.com"}, headers=auth_header(admin_token))
        block_id = resp.json()["id"]

        resp = client.delete(f"/api/admin/blocked/{block_id}", headers=auth_header(admin_token))
        assert resp.status_code == 204

        # Should be able to login now
        from tests.conftest import _fake_google_info
        info = _fake_google_info("unblock@test.com")
        with patch("routers.auth_router.verify_google_token", return_value=info):
            resp = client.post("/api/auth/google", json={"token": "fake"})
        assert resp.status_code == 200


def test_block_duplicate_email(client):
    with _admin_env():
        admin_token = _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "dup@test.com"}, headers=auth_header(admin_token))
        resp = client.post("/api/admin/blocked", json={"email": "dup@test.com"}, headers=auth_header(admin_token))
        assert resp.status_code == 409


def test_block_normalizes_email(client):
    with _admin_env():
        admin_token = _register_admin(client)
        client.post("/api/admin/blocked", json={"email": "UPPER@TEST.COM"}, headers=auth_header(admin_token))

        from tests.conftest import _fake_google_info
        info = _fake_google_info("upper@test.com")
        with patch("routers.auth_router.verify_google_token", return_value=info):
            resp = client.post("/api/auth/google", json={"token": "fake"})
        assert resp.status_code == 403


# ============================================================
# /api/me ENDPOINT
# ============================================================

def test_me_non_admin(client):
    with _admin_env():
        token = register_user(client, "regular@test.com")
        resp = client.get("/api/me", headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "regular@test.com"
        assert data["is_admin"] is False


def test_me_admin(client):
    with _admin_env():
        token = _register_admin(client)
        resp = client.get("/api/me", headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True


# ============================================================
# LAST LOGIN
# ============================================================

def test_last_login_set_on_login(client):
    with _admin_env():
        admin_token = _register_admin(client)
        register_user(client, "user@test.com")

        resp = client.get("/api/admin/users", headers=auth_header(admin_token))
        for u in resp.json()["users"]:
            assert u["last_login"] is not None


# ============================================================
# TEST-LOGIN ADMIN FLAG (unit-level, route registered at import time)
# ============================================================

def test_test_login_sets_admin_flag(client, db_session):
    """test-login should set is_admin and last_login just like google login."""
    from auth import create_token, get_admin_emails
    from models import User
    from crypto import encryption_enabled, generate_user_key, encrypt_user_key
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

        token = create_token(user.id)
        resp = client.get("/api/me", headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True


def test_test_login_non_admin_flag(client, db_session):
    """test-login should NOT set is_admin for non-admin emails."""
    from auth import create_token, get_admin_emails
    from models import User
    from crypto import encryption_enabled, generate_user_key, encrypt_user_key
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

        token = create_token(user.id)
        resp = client.get("/api/me", headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False
