"""Value types for parsing Epic's files.

What comes out of the two documents, before any interpretation. The draft an
import produces lives in draft.py; the rules that build it live in rules.py.
"""
from dataclasses import dataclass, field
from datetime import date

# Severity levels for findings, most to least serious.
ERROR = "error"
WARNING = "warning"
INFO = "info"


@dataclass
class Finding:
    """One thing the importer noticed: a failed cross-check, an assumption, a skip."""
    code: str          # rule or check id, e.g. "L3" or "C4"
    severity: str
    subject: str       # grant label, loan number, or "" for file-level
    message: str

    def as_dict(self) -> dict:
        return {"code": self.code, "severity": self.severity,
                "subject": self.subject, "message": self.message}


@dataclass
class StatementLoan:
    """One loan row from the Stock Loan Statement PDF."""
    loan_number: str
    name: str
    balance: float
    interest_rate: float       # decimal fraction, e.g. 0.0086 for 0.86%
    interest_to_date: float
    due_date: date
    # Filled in by rules.parse_loan_name (rule L2)
    loan_type: str | None = None          # Purchase | Interest | Tax
    loan_year: int | None = None
    grant_descriptors: list[str] = field(default_factory=list)
    # Filled in by rules.attribute_loan (rules L3/L4)
    grant_year: int | None = None
    grant_type: str | None = None


@dataclass
class Statement:
    """Everything parsed out of one Stock Loan Statement PDF."""
    statement_date: date | None
    account_number: str | None
    total_principal: float | None
    loans: list[StatementLoan] = field(default_factory=list)
    # due year -> subtotal printed on the statement
    subtotals: dict[int, float] = field(default_factory=dict)
    printed_total: float | None = None


@dataclass
class ShareRow:
    """One grant row from the share-summary CSV."""
    label: str                       # e.g. "2020 Bonus Shares"
    shares_granted: int | None
    shares_sold: int | None
    shares_remaining: int | None
    shares_83b: int | None
    cost_basis: float | None         # total, not per share
    loan_balance: float | None
    loan_due_year: int | None
    vested: list[int]                # cumulative vested shares per checkpoint
    unvested_value: list[float]
    annual_interest_due: float | None
    # Filled in by rules.classify_row (rule G1)
    year: int | None = None
    grant_type: str | None = None

    @property
    def is_empty(self) -> bool:
        return not self.shares_granted
