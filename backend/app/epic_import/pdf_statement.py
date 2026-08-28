"""Parser for Epic's Stock Loan Statement PDF.

Text extraction and row parsing are separate so the row grammar can be tested
against synthetic text without generating PDFs.

Statement layout (one row per loan, grouped by due year with a subtotal):

    Loan   Loan                       Principal  Interest  Interest   Loan Due
    Number Name                       Balance    Rate      (to Date)  Date
    001468 2018 Grant - Purchase Loan $76,296.60 0.86%     $109.36    7/15/2027

Long loan names wrap onto a following line; the trailing fragment belongs to
the name, not to the next row.
"""
import re
from datetime import date

from .models import ERROR, WARNING, Finding, Statement, StatementLoan

_MONEY = r"\$?\(?-?[\d,]+\.\d{2}\)?"

_ROW = re.compile(
    rf"^(?P<num>\d{{4,10}})\s+"
    rf"(?P<name>.+?)\s+"
    rf"(?P<bal>{_MONEY})\s+"
    rf"(?P<rate>-?[\d.]+)\s*%\s+"
    rf"(?P<interest>{_MONEY})\s+"
    rf"(?P<due>\d{{1,2}}/\d{{1,2}}/\d{{4}})\s*$"
)
_SUBTOTAL = re.compile(rf"^Subtotal\s+(?P<amt>{_MONEY})\s+(?P<year>\d{{4}})\s*$", re.I)
_TOTAL = re.compile(rf"^Total\s+(?P<amt>{_MONEY})(?:\s+{_MONEY})?\s*$", re.I)
_TOTAL_PRINCIPAL = re.compile(rf"^Total Principal Balance:\s*(?P<amt>{_MONEY})\s*$", re.I)
_HEADER_DATE = re.compile(r"^Stock Loan Statement\s*-\s*(?P<d>[A-Za-z]+ \d{1,2}, \d{4})\s*$", re.I)
_ACCOUNT = re.compile(r"^(?P<acct>\d{6,12})\s*$")

# Lines that are page furniture rather than data.
_BOILERPLATE = (
    "your loan agreements", "interest (to date)", "please email",
    "loan loan principal", "number name", "principal interest",
)

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}


def _money(s: str) -> float:
    """'$1,234.56' -> 1234.56;  '($5.00)' -> -5.00"""
    neg = s.strip().startswith("(") or s.strip().startswith("-")
    v = float(re.sub(r"[^\d.]", "", s))
    return -v if neg else v


def _us_date(s: str) -> date:
    m, d, y = (int(p) for p in s.split("/"))
    return date(y, m, d)


def _long_date(s: str) -> date | None:
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", s.strip())
    if not m or m.group(1).lower() not in _MONTHS:
        return None
    return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))


def extract_lines(pdf_bytes: bytes) -> list[str]:
    """Pull ordered text lines out of the PDF, one visual row per line."""
    try:
        import pdfplumber
    except ImportError as e:  # pragma: no cover - dependency is in requirements.txt
        raise RuntimeError("pdfplumber is required to read loan statement PDFs") from e

    import io
    lines: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            lines.extend((page.extract_text() or "").split("\n"))
    return lines


def parse_statement_lines(lines: list[str]) -> tuple[Statement, list[Finding]]:
    """Turn statement text lines into a Statement. Rule L1."""
    findings: list[Finding] = []
    st = Statement(statement_date=None, account_number=None, total_principal=None)
    seen_numbers: set[str] = set()

    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        low = s.lower()

        m = _ROW.match(s)
        if m:
            num = m.group("num")
            if num in seen_numbers:
                findings.append(Finding("L1", WARNING, num,
                                        "Loan number appears more than once on the statement"))
            seen_numbers.add(num)
            st.loans.append(StatementLoan(
                loan_number=num,
                name=m.group("name").strip(),
                balance=_money(m.group("bal")),
                interest_rate=float(m.group("rate")) / 100.0,
                interest_to_date=_money(m.group("interest")),
                due_date=_us_date(m.group("due")),
            ))
            continue

        m = _SUBTOTAL.match(s)
        if m:
            st.subtotals[int(m.group("year"))] = _money(m.group("amt"))
            continue

        m = _TOTAL_PRINCIPAL.match(s)
        if m:
            st.total_principal = _money(m.group("amt"))
            continue

        m = _TOTAL.match(s)
        if m:
            st.printed_total = _money(m.group("amt"))
            continue

        m = _HEADER_DATE.match(s)
        if m:
            st.statement_date = _long_date(m.group("d"))
            continue

        if st.statement_date and not st.account_number and _ACCOUNT.match(s):
            st.account_number = s
            continue

        # A name too long for its column wraps onto the next line. Only merge when
        # the row above is visibly cut off, or the fragment is the bare year that
        # ends a loan name — merging anything else would corrupt a good name, and a
        # name left truncated fails loudly in the L2 grammar instead.
        if st.loans and len(s) <= 40 and not any(low.startswith(b) for b in _BOILERPLATE):
            tail = st.loans[-1]
            if tail.name.endswith("-") or re.fullmatch(r"\d{4}", s):
                tail.name = f"{tail.name.rstrip(' -')} - {s}".strip()

    if not st.loans:
        findings.append(Finding("L1", ERROR, "",
                                "No loan rows found — is this an Epic Stock Loan Statement?"))
    return st, findings


def parse_statement_pdf(pdf_bytes: bytes) -> tuple[Statement, list[Finding]]:
    return parse_statement_lines(extract_lines(pdf_bytes))
