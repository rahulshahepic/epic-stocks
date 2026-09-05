"""Invitation secrets must not be readable from the database.

An invitation token is a bearer credential for someone's financial data, and
acceptance deliberately does not require the accepting account's email to match
the invited one — the invitation email says so in as many words, because people
sign in with whatever account they have. That makes the stored token the whole
of the security boundary, and it used to sit in `invitations` as plaintext:
anyone who could read the table (a dump, a backup, a replica) could redeem every
pending invitation from any account they controlled.

The token is now stored as an HMAC verifier. The short code is too, plus a
sealed copy, because the sent-invitations list shows the inviter their code.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text

from scaffold.invite_tokens import (
    code_verifier,
    seal_code,
    token_verifier,
    unseal_code,
)
from scaffold.models import Invitation
from tests.conftest import register_user


@pytest.fixture()
def sent_invites(monkeypatch):
    """Capture the raw token and code the invitation email would carry."""
    import app.routers.sharing as sharing

    captured = []
    original = sharing._send_invitation_email

    def _capture(inv, inviter, raw_token, raw_code):
        captured.append({"id": inv.id, "token": raw_token, "code": raw_code})
        return True

    monkeypatch.setattr(sharing, "_send_invitation_email", _capture)
    return captured


def _invite(client, email="bob@test.com"):
    return client.post("/api/sharing/invite", json={"email": email})


# ── Nothing redeemable is stored ────────────────────────────────────────────

def test_the_stored_token_is_not_the_token(client, db_session, sent_invites):
    register_user(client, "alice@test.com")
    assert _invite(client).status_code in (200, 201)
    raw_token = sent_invites[0]["token"]

    stored = db_session.execute(text("SELECT token FROM invitations")).scalar()

    assert stored != raw_token
    assert raw_token not in stored
    assert stored == token_verifier(raw_token)


def test_the_stored_short_code_is_not_the_code(client, db_session, sent_invites):
    register_user(client, "alice@test.com")
    assert _invite(client).status_code in (200, 201)
    raw_code = sent_invites[0]["code"]

    stored, sealed = db_session.execute(
        text("SELECT short_code, short_code_sealed FROM invitations")
    ).first()

    assert stored != raw_code
    assert stored == code_verifier(raw_code)
    # The sealed copy is what makes the code displayable again — but only to
    # someone holding the server key, not to someone holding the table.
    assert raw_code not in sealed
    assert unseal_code(sealed) == raw_code


def test_a_token_read_out_of_the_database_cannot_be_redeemed(client, make_client, db_session, sent_invites):
    """The point of the whole change: a table read yields nothing usable."""
    register_user(client, "alice@test.com")
    _invite(client)
    stolen_token, stolen_code = db_session.execute(
        text("SELECT token, short_code FROM invitations")
    ).first()

    with make_client("mallory@test.com") as mallory:
        assert mallory.post("/api/sharing/accept", json={"token": stolen_token}).status_code == 404
        assert mallory.post("/api/sharing/accept", json={"code": stolen_code}).status_code == 404


# ── The real secrets still work ─────────────────────────────────────────────

def test_the_emailed_token_is_accepted(client, make_client, sent_invites):
    register_user(client, "alice@test.com")
    _invite(client)
    raw_token = sent_invites[0]["token"]

    with make_client("bob@test.com") as bob:
        resp = bob.post("/api/sharing/accept", json={"token": raw_token})

    assert resp.status_code == 200, resp.text


def test_invite_info_resolves_the_emailed_token(client, sent_invites):
    register_user(client, "alice@test.com", "Alice")
    _invite(client)
    raw_token = sent_invites[0]["token"]

    resp = client.get(f"/api/sharing/invite-info?token={raw_token}")

    assert resp.json()["valid"] is True
    assert resp.json()["inviter_name"] == "Alice"


def test_the_inviter_can_still_read_the_short_code(client, sent_invites):
    """The sent list shows it, so the sealed copy has to come back."""
    register_user(client, "alice@test.com")
    _invite(client)
    raw_code = sent_invites[0]["code"]

    shown = client.get("/api/sharing/sent").json()[0]["short_code"]

    assert shown.replace("-", "") == raw_code


def test_the_displayed_code_is_accepted(client, make_client, sent_invites):
    register_user(client, "alice@test.com")
    _invite(client)
    shown = client.get("/api/sharing/sent").json()[0]["short_code"]

    with make_client("bob@test.com") as bob:
        assert bob.post("/api/sharing/accept", json={"code": shown}).status_code == 200


# ── Resend ──────────────────────────────────────────────────────────────────

def test_resend_issues_a_fresh_token_and_retires_the_old_one(client, make_client, db_session, sent_invites):
    """The original token is unrecoverable, so resend must mint a new one."""
    register_user(client, "alice@test.com")
    inv_id = _invite(client).json()["id"]
    first_token = sent_invites[0]["token"]

    # Bypass the once-an-hour resend limit.
    db_session.execute(
        text("UPDATE invitations SET last_sent_at = NULL WHERE id = :id"), {"id": inv_id}
    )
    db_session.commit()

    assert client.post(f"/api/sharing/invite/{inv_id}/resend").status_code == 200
    second_token = sent_invites[1]["token"]
    assert second_token != first_token

    with make_client("bob@test.com") as bob:
        assert bob.post("/api/sharing/accept", json={"token": first_token}).status_code == 404
        assert bob.post("/api/sharing/accept", json={"token": second_token}).status_code == 200


def test_resend_keeps_the_short_code(client, db_session, sent_invites):
    """Someone may have already read it out loud; only the link is re-issued."""
    register_user(client, "alice@test.com")
    inv_id = _invite(client).json()["id"]
    first_code = sent_invites[0]["code"]

    db_session.execute(
        text("UPDATE invitations SET last_sent_at = NULL WHERE id = :id"), {"id": inv_id}
    )
    db_session.commit()
    assert client.post(f"/api/sharing/invite/{inv_id}/resend").status_code == 200

    assert sent_invites[1]["code"] == first_code


# ── The primitives ──────────────────────────────────────────────────────────

def test_verifiers_are_deterministic_and_domain_separated():
    assert token_verifier("abc") == token_verifier("abc")
    # The same string used as a token and as a code must not collide.
    assert token_verifier("abc") != code_verifier("abc")


def test_a_different_secret_yields_a_different_verifier(monkeypatch):
    before = token_verifier("abc")
    monkeypatch.setenv("INVITE_TOKEN_SECRET", "x" * 40)
    assert token_verifier("abc") != before


def test_sealing_round_trips_and_is_not_deterministic():
    sealed_a = seal_code("ABCD2345")
    sealed_b = seal_code("ABCD2345")
    assert sealed_a != sealed_b  # random nonce
    assert unseal_code(sealed_a) == "ABCD2345"
    assert unseal_code(sealed_b) == "ABCD2345"


def test_unsealing_something_unreadable_returns_none():
    """A rotated secret must not break the whole sent-invitations list."""
    assert unseal_code(None) is None
    assert unseal_code("") is None
    assert unseal_code("not-base64-at-all!!") is None
    assert unseal_code(seal_code("ABCD2345")[:-4] + "AAAA") is None


def test_the_sent_list_survives_an_unreadable_code(client, db_session, sent_invites):
    register_user(client, "alice@test.com")
    _invite(client)
    db_session.execute(text("UPDATE invitations SET short_code_sealed = 'corrupt'"))
    db_session.commit()

    resp = client.get("/api/sharing/sent")

    assert resp.status_code == 200
    assert resp.json()[0]["short_code"] is None
