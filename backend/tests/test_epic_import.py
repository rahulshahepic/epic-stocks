"""Tests for importing Epic's own files and the paste-out repair loop.

Fixtures in test_data/ are synthetic — the prices, rates and balances in them
are invented round numbers, not Epic's.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.epic_import import (build_prompt, build_skeleton, derive_draft,
                             draft_from_payload, is_blocked, parse_share_csv,
                             parse_statement_lines, parse_statement_pdf,
                             to_wizard_payload, validate_draft)
from app.epic_import.rules import (attribute_loan, classify_row, is_vest_taxed,
                                   parse_loan_name)
from tests.conftest import register_user

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "test_data")


def statement_lines():
    with open(os.path.join(DATA, "epic_loan_statement.txt")) as fh:
        return fh.read().split("\n")


def csv_bytes():
    with open(os.path.join(DATA, "epic_share_summary.csv"), "rb") as fh:
        return fh.read()


# A grant schedule matching the synthetic fixture. Deliberately has no 2023 Free
# template, so the fixture exercises the "shift the nearest one" path.
CONTENT = {
    "grant_templates": [
        {"year": 2020, "type": "Purchase", "vest_start": "2021-09-30", "periods": 5,
         "exercise_date": "2020-12-31", "default_catch_up": True, "show_dp_shares": True,
         "default_purchase_due_date": "2029-07-15", "default_tax_due_date": None},
        {"year": 2021, "type": "Purchase", "vest_start": "2022-09-30", "periods": 4,
         "exercise_date": "2021-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": "2030-07-15", "default_tax_due_date": None},
        {"year": 2021, "type": "Bonus", "vest_start": "2022-09-30", "periods": 3,
         "exercise_date": "2021-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": None, "default_tax_due_date": None},
        {"year": 2022, "type": "Purchase", "vest_start": "2023-09-30", "periods": 4,
         "exercise_date": "2022-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": "2031-06-30", "default_tax_due_date": None},
        {"year": 2022, "type": "Bonus", "vest_start": "2023-09-30", "periods": 3,
         "exercise_date": "2022-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": None, "default_tax_due_date": None},
        {"year": 2022, "type": "Free", "vest_start": "2027-09-30", "periods": 1,
         "exercise_date": "2022-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": None, "default_tax_due_date": "2031-06-30"},
        {"year": 2023, "type": "Bonus", "vest_start": "2024-09-30", "periods": 3,
         "exercise_date": "2023-12-31", "default_catch_up": False, "show_dp_shares": False,
         "default_purchase_due_date": None, "default_tax_due_date": None},
    ],
    "bonus_schedule_variants": [],
    "loan_rates": {
        "interest": {"2021": 0.02, "2022": 0.025, "2023": 0.04},
        "tax": {"Catch-Up": {"2021": 0.02, "2022": 0.03}, "Bonus": {"2023": 0.04}},
        "purchase_original": {"2020": {"rate": 0.01, "due_date": "2029-07-15"},
                              "2021": {"rate": 0.015, "due_date": "2030-07-15"},
                              "2022": {"rate": 0.03, "due_date": "2031-06-30"}},
    },
}


@pytest.fixture()
def skeleton():
    sk, findings = build_skeleton(CONTENT)
    assert [f for f in findings if f.severity == "error"] == []
    return sk


@pytest.fixture()
def parsed():
    statement, f1 = parse_statement_lines(statement_lines())
    rows, f2 = parse_share_csv(csv_bytes())
    return statement, rows, f1 + f2


@pytest.fixture()
def drafted(skeleton, parsed):
    statement, rows, pf = parsed
    draft, df = derive_draft(statement, rows, skeleton)
    findings = pf + df + validate_draft(draft, statement, rows, skeleton)
    return draft, findings


def grant(draft, year, gtype):
    return next(g for g in draft.grants if g.year == year and g.type == gtype)


def codes(findings, severity=None):
    return [f.code for f in findings if severity is None or f.severity == severity]


# ============================================================
# PARSING
# ============================================================

def test_statement_rows_and_totals_parse():
    statement, findings = parse_statement_lines(statement_lines())
    assert [f for f in findings if f.severity == "error"] == []
    assert len(statement.loans) == 9
    assert statement.statement_date.isoformat() == "2024-02-01"
    assert statement.subtotals == {2029: 545000.00, 2030: 1218000.00, 2031: 2032000.00}
    assert round(sum(l.balance for l in statement.loans), 2) == statement.printed_total


def test_wrapped_loan_name_is_reassembled():
    statement, _ = parse_statement_lines(statement_lines())
    wrapped = next(l for l in statement.loans if l.loan_number == "100008")
    assert wrapped.name == "2022 Bonus/2022 Grant - Interest Loan - 2023"


def test_boilerplate_is_not_read_as_a_loan_name():
    statement, _ = parse_statement_lines(statement_lines())
    assert all("stockownership" not in l.name for l in statement.loans)


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


def test_tax_loan_routes_to_the_zero_basis_grant():
    known = {2020: {"Purchase", "Catch-Up"}}
    assert attribute_loan(["2020 Grant"], "Tax", known)[:2] == (2020, "Catch-Up")
    assert attribute_loan(["2020 Grant"], "Interest", known)[:2] == (2020, "Purchase")
    assert attribute_loan(["2020 Grant"], "Tax", {2020: {"Purchase"}})[:2] == (2020, "Purchase")


def test_loan_covering_two_grants_goes_to_the_bonus_side():
    known = {2020: {"Purchase", "Bonus"}}
    for descriptors in (["2020 Bonus", "2020 Grant"], ["2020 Grant", "2020 Bonus"]):
        assert attribute_loan(descriptors, "Interest", known)[:2] == (2020, "Bonus")


def test_unused_categories_are_dropped():
    rows, findings = parse_share_csv(csv_bytes())
    assert "Other" not in [r.label for r in rows]
    assert len(rows) == 9 and findings == []


@pytest.mark.parametrize("label,expected", [
    ("2020 Purchased", (2020, "Purchase")), ("2020 Catch-up", (2020, "Catch-Up")),
    ("2021 Bonus Shares", (2021, "Bonus")), ("2023 Free", (2023, "Free")),
    ("2019 SARs Conversion", (None, None)),
])
def test_row_labels_map_to_grant_types(label, expected):
    assert classify_row(label) == expected


# ============================================================
# SKELETON — structure the import must not invent
# ============================================================

def test_catch_up_rows_come_from_the_purchase_template(skeleton):
    catch_up = skeleton.template(2020, "Catch-Up")
    purchase = skeleton.template(2020, "Purchase")
    assert catch_up is not None
    assert (catch_up.vest_start, catch_up.periods) == (purchase.vest_start, purchase.periods)
    assert skeleton.template(2021, "Catch-Up") is None   # that year has no catch-up


def test_default_bonus_variant_sets_the_period_count():
    content = {**CONTENT, "bonus_schedule_variants": [
        {"grant_year": 2021, "grant_type": "Bonus", "variant_code": "C",
         "periods": 4, "label": "C", "is_default": True},
        {"grant_year": 2021, "grant_type": "Bonus", "variant_code": "A",
         "periods": 2, "label": "A", "is_default": False},
    ]}
    sk, _ = build_skeleton(content)
    assert sk.template(2021, "Bonus").periods == 4


def test_rates_are_indexed_by_kind_and_year(skeleton):
    assert skeleton.rate_for("Interest", "Purchase", 2022) == 0.025
    assert skeleton.rate_for("Tax", "Catch-Up", 2021) == 0.02
    assert skeleton.rate_for("Tax", "Bonus", 2023) == 0.04
    assert skeleton.rate_for("Interest", "Purchase", 1999) is None


# ============================================================
# DERIVING A DRAFT
# ============================================================

def test_schedule_comes_from_the_template_not_the_files(drafted):
    draft, _ = drafted
    g = grant(draft, 2021, "Purchase")
    assert g.vest_start.isoformat() == "2022-09-30"   # template, not inferred
    assert g.periods == 4
    assert g.exercise_date.isoformat() == "2021-12-31"


def test_missing_template_shifts_the_nearest_one_and_says_so(drafted):
    draft, findings = drafted
    free = grant(draft, 2023, "Free")
    assert free.vest_start.isoformat() == "2028-09-30"   # 2022 Free shifted one year
    assert free.periods == 1
    assert any(f.code == "S1" and "2023 Free" in f.subject for f in findings)


def test_shares_and_basis_come_from_the_csv(drafted):
    draft, _ = drafted
    g = grant(draft, 2021, "Purchase")
    assert g.shares == 200000
    assert g.price == 12.00


def test_catch_up_basis_is_recognised_as_accrued_at_vest(drafted):
    rows, _ = parse_share_csv(csv_bytes())
    row = next(r for r in rows if r.label == "2020 Catch-up")
    assert is_vest_taxed(row)[0] is True
    draft, _ = drafted
    assert grant(draft, 2020, "Catch-Up").price == 0.0


def test_unvested_shares_with_no_unvested_value_mean_zero_basis(drafted):
    rows, _ = parse_share_csv(csv_bytes())
    row = next(r for r in rows if r.label == "2023 Bonus Shares")
    assert is_vest_taxed(row) == (True, "shares are unvested but carry no unvested value")
    draft, _ = drafted
    assert grant(draft, 2023, "Bonus").price == 0.0


def test_loans_are_nested_under_the_grant_they_belong_to(drafted):
    draft, _ = drafted
    assert {l.loan_number for l in grant(draft, 2020, "Catch-Up").loans} == {"100003", "100004"}
    assert {l.loan_number for l in grant(draft, 2020, "Purchase").loans} == {"100001", "100002"}
    assert {l.loan_number for l in grant(draft, 2022, "Bonus").loans} == {"100008", "100009"}


def test_prices_come_from_purchase_grant_basis_dated_by_year(drafted):
    draft, _ = drafted
    assert [(p.effective_date.isoformat(), p.price) for p in draft.prices] == [
        ("2020-01-01", 10.00), ("2021-01-01", 12.00), ("2022-01-01", 15.00)]


def test_unmapped_category_is_reported_not_dropped_silently(drafted):
    _, findings = drafted
    assert any(f.code == "G1" and "SARs" in f.subject for f in findings)


def test_the_fixture_reconciles_end_to_end(drafted):
    draft, findings = drafted
    assert [f.as_dict() for f in findings if f.severity == "error"] == []
    assert is_blocked(findings) is False


# ============================================================
# CHECKS
# ============================================================

def test_a_misread_row_blocks_the_import(skeleton):
    lines = [l.replace("$500,000.00", "$500,000.99") for l in statement_lines()]
    statement, f = parse_statement_lines(lines)
    rows, _ = parse_share_csv(csv_bytes())
    draft, df = derive_draft(statement, rows, skeleton)
    findings = f + df + validate_draft(draft, statement, rows, skeleton)
    assert "C1" in codes(findings, "error")
    assert "C2" in codes(findings, "error")
    assert is_blocked(findings) is True


def test_wrong_attribution_is_an_error_but_does_not_block(skeleton):
    """The documents disagreeing is worth stopping on, but it is the user's call."""
    statement, f = parse_statement_lines(statement_lines())
    rows, _ = parse_share_csv(csv_bytes())
    for sl in statement.loans:
        sl.name = sl.name.replace("Tax Loan", "Interest Loan")
    draft, df = derive_draft(statement, rows, skeleton)
    findings = f + df + validate_draft(draft, statement, rows, skeleton)
    assert "C3" in codes(findings, "error")
    assert "C4" in codes(findings, "error")
    assert is_blocked(findings) is False


def test_share_count_disagreement_is_reported(skeleton, parsed):
    statement, rows, _ = parsed
    draft, _ = derive_draft(statement, rows, skeleton)
    grant(draft, 2021, "Purchase").shares = 42
    assert "C8" in codes(validate_draft(draft, statement, rows, skeleton), "error")


def test_a_rate_off_the_record_is_flagged(skeleton, parsed):
    statement, rows, _ = parsed
    draft, _ = derive_draft(statement, rows, skeleton)
    grant(draft, 2020, "Purchase").loans[1].interest_rate = 0.99
    assert "C9" in codes(validate_draft(draft, statement, rows, skeleton), "warning")


def test_purchase_loan_rates_are_not_checked_because_they_get_refinanced(skeleton, parsed):
    statement, rows, _ = parsed
    draft, _ = derive_draft(statement, rows, skeleton)
    purchase = next(l for l in grant(draft, 2020, "Purchase").loans
                    if l.loan_type == "Purchase")
    purchase.interest_rate = 0.99
    assert "C9" not in codes(validate_draft(draft, statement, rows, skeleton))


def test_shares_remaining_mismatch_is_reported(skeleton, parsed):
    statement, rows, _ = parsed
    rows[0].shares_remaining += 1
    draft, _ = derive_draft(statement, rows, skeleton)
    assert "C6" in codes(validate_draft(draft, statement, rows, skeleton), "warning")


def test_csv_only_raises_no_unreconcilable_loan_errors(skeleton):
    rows, _ = parse_share_csv(csv_bytes())
    draft, df = derive_draft(None, rows, skeleton)
    findings = df + validate_draft(draft, None, rows, skeleton)
    assert [f.as_dict() for f in findings if f.severity == "error"] == []


# ============================================================
# A REPAIRED DRAFT COMING BACK
# ============================================================

def test_a_repaired_draft_is_read_back(skeleton, drafted):
    draft, _ = drafted
    payload = to_wizard_payload(draft)
    payload["grants"][0]["shares"] = 123456
    back, findings = draft_from_payload(payload, skeleton)
    assert [f for f in findings if f.severity == "error"] == []
    assert back.origin == "supplied"
    assert back.grants[0].shares == 123456
    assert len(back.all_loans) == len(draft.all_loans)


def test_the_same_checks_run_on_a_repaired_draft(skeleton, parsed):
    """A check that only works on our own output is not a check."""
    statement, rows, _ = parsed
    draft, _ = derive_draft(statement, rows, skeleton)
    payload = to_wizard_payload(draft)
    payload["grants"][0]["loans"] = []          # drop a grant's loans entirely
    back, _ = draft_from_payload(payload, skeleton)
    findings = validate_draft(back, statement, rows, skeleton)
    assert "C1" in codes(findings, "error")
    assert is_blocked(findings) is True


def test_a_repaired_draft_cannot_change_the_vesting_schedule(skeleton, drafted):
    draft, _ = drafted
    payload = to_wizard_payload(draft)
    payload["grants"][0]["periods"] = 99
    payload["grants"][0]["vest_start"] = "1999-01-01"
    back, findings = draft_from_payload(payload, skeleton)
    template = skeleton.template(back.grants[0].year, back.grants[0].type)
    assert back.grants[0].periods == template.periods
    assert back.grants[0].vest_start == template.vest_start
    assert codes(findings, "warning").count("C10") == 2


def test_unreadable_json_says_what_is_wrong(skeleton):
    _, findings = draft_from_payload({"nope": 1}, skeleton)
    assert findings[0].severity == "error"
    assert "grants" in findings[0].message


def test_a_bad_grant_is_reported_without_losing_the_good_ones(skeleton, drafted):
    draft, _ = drafted
    payload = to_wizard_payload(draft)
    payload["grants"].append({"year": 2024, "type": "Purchase", "shares": "lots"})
    back, findings = draft_from_payload(payload, skeleton)
    assert len(back.grants) == len(draft.grants)
    assert "R1" in codes(findings, "error")


# ============================================================
# THE PROMPT
# ============================================================

def test_the_prompt_carries_what_an_assistant_needs(skeleton, parsed, drafted):
    statement, rows, _ = parsed
    draft, findings = drafted
    prompt = build_prompt(draft, findings, statement, skeleton,
                          "\n".join(statement_lines()), csv_bytes().decode())

    assert "Return only the JSON object." in prompt
    assert "do not change these" in prompt.lower()
    assert "2022-09-30" in prompt                       # the fixed schedule
    assert "0.025" in prompt                            # the rates on record
    assert "100008" in prompt                           # the source statement text
    assert "2021 Bonus Shares" in prompt                # the source CSV text
    assert '"loan_type": "Purchase"' in prompt          # the output contract
    assert "Subtotal" in prompt


def test_the_prompt_lists_what_actually_failed(skeleton, parsed):
    statement, rows, _ = parsed
    for sl in statement.loans:
        sl.name = sl.name.replace("Tax Loan", "Interest Loan")
    draft, df = derive_draft(statement, rows, skeleton)
    findings = df + validate_draft(draft, statement, rows, skeleton)
    prompt = build_prompt(draft, findings, statement, skeleton)
    assert "[C3]" in prompt and "[C4]" in prompt


def test_a_clean_draft_still_produces_a_usable_prompt(skeleton, drafted):
    draft, _ = drafted
    prompt = build_prompt(draft, [], None, skeleton)
    assert "no failures" in prompt


# ============================================================
# API
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


def upload_files(with_pdf=True):
    files = {"share_csv": ("shares.csv", csv_bytes(), "text/csv")}
    if with_pdf:
        files["statement_pdf"] = ("statement.pdf", make_pdf(statement_lines()),
                                  "application/pdf")
    return files


def analyze(client, **extra):
    resp = client.post("/api/epic-import/analyze", files=upload_files(), **extra)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_analyze_returns_a_draft_and_writes_nothing(client):
    register_user(client)
    body = analyze(client)
    assert body["origin"] == "parsed"
    assert body["summary"]["grants"] == 8
    assert body["summary"]["loans"] == 9
    assert body["summary"]["total_shares"] == 679000   # the SARs category is not imported
    assert client.get("/api/grants").json() == []
    assert client.get("/api/loans").json() == []


def test_analyze_always_offers_a_prompt(client):
    register_user(client)
    assert "Return only the JSON object." in analyze(client)["prompt"]


def test_analyze_requires_at_least_one_file(client):
    register_user(client)
    assert client.post("/api/epic-import/analyze", files={}).status_code == 400


def test_a_misread_statement_blocks(client):
    register_user(client)
    broken = [l.replace("$500,000.00", "$500,000.99") for l in statement_lines()]
    resp = client.post("/api/epic-import/analyze", files={
        "share_csv": ("shares.csv", csv_bytes(), "text/csv"),
        "statement_pdf": ("s.pdf", make_pdf(broken), "application/pdf"),
    })
    body = resp.json()
    assert body["blocked"] is True
    assert "C1" in [f["code"] for f in body["findings"]]
    assert "[C1]" in body["prompt"]


def test_a_repaired_draft_can_be_pasted_back(client):
    register_user(client)
    first = analyze(client)
    payload = first["wizard_payload"]
    payload["grants"][0]["shares"] = 4321
    second = analyze(client, data={"revised_json": json.dumps(payload)})
    assert second["origin"] == "supplied"
    assert second["wizard_payload"]["grants"][0]["shares"] == 4321
    assert "C8" in [f["code"] for f in second["findings"]]


def test_a_repaired_draft_can_arrive_as_a_json_file(client):
    register_user(client)
    payload = analyze(client)["wizard_payload"]
    files = upload_files()
    files["revised_draft"] = ("fixed.json", json.dumps(payload).encode(), "application/json")
    resp = client.post("/api/epic-import/analyze", files=files)
    assert resp.status_code == 200, resp.text
    assert resp.json()["origin"] == "supplied"


def test_a_repaired_draft_can_arrive_as_the_apps_own_workbook(client):
    register_user(client)
    analyze(client)
    client.post("/api/wizard/submit", json={
        **analyze(client)["wizard_payload"], "clear_existing": True,
        "generate_payoff_sales": False})
    export = client.get("/api/export/excel").content

    files = upload_files()
    files["revised_draft"] = ("filled.xlsx", export, "application/vnd.ms-excel")
    body = client.post("/api/epic-import/analyze", files=files).json()
    assert body["origin"] == "supplied"
    assert body["summary"]["grants"] == 8
    assert body["summary"]["loans"] == 9


def test_unparseable_paste_says_what_to_do(client):
    register_user(client)
    resp = client.post("/api/epic-import/analyze", files=upload_files(),
                       data={"revised_json": "Sure! Here is the JSON: {oops"})
    assert resp.status_code == 400
    assert "starting at '{'" in resp.json()["detail"]


def test_the_draft_can_be_submitted_through_the_wizard(client):
    """Acceptance goes through the wizard, so what is signed off is the position."""
    register_user(client)
    payload = analyze(client)["wizard_payload"]
    resp = client.post("/api/wizard/submit", json={
        **payload, "clear_existing": True, "generate_payoff_sales": False})
    assert resp.status_code == 201, resp.text
    assert len(client.get("/api/grants").json()) == 8
    assert len(client.get("/api/loans").json()) == 9
    assert len(client.get("/api/prices").json()) == 3


def test_analyze_requires_authentication(client):
    assert client.post("/api/epic-import/analyze", files=upload_files()).status_code == 401


# ============================================================
# DIAGNOSTICS
# ============================================================

def diff_files(client, **overrides):
    export = client.get("/api/export/excel")
    assert export.status_code == 200, export.text
    files = {"export_xlsx": ("export.xlsx", export.content,
                             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    files.update(upload_files())
    files.update(overrides)
    return files


def test_diff_finds_nothing_when_the_data_came_from_the_same_files(client):
    register_user(client)
    payload = analyze(client)["wizard_payload"]
    client.post("/api/wizard/submit", json={
        **payload, "clear_existing": True, "generate_payoff_sales": False})
    report = client.post("/api/epic-import/diff", files=diff_files(client)).json()["report"]
    assert report["differences"] == []


def test_diff_names_the_rule_behind_each_difference(client):
    register_user(client)
    payload = analyze(client)["wizard_payload"]
    client.post("/api/wizard/submit", json={
        **payload, "clear_existing": True, "generate_payoff_sales": False})
    g = next(x for x in client.get("/api/grants").json()
             if x["year"] == 2022 and x["type"] == "Purchase")
    client.put(f"/api/grants/{g['id']}", json={"shares": 999})

    report = client.post("/api/epic-import/diff", files=diff_files(client)).json()["report"]
    shares = [d for d in report["differences"] if d["field"] == "shares"]
    assert len(shares) == 1
    assert shares[0]["rule"] == "G2" and shares[0]["severity"] == "error"


def test_diff_writes_nothing(client):
    register_user(client)
    payload = analyze(client)["wizard_payload"]
    client.post("/api/wizard/submit", json={
        **payload, "clear_existing": True, "generate_payoff_sales": False})
    before = client.get("/api/grants").json()
    client.post("/api/epic-import/diff", files=diff_files(client))
    assert client.get("/api/grants").json() == before


def test_diff_markdown_download(client):
    register_user(client)
    resp = client.post("/api/epic-import/diff.md", files=diff_files(client))
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert "# Epic import reconciliation" in resp.text


def test_diff_rejects_something_that_is_not_an_export(client):
    register_user(client)
    resp = client.post("/api/epic-import/diff", files=diff_files(
        client, export_xlsx=("notes.txt", b"not a workbook", "text/plain")))
    assert resp.status_code == 400


def test_analyze_returns_the_draft_in_the_shape_the_wizard_loads(client):
    """The wizard populates itself from grants/loans/prices; the draft arrives
    in that shape so it can be reviewed there rather than as a file."""
    register_user(client)
    prefill = analyze(client)["wizard_prefill"]
    assert len(prefill["grants"]) == 8
    assert len(prefill["loans"]) == 9
    assert len(prefill["prices"]) == 3
    assert all(g["id"] < 0 for g in prefill["grants"])       # never mistaken for saved rows
    purchase = next(g for g in prefill["grants"]
                    if g["year"] == 2021 and g["type"] == "Purchase")
    assert purchase["shares"] == 200000
    assert {l["loan_number"] for l in prefill["loans"] if l["grant_year"] == 2020
            and l["grant_type"] == "Catch-Up"} == {"100003", "100004"}


# ============================================================
# REGRESSIONS FOUND BY DRIVING THE REPAIR LOOP END TO END
# ============================================================

def with_extra_column(lines):
    """Epic adds a status column, so no statement row matches any more."""
    import re as _re
    return [_re.sub(r"( \d{1,2}/\d{1,2}/\d{4})$", r"\1 Active", l)
            if _re.match(r"^\d{6} ", l) else l for l in lines]


def test_a_repaired_draft_clears_the_parse_errors_it_fixes(client):
    """A supplied draft supersedes the parse. Leaving the parse errors standing
    means a perfect repair still reads as failing and the loop never converges."""
    register_user(client)
    good = analyze(client)["wizard_payload"]

    broken = {"share_csv": ("shares.csv", csv_bytes(), "text/csv"),
              "statement_pdf": ("s.pdf", make_pdf(with_extra_column(statement_lines())),
                                "application/pdf")}
    first = client.post("/api/epic-import/analyze", files=broken).json()
    assert first["blocked"] is True
    assert "L1" in [f["code"] for f in first["findings"]]

    fixed = client.post("/api/epic-import/analyze", files=broken,
                        data={"revised_json": json.dumps(good)}).json()
    assert fixed["blocked"] is False
    assert fixed["reconciles"] is True
    assert [f for f in fixed["findings"] if f["severity"] == "error"] == []
    # The parse complaint is kept as context, not dropped and not counted.
    stale = next(f for f in fixed["findings"] if f["code"] == "L1")
    assert stale["severity"] == "info"
    assert "before your correction" in stale["message"]


def test_a_renamed_csv_column_is_an_error_not_a_silent_zero(client):
    """Without the cost basis column every grant prices at zero, which turns
    every capital gain into ordinary income. That must never pass quietly."""
    register_user(client)
    renamed = csv_bytes().replace(b"Cost Basis of Shares", b"Total Cost Basis")
    body = client.post("/api/epic-import/analyze", files={
        "share_csv": ("shares.csv", renamed, "text/csv")}).json()

    assert body["blocked"] is True
    g0 = next(f for f in body["findings"] if f["code"] == "G0")
    assert g0["severity"] == "error"
    assert "priced at zero" in g0["message"]
    assert "Total Cost Basis" in g0["message"]     # names the headers it did find
    assert body["summary"]["grants"] == 0


def test_a_missing_check_column_only_costs_us_that_check():
    rows, findings = parse_share_csv(
        csv_bytes().replace(b"Annual Interest Due", b"Yearly Interest"))
    assert rows                                     # still usable
    assert [f.code for f in findings] == ["G0"]
    assert findings[0].severity == "warning"


def test_no_grants_is_said_once_not_once_per_loan(skeleton):
    """A CSV we cannot read leaves every loan homeless; saying so 54 times buries
    the one finding that explains why."""
    statement, _ = parse_statement_lines(statement_lines())
    draft, findings = derive_draft(statement, [], skeleton)
    homeless = [f for f in findings if f.code == "L3"]
    assert len(homeless) == 1
    assert "9 loans" in homeless[0].message
