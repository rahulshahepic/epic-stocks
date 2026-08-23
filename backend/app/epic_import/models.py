"""Value types for the Epic statement importer.

Every derived field carries the id of the rule that produced it, so a wrong
value in the reconciliation report points straight at the rule to fix.
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


@dataclass
class ProposedGrant:
    year: int
    type: str
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0
    election_83b: bool = False
    source_label: str = ""
    # field name -> rule id that produced it
    rules: dict[str, str] = field(default_factory=dict)
    # fields the importer could not pin down from the files alone
    uncertain: list[str] = field(default_factory=list)

    @property
    def key(self) -> tuple[int, str]:
        return (self.year, self.type)


@dataclass
class ProposedLoan:
    loan_number: str
    grant_year: int
    grant_type: str
    loan_type: str
    loan_year: int
    amount: float
    interest_rate: float
    due_date: date
    source_name: str = ""
    rules: dict[str, str] = field(default_factory=dict)
    uncertain: list[str] = field(default_factory=list)


@dataclass
class ProposedPrice:
    effective_date: date
    price: float
    rules: dict[str, str] = field(default_factory=dict)
    uncertain: list[str] = field(default_factory=list)


@dataclass
class Conventions:
    """Date conventions the source files do not carry.

    Defaults follow SPEC.md; reconcile.learn_conventions overrides them from a
    user's existing data so a re-run stops reporting cosmetic date differences.
    """
    vest_month: int = 3
    vest_day: int = 1
    exercise_month: int = 12
    exercise_day: int = 31
    price_month: int = 3
    price_day: int = 1

    def as_dict(self) -> dict:
        return {"vest_month": self.vest_month, "vest_day": self.vest_day,
                "exercise_month": self.exercise_month, "exercise_day": self.exercise_day,
                "price_month": self.price_month, "price_day": self.price_day}


@dataclass
class Proposal:
    """What the importer thinks the user's data should look like."""
    statement_date: date | None = None
    grants: list[ProposedGrant] = field(default_factory=list)
    loans: list[ProposedLoan] = field(default_factory=list)
    prices: list[ProposedPrice] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    conventions: Conventions = field(default_factory=Conventions)

    def add(self, code: str, severity: str, subject: str, message: str) -> None:
        self.findings.append(Finding(code, severity, subject, message))

    @property
    def has_errors(self) -> bool:
        return any(f.severity == ERROR for f in self.findings)
