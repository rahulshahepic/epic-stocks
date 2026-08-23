"""Tests for importing Epic's own statement files.

Fixtures in test_data/ are synthetic — the share prices and loan balances are
invented round numbers, not Epic's.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.epic_import import (build_proposal, parse_share_csv, parse_statement_lines,
                             parse_statement_pdf, reconcile)
from app.epic_import.rules import (attribute_loan, classify_row, infer_schedule,
                                   is_vest_taxed, parse_loan_name)
from tests.conftest import register_user

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "test_data")
STATEMENT_TXT = os.path.join(DATA, "epic_loan_statement.txt")
SHARE_CSV = os.path.join(DATA, "epic_share_summary.csv")


def statement_lines():
    with open(STATEMENT_TXT) as fh:
        return fh.read().split("\n")


def csv_bytes():
    with open(SHARE_CSV, "rb") as fh:
        return fh.read()


@pytest.fixture()
def proposal():
    statement, f1 = parse_statement_lines(statement_lines())
    rows, f2 = parse_share_csv(csv_bytes())
    return build_proposal(statement, rows, parse_findings=f1 + f2)


def by_key(proposal, year, gtype):
    return next(g for g in proposal.grants if g.year == year and g.type == gtype)


def codes(proposal, severity=None):
    return [f.code for f in proposal.findings if severity is None or f.severity == severity]


# ============================================================
# PDF STATEMENT
# ============================================================

def test_statement_rows_and_totals_parse():
    statement, findings = parse_statement_lines(statement_lines())
    assert [f for f in findings if f.severity == "error"] == []
    assert len(statement.loans) == 9
    assert statement.statement_date.isoformat() == "2024-02-01"
    assert statement.total_principal == 3795000.00
    assert statement.printed_total == 3795000.00
    assert statement.subtotals == {2029: 545000.00, 2030: 1218000.00, 2031: 2032000.00}
    assert round(sum(l.balance for l in statement.loans), 2) == statement.printed_total


def test_wrapped_loan_name_is_reassembled():
    """A name too long for the column wraps onto the next line, year and all."""
    statement, _ = parse_statement_lines(statement_lines())
    wrapped = next(l for l in statement.loans if l.loan_number == "100008")
    assert wrapped.name == "2022 Bonus/2022 Grant - Interest Loan - 2023"
    assert wrapped.balance == 7000.00


def test_boilerplate_is_not_read_as_a_loan_name():
    statement, _ = parse_statement_lines(statement_lines())
    assert all("stockownership" not in l.name for l in statement.loans)
    assert all("loan agreements" not in l.name for l in statement.loans)


def test_statement_with_no_rows_is_an_error():
    _, findings = parse_statement_lines(["Some other document", "with no loan rows"])
    assert any(f.severity == "error" and f.code == "L1" for f in findings)


@pytest.mark.parametrize("name,expected", [
    ("2018 Grant - Purchase Loan", ("Purchase", None, ["2018 Grant"])),
    ("2018 Grant - Interest Loan - 2020", ("Interest", 2020, ["2018 Grant"])),
    ("2020 Bonus - Tax Loan - 2021", ("Tax", 2021, ["2020 Bonus"])),
    ("2020 Bonus/2020 Grant - Interest Loan - 2024",
     ("Interest", 2024, ["2020 Bonus", "2020 Grant"])),
    ("not a loan name", (None, None, [])),
])
def test_loan_name_grammar(name, expected):
    assert parse_loan_name(name) == expected


def test_tax_loan_on_an_unqualified_grant_routes_to_the_catch_up():
    """Epic names tax loans after the "<year> Grant" even when the withholding
    belongs to that year's zero-basis catch-up shares."""
    known = {2020: {"Purchase", "Catch-Up"}}
    assert attribute_loan(["2020 Grant"], "Tax", known)[:2] == (2020, "Catch-Up")
    assert attribute_loan(["2020 Grant"], "Purchase", known)[:2] == (2020, "Purchase")
    assert attribute_loan(["2020 Grant"], "Interest", known)[:2] == (2020, "Purchase")


def test_tax_loan_stays_on_the_purchase_grant_when_there_is_no_zero_basis_grant():
    assert attribute_loan(["2020 Grant"], "Tax", {2020: {"Purchase"}})[:2] == (2020, "Purchase")


def test_loan_covering_two_grants_goes_to_the_bonus_side():
    known = {2020: {"Purchase", "Bonus"}}
    for descriptors in (["2020 Bonus", "2020 Grant"], ["2020 Grant", "2020 Bonus"]):
        year, gtype, rule, ambiguous = attribute_loan(descriptors, "Interest", known)
        assert (year, gtype, rule, ambiguous) == (2020, "Bonus", "L4", True)


# ============================================================
# SHARE CSV
# ============================================================

def test_unused_categories_are_dropped():
    rows, findings = parse_share_csv(csv_bytes())
    labels = [r.label for r in rows]
    assert "Other" not in labels and "Pre-2017 Class A Shares" not in labels
    assert len(rows) == 9
    assert findings == []


def test_csv_without_a_grant_column_is_an_error():
    _, findings = parse_share_csv(b"Something,Else\n1,2\n")
    assert [f.code for f in findings] == ["G0"]


@pytest.mark.parametrize("label,expected", [
    ("2020 Purchased", (2020, "Purchase")),
    ("2020 Catch-up", (2020, "Catch-Up")),
    ("2021 Bonus Shares", (2021, "Bonus")),
    ("2023 Free", (2023, "Free")),
    ("2019 SARs Conversion", (None, None)),
    ("Pre-2017 Class A Shares", (None, None)),
])
def test_row_labels_map_to_grant_types(label, expected):
    assert classify_row(label) == expected


# ============================================================
# DERIVATION
# ============================================================

def test_grants_derived_from_the_csv(proposal):
    assert len(proposal.grants) == 8  # the SARs category is skipped

    purchase = by_key(proposal, 2021, "Purchase")
    assert purchase.shares == 200000
    assert purchase.price == 12.00
    assert purchase.periods == 4            # 4 x 50,000
    assert purchase.vest_start.year == 2022  # 2 of 4 vests already elapsed by Feb 2024

    cliff = by_key(proposal, 2023, "Free")
    assert (cliff.periods, cliff.vest_start.year) == (1, 2024)


def test_vesting_shape_is_read_off_the_checkpoint_columns():
    rows, _ = parse_share_csv(csv_bytes())
    row = next(r for r in rows if r.label == "2022 Purchased")
    periods, remaining, increments = infer_schedule(row)
    assert (periods, remaining) == (4, 3)
    assert increments == [75000, 75000, 75000]


def test_fully_vested_grant_cannot_show_its_schedule(proposal):
    g = by_key(proposal, 2020, "Purchase")
    assert "periods" in g.uncertain and "vest_start" in g.uncertain
    assert any(f.code == "G4" and f.subject == "2020 Purchased" for f in proposal.findings)


def test_catch_up_basis_is_recognised_as_accrued_at_vest(proposal):
    """A per-share basis that is not a round number of cents is a running total
    of value taxed as it vested, not a purchase price."""
    rows, _ = parse_share_csv(csv_bytes())
    row = next(r for r in rows if r.label == "2020 Catch-up")
    assert is_vest_taxed(row)[0] is True
    assert by_key(proposal, 2020, "Catch-Up").price == 0.0


def test_unvested_shares_with_no_unvested_value_mean_zero_basis(proposal):
    rows, _ = parse_share_csv(csv_bytes())
    row = next(r for r in rows if r.label == "2023 Bonus Shares")
    assert is_vest_taxed(row) == (True, "shares are unvested but carry no unvested value")
    assert by_key(proposal, 2023, "Bonus").price == 0.0


def test_bonus_basis_that_misses_the_year_price_is_flagged_not_silently_zeroed(proposal):
    """The 2022 bonus carries a basis above that year's share price. That is kept,
    because zeroing a real basis is worse than reporting it — but it is flagged."""
    assert by_key(proposal, 2022, "Bonus").price == 20.00
    assert any(f.code == "G3" and f.severity == "warning" and "2022 Bonus" in f.subject
               for f in proposal.findings)


def test_share_prices_are_derived_from_purchase_grants(proposal):
    assert [(p.effective_date.isoformat(), p.price) for p in proposal.prices] == [
        ("2020-03-01", 10.00), ("2021-03-01", 12.00), ("2022-03-01", 15.00)]


def test_unmapped_category_is_reported_not_dropped_silently(proposal):
    assert any(f.code == "G1" and "SARs" in f.subject for f in proposal.findings)


def test_shares_sold_are_reported_but_no_sales_invented(proposal):
    assert any(f.code == "G2" and "2020 Purchased" in f.subject for f in proposal.findings)


# ============================================================
# CROSS-CHECKS
# ============================================================

def test_every_cross_check_passes_on_the_fixture(proposal):
    assert [f.as_dict() for f in proposal.findings if f.severity == "error"] == []


def test_a_misparsed_balance_is_caught_by_the_statement_subtotal():
    lines = [l.replace("$500,000.00", "$500,000.99") for l in statement_lines()]
    statement, f = parse_statement_lines(lines)
    p = build_proposal(statement, parse_share_csv(csv_bytes())[0], parse_findings=f)
    assert "C1" in codes(p, "error")
    assert "C2" in codes(p, "error")


def test_wrong_attribution_is_caught_by_the_csv_loan_balance():
    """Route tax loans to the purchase grant and the CSV balances stop adding up."""
    statement, f = parse_statement_lines(statement_lines())
    rows, _ = parse_share_csv(csv_bytes())
    for sl in statement.loans:
        sl.name = sl.name.replace("Tax Loan", "Interest Loan")
    p = build_proposal(statement, rows, parse_findings=f)
    assert "C3" in codes(p, "error")
    assert "C4" in codes(p, "error")


def test_shares_remaining_mismatch_is_reported():
    rows, _ = parse_share_csv(csv_bytes())
    rows[0].shares_remaining += 1
    p = build_proposal(None, rows)
    assert "C6" in codes(p, "warning")


# ============================================================
# PDF ROUND TRIP
# ============================================================

def make_pdf(lines: list[str]) -> bytes:
    """Smallest valid PDF that renders one text line per input line."""
    def esc(s):
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    content = ("BT /F1 9 Tf 36 756 Td 11 TL\n"
               + "".join(f"({esc(l)}) Tj T*\n" for l in lines if l.strip()) + "ET")
    objs = [
        "<</Type/Catalog/Pages 2 0 R>>",
        "<</Type/Pages/Kids[3 0 R]/Count 1>>",
        "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        "/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
        "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        f"<</Length {len(content)}>>\nstream\n{content}\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    start = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<</Size {len(objs) + 1}/Root 1 0 R>>\n"
            f"startxref\n{start}\n%%EOF\n").encode()
    return bytes(out)


def test_real_pdf_extraction_finds_the_same_rows():
    statement, findings = parse_statement_pdf(make_pdf(statement_lines()))
    assert [f for f in findings if f.severity == "error"] == []
    assert len(statement.loans) == 9
    assert round(sum(l.balance for l in statement.loans), 2) == 3795000.00
    assert next(l for l in statement.loans
                if l.loan_number == "100008").name.endswith("Interest Loan - 2023")


# ============================================================
# API
# ============================================================

def upload_files(with_pdf=True):
    files = {"share_csv": ("shares.csv", csv_bytes(), "text/csv")}
    if with_pdf:
        files["statement_pdf"] = ("statement.pdf", make_pdf(statement_lines()),
                                  "application/pdf")
    return files


def test_preview_writes_nothing(client):
    register_user(client)
    resp = client.post("/api/epic-import/preview", files=upload_files())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["proposal"]["grants"]) == 8
    assert len(body["proposal"]["loans"]) == 9
    assert body["plan"]["grants_updated"] == 0
    assert client.get("/api/grants").json() == []
    assert client.get("/api/loans").json() == []


def test_preview_requires_at_least_one_file(client):
    register_user(client)
    assert client.post("/api/epic-import/preview", files={}).status_code == 400


def test_apply_creates_grants_loans_and_prices(client):
    register_user(client)
    resp = client.post("/api/epic-import/apply", files=upload_files())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["grants_created"], body["loans_created"], body["prices_created"]) == (8, 9, 3)
    assert len(client.get("/api/grants").json()) == 8
    assert len(client.get("/api/loans").json()) == 9
    assert len(client.get("/api/prices").json()) == 3


def test_apply_twice_updates_rather_than_duplicating(client):
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    body = client.post("/api/epic-import/apply", files=upload_files()).json()
    assert (body["grants_created"], body["loans_created"]) == (0, 0)
    assert (body["grants_updated"], body["loans_updated"]) == (8, 9)
    assert len(client.get("/api/grants").json()) == 8


def test_apply_keeps_a_schedule_the_user_already_set(client):
    """A statement says nothing about vest dates, so it must not overwrite them."""
    register_user(client)
    client.post("/api/grants", json={
        "year": 2021, "type": "Purchase", "shares": 1, "price": 1.0,
        "vest_start": "2021-06-15", "periods": 9, "exercise_date": "2021-11-30",
        "dp_shares": -500,
    })
    client.post("/api/epic-import/apply", files=upload_files())
    g = next(g for g in client.get("/api/grants").json()
             if g["year"] == 2021 and g["type"] == "Purchase")
    assert g["shares"] == 200000        # refreshed from the CSV
    assert g["price"] == 12.00
    assert g["vest_start"] == "2021-06-15"   # left alone
    assert g["periods"] == 9
    assert g["dp_shares"] == -500


def test_apply_adopts_the_derived_schedule_when_asked(client):
    register_user(client)
    client.post("/api/grants", json={
        "year": 2021, "type": "Purchase", "shares": 1, "price": 1.0,
        "vest_start": "2021-06-15", "periods": 9, "exercise_date": "2021-11-30",
    })
    client.post("/api/epic-import/apply?adopt_schedule=true", files=upload_files())
    g = next(g for g in client.get("/api/grants").json()
             if g["year"] == 2021 and g["type"] == "Purchase")
    assert g["periods"] == 4
    assert g["vest_start"].startswith("2022")


def test_apply_reports_loans_the_statement_no_longer_lists(client):
    register_user(client)
    client.post("/api/loans", json={
        "grant_year": 2019, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2019, "amount": 1000.0, "interest_rate": 0.01,
        "due_date": "2028-07-15", "loan_number": "099999",
    })
    body = client.post("/api/epic-import/apply", files=upload_files()).json()
    assert body["loans_not_on_statement"] == ["099999"]
    assert len(client.get("/api/loans").json()) == 10  # nothing deleted


def test_apply_takes_a_backup_first(client):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-03-01", "price": 9.0})
    client.post("/api/epic-import/apply", files=upload_files())
    assert len(client.get("/api/import/backups").json()) == 1


def test_apply_leaves_existing_prices_alone(client):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-03-01", "price": 9.0})
    client.post("/api/epic-import/apply", files=upload_files())
    prices = {p["effective_date"]: p["price"] for p in client.get("/api/prices").json()}
    assert prices["2020-03-01"] == 9.0
    assert prices["2021-03-01"] == 12.00


def test_apply_can_overwrite_prices_when_asked(client):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-03-01", "price": 9.0})
    client.post("/api/epic-import/apply?overwrite_prices=true", files=upload_files())
    prices = {p["effective_date"]: p["price"] for p in client.get("/api/prices").json()}
    assert prices["2020-03-01"] == 10.00


# ============================================================
# DIFF
# ============================================================

def export_bytes(client) -> bytes:
    resp = client.get("/api/export/excel")
    assert resp.status_code == 200, resp.text
    return resp.content


def diff_files(client, **overrides):
    files = {"export_xlsx": ("export.xlsx", export_bytes(client),
                             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    files.update(upload_files())
    files.update(overrides)
    return files


def test_diff_finds_nothing_when_the_data_came_from_the_same_files(client):
    """The round trip: import, export, diff. Anything reported here is a bug in
    the rules, not in the user's data."""
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    resp = client.post("/api/epic-import/diff", files=diff_files(client))
    assert resp.status_code == 200, resp.text
    report = resp.json()["report"]
    assert report["differences"] == []
    assert report["errors"] == 0


def test_diff_names_the_rule_behind_each_difference(client):
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    g = next(g for g in client.get("/api/grants").json()
             if g["year"] == 2022 and g["type"] == "Purchase")
    client.put(f"/api/grants/{g['id']}", json={"shares": 999})

    report = client.post("/api/epic-import/diff", files=diff_files(client)).json()["report"]
    shares = [d for d in report["differences"] if d["field"] == "shares"]
    assert len(shares) == 1
    assert shares[0]["rule"] == "G2"           # points at the rule to fix
    assert shares[0]["severity"] == "error"
    assert shares[0]["imported"] == "300,000" and shares[0]["existing"] == "999"


def test_diff_learns_the_users_date_conventions(client):
    """A user whose vest dates are not 1 March should not see every grant flagged."""
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    for g in client.get("/api/grants").json():
        client.put(f"/api/grants/{g['id']}", json={"vest_start": f"{g['vest_start'][:4]}-07-01"})

    body = client.post("/api/epic-import/diff", files=diff_files(client)).json()
    assert body["report"]["conventions"]["vest_month"] == 7
    assert [d for d in body["report"]["differences"] if d["field"] == "vest_start"] == []
    # ...whereas the SPEC defaults would have flagged every one of them.
    assert [d for d in body["report_with_defaults"]["differences"]
            if d["field"] == "vest_start"]


def test_diff_reports_records_missing_on_either_side(client):
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    loans = client.get("/api/loans").json()
    client.delete(f"/api/loans/{loans[0]['id']}")

    report = client.post("/api/epic-import/diff", files=diff_files(client)).json()["report"]
    missing = [d for d in report["differences"] if d["entity"] == "loan" and d["field"] == ""]
    assert len(missing) == 1
    assert missing[0]["existing"] == "—"


def test_diff_writes_nothing(client):
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    before = client.get("/api/grants").json()
    client.post("/api/epic-import/diff", files=diff_files(client))
    assert client.get("/api/grants").json() == before


def test_diff_markdown_download(client):
    register_user(client)
    client.post("/api/epic-import/apply", files=upload_files())
    resp = client.post("/api/epic-import/diff.md", files=diff_files(client))
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert "# Epic import reconciliation" in resp.text


def test_diff_rejects_something_that_is_not_an_export(client):
    register_user(client)
    resp = client.post("/api/epic-import/diff", files=diff_files(
        client, export_xlsx=("notes.txt", b"not a workbook", "text/plain")))
    assert resp.status_code == 400


def test_endpoints_require_authentication(client):
    for path in ("/api/epic-import/preview", "/api/epic-import/apply", "/api/epic-import/diff"):
        assert client.post(path, files=upload_files()).status_code == 401


def test_csv_only_import_does_not_call_every_loan_stale(client):
    """Without a statement there is nothing for a loan to be absent from."""
    register_user(client)
    client.post("/api/loans", json={
        "grant_year": 2019, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2019, "amount": 1000.0, "interest_rate": 0.01,
        "due_date": "2028-07-15", "loan_number": "099999",
    })
    plan = client.post("/api/epic-import/preview",
                       files=upload_files(with_pdf=False)).json()["plan"]
    assert plan["loans_not_on_statement"] == []

    body = client.post("/api/epic-import/apply", files=upload_files(with_pdf=False)).json()
    assert body["loans_not_on_statement"] == []
    assert body["loans_created"] == 0          # no statement, no loans to import
    assert body["grants_created"] == 8


def test_csv_only_does_not_raise_unreconcilable_loan_errors():
    """The loan cross-checks compare the CSV against the statement; with no
    statement there is nothing to compare, not a disagreement."""
    rows, _ = parse_share_csv(csv_bytes())
    p = build_proposal(None, rows)
    assert [f.code for f in p.findings if f.severity == "error"] == []
