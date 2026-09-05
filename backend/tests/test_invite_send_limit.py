"""The daily invitation limit must count sends, not surviving rows.

Reproduced against staging: eleven invitation emails went out with a single row
to show for them. The limit counted rows in `invitations`, and a revoked
invitation to an address is *deleted* when the same address is invited again —
the unique constraint on (inviter_id, invitee_email) leaves no choice. Deleting
the row deleted the evidence of the email already sent, so invite → revoke →
invite → revoke spent the same slot indefinitely, with each round putting a
real email in the recipient's inbox.

The counter now lives in its own table, which is only ever appended to.
"""
import sys
import os
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routers.sharing import INVITE_DAILY_LIMIT
from scaffold.models import InviteSendEvent
from tests.conftest import register_user


@pytest.fixture()
def sends(monkeypatch):
    """Count the emails the endpoint actually tried to send.

    The real sender is a no-op without SMTP configured, which is exactly the
    thing that made this bug invisible: every attempt "succeeded" silently.
    """
    import app.routers.sharing as sharing

    attempts: list[str] = []

    def _fake_send(inv, user, raw_token, raw_code):
        attempts.append(inv.invitee_email)
        return True

    monkeypatch.setattr(sharing, "_send_invitation_email", _fake_send)
    return attempts


def _invite(client, email):
    return client.post("/api/sharing/invite", json={"email": email})


def test_revoking_and_reinviting_cannot_outrun_the_limit(client, sends):
    """The reproduction, one for one: invite, revoke, repeat.

    Each round deletes the previous invitation row. Before the fix the counter
    went with it and every round sent another email.
    """
    register_user(client, "inviter@test.com")

    statuses = []
    for _ in range(INVITE_DAILY_LIMIT + 5):
        resp = _invite(client, "target@test.com")
        statuses.append(resp.status_code)
        if resp.status_code != 200:
            continue
        assert client.delete(f"/api/sharing/invite/{resp.json()['id']}").status_code == 204

    assert len(sends) == INVITE_DAILY_LIMIT, (
        f"{len(sends)} emails left the server for a limit of {INVITE_DAILY_LIMIT}"
    )
    assert statuses[-1] == 429


def test_the_limit_holds_across_different_addresses(client, sends):
    register_user(client, "inviter@test.com")

    for i in range(INVITE_DAILY_LIMIT):
        assert _invite(client, f"target{i}@test.com").status_code == 200

    resp = _invite(client, "one-too-many@test.com")
    assert resp.status_code == 429
    assert len(sends) == INVITE_DAILY_LIMIT


def test_resends_come_out_of_the_same_budget(client, db_session, sends):
    """A resend is an email; counting only new invitations doubled the ceiling."""
    register_user(client, "inviter@test.com")

    ids = []
    for i in range(INVITE_DAILY_LIMIT - 1):
        resp = _invite(client, f"target{i}@test.com")
        assert resp.status_code == 200
        ids.append(resp.json()["id"])

    # The one-hour cooldown is per invitation; move this one out of it.
    from scaffold.models import Invitation
    inv = db_session.get(Invitation, ids[0])
    inv.last_sent_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db_session.commit()

    assert client.post(f"/api/sharing/invite/{ids[0]}/resend").status_code == 200
    assert len(sends) == INVITE_DAILY_LIMIT

    assert _invite(client, "one-too-many@test.com").status_code == 429
    assert len(sends) == INVITE_DAILY_LIMIT


def test_a_refused_send_leaves_no_invitation_behind(client, db_session, sends):
    """A 429 must not create a pending invitation whose email never went out.

    It would hold the (inviter, email) slot and show in the sent list as though
    the recipient had been contacted.
    """
    register_user(client, "inviter@test.com")
    for i in range(INVITE_DAILY_LIMIT):
        assert _invite(client, f"target{i}@test.com").status_code == 200

    assert _invite(client, "never-contacted@test.com").status_code == 429

    sent = client.get("/api/sharing/sent").json()
    assert not any(i["invitee_email"] == "never-contacted@test.com" for i in sent)


def test_the_window_moves(client, db_session, sends):
    """Yesterday's sends do not count against today's budget."""
    register_user(client, "inviter@test.com")

    for i in range(INVITE_DAILY_LIMIT):
        assert _invite(client, f"target{i}@test.com").status_code == 200
    assert _invite(client, "blocked@test.com").status_code == 429

    old = datetime.now(timezone.utc) - timedelta(hours=25)
    for event in db_session.query(InviteSendEvent).all():
        event.sent_at = old
    db_session.commit()

    assert _invite(client, "allowed-now@test.com").status_code == 200


def test_the_counter_is_per_account(client, make_client, sends):
    register_user(client, "inviter@test.com")
    for i in range(INVITE_DAILY_LIMIT):
        assert _invite(client, f"target{i}@test.com").status_code == 200
    assert _invite(client, "blocked@test.com").status_code == 429

    with make_client("other@test.com") as other:
        assert _invite(other, "target0@test.com").status_code == 200


def test_validation_failures_do_not_spend_a_send(client, db_session, sends):
    """Nothing left the server, so nothing may be charged for it."""
    register_user(client, "inviter@test.com")

    assert _invite(client, "inviter@test.com").status_code == 422  # cannot invite yourself
    assert _invite(client, "not-an-email").status_code == 422

    assert db_session.query(InviteSendEvent).count() == 0
    assert sends == []


def test_stale_counter_rows_are_pruned(client, db_session, sends):
    """The table only ever gains rows, so something has to drop the old ones."""
    register_user(client, "inviter@test.com")
    assert _invite(client, "first@test.com").status_code == 200

    for event in db_session.query(InviteSendEvent).all():
        event.sent_at = datetime.now(timezone.utc) - timedelta(days=3)
    db_session.commit()

    assert _invite(client, "second@test.com").status_code == 200
    assert db_session.query(InviteSendEvent).count() == 1
