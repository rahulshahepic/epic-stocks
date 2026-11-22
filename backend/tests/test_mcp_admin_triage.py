"""Admin write tools beyond AI connection settings: triage, narrowing, and
widening changes approved with a one-time code sent to the admin's own devices.

The property that matters most: a widening change never happens on a tool call
alone. The code reaches the admin through their own notification settings and
never appears in a tool result, the journal or the audit table, so text the
assistant read cannot approve anything.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from scaffold.models import BlockedEmail, ErrorLog, GrantProgramSettings, InviteSendingBlock, User
from scaffold.oauth import admin_requests
from scaffold.oauth.models import AdminActionJournal, AdminActionRequest
from tests.conftest import register_user
from tests.test_mcp_admin import WRITE, _admin_session

ADMIN = {"ADMIN_EMAIL": "admin@example.com"}


@pytest.fixture(autouse=True)
def fresh_maintenance_cache():
    """Maintenance state is cached per process for a second; a test that turns
    it on must not leak into the next one in a serial run."""
    from scaffold import maintenance
    maintenance._cache = None
    yield
    maintenance._cache = None


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

    def __call__(self, db, user, title, body):
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


def _errors(db_session, n=3):
    rows = [ErrorLog(method="GET", path="/api/x", error_type="TypeError", error_message="m",
                     traceback="tb", error_ref=f"ref{i}") for i in range(n)]
    db_session.add_all(rows)
    db_session.commit()
    return [r.id for r in rows]


def _user(client, db_session, email):
    register_user(client, email)
    register_user(client, "admin@example.com")
    return db_session.query(User).filter(User.email == email).one()


# ── housekeeping ────────────────────────────────────────────────────────────

def test_resolving_errors_hides_them_from_the_scan_and_keeps_the_rows(session, db_session):
    client, call = session
    ids = _errors(db_session, 3)
    out = call("admin_resolve_errors", {"error_ids": ids[:2], "note": "fixed in #608"})
    assert out["changed_ids"] == ids[:2]

    listed = call("admin_recent_errors")
    assert [r["id"] for r in listed["records"]] == [ids[2]]
    assert listed["resolved_count"] == 2
    everything = call("admin_recent_errors", {"include_resolved": True})
    resolved = {r["id"]: r for r in everything["records"]}
    assert resolved[ids[0]]["resolved_note"] == "fixed in #608" and resolved[ids[0]]["resolved_at_utc"]

    page = {e["id"]: e for e in client.get("/api/admin/errors").json()}
    assert page[ids[0]]["traceback"] == "tb", "the traceback is kept"
    assert page[ids[0]]["resolved_by"] == "admin@example.com"

    call("admin_resolve_errors", {"error_ids": [ids[0]], "reopen": True})
    assert {r["id"] for r in call("admin_recent_errors")["records"]} == {ids[0], ids[2]}


def test_resolving_through_an_id_takes_every_older_unresolved_error(session, db_session):
    _, call = session
    ids = _errors(db_session, 4)
    out = call("admin_resolve_errors", {"through_id": ids[2]})
    assert out["changed_ids"] == ids[:3]
    assert [r["id"] for r in call("admin_recent_errors")["records"]] == [ids[3]]
    assert "either" in call("admin_resolve_errors", {}, ok=False)
    assert "either" in call("admin_resolve_errors", {"error_ids": ids, "through_id": 1}, ok=False)
    assert "99999" in call("admin_resolve_errors", {"error_ids": [99999]}, ok=False)
    assert "by id" in call("admin_resolve_errors", {"through_id": ids[3], "reopen": True}, ok=False)


def test_errors_can_be_resolved_from_the_admin_page(session, db_session):
    client, call = session
    [error_id] = _errors(db_session, 1)
    assert client.patch(f"/api/admin/errors/{error_id}", json={"note": "deployed"}).status_code == 204
    assert call("admin_recent_errors")["records"] == []
    assert client.patch("/api/admin/errors/99999", json={}).status_code == 404
    journal = db_session.query(AdminActionJournal).filter(AdminActionJournal.action == "resolve_errors").all()
    assert {j.via for j in journal} == {"browser"}


def test_reports_and_refusals_can_be_triaged_in_batches(session, db_session):
    from scaffold.models import UserReport
    from scaffold.oauth.settings import record_rejection
    client, call = session
    reports = [UserReport(message=f"r{i}", source="manual", status="new") for i in range(3)]
    db_session.add_all(reports)
    db_session.commit()
    call("admin_set_report_status", {"report_ids": [r.id for r in reports], "status": "resolved"})
    assert call("admin_user_reports", {"status": "new"})["records"] == []
    assert "either" in call("admin_set_report_status", {"status": "new"}, ok=False)

    for host in ("a.example", "b.example"):
        record_rejection(db_session, f"https://{host}/cb", "X", "refused")
    refused = [r["id"] for r in call("admin_ai_connections")["refused_redirects"]["records"]]
    call("admin_dismiss_refused_redirect", {"refused_ids": refused})
    assert client.get("/api/admin/mcp").json()["rejected"] == []


def test_cleanup_recompute_and_test_notification(session, db_session):
    client, call = session
    assert set(call("admin_prune_connector_tables")["removed"]) >= {"auth_codes", "clients"}

    with patch("app.event_cache.schedule_recompute") as queued:
        out = call("admin_recompute_account", {"account_email": "admin@example.com"})
    queued.assert_called_once_with(out["account_id"])
    assert "No account" in call("admin_recompute_account", {"account_email": "ghost@example.com"}, ok=False)

    out = call("admin_send_test_notification")
    assert out["sent_to"] == [] and "subscribe" in out["note"]


# ── narrowing: preview, then confirm ────────────────────────────────────────

def test_blocking_an_address_previews_first_and_never_blocks_an_admin(session, db_session):
    client, call = session
    preview = call("admin_block_email", {"email": "Spam@Example.com"})
    assert preview["preview"] == {"email": "spam@example.com", "has_account": False}
    assert db_session.query(BlockedEmail).count() == 0, "a preview changes nothing"
    assert "does not match" in call("admin_block_email", {"email": "other@example.com",
                                                          "confirm": preview["confirm"]}, ok=False)
    call("admin_block_email", {"email": "spam@example.com", "confirm": preview["confirm"]})
    assert [b["email"] for b in client.get("/api/admin/blocked").json()] == ["spam@example.com"]

    own = call("admin_block_email", {"email": "admin@example.com"})
    assert "admin" in call("admin_block_email", {"email": "admin@example.com",
                                                 "confirm": own["confirm"]}, ok=False)
    assert client.post("/api/admin/blocked", json={"email": "admin@example.com"}).status_code == 400


def test_maintenance_can_be_started_and_the_connector_still_answers(session, db_session):
    client, call = session
    preview = call("admin_start_maintenance")
    assert client.get("/api/admin/maintenance").json()["active"] is False
    call("admin_start_maintenance", {"confirm": preview["confirm"]})
    assert client.get("/api/admin/maintenance").json()["active"] is True
    assert call("admin_deployment_status")["environment"]
    assert "already on" in call("admin_start_maintenance", ok=False)


def test_invite_blocks_content_admin_and_account_connections(session, db_session):
    client, call = session
    user = _user(client, db_session, "member@example.com")

    preview = call("admin_block_invite_sending", {"account_email": user.email})
    call("admin_block_invite_sending", {"account_email": user.email, "confirm": preview["confirm"]})
    assert db_session.query(InviteSendingBlock).filter_by(user_id=user.id).count() == 1

    client.post(f"/api/admin/users/{user.id}/content-admin")
    preview = call("admin_revoke_content_admin", {"account_email": user.email})
    call("admin_revoke_content_admin", {"account_email": user.email, "confirm": preview["confirm"]})
    db_session.refresh(user)
    assert user.is_content_admin == 0

    assert "no live" in call("admin_revoke_account_connections",
                             {"account_email": user.email}, ok=False).lower()
    preview = call("admin_revoke_account_connections", {"account_email": "admin@example.com"})
    assert preview["warning"], "revoking the connection in use is called out"


# ── widening: filed, then approved with the code sent to the admin ──────────

def _blocked(db_session, email="spam@example.com"):
    db_session.add(BlockedEmail(email=email, reason="test"))
    db_session.commit()


def test_a_widening_change_waits_for_the_code_from_the_admins_devices(session, db_session, inbox):
    client, call = session
    _blocked(db_session)
    filed = call("admin_request_unblock_email", {"email": "spam@example.com",
                                                 "reason": "Asked by email"})
    request_id = filed["request"]["id"]
    assert filed["approval_code"]["sent_to"] == ["push"]
    assert db_session.query(BlockedEmail).count() == 1, "nothing changes on filing"

    code = inbox.code
    assert len(code) == 8 and code.isdigit()
    assert "Unblock sign-in for spam@example.com" in inbox.messages[-1]
    assert code not in json.dumps(filed), "the assistant is never told the code"

    wrong = "00000000" if code != "00000000" else "11111111"
    assert "4 tries left" in call("admin_approve_request", {"request_id": request_id, "code": wrong}, ok=False)
    out = call("admin_approve_request", {"request_id": request_id, "code": f"{code[:4]}-{code[4:]}"})
    assert out["request"]["status"] == "approved" and out["request"]["decided_by"] == "admin@example.com"
    assert db_session.query(BlockedEmail).count() == 0
    assert "already approved" in call("admin_approve_request", {"request_id": request_id, "code": code}, ok=False)

    from scaffold.oauth.models import McpAudit
    journal = db_session.query(AdminActionJournal).all()
    recorded = json.dumps([[j.action, j.before, j.after, j.detail] for j in journal])
    assert code not in recorded
    assert {"send_approval_code", "wrong_approval_code", "approve_unblock_email"} <= {j.action for j in journal}
    assert code not in json.dumps([[a.tool, a.outcome] for a in db_session.query(McpAudit).all()])


@pytest.mark.parametrize("tool,args,setup,check", [
    ("admin_request_unblock_invite_sending", lambda u: {"account_email": u.email},
     lambda db, u: db.add(InviteSendingBlock(user_id=u.id, reason="x")),
     lambda db, u: db.query(InviteSendingBlock).filter_by(user_id=u.id).count() == 0),
    ("admin_request_content_admin", lambda u: {"account_email": u.email}, lambda db, u: None,
     lambda db, u: db.get(User, u.id).is_content_admin == 1),
    ("admin_request_flexible_payoff", lambda u: {"active": True}, lambda db, u: None,
     lambda db, u: bool(db.get(GrantProgramSettings, 1) and db.get(GrantProgramSettings, 1).flexible_payoff_enabled)),
])
def test_each_widening_action_runs_only_on_approval(session, db_session, inbox, tool, args, setup, check):
    client, call = session
    user = _user(client, db_session, "member@example.com")
    setup(db_session, user)
    db_session.commit()
    filed = call(tool, {**args(user), "reason": "test"})
    db_session.expire_all()
    assert not check(db_session, user)
    call("admin_approve_request", {"request_id": filed["request"]["id"], "code": inbox.code})
    db_session.expire_all()
    assert check(db_session, user)


def test_ending_maintenance_through_a_code(session, db_session, inbox):
    client, call = session
    call("admin_start_maintenance", {"confirm": call("admin_start_maintenance")["confirm"]})
    filed = call("admin_request_end_maintenance")
    call("admin_approve_request", {"request_id": filed["request"]["id"], "code": inbox.code})
    assert client.get("/api/admin/maintenance").json()["active"] is False
    assert "not on" in call("admin_request_end_maintenance", ok=False)


def test_five_wrong_codes_lock_the_code_and_a_fresh_one_replaces_it(session, db_session, inbox):
    _, call = session
    _blocked(db_session)
    request_id = call("admin_request_unblock_email", {"email": "spam@example.com"})["request"]["id"]
    first = inbox.code
    wrong = "00000000" if first != "00000000" else "11111111"
    for _ in range(admin_requests.MAX_CODE_ATTEMPTS):
        call("admin_approve_request", {"request_id": request_id, "code": wrong}, ok=False)
    assert "Too many" in call("admin_approve_request", {"request_id": request_id, "code": first}, ok=False)

    sent = call("admin_send_approval_code", {"request_id": request_id})
    assert sent["approval_code"]["sent_to"] == ["push"]
    second = inbox.code
    if second != first:
        assert "does not match" in call("admin_approve_request",
                                        {"request_id": request_id, "code": first}, ok=False)
    call("admin_approve_request", {"request_id": request_id, "code": second})
    assert db_session.query(BlockedEmail).count() == 0


def test_codes_expire_and_are_capped_per_request(session, db_session, inbox):
    _, call = session
    _blocked(db_session)
    request_id = call("admin_request_unblock_email", {"email": "spam@example.com"})["request"]["id"]
    row = db_session.get(AdminActionRequest, request_id)
    row.approval_code_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    assert "expired" in call("admin_approve_request", {"request_id": request_id, "code": inbox.code}, ok=False)
    for _ in range(admin_requests.MAX_CODES_PER_REQUEST - 1):
        call("admin_send_approval_code", {"request_id": request_id})
    assert "already sent" in call("admin_send_approval_code", {"request_id": request_id}, ok=False)


def test_a_code_works_only_for_the_admin_it_was_sent_to(client, db_session, inbox):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com;other@example.com"}):
        _, call = _admin_session(client, WRITE)
        _blocked(db_session)
        request_id = call("admin_request_unblock_email", {"email": "spam@example.com"})["request"]["id"]
        with pytest.raises(admin_requests.ApprovalError, match="does not match"):
            admin_requests.approve_with_code(db_session, request_id, inbox.code,
                                             admin_email="other@example.com")
        assert db_session.query(BlockedEmail).count() == 1


def test_without_a_delivery_channel_the_browser_still_approves(session, db_session):
    client, call = session
    _blocked(db_session)
    with patch("scaffold.oauth.approval_delivery.deliver", Inbox(channels=())):
        filed = call("admin_request_unblock_email", {"email": "spam@example.com"})
    assert filed["approval_code"]["sent_to"] == [] and "browser" in filed["approval_code"]["problem"]
    page = client.get("/api/admin/mcp").json()
    entry = next(r for r in page["requests"] if r["id"] == filed["request"]["id"])
    assert entry["description"] == "Unblock sign-in for spam@example.com" and entry["consequence"]
    client.post(f"/api/admin/mcp/requests/{entry['id']}/approve")
    assert db_session.query(BlockedEmail).count() == 0


def test_a_stale_request_fails_instead_of_acting_twice(session, db_session, inbox):
    client, call = session
    _blocked(db_session)
    filed = call("admin_request_unblock_email", {"email": "spam@example.com"})
    block = db_session.query(BlockedEmail).one()
    client.delete(f"/api/admin/blocked/{block.id}")
    out = call("admin_approve_request", {"request_id": filed["request"]["id"], "code": inbox.code})
    assert out["request"]["status"] == "failed" and "no longer blocked" in out["request"]["outcome"]


def test_rejecting_from_the_connector_changes_nothing(session, db_session, inbox):
    _, call = session
    _blocked(db_session)
    filed = call("admin_request_unblock_email", {"email": "spam@example.com"})
    out = call("admin_reject_request", {"request_id": filed["request"]["id"]})
    assert out["request"]["status"] == "rejected"
    assert "already rejected" in call("admin_approve_request",
                                      {"request_id": filed["request"]["id"], "code": inbox.code}, ok=False)
    assert db_session.query(BlockedEmail).count() == 1


def test_bad_requests_are_refused_before_a_code_is_sent(session, db_session, inbox):
    _, call = session
    assert "not blocked" in call("admin_request_unblock_email", {"email": "x@example.com"}, ok=False)
    assert "true or false" in call("admin_request_flexible_payoff", {"active": "yes"}, ok=False)
    assert "already off" in call("admin_request_flexible_payoff", {"active": False}, ok=False)
    assert "No account" in call("admin_request_content_admin", {"account_email": "ghost@example.com"}, ok=False)
    assert inbox.messages == []


# ── delivery follows the admin's own settings ───────────────────────────────

def test_delivery_follows_push_and_email_settings(client, db_session):
    from scaffold.models import EmailPreference, PushSubscription
    from scaffold.notifications import PushResult
    from scaffold.oauth.approval_delivery import deliver

    register_user(client, "admin@example.com")
    user = db_session.query(User).filter(User.email == "admin@example.com").one()
    with patch("scaffold.notifications.send_push", return_value=PushResult.SENT), \
         patch("scaffold.email_sender.email_configured", return_value=True), \
         patch("scaffold.email_sender.send_email", return_value=True) as mailed:
        pref = db_session.query(EmailPreference).filter_by(user_id=user.id).first()
        if pref is None:
            pref = EmailPreference(user_id=user.id, enabled=0)
            db_session.add(pref)
        pref.enabled = 0
        db_session.commit()
        assert deliver(db_session, user, "t", "b") == []

        db_session.add(PushSubscription(user_id=user.id, endpoint="https://push.example/1",
                                        p256dh="k", auth="a"))
        db_session.commit()
        assert deliver(db_session, user, "t", "b") == ["push"]

        pref.enabled = 1
        db_session.commit()
        assert deliver(db_session, user, "t", "b") == ["push", "email"]
        pref.enabled = 0
        db_session.commit()
        assert deliver(db_session, user, "t", "b") == ["push"]
        assert mailed.call_count == 1


def test_triage_migration_is_reversible():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect
    versions = Path(__file__).parents[1] / "alembic/versions"
    engine = create_engine("sqlite://")
    modules = []
    for name in ("p7q8r9s0t1u2_admin_action_requests.py", "q8r9s0t1u2v3_admin_triage_and_approval_codes.py"):
        spec = importlib.util.spec_from_file_location(name[:-3], versions / name)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        conn.exec_driver_sql("CREATE TABLE error_logs (id INTEGER PRIMARY KEY, error_type VARCHAR)")
        modules[0].upgrade()
        modules[1].upgrade()
        columns = {c["name"] for c in inspect(conn).get_columns("error_logs")}
        assert {"resolved_at", "resolved_by", "resolved_note"} <= columns
        columns = {c["name"] for c in inspect(conn).get_columns("admin_action_requests")}
        assert {"approval_code_hash", "approval_attempts"} <= columns
        modules[1].downgrade()
        assert "resolved_at" not in {c["name"] for c in inspect(conn).get_columns("error_logs")}
    engine.dispose()


def test_codes_and_wrong_guesses_are_capped_per_admin_across_requests(session, db_session, inbox, monkeypatch):
    """A model fed planted text could file request after request; the hourly
    caps bound both the messages to the admin's phone and the total guesses."""
    _, call = session
    monkeypatch.setattr(admin_requests, "MAX_CODES_PER_HOUR", 2)
    monkeypatch.setattr(admin_requests, "MAX_WRONG_CODES_PER_HOUR", 2)
    for email in ("a@example.com", "b@example.com", "c@example.com"):
        _blocked(db_session, email)
    first = call("admin_request_unblock_email", {"email": "a@example.com"})
    call("admin_request_unblock_email", {"email": "b@example.com"})
    third = call("admin_request_unblock_email", {"email": "c@example.com"})
    assert third["approval_code"]["sent_to"] == [] and "last hour" in third["approval_code"]["problem"]
    assert len(inbox.messages) == 2

    request_id, code = first["request"]["id"], None
    for _ in range(2):
        call("admin_approve_request", {"request_id": request_id, "code": "12345678"}, ok=False)
    code = inbox.messages[0].split("Code: ")[1].splitlines()[0].replace(" ", "")
    assert "last hour" in call("admin_approve_request", {"request_id": request_id, "code": code}, ok=False)
    assert db_session.query(BlockedEmail).count() == 3
