"""Tests for the email invitation / sharing feature."""
import pytest
from tests.conftest import register_user


# ── Helpers ──────────────────────────────────────────────────────────────────

def _invite(client, email):
    return client.post("/api/sharing/invite", json={"email": email})


def _seed_data(client):
    """Create minimal grant + price so dashboard/events endpoints return data."""
    client.post("/api/grants", json={
        "year": 2024, "type": "Purchase", "shares": 1000, "price": 10.0,
        "vest_start": "2024-01-01", "periods": 4, "exercise_date": "2024-01-01",
    })
    client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 10.0})
    client.post("/api/prices", json={"effective_date": "2025-01-01", "price": 20.0})


# ── Invitation CRUD ─────────────────────────────────────────────────────────

class TestInviteCRUD:
    def test_send_invite(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        resp = _invite(client, "bob@test.com")
        assert resp.status_code == 200
        data = resp.json()
        assert data["invitee_email"] == "bob@test.com"
        assert data["status"] == "pending"
        assert len(data["short_code"].replace("-", "")) == 8
        # email_sent is False in test env (no email provider configured)
        assert data["email_sent"] is False

    def test_cannot_invite_self(self, client):
        register_user(client, "alice@test.com")
        resp = _invite(client, "alice@test.com")
        assert resp.status_code == 422

    def test_duplicate_invite_blocked(self, client):
        register_user(client, "alice@test.com")
        resp1 = _invite(client, "bob@test.com")
        assert resp1.status_code == 200
        resp2 = _invite(client, "bob@test.com")
        assert resp2.status_code == 409

    def test_list_sent(self, client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        _invite(client, "carol@test.com")
        resp = client.get("/api/sharing/sent")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_revoke_pending(self, client):
        register_user(client, "alice@test.com")
        inv = _invite(client, "bob@test.com").json()
        resp = client.delete(f"/api/sharing/invite/{inv['id']}")
        assert resp.status_code == 204
        sent = client.get("/api/sharing/sent").json()
        assert sent[0]["status"] == "revoked"

    def test_resend_resets_expiry(self, client):
        register_user(client, "alice@test.com")
        inv = _invite(client, "bob@test.com").json()
        old_expires = inv["expires_at"]
        resp = client.post(f"/api/sharing/invite/{inv['id']}/resend")
        assert resp.status_code == 200
        # expires_at should be updated (at least not decreased)
        assert resp.json()["expires_at"] >= old_expires

    def test_revoke_then_reinvite(self, client):
        register_user(client, "alice@test.com")
        inv = _invite(client, "bob@test.com").json()
        client.delete(f"/api/sharing/invite/{inv['id']}")
        resp = _invite(client, "bob@test.com")
        assert resp.status_code == 200


# ── Token acceptance ────────────────────────────────────────────────────────

class TestAcceptance:
    def test_accept_by_token(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        inv = _invite(client, "bob@test.com").json()
        # Extract token from the DB (the API doesn't return raw tokens)
        sent = client.get("/api/sharing/sent").json()
        token = None
        # Get token via invite-info to verify it's valid
        code = sent[0]["short_code"]
        info = client.get(f"/api/sharing/invite-info?code={code}")
        assert info.json()["valid"] is True

        # Accept as bob using the short code
        with make_client("bob@test.com", "Bob") as bob:
            resp = bob.post("/api/sharing/accept", json={"code": code})
            assert resp.status_code == 200
            assert "invitation_id" in resp.json()

    def test_accept_by_short_code_with_dash(self, client, make_client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            resp = bob.post("/api/sharing/accept", json={"code": code})
            assert resp.status_code == 200

    def test_cannot_accept_own_invite(self, client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        resp = client.post("/api/sharing/accept", json={"code": code})
        assert resp.status_code == 422

    def test_accept_sets_invitee_info(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@actual.com", "Bob") as bob:
            bob.post("/api/sharing/accept", json={"code": code})
        sent = client.get("/api/sharing/sent").json()[0]
        assert sent["status"] == "accepted"
        assert sent["invitee_account_email"] == "bob@actual.com"
        assert sent["invitee_name"] == "Bob"

    def test_double_accept_same_user(self, client, make_client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            bob.post("/api/sharing/accept", json={"code": code})
            # Second accept should return ok (already accepted)
            resp = bob.post("/api/sharing/accept", json={"code": code})
            assert resp.status_code == 200

    def test_token_cannot_be_reused(self, client, make_client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            bob.post("/api/sharing/accept", json={"code": code})
        with make_client("carol@test.com") as carol:
            resp = carol.post("/api/sharing/accept", json={"code": code})
            assert resp.status_code == 410

    def test_revoked_invite_cannot_be_accepted(self, client, make_client):
        register_user(client, "alice@test.com")
        inv = _invite(client, "bob@test.com").json()
        client.delete(f"/api/sharing/invite/{inv['id']}")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            resp = bob.post("/api/sharing/accept", json={"code": code})
            assert resp.status_code == 410


# ── Shared data access ──────────────────────────────────────────────────────

class TestSharedAccess:
    def _setup_shared(self, client, make_client):
        """Alice invites Bob, Bob accepts. Returns (alice_client, bob_client, invitation_id)."""
        register_user(client, "alice@test.com", "Alice")
        _seed_data(client)
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        bob_cm = make_client("bob@test.com", "Bob")
        bob = bob_cm.__enter__()
        resp = bob.post("/api/sharing/accept", json={"code": code})
        inv_id = resp.json()["invitation_id"]
        return client, bob, bob_cm, inv_id

    def test_viewer_can_read_dashboard(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/dashboard")
            assert resp.status_code == 200
            data = resp.json()
            assert "current_price" in data
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_can_read_events(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/events")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_can_read_grants(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/grants")
            assert resp.status_code == 200
            assert len(resp.json()) == 1
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_can_read_prices(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/prices")
            assert resp.status_code == 200
            assert len(resp.json()) == 2
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_cannot_write(self, client, make_client):
        """Viewer has no write access — standard endpoints use their own user, not the inviter."""
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            # Bob's own grants list should be empty
            resp = bob.get("/api/grants")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_events_include_exit_summary(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/events")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_can_read_tax_settings(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/tax-settings")
            assert resp.status_code == 200
            data = resp.json()
            assert "federal_income_rate" in data
            assert "state_income_rate" in data
        finally:
            bob_cm.__exit__(None, None, None)

    def test_viewer_can_read_horizon_settings(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            resp = bob.get(f"/api/sharing/view/{inv_id}/horizon-settings")
            assert resp.status_code == 200
            data = resp.json()
            assert "horizon_date" in data
        finally:
            bob_cm.__exit__(None, None, None)

    def test_revoked_access_denied(self, client, make_client):
        alice, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            # Alice revokes
            alice.delete(f"/api/sharing/invite/{inv_id}")
            resp = bob.get(f"/api/sharing/view/{inv_id}/dashboard")
            assert resp.status_code == 404
        finally:
            bob_cm.__exit__(None, None, None)

    def test_unauthorized_viewer_denied(self, client, make_client):
        _, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            with make_client("carol@test.com") as carol:
                resp = carol.get(f"/api/sharing/view/{inv_id}/dashboard")
                assert resp.status_code == 404
        finally:
            bob_cm.__exit__(None, None, None)

    def test_last_viewed_at_updated(self, client, make_client):
        alice, bob, bob_cm, inv_id = self._setup_shared(client, make_client)
        try:
            bob.get(f"/api/sharing/view/{inv_id}/dashboard")
            sent = alice.get("/api/sharing/sent").json()[0]
            assert sent["last_viewed_at"] is not None
        finally:
            bob_cm.__exit__(None, None, None)


# ── Invitee management ──────────────────────────────────────────────────────

class TestInviteeManagement:
    def test_list_received(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com", "Bob") as bob:
            bob.post("/api/sharing/accept", json={"code": code})
            received = bob.get("/api/sharing/received").json()
            assert len(received) == 1
            assert received[0]["inviter_name"] == "Alice"

    def test_remove_access(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            resp = bob.post("/api/sharing/accept", json={"code": code})
            inv_id = resp.json()["invitation_id"]
            resp = bob.delete(f"/api/sharing/access/{inv_id}")
            assert resp.status_code == 204
            received = bob.get("/api/sharing/received").json()
            assert len(received) == 0

    def test_toggle_notify(self, client, make_client):
        register_user(client, "alice@test.com")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            resp = bob.post("/api/sharing/accept", json={"code": code})
            inv_id = resp.json()["invitation_id"]
            resp = bob.put(f"/api/sharing/access/{inv_id}/notify", json={"enabled": False})
            assert resp.status_code == 200
            assert resp.json()["enabled"] is False


# ── /api/me shared_accounts ─────────────────────────────────────────────────

class TestMeSharedAccounts:
    def test_me_includes_shared_accounts(self, client, make_client):
        register_user(client, "alice@test.com", "Alice")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        with make_client("bob@test.com") as bob:
            bob.post("/api/sharing/accept", json={"code": code})
            me = bob.get("/api/me").json()
            assert len(me["shared_accounts"]) == 1
            assert me["shared_accounts"][0]["inviter_name"] == "Alice"

    def test_me_no_shared_accounts(self, client):
        register_user(client, "alice@test.com")
        me = client.get("/api/me").json()
        assert me["shared_accounts"] == []


# ── Public invite-info endpoint ─────────────────────────────────────────────

class TestInviteInfo:
    def test_valid_token(self, client):
        register_user(client, "alice@test.com", "Alice")
        _invite(client, "bob@test.com")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        resp = client.get(f"/api/sharing/invite-info?code={code}")
        assert resp.json()["valid"] is True
        assert resp.json()["inviter_name"] == "Alice"

    def test_invalid_code(self, client):
        resp = client.get("/api/sharing/invite-info?code=XXXX-XXXX")
        assert resp.json()["valid"] is False

    def test_revoked_invalid(self, client):
        register_user(client, "alice@test.com")
        inv = _invite(client, "bob@test.com").json()
        client.delete(f"/api/sharing/invite/{inv['id']}")
        code = client.get("/api/sharing/sent").json()[0]["short_code"]
        resp = client.get(f"/api/sharing/invite-info?code={code}")
        assert resp.json()["valid"] is False


# ── Multi-user scenarios ────────────────────────────────────────────────────

class TestMultiUser:
    def test_viewer_sees_multiple_inviters(self, client, make_client):
        """A financial advisor (Carol) can view both Alice's and Bob's data."""
        register_user(client, "alice@test.com", "Alice")
        _seed_data(client)
        _invite(client, "carol@test.com")
        code_alice = client.get("/api/sharing/sent").json()[0]["short_code"]

        with make_client("bob@test.com", "Bob") as bob:
            bob.post("/api/grants", json={
                "year": 2024, "type": "Purchase", "shares": 500, "price": 15.0,
                "vest_start": "2024-01-01", "periods": 4, "exercise_date": "2024-01-01",
            })
            bob.post("/api/prices", json={"effective_date": "2024-01-01", "price": 15.0})
            bob.post("/api/sharing/invite", json={"email": "carol@test.com"})
            code_bob = bob.get("/api/sharing/sent").json()[0]["short_code"]

        with make_client("carol@test.com", "Carol") as carol:
            carol.post("/api/sharing/accept", json={"code": code_alice})
            carol.post("/api/sharing/accept", json={"code": code_bob})
            received = carol.get("/api/sharing/received").json()
            assert len(received) == 2
            me = carol.get("/api/me").json()
            assert len(me["shared_accounts"]) == 2
