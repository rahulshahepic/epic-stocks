"""Use invented figures and test both the browser API and real MCP transport."""
import base64
import hashlib
import json
from datetime import timedelta
from io import BytesIO
from unittest.mock import patch

from openpyxl import Workbook
from sqlalchemy import select, text

from scaffold import sensitive_reports as support
from scaffold.models import SensitiveReport, SensitiveReportDocument, UserReport
from scaffold.oauth.models import AdminActionJournal
from scaffold.oauth.scopes import ADMIN_READ, ADMIN_REPORT_SENSITIVE, ADMIN_WRITE
from tests.conftest import register_user
from tests.test_mcp_admin import _connect_admin, _rpc


ADMIN = "report-admin@example.test"
REPORTER = "reporter@example.test"
CSV = b"grant,shares,price\nMade-up grant,1234,25.50\n"
DATA = "A fictional purchase price of 25.50 was ignored"


def _encoded(name, raw):
    return {"name": name, "base64": base64.b64encode(raw).decode("ascii")}


def _submit(client, **overrides):
    body = {
        "message": DATA,
        "source": "import",
        "share_diagnostics": True,
        "attach_documents": True,
        "documents": [_encoded("made-up-grants.csv", CSV)],
        "workflow": "Analyze file with cash price override 25.50",
        "client_log": "POST /api/epic-import/analyze → 422",
        "error_message": "Fictional mismatch at 25.50",
        **overrides,
    }
    return client.post("/api/report/with-consent", json=body)


def _path(report_id, document_id=None):
    path = f"/api/admin/reports/{report_id}/sensitive"
    return path if document_id is None else f"{path}/documents/{document_id}"


def _call(client, token, name, **arguments):
    return _rpc(client, token, "tools/call", {"name": name, "arguments": arguments})


def test_consent_defaults_and_unconsented_diagnostics(client, db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    register_user(client, REPORTER)
    assert _submit(client, share_diagnostics=False, attach_documents=False).status_code == 400
    assert _submit(client, attach_documents=False).status_code == 400
    assert _submit(client, source="manual").status_code == 400
    assert _submit(client, documents=[]).status_code == 400
    assert db_session.query(UserReport).count() == 0
    assert client.post("/api/report", json={"message": DATA, "share_diagnostics": True}).status_code == 400
    assert client.post("/api/report", json={"message": DATA, "attach_documents": True}).status_code == 400

    ordinary = client.post("/api/report", json={
        "message": "An ordinary report", "path": "/import?secret=fictional",
        "workflow": DATA, "documents": [_encoded("sample.csv", CSV)],
        "user_agent": DATA, "client_log": DATA, "error_message": DATA,
    }).json()["id"]
    row = db_session.get(UserReport, ordinary)
    assert row.path == "/import"
    assert not any((row.user_id, row.email, row.client_log, row.user_agent, row.error_message))
    assert db_session.get(SensitiveReport, ordinary) is None

    attachment_only = _submit(client, share_diagnostics=False).json()["id"]
    register_user(client, ADMIN)
    record = client.get(_path(attachment_only)).json()
    assert "account" not in record["details"]
    assert "workflow" not in record["details"]
    assert "error_shown" not in record["details"]
    assert "recent_activity" not in record["details"]
    assert len(record["documents"]) == 1

    diagnostics_only = _submit(client, attach_documents=False, documents=[]).json()["id"]
    assert client.get(_path(diagnostics_only)).json()["documents"] == []


def test_encrypted_storage_no_report_content_in_email_and_authenticated_original(client, db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    register_user(client, REPORTER)
    with patch("scaffold.email_sender.email_configured", return_value=True), patch("scaffold.email_sender.send_email") as mail:
        report_id = _submit(client).json()["id"]
    assert mail.call_count == 1
    for private in (DATA, REPORTER, "made-up-grants.csv", "25.50"):
        assert private not in str(mail.call_args)

    row = db_session.get(UserReport, report_id)
    assert row.message == support.STUB_MESSAGE and row.user_id is None and row.error_ref is None
    sealed, wrapped = db_session.execute(text("SELECT details, wrapped_key FROM sensitive_reports")).one()
    docid, metadata, original = db_session.execute(text(
        "SELECT id, metadata_ciphertext, original FROM sensitive_report_documents"
    )).one()
    assert b"25.50" not in sealed and REPORTER.encode() not in sealed
    assert b"made-up-grants.csv" not in metadata and CSV not in original
    assert len(base64.b64decode(wrapped)) == 60
    assert client.get(_path(report_id)).status_code == 403
    assert client.get(_path(report_id, docid)).status_code == 403

    register_user(client, ADMIN)
    report = client.get(_path(report_id))
    assert report.headers["cache-control"] == "private, no-store"
    assert report.json()["details"]["account"]["email"] == REPORTER
    assert report.json()["details"]["workflow"].endswith("25.50")
    assert report.json()["documents"][0]["sha256"] == hashlib.sha256(CSV).hexdigest()
    downloaded = client.get(_path(report_id, docid))
    assert downloaded.content == CSV
    assert downloaded.headers["content-type"] == "application/octet-stream"
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert client.get(_path(report_id, docid) + "?as_text=true").json()["text"] == CSV.decode()

    audit = db_session.scalars(select(AdminActionJournal).where(AdminActionJournal.target_id == report_id)).all()
    assert {row.action for row in audit} == {
        "read_private_report", "read_private_document_original", "read_private_document_text",
    }
    assert all(row.outcome == "ok" and row.actor_email == ADMIN and row.via == "browser" for row in audit)
    assert all(DATA not in (row.before or "") and CSV.decode() not in (row.after or "") for row in audit)

    # Tampering with authenticated ciphertext does not release plaintext.
    db_session.execute(text("UPDATE sensitive_report_documents SET original = :payload"),
                       {"payload": original[:-1] + bytes([original[-1] ^ 1])})
    db_session.commit()
    assert client.get(_path(report_id, docid)).status_code == 422
    monkeypatch.setenv("ADMIN_EMAIL", "")
    assert client.get(_path(report_id)).status_code == 403


def test_real_mcp_scope_original_text_isolation_and_purge_approval(client, db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    report_a = _submit(client).json()["id"]
    report_b = _submit(client, message="Another fictional report").json()["id"]
    db_session.rollback()
    register_user(client, ADMIN)
    readonly = _connect_admin(client)["access_token"]
    write_only = _connect_admin(client, [ADMIN_READ, ADMIN_WRITE])["access_token"]
    scoped = _connect_admin(client, [ADMIN_READ, ADMIN_REPORT_SENSITIVE, ADMIN_WRITE])["access_token"]

    listed = _call(client, readonly, "admin_user_reports")
    assert DATA not in json.dumps(listed)
    assert json.loads(listed["content"][0]["text"])["records"][0]["has_sensitive_material"]
    assert _call(client, readonly, "admin_private_report", report_id=report_a)["isError"]

    inspected = _call(client, scoped, "admin_private_report", report_id=report_a)
    private = json.loads(inspected["content"][0]["text"])
    doc_id = private["documents"][0]["id"]
    assert private["untrusted_input"] and private["details"]["message"] == DATA
    args = {"report_id": report_a, "document_id": doc_id}
    original = _call(client, scoped, "admin_private_report_document", **args, format="original")
    assert base64.b64decode(original["content"][1]["resource"]["blob"]) == CSV
    extracted = _call(client, scoped, "admin_private_report_document", **args)
    payload = json.loads(extracted["content"][0]["text"])
    assert payload["untrusted_input"] and payload["text"] == CSV.decode()
    chunk = _call(client, scoped, "admin_private_report_document", **args, format="base64", offset=7)
    assert base64.b64decode(json.loads(chunk["content"][0]["text"])["base64"]) == CSV[7:]
    assert _call(client, scoped, "admin_private_report_document", report_id=report_b, document_id=doc_id)["isError"]
    assert any(row.via == "mcp" and row.action == "read_private_document_original"
               for row in db_session.query(AdminActionJournal).all())

    with patch("app.mcp.admin_tools._send_code", return_value={"sent_to": []}):
        filed = _call(client, scoped, "admin_request_report_purge", report_id=report_a)
    request_id = json.loads(filed["content"][0]["text"])["request"]["id"]
    forbidden_send = _call(client, write_only, "admin_send_approval_code", request_id=request_id)
    assert forbidden_send["isError"] and "connection that filed" in forbidden_send["content"][0]["text"]
    other_scoped = _connect_admin(client, [ADMIN_READ, ADMIN_REPORT_SENSITIVE, ADMIN_WRITE])["access_token"]
    forbidden_approval = _call(client, other_scoped, "admin_approve_request", request_id=request_id, code="12345678")
    assert forbidden_approval["isError"] and "connection that filed" in forbidden_approval["content"][0]["text"]
    assert client.get(_path(report_a)).status_code == 200
    assert client.delete(f"/api/admin/reports/{report_a}").status_code == 409
    approved = client.post(f"/api/admin/mcp/requests/{request_id}/approve")
    assert approved.status_code == 200
    assert client.get(_path(report_a)).status_code == 404
    assert db_session.get(SensitiveReportDocument, doc_id) is None
    assert client.get(_path(report_b)).status_code == 200

    monkeypatch.setenv("ADMIN_EMAIL", "")
    revoked = client.post("/admin-mcp", headers={"Authorization": f"Bearer {scoped}"}, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "admin_private_report", "arguments": {"report_id": report_b}},
    })
    assert revoked.status_code == 403 or revoked.json()["result"]["isError"]


def test_expiry_live_erasure_and_account_deletion(client, db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    register_user(client, REPORTER)
    account_report = _submit(client).json()["id"]
    client.cookies.clear()
    expiring_report = _submit(client).json()["id"]
    assert db_session.get(SensitiveReport, expiring_report).user_id is None
    db_session.get(SensitiveReport, expiring_report).expires_at = support.now() - timedelta(seconds=1)
    db_session.commit()
    register_user(client, ADMIN)
    assert client.get(_path(expiring_report)).status_code == 404
    assert client.delete(f"/api/admin/reports/{expiring_report}").status_code == 409
    support.expire_reports(db_session)
    assert db_session.get(SensitiveReport, expiring_report) is None
    assert db_session.query(SensitiveReportDocument).filter_by(report_id=expiring_report).count() == 0

    register_user(client, REPORTER)
    assert client.delete("/api/me").status_code in (200, 204)
    assert db_session.get(UserReport, account_report) is None
    assert db_session.query(SensitiveReportDocument).filter_by(report_id=account_report).count() == 0


def test_file_validation_encryption_failure_and_safe_errors(client, db_session, monkeypatch):
    for attachment in (_encoded("bad.pdf", CSV), _encoded("bad.exe", b"MZ"),
                       _encoded("bad.csv", b"col\n\x00"), {"name": "bad.csv", "base64": "abc!"}):
        response = _submit(client, documents=[attachment])
        assert response.status_code == 400
        assert attachment["base64"] not in response.text
    oversized = _encoded("huge.csv", b"s" * (support.MAX_FILE_BYTES + 1))
    assert _submit(client, documents=[oversized]).status_code in (400, 422)
    assert _submit(client, documents=[_encoded("x.csv", CSV)] * 4).status_code == 422
    assert client.post("/api/report/with-consent", content='{"documents":"' + DATA,
                       headers={"Content-Type": "application/json"}).status_code == 422

    with patch("scaffold.crypto.encryption_enabled", return_value=False):
        assert _submit(client).status_code == 503
    assert db_session.query(UserReport).count() == 0


def test_workbook_and_pdf_original_roundtrip_and_text(client, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    register_user(client, ADMIN)
    sheet = Workbook()
    sheet.active.append(["FID", 4321, 12.50])
    workbook = BytesIO()
    sheet.save(workbook)

    # Small text-only synthetic PDF with an import-shaped line.
    from tests.test_upload_hardening import _pdf
    pdf = _pdf(["BT /F1 10 Tf 1 0 0 1 20 760 Tm (Fictional stock loan balance 543.21) Tj ET"])
    report_id = _submit(client, documents=[
        _encoded("fictional.xlsx", workbook.getvalue()), _encoded("fictional.pdf", pdf),
    ]).json()["id"]
    docs = client.get(_path(report_id)).json()["documents"]
    assert client.get(_path(report_id, docs[0]["id"])).content == workbook.getvalue()
    assert "FID\t4321\t12.5" in client.get(_path(report_id, docs[0]["id"]) + "?as_text=true").json()["text"]
    assert client.get(_path(report_id, docs[1]["id"])).content == pdf
    assert "543.21" in client.get(_path(report_id, docs[1]["id"]) + "?as_text=true").json()["text"]


def test_reports_respect_storage_budget(client, db_session, monkeypatch):
    monkeypatch.setattr(support, "MAX_STORED_DOCUMENT_BYTES", len(CSV))
    assert _submit(client).status_code == 200
    assert _submit(client).status_code == 503
    assert db_session.query(SensitiveReportDocument).count() == 1
    assert db_session.query(UserReport).count() == 1


def test_sensitive_oauth_choice_starts_off_even_when_requested(client, monkeypatch):
    from scaffold.oauth.consent import render_consent

    page = render_consent(client_name="Fictional assistant", redirect_origin="https://chatgpt.com",
                          account_email=ADMIN, requested_scopes=[ADMIN_READ, ADMIN_REPORT_SENSITIVE],
                          request_token="synthetic", csrf="synthetic", admin=True)
    assert 'value="admin:read" checked' in page
    assert 'value="admin:reports:sensitive">' in page

    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)
    register_user(client, ADMIN)
    token = _connect_admin(client)["access_token"]
    names = {tool["name"] for tool in _rpc(client, token, "tools/list")["tools"]}
    assert "admin_user_reports" in names
    assert "admin_private_report" not in names
    assert "admin_private_report_document" not in names
