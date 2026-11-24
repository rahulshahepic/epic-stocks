"""Describe the checks we could actually perform; absence is never a match."""
from datetime import date

from .models import Finding, ShareRow, Statement


def reconciliation_evidence(statement: Statement | None, rows: list[ShareRow],
                            findings: list[Finding], today: date) -> list[dict]:
    def item(label, status, detail, rules):
        relevant = sorted({f.code for f in findings if f.code in rules})
        return {"label": label, "status": status, "detail": detail, "rule_ids": relevant}

    bad_shares = any(f.code in {"G0", "G1", "G2", "R1", "C8"}
                     and f.severity in {"error", "warning"} for f in findings)
    shares = item("Grant and share records",
                  "mismatch" if bad_shares else "matched" if rows else "not_available",
                  "Compared with the grant rows in the stock workbook. This is not a verification of today's vested holdings."
                  if rows else "No stock workbook rows were available for comparison.",
                  {"G0", "G1", "G2", "R1", "C8"})
    total = (statement.printed_total if statement.printed_total is not None
             else statement.total_principal) if statement else None
    bad_loans = any(f.code in {"C1", "C2"} and f.severity == "error" for f in findings)
    stale = bool(statement and statement.statement_date
                 and (today - statement.statement_date).days > 90)
    loan_status = ("mismatch" if bad_loans else "not_available" if total is None
                   else "stale" if stale else "estimated" if not statement.statement_date else "matched")
    cutoff = statement.statement_date.isoformat() if statement and statement.statement_date else None
    loan_detail = (f"Compared with the statement's printed principal total, as of {cutoff or 'an unknown date'}. "
                   "This does not include a verified outstanding accrued-interest balance."
                   if total is not None else "No printed principal total was available; loan rows alone do not verify a balance.")
    if stale:
        loan_detail += " The statement is over 90 days old; get the latest one before relying on this balance."
    return [shares,
            item("Loan principal", loan_status, loan_detail, {"C1", "C2", "C3"}),
            item("Vested holdings", "estimated", "Vesting starts from the company schedule. Check moved dates, past sales and share exchanges before relying on today's holdings.", {"C5", "C6", "C10", "C11", "C12"}),
            item("Accrued interest", "not_available", "The statement's interest-to-date column is not proof of outstanding uncapitalized interest at a cutoff. Add a verified interest checkpoint separately if needed.", {"C4"})]
