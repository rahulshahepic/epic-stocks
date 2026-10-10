"""The plugin's acceptance step applies exactly the reviewed import, once."""
import copy
import socket
from pathlib import Path

import pytest

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, seed
from tests.test_mcp_chat_import import RETENTION
from app.mcp import import_ui
from app.mcp.import_files import _destination


@pytest.fixture()
def mcp(client):
    register_user(client)
    return Mcp(client)


def review(mcp, grant=None, **extra):
    state = mcp.call("show_import")["data"]
    return mcp.call("prepare_import_review", revision=state.get("revision", ""),
                    payload={"grants": [grant or copy.deepcopy(RETENTION)], "prices": [], **extra})["data"]


def accept(mcp, data):
    return mcp.call("accept_import_review", review_token=data["review_token"], confirmed=True)["data"]


def test_custom_grant_no_template_can_complete_inside_plugin(mcp):
    data = review(mcp)
    assert not data["blocked"]
    assert data["payload"]["grants"][0]["type"] == "Retention"
    assert mcp.client.get("/api/grants").json() == []
    assert accept(mcp, data)["saved"]
    grant = mcp.client.get("/api/grants").json()[0]
    assert (grant["type"], grant["price"], grant["periods"]) == ("Retention", 0, 2)
    assert "expired" in mcp.error("accept_import_review", review_token=data["review_token"], confirmed=True)


def test_user_must_confirm_schedule_and_basis(mcp):
    data = review(mcp, {**RETENTION, "schedule_confirmed": False})
    assert data["blocked"] and "review_token" not in data
    assert any(f["code"] == "R1" for f in data["findings"])


def test_confirmed_leave_adjustment_can_differ_from_template(mcp):
    grant = {**RETENTION, "year": 2021, "type": "Purchase", "price": 2,
             "vest_start": "2023-03-01", "periods": 4, "exercise_date": "2021-12-31"}
    data = review(mcp, grant)
    assert not data["blocked"]
    accept(mcp, data)
    assert mcp.client.get("/api/grants").json()[0]["vest_start"] == "2023-03-01"
    data = review(mcp, {**grant, "custom_schedule": False})
    assert data["blocked"]


def test_save_requires_explicit_confirmation(mcp):
    data = review(mcp)
    assert "Confirm" in mcp.error("accept_import_review", review_token=data["review_token"], confirmed=False)
    assert mcp.client.get("/api/grants").json() == []


def test_save_scope_is_separate_from_proposal(mcp):
    read = Mcp(mcp.client, scope="equity:read import:propose")
    data = review(read)
    assert not data["can_save"]
    assert "permission" in read.error("accept_import_review", review_token=data["review_token"], confirmed=True)


def test_account_change_invalidates_review(mcp):
    data = review(mcp)
    seed(mcp.client)
    assert "account changed" in mcp.error("accept_import_review", review_token=data["review_token"], confirmed=True)


def test_restage_invalidates_old_token_and_revision(mcp):
    old = review(mcp)
    new = review(mcp, {**RETENTION, "shares": 600})
    assert "replaced" in mcp.error("accept_import_review", review_token=old["review_token"], confirmed=True)
    assert "draft changed" in mcp.error("prepare_import_review", revision=old["revision"], payload=old["payload"])
    assert accept(mcp, new)["saved"]


def test_partial_import_preserves_unmentioned_grants_loans_prices_sales(mcp):
    seed(mcp.client)
    before = {kind: mcp.client.get("/api/" + kind).json() for kind in ("grants", "loans", "prices", "sales")}
    data = review(mcp)
    accept(mcp, data)
    for kind in before:
        after = mcp.client.get("/api/" + kind).json()
        for row in before[kind]:
            assert row in after


def test_connection_cannot_accept_another_connections_review(mcp):
    data = review(mcp)
    other = Mcp(mcp.client)
    assert "expired" in other.error("accept_import_review", review_token=data["review_token"], confirmed=True)


def test_file_parser_reuses_analyze_and_repairs_against_same_files(mcp, monkeypatch):
    raw = Path("test_data/epic_share_summary.csv").read_bytes()
    monkeypatch.setattr(import_ui, "download_file", lambda ref: raw)
    data = mcp.call("analyze_import_files", files=[{"file_id": "file_csv", "download_url": "unused", "file_name": "summary.csv", "role": "share_csv"}])["data"]
    assert data["files"][0]["file_id"] == "file_csv"
    assert data["payload"]["grants"]
    assert "bytes" not in str(data)
    assert "download_url" not in str(data)
    assert mcp.client.get("/api/grants").json() == []
    result = mcp.call("prepare_import_review", revision=data["revision"], payload=data["payload"])["data"]
    assert result["findings"]


def test_supporting_text_is_available_for_chatgpt_repair(mcp, monkeypatch):
    monkeypatch.setattr(import_ui, "download_file", lambda ref: b"Retention award: 500 shares")
    data = mcp.call("analyze_import_files", files=[{"file_id": "letter", "download_url": "unused", "file_name": "letter.txt"}])["data"]
    assert "Retention award" in data["prompt"]
    assert "review_token" not in data


def test_metadata_has_complete_file_param_schema(mcp):
    tool = next(t for t in mcp.list_tools() if t["name"] == "analyze_import_files")
    assert tool["_meta"]["openai/fileParams"] == ["files"]
    schema = tool["inputSchema"]["properties"]["files"]["items"]
    assert schema["required"] == ["download_url", "file_id"]
    assert {"file_name", "mime_type"}.issubset(schema["properties"])


def test_blank_basis_is_not_zero_and_invalid_price_rows_are_not_dropped(mcp):
    data = review(mcp, {**RETENTION, "price": None})
    assert data["blocked"] and "review_token" not in data
    data = review(mcp, prices=[{"effective_date": "broken", "price": 5}])
    assert data["blocked"] and "review_token" not in data


def test_payments_and_sales_only_import_is_deduplicated_and_preserves_grants(mcp):
    seed(mcp.client)
    loans = mcp.client.get("/api/loans").json()
    number = loans[0].get("loan_number")
    if not number:
        loan = loans[0]
        mcp.client.put(f"/api/loans/{loan['id']}", json={"version": loan["version"], "loan_number": "test-loan"})
        number = "test-loan"
    before = mcp.client.get("/api/grants").json()
    payload = {"grants": [], "prices": [], "sales": [{"date": "2024-08-01", "shares": 10, "price_per_share": 5}],
               "loan_payments": [{"loan_number": number, "date": "2024-08-02", "amount": 100}]}
    for _ in range(2):
        state = mcp.call("show_import")["data"]
        data = mcp.call("prepare_import_review", payload=payload, revision=state.get("revision", ""))["data"]
        assert not data["blocked"]
        assert accept(mcp, data)["saved"]
    assert mcp.client.get("/api/grants").json() == before
    assert len(mcp.client.get("/api/loan-payments").json()) == 1
    assert len([s for s in mcp.client.get("/api/sales").json() if s["date"] == "2024-08-01"]) == 1


def test_expiry_and_another_users_token_are_refused(mcp, db_session):
    from datetime import datetime, timedelta, timezone
    from scaffold.models import ImportProposal
    data = review(mcp)
    db_session.query(ImportProposal).update({"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
    db_session.commit()
    assert "expired" in mcp.error("accept_import_review", review_token=data["review_token"], confirmed=True)
    register_user(mcp.client, "second-plugin@example.com")
    other = Mcp(mcp.client)
    assert "expired" in other.error("accept_import_review", review_token=data["review_token"], confirmed=True)


def test_unreadable_pdf_retains_the_repair_path(mcp, monkeypatch):
    monkeypatch.setattr(import_ui, "download_file", lambda ref: b"%PDF-invalid")
    data = mcp.call("analyze_import_files", files=[{"file_id": "scanned", "download_url": "unused", "file_name": "statement.pdf", "role": "statement_pdf"}])["data"]
    assert data["blocked"]
    assert data["files"] and data["source_notes"]
    data = mcp.call("prepare_import_review", revision=data["revision"], payload={"grants": [RETENTION], "prices": []})["data"]
    assert not data["blocked"]
    assert "Automatic source parsing could not run" in str(data["source_notes"])


def test_workbook_keeps_dates_sales_and_payments(mcp, monkeypatch):
    seed(mcp.client)
    loan = mcp.client.get("/api/loans").json()[0]
    mcp.client.put(f"/api/loans/{loan['id']}", json={"version": loan["version"], "loan_number": "xlsx-loan"})
    mcp.client.post("/api/loan-payments", json={"loan_id": loan["id"], "date": "2024-09-01", "amount": 100})
    raw = mcp.client.get("/api/export/excel").content
    monkeypatch.setattr(import_ui, "download_file", lambda ref: raw)
    data = mcp.call("analyze_import_files", files=[{"file_id": "workbook", "download_url": "unused", "file_name": "stocks.xlsx", "role": "workbook"}])["data"]
    assert data["payload"]["sales"]
    assert data["payload"]["loan_payments"][0]["loan_number"] == "xlsx-loan"
    assert all(g["vest_start"] and g["periods"] and g["custom_schedule"] for g in data["payload"]["grants"])
    assert not any(g["schedule_confirmed"] for g in data["payload"]["grants"])
    for g in data["payload"]["grants"]:
        g.update(schedule_confirmed=True, basis_confirmed=True)
    data = mcp.call("prepare_import_review", revision=data["revision"], payload=data["payload"])["data"]
    assert not data["blocked"], data
    accept(mcp, data)
    assert len(mcp.client.get("/api/loan-payments").json()) == 1


def test_images_are_returned_as_model_content_not_plain_base64_json(mcp, monkeypatch):
    monkeypatch.setattr(import_ui, "download_file", lambda ref: b"synthetic-image")
    result = mcp.raw_call("analyze_import_files", files=[{"file_id": "screenshot", "download_url": "unused", "file_name": "award.png", "mime_type": "image/png"}])
    assert result["content"][1]["type"] == "image"
    assert "bytes" not in str(result["structuredContent"])


@pytest.mark.parametrize("url", ["http://files.oaiusercontent.com/a", "https://127.0.0.1/a", "https://evil.test/a", "https://files.oaiusercontent.com.evil.test/a", "https://user:pass@files.oaiusercontent.com/a", "https://files.oaiusercontent.com:8443/a"])
def test_file_download_rejects_arbitrary_urls(url):
    with pytest.raises(ValueError):
        _destination(url)


def test_file_download_rejects_private_dns(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(ValueError, match="public"):
        _destination("https://files.oaiusercontent.com/a")


@pytest.mark.parametrize("status,size,encoding", [(302, 1, "identity"), (200, 5 * 1024 * 1024 + 1, "identity"), (200, 10, "gzip")])
def test_download_refuses_redirects_large_files_and_encoded_transfers(monkeypatch, status, size, encoding):
    from app.mcp import import_files
    from urllib.parse import urlsplit
    monkeypatch.setattr(import_files, "_destination", lambda url: (urlsplit("https://files.oaiusercontent.com/test"), "8.8.8.8"))
    class Response:
        def __init__(self):
            self.status = status
        def getheader(self, *args):
            return encoding
        def read(self, limit):
            return b"x" * min(size, limit)
    class Connection:
        def __init__(self, *args):
            pass
        def request(self, *args):
            pass
        def getresponse(self):
            return Response()
        def close(self):
            pass
    monkeypatch.setattr(import_files, "_PinnedConnection", Connection)
    with pytest.raises(ValueError):
        import_files.download_file({"file_id": "file-test", "download_url": "unused"})


def test_json_array_is_reported_without_losing_original_files(mcp, monkeypatch):
    monkeypatch.setattr(import_ui, "download_file", lambda ref: b"[]")
    data = mcp.call("analyze_import_files", files=[{"file_id": "draft", "download_url": "unused", "file_name": "draft.json", "role": "draft"}])["data"]
    assert data["blocked"] and data["files"] and data["source_notes"]
