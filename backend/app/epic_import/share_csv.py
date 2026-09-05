"""Parser for Epic's share-summary CSV export.

Columns (header row, order not relied upon):
    Grant, Shares Granted, Shares Sold, Shares Remaining, 83b Shares,
    Cost Basis of Shares, Loan Balance, Loan Due Year,
    Vest {n} - Vested Shares ..., Vest {n} - Unvested Value ...,
    Annual Interest Due

The "Vest n" columns are cumulative vested share counts at successive future
checkpoints — the checkpoint dates are not in the file, which is why vest_start
comes from the company schedule rather than being read (rule S1).
"""
import csv
import io
import re

from .models import ERROR, WARNING, Finding, ShareRow

# column -> what is lost without it
_REQUIRED = {
    "shares granted": "no grant would carry a share count",
    "cost basis of shares": "every grant would be priced at zero",
}
_OPTIONAL = {
    "loan balance": "loan attribution cannot be checked against the grant",
    "annual interest due": "loan rates and balances cannot be cross-checked",
    "shares remaining": "sold shares cannot be reconciled",
    "shares sold": "shares that have left a grant cannot be told from down payments",
}

_VESTED = re.compile(r"^vest\s*(\d+)\s*-\s*vested\s*shares$", re.I)
_UNVESTED = re.compile(r"^vest\s*(\d+)\s*-\s*unvested\s*value$", re.I)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _num(v):
    v = (v or "").strip().replace(",", "").replace("$", "")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _int(v):
    n = _num(v)
    return None if n is None else int(round(n))


def parse_share_csv(raw: bytes) -> tuple[list[ShareRow], list[Finding]]:
    """Parse the CSV into ShareRows. Rows with no share count are dropped."""
    findings: list[Finding] = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        return [], [Finding("G0", ERROR, "", "CSV is empty")]
    except csv.Error:
        # A field over the module's 128 KB limit. This file arrives from an
        # anonymous caller on the trial endpoint, so the error is a finding
        # rather than an exception escaping as a 500.
        return [], [Finding("G0", ERROR, "", "CSV is not readable — a field is far too long.")]

    idx = {_norm(h): i for i, h in enumerate(header)}
    if "grant" not in idx:
        return [], [Finding("G0", ERROR, "",
                            "CSV has no 'Grant' column — is this Data for Stock Workbook, "
                            "downloaded from Shareworks?")]

    # A renamed column reads as an absent one, and an absent cost basis silently
    # prices every grant at zero — which in this app turns every capital gain
    # into ordinary income. Say so loudly rather than importing a wrong number.
    for column, consequence in _REQUIRED.items():
        if column not in idx:
            findings.append(Finding("G0", ERROR, "",
                                    f"Data for Stock Workbook has no '{column}' column, so "
                                    f"{consequence}. It may have been renamed — the columns "
                                    f"found were: {', '.join(header)}."))
    if findings:
        return [], findings
    for column, consequence in _OPTIONAL.items():
        if column not in idx:
            findings.append(Finding("G0", WARNING, "",
                                    f"No '{column}' column, so {consequence}."))

    vest_cols, unvest_cols = {}, {}
    for h, i in idx.items():
        m = _VESTED.match(h)
        if m:
            vest_cols[int(m.group(1))] = i
        m = _UNVESTED.match(h)
        if m:
            unvest_cols[int(m.group(1))] = i

    def cell(row, name):
        i = idx.get(name)
        return row[i] if i is not None and i < len(row) else ""

    rows: list[ShareRow] = []
    try:
        body = list(reader)
    except csv.Error:
        return [], [Finding("G0", ERROR, "", "CSV is not readable — a field is far too long.")]
    for row in body:
        if not row or not (row[idx["grant"]] if idx["grant"] < len(row) else "").strip():
            continue
        granted = _int(cell(row, "shares granted"))
        if not granted:
            continue  # unused grant category — Epic lists every category for every employee
        rows.append(ShareRow(
            label=row[idx["grant"]].strip(),
            shares_granted=granted,
            shares_sold=(_int(cell(row, "shares sold")) or 0) if "shares sold" in idx else None,
            shares_remaining=_int(cell(row, "shares remaining")),
            shares_83b=_int(cell(row, "83b shares")) or 0,
            cost_basis=_num(cell(row, "cost basis of shares")),
            loan_balance=_num(cell(row, "loan balance")),
            loan_due_year=_int(cell(row, "loan due year")),
            vested=[_int(row[vest_cols[n]]) or 0 for n in sorted(vest_cols)
                    if vest_cols[n] < len(row)],
            unvested_value=[_num(row[unvest_cols[n]]) or 0.0 for n in sorted(unvest_cols)
                            if unvest_cols[n] < len(row)],
            annual_interest_due=_num(cell(row, "annual interest due")),
        ))

    if not rows:
        findings.append(Finding("G0", ERROR, "", "CSV has no rows with a share count"))
    return rows, findings
