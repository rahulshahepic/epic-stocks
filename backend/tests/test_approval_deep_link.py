"""Issue #825: an approval notification must land the admin on the exact
request — the push tap and the email link point at the same per-request
anchor in Admin → AI Connections (/admin?request=<id>#ai-connections),
not at the app home or the section in general.
"""
import os
from unittest.mock import patch

from scaffold.models import BlockedEmail, PushSubscription, User
from tests.conftest import register_user
from tests.test_mcp_admin import WRITE, _admin_session

ADMIN = {"ADMIN_EMAIL": "admin@example.com"}


class RecordingInbox:
    """Stands in for deliver(): records body, email body and deep link."""

    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, db, user, title, body, email_body=None, url=None):
        self.calls.append({"body": body, "email_body": email_body, "url": url})
        return ["push"]


def test_push_payload_carries_the_deep_link(client, db_session):
    from scaffold.notifications import PushResult
    from scaffold.oauth.approval_delivery import deliver

    register_user(client, "admin@example.com")
    user = db_session.query(User).filter(User.email == "admin@example.com").one()
    db_session.add(PushSubscription(user_id=user.id, endpoint="https://push.example/1",
                                    p256dh="k", auth="a"))
    db_session.commit()

    payloads = []
    def capture(sub, payload):
        payloads.append(payload)
        return PushResult.SENT

    with patch("scaffold.notifications.send_push", capture):
        assert deliver(db_session, user, "t", "b", url="/admin?request=7#ai-connections") == ["push"]
        assert payloads[-1]["data"] == {"url": "/admin?request=7#ai-connections"}

        # No url (e.g. a generic notice) keeps the old payload shape.
        assert deliver(db_session, user, "t", "b") == ["push"]
        assert "data" not in payloads[-1]


def test_approval_push_and_email_point_at_the_same_request(client, db_session):
    box = RecordingInbox()
    with patch.dict(os.environ, {**ADMIN, "APP_URL": "https://example.test"}), \
         patch("scaffold.oauth.approval_delivery.deliver", box):
        _, call = _admin_session(client, WRITE)
        db_session.add(BlockedEmail(email="spam@example.com", reason="test"))
        db_session.commit()
        filed = call("admin_request_unblock_email", {"email": "spam@example.com",
                                                     "reason": "Asked by email"})
    request_id = filed["request"]["id"]
    assert box.calls, "the approval code was delivered"
    sent = box.calls[-1]
    expected_path = f"/admin?request={request_id}#ai-connections"
    # The push tap's destination…
    assert sent["url"] == expected_path
    # …and the email link are the same request anchor.
    assert f"https://example.test{expected_path}" in sent["email_body"]
    # The code still never travels by email.
    code_line = next(l for l in sent["body"].splitlines() if l.startswith("Code: "))
    assert code_line.removeprefix("Code: ").replace(" ", "") not in sent["email_body"]
