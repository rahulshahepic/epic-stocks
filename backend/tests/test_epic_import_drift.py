"""Format-drift and repair-loop regression suite.

Epic's file formats will change. This suite mutates the synthetic fixtures the
way a real format change would and pins two things per case:

  detection  — the drift is noticed, with the right codes, and blocks only when
               we genuinely could not read a document
  recovery   — feeding a correct draft back (what a user gets from their
               assistant) converges to a clean bill against the same mutated
               files, so the loop can actually terminate

Both halves matter. An earlier version detected every case correctly and could
still never converge, because parse complaints outlived the repair that fixed
them — detection alone would not have caught that.

Fixtures are synthetic throughout: invented round numbers, "Test Employee",
no real balances or share prices.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.epic_import import (build_prompt, derive_draft, draft_from_payload, is_blocked,
                             parse_share_csv, parse_statement_lines,
                             supersede_parse_findings, to_wizard_payload,
                             validate_draft)
from app.epic_import.models import INFO
from tests.test_epic_import import CONTENT, csv_bytes, statement_lines
from app.epic_import import build_skeleton


# ── how Epic's formats could realistically drift ────────────────────────────

def money_format(lines, csv_raw):
    """One row loses its separators, so the row regex misses it."""
    return [l.replace("$2,000,000.00", "2000000.0") if l.startswith("100007") else l
            for l in lines], csv_raw


def new_loan_type(lines, csv_raw):
    """A loan kind the name grammar has never seen."""
    return [l.replace("Tax Loan - 2023", "Fee Loan - 2023") for l in lines], csv_raw


def status_column(lines, csv_raw):
    """A column added to every statement row — nothing matches any more."""
    return [re.sub(r"( \d{1,2}/\d{1,2}/\d{4})$", r"\1 Active", l)
            if re.match(r"^\d{6} ", l) else l for l in lines], csv_raw


def truncated(lines, csv_raw):
    """Only the first pages of the statement were exported."""
    cut = next(i for i, l in enumerate(lines) if l.startswith("100007"))
    return lines[:cut], csv_raw


def renamed_basis_column(lines, csv_raw):
    """The cost basis column is renamed — silently zeroes every grant if missed."""
    return lines, csv_raw.replace(b"Cost Basis of Shares", b"Total Cost Basis")


def renamed_category(lines, csv_raw):
    """A grant category the label mapping has never seen."""
    return lines, csv_raw.replace(b"2022 Purchased,", b"2022 Restricted Purchase,")


def wider_loan_numbers(lines, csv_raw):
    """Loan numbers widen. Tolerated by design — a control case."""
    return [re.sub(r"^(\d{6}) ", r"99\1 ", l) for l in lines], csv_raw


def extra_csv_column(lines, csv_raw):
    """A column added to the CSV. Tolerated by design — a control case."""
    out = []
    for i, row in enumerate(csv_raw.decode().splitlines()):
        cols = row.split(",")
        cols.insert(4, "Grant Date" if i == 0 else "2024-01-01")
        out.append(",".join(cols))
    return lines, "\n".join(out).encode()


# case -> (mutation, codes that must fire, must it block?)
CASES = {
    "money_format":         (money_format,         {"C1", "C2", "C3", "C4"}, True),
    "new_loan_type":        (new_loan_type,        {"L2", "C1", "C3"},       True),
    "status_column":        (status_column,        {"L1", "C1", "C2"},       True),
    "truncated":            (truncated,            {"C2", "C3"},             True),
    "renamed_basis_column": (renamed_basis_column, {"G0"},                   True),
    # Losing a grant orphans the loans that belong to it, so the statement
    # stops adding up — blocking is right, not over-strict.
    "renamed_category":     (renamed_category,     {"G1", "L3", "C1", "C2"}, True),
    "wider_loan_numbers":   (wider_loan_numbers,   set(),                    False),
    "extra_csv_column":     (extra_csv_column,     set(),                    False),
}


@pytest.fixture()
def skeleton():
    sk, _ = build_skeleton(CONTENT)
    return sk


def analyse(mutation, skeleton, payload=None):
    """Mirror what POST /api/epic-import/analyze does, including the demotion of
    parse complaints once a corrected draft supersedes them."""
    lines, raw = mutation(statement_lines(), csv_bytes())
    statement, f1 = parse_statement_lines(lines)
    rows, f2 = parse_share_csv(raw)
    findings = f1 + f2

    if payload is not None:
        # The endpoint's own helper, not a copy of it — so removing the demotion
        # from the router turns this suite red.
        findings = supersede_parse_findings(findings)
        draft, f3 = draft_from_payload(payload, skeleton)
    else:
        draft, f3 = derive_draft(statement, rows, skeleton)
    findings += f3 + validate_draft(draft, statement, rows, skeleton)
    return draft, findings


def prompt_for(mutation, skeleton) -> str:
    lines, raw = mutation(statement_lines(), csv_bytes())
    statement, _ = parse_statement_lines(lines)
    draft, findings = analyse(mutation, skeleton)
    return build_prompt(draft, findings, statement, skeleton,
                        "\n".join(lines), raw.decode())


def clean_draft(skeleton):
    """What a correct answer looks like — the draft from the unmutated files."""
    statement, _ = parse_statement_lines(statement_lines())
    rows, _ = parse_share_csv(csv_bytes())
    draft, _ = derive_draft(statement, rows, skeleton)
    return to_wizard_payload(draft)


@pytest.mark.parametrize("case", sorted(CASES))
def test_drift_is_detected_with_the_right_codes(case, skeleton):
    mutation, expected, should_block = CASES[case]
    _, findings = analyse(mutation, skeleton)
    fired = {f.code for f in findings if f.severity in ("error", "warning")}

    assert expected <= fired, f"{case}: expected {sorted(expected - fired)} to fire"
    assert is_blocked(findings) is should_block


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_correct_draft_converges_against_the_drifted_files(case, skeleton):
    """The loop has to be able to end. Feeding back a correct draft must come
    back clean, whatever the parser made of the files."""
    mutation, _, _ = CASES[case]
    draft, findings = analyse(mutation, skeleton, payload=clean_draft(skeleton))

    errors = [f.as_dict() for f in findings if f.severity == "error"]
    assert errors == [], f"{case} did not converge"
    assert is_blocked(findings) is False
    assert len(draft.grants) == 8


def test_controls_need_no_repair_at_all(skeleton):
    """Widened loan numbers and an added CSV column are tolerated, not repaired."""
    for case in ("wider_loan_numbers", "extra_csv_column"):
        draft, findings = analyse(CASES[case][0], skeleton)
        assert [f.as_dict() for f in findings if f.severity == "error"] == [], case
        assert len(draft.all_loans) == 9, case


def test_losing_the_cost_basis_column_never_passes_quietly(skeleton):
    """The regression that matters most: a renamed column silently pricing every
    grant at zero turns every capital gain into ordinary income."""
    draft, findings = analyse(renamed_basis_column, skeleton)
    assert is_blocked(findings) is True
    g0 = next(f for f in findings if f.code == "G0")
    assert g0.severity == "error" and "priced at zero" in g0.message
    assert draft.grants == []


def test_a_repair_clears_the_parse_complaints_it_answers(skeleton):
    """Detection alone is not enough: if parse errors outlive the repair, a
    perfect draft still reads as failing and the loop never terminates."""
    _, before = analyse(status_column, skeleton)
    assert "L1" in {f.code for f in before if f.severity == "error"}

    _, after = analyse(status_column, skeleton, payload=clean_draft(skeleton))
    stale = [f for f in after if f.code == "L1"]
    assert stale and all(f.severity == INFO for f in stale)


@pytest.mark.parametrize("case", sorted(c for c in CASES if CASES[c][2]))
def test_the_prompt_carries_what_a_repair_needs(case, skeleton):
    """Whether an assistant can actually repair from the prompt needs a human in
    the loop, but its ingredients can be pinned: what failed, the source text to
    fix it from, the schedule it must not touch, and the output contract."""
    mutation, expected, _ = CASES[case]
    prompt = prompt_for(mutation, skeleton)

    for code in expected:
        assert f"[{code}]" in prompt, f"{case}: prompt does not mention {code}"
    assert "2022-09-30" in prompt                    # the fixed company schedule
    assert "do not change these" in prompt.lower()
    assert '"loan_type": "Purchase"' in prompt       # the output contract
    assert "Return only the JSON object." in prompt
    # The source material to repair from, whichever file the drift was in.
    assert "## Share summary CSV" in prompt
    assert "## Stock Loan Statement" in prompt


def test_the_prompt_shows_the_headers_when_a_column_was_renamed(skeleton):
    """A renamed column is only fixable if the prompt says what it is now called."""
    prompt = prompt_for(renamed_basis_column, skeleton)
    assert "Total Cost Basis" in prompt
    assert "[G0]" in prompt
