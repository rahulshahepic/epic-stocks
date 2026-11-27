"""Issue #826: the admin must be able to see who filed a change request —
the server-recorded connection and the account that authorized it — not
just the name the app claimed for itself. The browser payload used to
drop the request's grant_id (the only server-stamped identity) while
passing the claimed client_name through, and the approval notifications
named nobody at all.
"""
import os
from unittest.mock import patch

from scaffold.models import BlockedEmail
from scaffold.oauth.models import OAuthGrant
from tests.test_mcp_admin import WRITE, _admin_session

ADMIN = {"ADMIN_EMAIL": "admin@example.com"}


class RecordingInbox:
    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, db, user, title, body, email_body=None, url=None):
        self.calls.append({"body": body, "email_body": email_body})
        return ["push"]


def _file_request(client, db_session):
    db_session.add(BlockedEmail(email="spam@example.com", reason="test"))
    db_session.commit()
    _, call = _admin_session(client, WRITE)
    filed = call("admin_request_unblock_email", {"email": "spam@example.com",
                                                 "reason": "Asked by email"})
    return filed["request"]["id"]


def test_admin_payload_carries_the_server_recorded_filing_connection(client, db_session):
    with patch.dict(os.environ, ADMIN):
        request_id = _file_request(client, db_session)
        status = client.get("/api/admin/mcp").json()
    entry = next(r for r in status["requests"] if r["id"] == request_id)
    # The claimed name, as before…
    assert entry["client_name"] == "ChatGPT diagnostics"
    # …and now the server-stamped facts beside it: the connection as
    # recorded when it was authorized, and the account that authorized it.
    assert entry["filed_by_client"] == "ChatGPT diagnostics"
    assert entry["filed_by_account"] == "admin@example.com"
    assert entry["filed_connection_active"] is True


def test_admin_payload_says_so_when_the_filing_connection_is_gone(client, db_session):
    with patch.dict(os.environ, ADMIN):
        request_id = _file_request(client, db_session)
        db_session.query(OAuthGrant).delete()
        db_session.commit()
        status = client.get("/api/admin/mcp").json()
    entry = next(r for r in status["requests"] if r["id"] == request_id)
    assert entry["filed_connection_active"] is False
    assert entry["filed_by_client"] is None
    assert entry["filed_by_account"] is None
    # The claimed name is still shown — labelled as a claim by the UI.
    assert entry["client_name"] == "ChatGPT diagnostics"


def test_approval_notifications_name_the_requester_as_unverified(client, db_session):
    box = RecordingInbox()
    with patch.dict(os.environ, ADMIN), \
         patch("scaffold.oauth.approval_delivery.deliver", box):
        _file_request(client, db_session)
    assert box.calls, "the approval code was delivered"
    sent = box.calls[-1]
    for text in (sent["body"], sent["email_body"]):
        assert "Asked by: ChatGPT diagnostics" in text
        assert "unverified" in text
