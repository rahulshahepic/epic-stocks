"""Tests for the email unsubscribe system and admin email management."""
import os
from unittest.mock import patch
from tests.conftest import register_user

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})


# ── Unsubscribe token helpers ──────────────────────────────────────────────

class TestUnsubscribeTokens:
    def test_generate_and_verify(self):
        from scaffold.email_sender import generate_unsubscribe_token, verify_unsubscribe_token
        token = generate_unsubscribe_token("test@example.com", "invite")
        assert verify_unsubscribe_token(token, "test@example.com", "invite")
        assert not verify_unsubscribe_token(token, "other@example.com", "invite")
        assert not verify_unsubscribe_token(token, "test@example.com", "notify")
        assert not verify_unsubscribe_token("badtoken", "test@example.com", "invite")

    def test_case_insensitive(self):
        from scaffold.email_sender import generate_unsubscribe_token, verify_unsubscribe_token
        token = generate_unsubscribe_token("Test@Example.COM", "notify")
        assert verify_unsubscribe_token(token, "test@example.com", "notify")

    def test_unsubscribe_url(self):
        from scaffold.email_sender import unsubscribe_url
        with patch.dict(os.environ, {"APP_URL": "https://example.com"}):
            url = unsubscribe_url("test@example.com", "invite")
            assert "https://example.com/unsubscribe" in url
            assert "token=" in url
            assert "email=test" in url
            assert "type=invite" in url


# ── Unsubscribe API ────────────────────────────────────────────────────────

class TestUnsubscribeAPI:
    def test_check_valid_token(self, client):
        from scaffold.email_sender import generate_unsubscribe_token
        token = generate_unsubscribe_token("bob@test.com", "invite")
        resp = client.get("/api/unsubscribe", params={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["already_unsubscribed"] is False

    def test_check_invalid_token(self, client):
        resp = client.get("/api/unsubscribe", params={
            "token": "bad", "email": "bob@test.com", "type": "invite"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False

    def test_check_invalid_type(self, client):
        from scaffold.email_sender import generate_unsubscribe_token
        token = generate_unsubscribe_token("bob@test.com", "invite")
        resp = client.get("/api/unsubscribe", params={
            "token": token, "email": "bob@test.com", "type": "bad"
        })
        assert resp.status_code == 200
        assert resp.json()["valid"] is False

    def test_process_invite_unsubscribe(self, client):
        from scaffold.email_sender import generate_unsubscribe_token
        token = generate_unsubscribe_token("bob@test.com", "invite")
        resp = client.post("/api/unsubscribe", json={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        # Verify opt-out is recorded
        resp2 = client.get("/api/unsubscribe", params={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        assert resp2.json()["already_unsubscribed"] is True

    def test_process_notify_unsubscribe(self, client):
        register_user(client, "bob@test.com")
        # Enable email prefs first
        client.put("/api/notifications/email?enabled=true")

        from scaffold.email_sender import generate_unsubscribe_token
        token = generate_unsubscribe_token("bob@test.com", "notify")
        resp = client.post("/api/unsubscribe", json={
            "token": token, "email": "bob@test.com", "type": "notify"
        })
        assert resp.status_code == 200

        # Verify email notifications are disabled
        resp2 = client.get("/api/unsubscribe", params={
            "token": token, "email": "bob@test.com", "type": "notify"
        })
        assert resp2.json()["already_unsubscribed"] is True

    def test_process_invalid_token_rejected(self, client):
        resp = client.post("/api/unsubscribe", json={
            "token": "bad", "email": "bob@test.com", "type": "invite"
        })
        assert resp.status_code == 403

    def test_idempotent_unsubscribe(self, client):
        from scaffold.email_sender import generate_unsubscribe_token
        token = generate_unsubscribe_token("bob@test.com", "invite")
        # First unsubscribe
        resp1 = client.post("/api/unsubscribe", json={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        assert resp1.status_code == 200
        # Second unsubscribe (idempotent)
        resp2 = client.post("/api/unsubscribe", json={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        assert resp2.status_code == 200


# ── Invitation opt-out blocks sending ──────────────────────────────────────

class TestOptOutBlocksInvites:
    def test_opted_out_email_cannot_be_invited(self, client):
        from scaffold.email_sender import generate_unsubscribe_token
        # Bob opts out
        token = generate_unsubscribe_token("bob@test.com", "invite")
        client.post("/api/unsubscribe", json={
            "token": token, "email": "bob@test.com", "type": "invite"
        })
        # Alice tries to invite Bob
        register_user(client, "alice@test.com")
        resp = client.post("/api/sharing/invite", json={"email": "bob@test.com"})
        assert resp.status_code == 422
        assert "opted out" in resp.json()["detail"]

    def test_unsubscribe_declines_pending_invites(self, client, make_client):
        """When a recipient unsubscribes, all pending invites to them should be declined."""
        from scaffold.email_sender import generate_unsubscribe_token
        # Alice invites Bob
        with make_client("alice@test.com", "Alice") as alice:
            alice.post("/api/sharing/invite", json={"email": "bob@test.com"})
            sent = alice.get("/api/sharing/sent").json()
            assert len(sent) == 1
            assert sent[0]["status"] == "pending"

        # Bob unsubscribes
        unsub_token = generate_unsubscribe_token("bob@test.com", "invite")
        resp = client.post("/api/unsubscribe", json={
            "token": unsub_token, "email": "bob@test.com", "type": "invite"
        })
        assert resp.status_code == 200

        # Alice's invite should now be declined
        with make_client("alice@test.com", "Alice") as alice:
            sent = alice.get("/api/sharing/sent").json()
            assert len(sent) == 1
            assert sent[0]["status"] == "declined"

    def test_resend_blocked_after_recipient_opts_out(self, client, make_client):
        """Resending an invite should fail if the recipient has opted out."""
        from scaffold.email_sender import generate_unsubscribe_token
        # Alice invites Bob
        with make_client("alice@test.com", "Alice") as alice:
            alice.post("/api/sharing/invite", json={"email": "bob@test.com"})
            sent = alice.get("/api/sharing/sent").json()
            invite_id = sent[0]["id"]

        # Bob unsubscribes — this also declines the invite
        unsub_token = generate_unsubscribe_token("bob@test.com", "invite")
        client.post("/api/unsubscribe", json={
            "token": unsub_token, "email": "bob@test.com", "type": "invite"
        })

        # Alice tries to resend — should fail (invite is now declined, not pending)
        with make_client("alice@test.com", "Alice") as alice:
            resp = alice.post(f"/api/sharing/invite/{invite_id}/resend")
            assert resp.status_code == 422


# ── Sending block ──────────────────────────────────────────────────────────

class TestSendingBlock:
    def test_blocked_user_cannot_send(self, client, make_client):
        with _admin_env():
            _register_admin(client)
            # Create a user
            with make_client("alice@test.com") as alice:
                # Admin blocks alice from sending
                me = alice.get("/api/me").json()
                client.post(f"/api/admin/users/{me['id']}/block-sending", json={"reason": "abuse"})
                # Alice tries to invite
                resp = alice.post("/api/sharing/invite", json={"email": "bob@test.com"})
                assert resp.status_code == 403
                assert "restricted" in resp.json()["detail"]

    def test_unblock_allows_sending(self, client, make_client):
        with _admin_env():
            _register_admin(client)
            with make_client("alice@test.com") as alice:
                me = alice.get("/api/me").json()
                # Block then unblock
                client.post(f"/api/admin/users/{me['id']}/block-sending", json={"reason": "test"})
                client.delete(f"/api/admin/users/{me['id']}/block-sending")
                # Alice can now invite
                resp = alice.post("/api/sharing/invite", json={"email": "bob@test.com"})
                assert resp.status_code == 200


# ── Admin email lookup ─────────────────────────────────────────────────────

class TestAdminEmailLookup:
    def test_lookup_existing_user(self, client):
        with _admin_env():
            _register_admin(client)
            register_user(client, "alice@test.com", "Alice")
            _register_admin(client)  # re-login as admin
            resp = client.get("/api/admin/email-lookup", params={"email": "alice@test.com"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["has_account"] is True
            assert data["user_name"] == "Alice"
            assert data["invitation_opt_out"] is False

    def test_lookup_nonexistent(self, client):
        with _admin_env():
            _register_admin(client)
            resp = client.get("/api/admin/email-lookup", params={"email": "nobody@test.com"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["has_account"] is False

    def test_lookup_shows_opt_out(self, client):
        with _admin_env():
            _register_admin(client)
            from scaffold.email_sender import generate_unsubscribe_token
            token = generate_unsubscribe_token("bob@test.com", "invite")
            client.post("/api/unsubscribe", json={
                "token": token, "email": "bob@test.com", "type": "invite"
            })
            resp = client.get("/api/admin/email-lookup", params={"email": "bob@test.com"})
            data = resp.json()
            assert data["invitation_opt_out"] is True
            assert data["opt_out_id"] is not None


# ── Admin user detail ──────────────────────────────────────────────────────

class TestAdminUserDetail:
    def test_user_detail(self, client, make_client):
        with _admin_env():
            _register_admin(client)
            with make_client("alice@test.com", "Alice") as alice:
                me = alice.get("/api/me").json()

            resp = client.get(f"/api/admin/users/{me['id']}/detail")
            assert resp.status_code == 200
            data = resp.json()
            assert data["email"] == "alice@test.com"
            assert data["name"] == "Alice"
            assert isinstance(data["invitations_sent"], list)
            assert isinstance(data["invitations_received"], list)

    def test_user_detail_not_found(self, client):
        with _admin_env():
            _register_admin(client)
            resp = client.get("/api/admin/users/99999/detail")
            assert resp.status_code == 404


# ── Admin opt-out clearing ─────────────────────────────────────────────────

class TestAdminOptOutClearing:
    def test_clear_opt_out_by_id(self, client):
        with _admin_env():
            _register_admin(client)
            from scaffold.email_sender import generate_unsubscribe_token
            token = generate_unsubscribe_token("bob@test.com", "invite")
            client.post("/api/unsubscribe", json={
                "token": token, "email": "bob@test.com", "type": "invite"
            })
            # Find the opt-out id
            lookup = client.get("/api/admin/email-lookup", params={"email": "bob@test.com"}).json()
            opt_out_id = lookup["opt_out_id"]

            resp = client.delete(f"/api/admin/opt-outs/{opt_out_id}")
            assert resp.status_code == 204

            # Verify it's cleared
            lookup2 = client.get("/api/admin/email-lookup", params={"email": "bob@test.com"}).json()
            assert lookup2["invitation_opt_out"] is False

    def test_clear_opt_out_by_email(self, client):
        with _admin_env():
            _register_admin(client)
            from scaffold.email_sender import generate_unsubscribe_token
            token = generate_unsubscribe_token("carol@test.com", "invite")
            client.post("/api/unsubscribe", json={
                "token": token, "email": "carol@test.com", "type": "invite"
            })

            resp = client.delete("/api/admin/opt-outs", params={"email": "carol@test.com"})
            assert resp.status_code == 204


# ── Admin reset invitations ───────────────────────────────────────────────

class TestAdminResetInvitations:
    def test_reset_revokes_sent_and_received(self, client, make_client):
        with _admin_env():
            _register_admin(client)

            with make_client("alice@test.com", "Alice") as alice:
                alice.post("/api/sharing/invite", json={"email": "bob@test.com"})
                sent = alice.get("/api/sharing/sent").json()
                assert len(sent) == 1
                invite_token = sent[0]["short_code"].replace("-", "")

                # Bob accepts
                with make_client("bob@test.com", "Bob") as bob:
                    bob.post("/api/sharing/accept", json={"code": invite_token})

                alice_me = alice.get("/api/me").json()

            # Admin resets Alice's invitations
            resp = client.post(f"/api/admin/users/{alice_me['id']}/reset-invitations")
            assert resp.status_code == 200
            data = resp.json()
            assert data["revoked_sent"] == 1

            # Verify Bob no longer has access
            with make_client("bob@test.com", "Bob") as bob:
                received = bob.get("/api/sharing/received").json()
                assert len(received) == 0


# ── Admin re-enable email ─────────────────────────────────────────────────

class TestAdminReenableEmail:
    def test_reenable_after_unsubscribe(self, client):
        with _admin_env():
            _register_admin(client)
            register_user(client, "alice@test.com")
            client.put("/api/notifications/email?enabled=true")

            # Alice unsubscribes
            from scaffold.email_sender import generate_unsubscribe_token
            token = generate_unsubscribe_token("alice@test.com", "notify")
            client.post("/api/unsubscribe", json={
                "token": token, "email": "alice@test.com", "type": "notify"
            })

            # Re-login as admin
            _register_admin(client)
            me_resp = client.get("/api/admin/email-lookup", params={"email": "alice@test.com"}).json()
            assert me_resp["email_notifications_enabled"] is False

            # Admin re-enables
            resp = client.post(f"/api/admin/users/{me_resp['user_id']}/reenable-email")
            assert resp.status_code == 200

            lookup = client.get("/api/admin/email-lookup", params={"email": "alice@test.com"}).json()
            assert lookup["email_notifications_enabled"] is True


# ── Email footer inclusion ─────────────────────────────────────────────────

class TestEmailFooters:
    def test_invitation_email_has_unsubscribe(self):
        with patch.dict(os.environ, {"APP_URL": "https://example.com"}):
            from scaffold.email_sender import build_invitation_email
            _, text, html, hdrs = build_invitation_email("Alice", "tok123", "ABCD-EFGH", "bob@test.com")
            assert "unsubscribe" in text.lower()
            assert "unsubscribe" in html.lower()
            assert "bob@test.com" in text or "bob" in text
            assert "List-Unsubscribe" in hdrs
            assert "List-Unsubscribe-Post" in hdrs
            assert "One-Click" in hdrs["List-Unsubscribe-Post"]

    def test_event_email_has_unsubscribe(self):
        with patch.dict(os.environ, {"APP_URL": "https://example.com"}):
            from scaffold.email_sender import build_event_email
            events = [{"event_type": "Vesting"}]
            _, text, html, hdrs = build_event_email(events, recipient_email="alice@test.com")
            assert "unsubscribe" in text.lower()
            assert "unsubscribe" in html.lower()
            assert "List-Unsubscribe" in hdrs

    def test_event_email_no_footer_without_recipient(self):
        with patch.dict(os.environ, {"APP_URL": "https://example.com"}):
            from scaffold.email_sender import build_event_email
            events = [{"event_type": "Vesting"}]
            _, text, html, hdrs = build_event_email(events)
            # No unsubscribe without recipient
            assert "unsubscribe" not in text.lower()
            assert hdrs == {}
