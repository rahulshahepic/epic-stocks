from datetime import date

from app.epic_import.evidence import reconciliation_evidence
from app.epic_import.models import Finding, Statement


TODAY = date(2026, 11, 24)


def test_missing_files_never_claim_a_match():
    evidence = reconciliation_evidence(None, [], [], TODAY)
    assert [e['status'] for e in evidence] == ['not_available', 'not_available', 'estimated', 'not_available']


def test_loan_rows_without_a_printed_total_are_not_verified():
    statement = Statement(TODAY, None, None)
    assert reconciliation_evidence(statement, [], [], TODAY)[1]['status'] == 'not_available'


def test_zero_printed_balance_is_valid_evidence():
    statement = Statement(TODAY, None, 0.0, printed_total=0.0)
    assert reconciliation_evidence(statement, [], [], TODAY)[1]['status'] == 'matched'


def test_stale_cutoff_and_mismatch_are_distinct():
    statement = Statement(date(2024, 2, 1), None, 1000.0)
    stale = reconciliation_evidence(statement, [], [], TODAY)[1]
    assert stale['status'] == 'stale'
    assert '2024-02-01' in stale['detail']
    mismatch = reconciliation_evidence(statement, [], [Finding('C2', 'error', '', 'Mismatch')], TODAY)[1]
    assert mismatch['status'] == 'mismatch'
    assert mismatch['rule_ids'] == ['C2']


def test_interest_charges_are_never_called_verified_accrual():
    statement = Statement(TODAY, None, 1000.0)
    evidence = reconciliation_evidence(statement, [], [], TODAY)
    assert evidence[3]['status'] == 'not_available'
    assert 'interest-to-date' in evidence[3]['detail']


def test_skipped_unknown_share_category_is_never_a_match():
    # A nonempty parsed workbook can still contain an unrecognized grant label.
    evidence = reconciliation_evidence(None, [object()], [Finding('G1', 'warning', '', 'Unknown category')], TODAY)
    assert evidence[0]['status'] == 'mismatch'
