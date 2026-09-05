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


class _Unreadable(ValueError):
    """A matched row carried a figure that is not a figure. Reported, never raised out."""


def _money(s: str) -> float:
    """'$1,234.56' -> 1234.56;  '($5.00)' -> -5.00

    The row grammar admits shapes float() will not take ("1.2.3"), and this
    text comes out of a file an anonymous caller uploaded, so a bad figure is
    a finding rather than an exception escaping as a 500.
    """
    neg = s.strip().startswith("(") or s.strip().startswith("-")
    try:
        v = float(re.sub(r"[^\d.]", "", s))
    except ValueError as exc:
        raise _Unreadable(f"{s!r} is not an amount") from exc
    return -v if neg else v


def _rate(s: str) -> float:
    try:
        return float(s) / 100.0
    except ValueError as exc:
        raise _Unreadable(f"{s!r} is not an interest rate") from exc


def _us_date(s: str) -> date:
    """'7/15/2027' -> date. Raises _Unreadable on 13/40/2027 and friends."""
    try:
        m, d, y = (int(p) for p in s.split("/"))
        return date(y, m, d)
    except ValueError as exc:
        raise _Unreadable(f"{s!r} is not a date") from exc


def _long_date(s: str) -> date | None:
    """'March 3, 2027' -> date. None for anything that is not one.

    "February 30, 2027" and "March 3, 0000" both satisfy the pattern and both
    make date() raise, so the construction is guarded rather than the shape.
    """
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", s.strip())
    if not m or m.group(1).lower() not in _MONTHS:
        return None
    try:
        return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
    except ValueError:
        return None


class StatementUnreadable(ValueError):
    """The upload is not a PDF this server will spend more time on."""


# A Stock Loan Statement is a few pages. Text extraction is the most expensive
# thing an anonymous caller can ask this server to do (POST /api/trial/analyze
# takes no session), and pdfminer's cost is per page and unbounded by file
# size — a 5 MB upload can declare thousands of them. Stop well past any real
# statement and far short of anything worth doing on purpose.
MAX_PDF_PAGES = 64
# Lines are the other axis: one crafted page can carry an enormous text layer.
MAX_STATEMENT_LINES = 20_000


def extract_lines(pdf_bytes: bytes) -> list[str]:
    """Pull ordered text lines out of the PDF, one visual row per line.

    Raises StatementUnreadable for a file that is not a readable PDF or is
    larger than this parser will take on; RuntimeError only when pdfplumber
    itself is missing.
    """
    try:
        import pdfplumber
    except ImportError as e:  # pragma: no cover - dependency is in requirements.txt
        raise RuntimeError("pdfplumber is required to read loan statement PDFs") from e

    import io
    lines: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if len(pdf.pages) > MAX_PDF_PAGES:
                raise StatementUnreadable(
                    f"That PDF has more than {MAX_PDF_PAGES} pages — a Stock Loan "
                    f"Statement is a few. Upload just the statement."
                )
            for page in pdf.pages:
                lines.extend((page.extract_text() or "").split("\n"))
                if len(lines) > MAX_STATEMENT_LINES:
                    raise StatementUnreadable(
                        "That PDF holds far more text than a Stock Loan Statement."
                    )
    except StatementUnreadable:
        raise
    except RecursionError as exc:
        # Deeply nested objects in a crafted PDF. Not something to retry.
        raise StatementUnreadable("That PDF could not be read.") from exc
    except Exception as exc:
        # pdfminer raises its own family of errors on a malformed file, and
        # anything that reaches here is the upload's fault, not the server's.
        raise StatementUnreadable("That PDF could not be read.") from exc
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
            try:
                loan = StatementLoan(
                    loan_number=num,
                    name=m.group("name").strip(),
                    balance=_money(m.group("bal")),
                    interest_rate=_rate(m.group("rate")),
                    interest_to_date=_money(m.group("interest")),
                    due_date=_us_date(m.group("due")),
                )
            except _Unreadable as exc:
                findings.append(Finding("L1", WARNING, num,
                                        f"Row skipped — {exc}."))
                continue
            if num in seen_numbers:
                findings.append(Finding("L1", WARNING, num,
                                        "Loan number appears more than once on the statement"))
            seen_numbers.add(num)
            st.loans.append(loan)
            continue

        m = _SUBTOTAL.match(s)
        if m:
            try:
                st.subtotals[int(m.group("year"))] = _money(m.group("amt"))
            except _Unreadable as exc:
                findings.append(Finding("L1", WARNING, m.group("year"),
                                        f"Subtotal skipped — {exc}."))
            continue

        m = _TOTAL_PRINCIPAL.match(s)
        if m:
            try:
                st.total_principal = _money(m.group("amt"))
            except _Unreadable as exc:
                findings.append(Finding("L1", WARNING, "",
                                        f"Total principal skipped — {exc}."))
            continue

        m = _TOTAL.match(s)
        if m:
            try:
                st.printed_total = _money(m.group("amt"))
            except _Unreadable as exc:
                findings.append(Finding("L1", WARNING, "",
                                        f"Total skipped — {exc}."))
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
