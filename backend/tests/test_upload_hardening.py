"""Bounds and crash-resistance on everything a caller can upload or paste.

Two separate concerns, both reachable from outside:

  * A 5 MB upload is not a 5 MB workload. An .xlsx is a zip, a PDF declares its
    own page count, and both can ask for far more work than they cost to send.
  * An unhandled exception is a 500, and every 500 writes an error_logs row
    that the nightly trim uses to push a real traceback out of the 500-row
    window. Cheap 500s are therefore an attack on the evidence, not just noise
    — so malformed input has to come back as a finding or a 4xx, never a crash.

The trial endpoints take no session at all, which is what makes the parsers
worth this attention.
"""
import io
import json
import zipfile

import pytest

from tests.conftest import register_user


# ── Helpers ──────────────────────────────────────────────────────────────────

def _real_workbook(sheets=("Schedule",)) -> bytes:
    """A small, honest .xlsx — what a legitimate upload looks like."""
    import openpyxl
    wb = openpyxl.Workbook()
    wb.active.title = sheets[0]
    for name in sheets[1:]:
        wb.create_sheet(name)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _zip_bomb(uncompressed_bytes: int) -> bytes:
    """A zip whose single member expands to `uncompressed_bytes` of zeros.

    Honest headers: this is the archive that admits what it is, and the cheap
    first pass in safe_workbook should reject it without decompressing.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", b"\0" * uncompressed_bytes)
    return buf.getvalue()


def _lying_zip(uncompressed_bytes: int, declared: int = 64) -> bytes:
    """A zip whose header understates how big its member really is."""
    raw = bytearray(_zip_bomb(uncompressed_bytes))
    size = declared.to_bytes(4, "little")
    # Local file header: uncompressed size at offset 22.
    raw[22:26] = size
    # Central directory header: uncompressed size at offset 24 from its signature.
    cd = raw.find(b"PK\x01\x02")
    assert cd != -1, "no central directory in the generated zip"
    raw[cd + 24:cd + 28] = size
    return bytes(raw)


# ── safe_workbook, directly ──────────────────────────────────────────────────

def test_honest_bomb_rejected_without_decompressing():
    from scaffold.safe_workbook import (MAX_TOTAL_UNCOMPRESSED, WorkbookRejected,
                                        check_workbook_bytes)
    bomb = _zip_bomb(MAX_TOTAL_UNCOMPRESSED + 1024)
    # The point of the exercise: tiny on the wire, over the cap once expanded.
    assert len(bomb) < 1024 * 1024
    with pytest.raises(WorkbookRejected):
        check_workbook_bytes(bomb)


def test_understated_header_cannot_smuggle_bytes_past_the_cap():
    """A header that lies low does not buy the archive anything.

    zipfile stops a member's read at its declared file_size and then fails the
    CRC, so an understated header cannot hand more bytes to this guard or to
    openpyxl than it admits to — it just makes the archive unreadable. Pinned
    because the size cap's cheap first pass relies on exactly that.
    """
    import zipfile as _zipfile
    from scaffold.safe_workbook import WorkbookRejected, check_workbook_bytes

    liar = _lying_zip(50 * 1024 * 1024, declared=64)

    delivered = 0
    with _zipfile.ZipFile(io.BytesIO(liar)) as zf:
        info = zf.infolist()[0]
        assert info.file_size == 64, "the header should understate the content"
        with pytest.raises(_zipfile.BadZipFile):
            with zf.open(info) as member:
                while True:
                    chunk = member.read(65536)
                    if not chunk:
                        break
                    delivered += len(chunk)
    assert delivered < 4096, "zipfile handed over more than the declared size"

    # And the guard turns that into a refusal rather than an exception.
    with pytest.raises(WorkbookRejected):
        check_workbook_bytes(liar)


# The byte-counting second pass in check_workbook_bytes has no test of its own
# on purpose: with honest headers the declared-size pass always trips first,
# and a dishonest header makes zipfile refuse the member outright (above). It
# is kept in the code as cover for a zipfile that stops enforcing declared
# sizes, which is not a state this suite can construct.


def test_too_many_members_rejected(monkeypatch):
    import scaffold.safe_workbook as sw
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(sw.MAX_MEMBERS + 1):
            zf.writestr(f"part{i}.xml", b"x")
    with pytest.raises(sw.WorkbookRejected):
        sw.check_workbook_bytes(buf.getvalue())


def test_real_workbook_passes():
    from scaffold.safe_workbook import check_workbook_bytes
    check_workbook_bytes(_real_workbook())  # must not raise


def test_non_zip_is_left_to_the_caller():
    """Not a spreadsheet is not this guard's question to answer.

    Each caller already has its own message for an unreadable file, and the
    wizard's is a 422 the client depends on.
    """
    from scaffold.safe_workbook import check_workbook_bytes
    check_workbook_bytes(b"not an excel file at all")  # must not raise


# ── The endpoints that parse workbooks ───────────────────────────────────────

def test_wizard_parse_file_rejects_bomb(client):
    from scaffold.safe_workbook import MAX_TOTAL_UNCOMPRESSED
    register_user(client)
    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("bomb.xlsx", _zip_bomb(MAX_TOTAL_UNCOMPRESSED + 1024),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 400
    assert "decompressed" in resp.json()["detail"]


def test_wizard_parse_file_still_takes_a_real_workbook(client):
    register_user(client)
    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("ok.xlsx", _real_workbook(("Schedule", "Prices")),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200


def test_import_excel_rejects_bomb(client):
    from scaffold.safe_workbook import MAX_TOTAL_UNCOMPRESSED
    register_user(client)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("bomb.xlsx", _zip_bomb(MAX_TOTAL_UNCOMPRESSED + 1024),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 400
    assert "decompressed" in resp.json()["detail"]


def test_epic_import_revised_draft_rejects_bomb(client):
    from scaffold.safe_workbook import MAX_TOTAL_UNCOMPRESSED
    register_user(client)
    resp = client.post(
        "/api/epic-import/analyze",
        files={
            "share_csv": ("s.csv", b"Grant,Shares Granted,Cost Basis of Shares\n", "text/csv"),
            "revised_draft": ("bomb.xlsx", _zip_bomb(MAX_TOTAL_UNCOMPRESSED + 1024),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        },
    )
    assert resp.status_code == 400
    assert "decompressed" in resp.json()["detail"]


def test_epic_import_diff_rejects_bomb(client):
    from scaffold.safe_workbook import MAX_TOTAL_UNCOMPRESSED
    register_user(client)
    resp = client.post(
        "/api/epic-import/diff",
        files={
            "export_xlsx": ("bomb.xlsx", _zip_bomb(MAX_TOTAL_UNCOMPRESSED + 1024),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "share_csv": ("s.csv", b"Grant,Shares Granted,Cost Basis of Shares\n", "text/csv"),
        },
    )
    assert resp.status_code == 400
    assert "decompressed" in resp.json()["detail"]


def test_workbook_open_error_does_not_echo_library_internals(client):
    """A failed open says what happened, not which library said so."""
    register_user(client)
    # A valid zip that is not a workbook: openpyxl raises, and the old handler
    # put that exception's text straight in the response body.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("hello.txt", b"not a workbook")
    resp = client.post(
        "/api/epic-import/analyze",
        files={
            "share_csv": ("s.csv", b"Grant,Shares Granted,Cost Basis of Shares\n", "text/csv"),
            "revised_draft": ("x.xlsx", buf.getvalue(),
                              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        },
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "Could not open that workbook" in detail
    assert "zipfile" not in detail.lower() and "keyerror" not in detail.lower()


# ── The PDF statement parser ─────────────────────────────────────────────────

def test_extract_lines_refuses_a_pdf_with_too_many_pages(monkeypatch):
    """Text extraction is per page and this endpoint takes no session."""
    import app.epic_import.pdf_statement as ps

    class _FakePage:
        def extract_text(self):
            return "x"

    class _FakePdf:
        pages = [_FakePage()] * (ps.MAX_PDF_PAGES + 1)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    fake = type("m", (), {"open": staticmethod(lambda *_a, **_k: _FakePdf())})
    monkeypatch.setitem(__import__("sys").modules, "pdfplumber", fake)

    with pytest.raises(ps.StatementUnreadable) as exc:
        ps.extract_lines(b"%PDF-1.4 whatever")
    assert "pages" in str(exc.value)


def test_extract_lines_turns_a_broken_pdf_into_a_clean_error(client):
    """Anything starting %PDF- reaches pdfminer; none of it may reach the client as a 500."""
    resp = client.post(
        "/api/trial/analyze",
        files={"statement_pdf": ("s.pdf", b"%PDF-1.4\nnot really a pdf at all",
                                 "application/pdf")},
    )
    assert resp.status_code == 400
    assert "could not be read" in resp.json()["detail"].lower()


@pytest.mark.parametrize("row", [
    # Rate the row grammar admits but float() will not take.
    "001468 2018 Grant - Purchase Loan $76,296.60 1.2.3% $109.36 7/15/2027",
    # A due date that is not a date.
    "001468 2018 Grant - Purchase Loan $76,296.60 0.86% $109.36 13/40/2027",
])
def test_malformed_statement_row_is_a_finding_not_an_exception(row):
    from app.epic_import import parse_statement_lines
    st, findings = parse_statement_lines([row])
    assert st.loans == [], "an unreadable row must not become a loan"
    assert any(f.code == "L1" for f in findings)


def test_impossible_statement_date_is_ignored():
    """'February 30' satisfies the pattern and makes date() raise."""
    from app.epic_import import parse_statement_lines
    st, _ = parse_statement_lines(["Stock Loan Statement - February 30, 2027"])
    assert st.statement_date is None


def test_good_statement_still_parses():
    """The guards above must not have cost the parser its actual job."""
    from app.epic_import import parse_statement_lines
    st, _ = parse_statement_lines([
        "Stock Loan Statement - March 3, 2025",
        "001468 2018 Grant - Purchase Loan $76,296.60 0.86% $109.36 7/15/2027",
    ])
    assert len(st.loans) == 1
    assert st.loans[0].balance == 76296.60
    assert st.statement_date is not None


# ── The share-summary CSV parser ─────────────────────────────────────────────

def test_oversized_csv_field_is_a_finding_not_an_exception():
    """csv raises past its 128 KB field limit, and this file arrives unauthenticated."""
    from app.epic_import import parse_share_csv
    raw = b"Grant,Shares Granted,Cost Basis of Shares\n" + b"A" * 200_000 + b",1,1\n"
    rows, findings = parse_share_csv(raw)
    assert rows == []
    assert any(f.code == "G0" for f in findings)


def test_csv_field_over_the_limit_in_the_body_is_a_finding():
    from app.epic_import import parse_share_csv
    raw = (b"Grant,Shares Granted,Cost Basis of Shares\n"
           b"2021 Purchased,1,1\n" + b"B" * 200_000 + b",1,1\n")
    rows, findings = parse_share_csv(raw)
    assert any(f.code == "G0" for f in findings)


def test_trial_analyze_survives_a_hostile_csv(client):
    """The whole unauthenticated path, not just the parser."""
    raw = b"Grant,Shares Granted,Cost Basis of Shares\n" + b"A" * 200_000 + b",1,1\n"
    resp = client.post("/api/trial/analyze",
                       files={"share_csv": ("s.csv", raw, "text/csv")})
    assert resp.status_code < 500


# ── Grant years and the date arithmetic they drive ───────────────────────────

def test_four_digit_year_outside_range_does_not_crash_the_schedule():
    """'9999 Purchased' is a valid label and shifting a template onto it overflows date()."""
    from datetime import date
    from app.epic_import import derive_draft
    from app.epic_import.models import ShareRow
    from app.epic_import.skeleton import Skeleton, TemplateRow

    sk = Skeleton(templates=[
        TemplateRow(2021, "Purchase", date(2022, 9, 30), 5, date(2021, 12, 31))
    ])
    row = ShareRow(
        label="9999 Purchased", shares_granted=10, shares_sold=0, shares_remaining=10,
        shares_83b=0, cost_basis=100.0, loan_balance=None, loan_due_year=None,
        vested=[], unvested_value=[], annual_interest_due=None,
    )
    draft, findings = derive_draft(None, [row], sk)
    assert draft.grants == []
    assert any(f.code == "G1" for f in findings)


def test_trial_analyze_survives_an_out_of_range_year(client):
    raw = (b"Grant,Shares Granted,Cost Basis of Shares\n"
           b"9999 Purchased,10,100\n")
    resp = client.post("/api/trial/analyze",
                       files={"share_csv": ("s.csv", raw, "text/csv")})
    assert resp.status_code < 500


# ── The repair loop's pasted JSON ────────────────────────────────────────────

@pytest.mark.parametrize("payload,label", [
    ([1, 2], "a JSON array rather than an object"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1e999, "price": 1}]},
     "infinite shares"),
    ({"grants": [{"year": 10 ** 12, "type": "Purchase", "shares": 1, "price": 1}]},
     "a year past what date() holds"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1,
                  "periods": "x"}]}, "non-numeric periods"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1,
                  "dp_shares": "x"}]}, "non-numeric dp_shares"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1,
                  "loans": [5]}]}, "a loan that is not an object"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1,
                  "loans": "nope"}]}, "loans that are not an array"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1}],
      "prices": [5]}, "a price that is not an object"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1}],
      "prices": "nope"}, "prices that are not an array"),
    ({"grants": [{"year": 2021, "type": "Purchase", "shares": 1, "price": 1}],
      "statement_date": 5}, "a statement_date that is not a date"),
])
def test_draft_from_payload_never_raises(payload, label):
    """Whatever an assistant hands back is pasted through unchanged.

    Every one of these escaped as a 500 before, which is both a bad repair-loop
    experience and a way to churn the error log.
    """
    from datetime import date
    from app.epic_import import draft_from_payload
    from app.epic_import.skeleton import Skeleton, TemplateRow

    sk = Skeleton(templates=[
        TemplateRow(2021, "Purchase", date(2022, 9, 30), 5, date(2021, 12, 31))
    ])
    draft, findings = draft_from_payload(payload, sk)
    assert isinstance(findings, list), label
    # A rejected shape reports itself rather than passing silently.
    if not draft.grants:
        assert findings, label


def test_draft_from_payload_still_reads_a_good_payload():
    from datetime import date
    from app.epic_import import draft_from_payload
    from app.epic_import.skeleton import Skeleton, TemplateRow

    sk = Skeleton(templates=[
        TemplateRow(2021, "Purchase", date(2022, 9, 30), 5, date(2021, 12, 31))
    ])
    draft, _ = draft_from_payload({
        "grants": [{
            "year": 2021, "type": "Purchase", "shares": 100, "price": 2.83,
            "dp_shares": -10, "periods": 5,
            "loans": [{"loan_number": "022270", "loan_type": "Purchase",
                       "loan_year": 2021, "amount": 263000.0,
                       "interest_rate": 0.0086, "due_date": "2030-07-15"}],
        }],
        "prices": [{"effective_date": "2021-01-01", "price": 2.83}],
    }, sk)
    assert len(draft.grants) == 1
    assert draft.grants[0].shares == 100
    assert draft.grants[0].dp_shares == -10
    assert len(draft.grants[0].loans) == 1
    assert len(draft.prices) == 1


def test_deeply_nested_json_is_rejected_not_crashed(client):
    """Valid JSON that json.loads recurses to death on."""
    register_user(client)
    nested = "[" * 40_000 + "]" * 40_000
    resp = client.post(
        "/api/epic-import/analyze",
        data={"revised_json": nested},
        files={"share_csv": ("s.csv", b"Grant,Shares Granted,Cost Basis of Shares\n",
                             "text/csv")},
    )
    assert resp.status_code == 400
