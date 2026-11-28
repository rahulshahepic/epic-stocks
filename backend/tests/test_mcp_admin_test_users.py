"""Admin MCP test-user tools: the MCP door for the #827 mechanism.

Provisioning widens access, so it follows the reviewer pattern exactly: the
tool files an admin request and returns a generated password once; nothing
exists until a human approves with the code sent to their own devices (or in
the browser). Reset/revoke/delete narrow access, so they run directly after
the shared preview/confirm round trip. Test users stay a separate kind from
directory reviewers in every list, table and lifecycle.
"""
import os
from unittest.mock import patch

import pytest

from scaffold import reviewers, test_users
from scaffold.models import InternalTestAccount, ReviewerAccount, User
from scaffold.oauth.models import AdminActionJournal, AdminActionRequest
from tests.test_mcp_admin import WRITE, _admin_session

ADMIN = {"ADMIN_EMAIL": "admin@example.com"}


@pytest.fixture()
def session(client):
    with patch.dict(os.environ, ADMIN):
        tokens, call = _admin_session(client, WRITE)
        yield client, call


class Inbox:
    """Stands in for the admin's devices: records what was delivered."""

    def __init__(self, channels=("push",)):
        self.channels = list(channels)
        self.messages: list[str] = []

    def __call__(self, db, user, title, body, email_body=None, url=None):
        self.messages.append(body)
        return list(self.channels)

    @property
    def code(self) -> str:
        line = next(l for l in self.messages[-1].splitlines() if l.startswith("Code: "))
        return line.removeprefix("Code: ").replace(" ", "")


@pytest.fixture()
def inbox():
    box = Inbox()
    with patch("scaffold.oauth.approval_delivery.deliver", box):
        yield box


def _request_access(call, inbox, **args):
    out = call("admin_request_test_user_access", {"label": "Prod audit", "scenario": "established",
                                                  "days": 30, "reason": "Production validation", **args})
    assert out["request"]["status"] == "pending"
    assert out["request"]["action"] == "test_user_access"
    return out


def _approve(call, inbox, out):
    decided = call("admin_approve_request", {"request_id": out["request"]["id"], "code": inbox.code})
    assert decided["request"]["status"] == "approved", decided


def _sign_in(client, account, password):
    page = client.get("/test-user-login")
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    return client.post("/test-user-login", data={"login": account["login"], "password": password, "csrf": csrf},
                       follow_redirects=False)


def test_provisioning_waits_for_human_approval_and_password_works_once_approved(session, inbox, db_session):
    client, call = session
    assert call("admin_list_test_users")["test_users"] == []
    out = _request_access(call, inbox)
    password = out["password"]
    assert len(password) >= 64
    # Nothing is granted by the tool call alone, and the secret is nowhere
    # persistent: the request payload holds only the credential verifier,
    # and no journal row carries the password.
    assert db_session.query(InternalTestAccount).count() == 0
    row = db_session.get(AdminActionRequest, out["request"]["id"])
    assert password not in row.payload
    for entry in db_session.query(AdminActionJournal).all():
        assert password not in (entry.before or "") + (entry.after or "") + (entry.detail or "")

    _approve(call, inbox, out)
    assert db_session.query(InternalTestAccount).count() == 1
    listed = call("admin_list_test_users")["test_users"]
    assert [t["label"] for t in listed] == ["Prod audit"]
    assert listed[0]["status"] == "active"
    assert password not in str(listed)
    response = _sign_in(client, listed[0], password)
    assert response.status_code == 303, response.text
    assert client.get("/api/grants").status_code == 200


def test_test_users_and_reviewers_stay_separate_kinds(session, inbox, db_session):
    client, call = session
    raw, digest = reviewers.credentials()
    reviewers.grant_access(db_session, {"platform": "openai", "scenario": "established", "days": 30,
                                        "credential_hash": digest})
    db_session.commit()
    _approve(call, inbox, _request_access(call, inbox))

    test_listed = call("admin_list_test_users")["test_users"]
    reviewer_listed = call("admin_list_reviewers")["reviewers"]
    assert len(test_listed) == 1 and len(reviewer_listed) == 1
    assert test_listed[0]["login"].startswith("test-")
    assert test_listed[0]["login"] != reviewer_listed[0]["login"]
    assert db_session.query(InternalTestAccount).count() == 1
    assert db_session.query(ReviewerAccount).count() == 1
    user = db_session.get(User, db_session.get(InternalTestAccount, test_listed[0]["id"]).user_id)
    assert test_users.identity(user) and not reviewers.identity(user)


def test_rotation_replaces_the_password_only_after_approval(session, inbox, db_session):
    client, call = session
    first = _request_access(call, inbox)
    _approve(call, inbox, first)
    account = call("admin_list_test_users")["test_users"][0]
    assert test_users.authenticate(db_session, account["login"], first["password"])

    second = _request_access(call, inbox, test_user_id=account["id"], label="Prod audit rotated")
    assert second["password"] != first["password"]
    # The filed request alone changes nothing: the old password still works.
    assert test_users.authenticate(db_session, account["login"], first["password"])
    _approve(call, inbox, second)
    with pytest.raises(Exception):
        test_users.authenticate(db_session, account["login"], first["password"])
    assert test_users.authenticate(db_session, account["login"], second["password"])


def test_revoke_and_delete_need_the_preview_confirm_token(session, inbox, db_session):
    client, call = session
    _approve(call, inbox, _request_access(call, inbox))
    account = call("admin_list_test_users")["test_users"][0]

    preview = call("admin_revoke_test_user", {"test_user_id": account["id"]})
    assert preview["applied"] is False and preview["confirm"]
    assert call("admin_list_test_users")["test_users"][0]["status"] == "active"
    assert "Stale confirmation" in call("admin_revoke_test_user",
                                        {"test_user_id": account["id"], "confirm": "0" * 64}, ok=False)
    applied = call("admin_revoke_test_user", {"test_user_id": account["id"], "confirm": preview["confirm"]})
    assert applied["applied"] is True
    assert call("admin_list_test_users")["test_users"][0]["status"] == "revoked"

    preview = call("admin_delete_test_user", {"test_user_id": account["id"]})
    applied = call("admin_delete_test_user", {"test_user_id": account["id"], "confirm": preview["confirm"]})
    assert applied["applied"] is True
    assert call("admin_list_test_users")["test_users"] == []
    assert db_session.query(User).filter_by(email=account["login"] + "@test-users.example.invalid").count() == 0
    actions = {j.action for j in db_session.query(AdminActionJournal).filter(AdminActionJournal.via == "mcp")}
    assert {"test_user_revoke", "test_user_delete"} <= actions


def test_access_request_validates_label_and_scenario(session, db_session):
    _, call = session
    assert "label" in call("admin_request_test_user_access", {"scenario": "empty"}, ok=False)
    assert call("admin_request_test_user_access", {"label": "x" * 81}, ok=False)
    assert call("admin_request_test_user_access", {"label": "Fine", "scenario": "bogus"}, ok=False)
    assert db_session.query(AdminActionRequest).count() == 0


def test_read_only_connection_lists_but_cannot_provision(client, db_session):
    with patch.dict(os.environ, ADMIN):
        _, call = _admin_session(client)
        assert call("admin_list_test_users")["test_users"] == []
        assert "not granted" in call("admin_request_test_user_access", {"label": "Prod audit"}, ok=False)
