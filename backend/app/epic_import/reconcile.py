"""Compare what the importer derives from Epic's files against real data.

The importer will not be right first time. This module runs the derivation
against a dataset the user exported from the app and reports every difference
with the id of the rule that produced the value, so feedback comes back as
"rule G5 is off by a year" rather than "the import is wrong".

Baseline rows are plain dicts in the shape the Excel export writes:

    grant:  year type shares price vest_start periods exercise_date dp_shares election_83b
    loan:   loan_number grant_year grant_type loan_type loan_year amount
            interest_rate due_date
    price:  effective_date price
"""
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from .models import Conventions, Proposal

# Fields whose value is the point of the import — a difference here is a real bug.
_MATERIAL = {"shares", "price", "amount", "interest_rate"}
# Fields the source files do not carry at all; a difference is expected.
_CONVENTIONAL = {"exercise_date", "dp_shares", "effective_date"}

_MONEY_TOL = 0.005
_RATE_TOL = 1e-6


@dataclass
class Difference:
    entity: str        # grant | loan | price
    key: str           # "2020 Bonus", a loan number, or a year
    field: str         # "" when the whole record is missing on one side
    imported: str
    existing: str
    rule: str
    severity: str      # error | warning | info
    note: str = ""

    def as_dict(self) -> dict:
        return {"entity": self.entity, "key": self.key, "field": self.field,
                "imported": self.imported, "existing": self.existing,
                "rule": self.rule, "severity": self.severity, "note": self.note}


@dataclass
class ReconcileReport:
    differences: list[Difference] = field(default_factory=list)
    conventions: Conventions = field(default_factory=Conventions)
    counts: dict = field(default_factory=dict)

    @property
    def errors(self) -> int:
        return sum(1 for d in self.differences if d.severity == "error")

    @property
    def warnings(self) -> int:
        return sum(1 for d in self.differences if d.severity == "warning")

    def as_dict(self) -> dict:
        return {"differences": [d.as_dict() for d in self.differences],
                "conventions": self.conventions.as_dict(),
                "counts": self.counts,
                "errors": self.errors, "warnings": self.warnings}


def _d(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return f"{v:,.4f}".rstrip("0").rstrip(".")
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _same(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return False
        tol = _RATE_TOL if max(abs(a), abs(b)) < 1 else _MONEY_TOL
        return abs(float(a) - float(b)) <= tol
    return a == b


def learn_conventions(grants: list[dict], prices: list[dict]) -> Conventions:
    """Read the date conventions out of a user's existing data.

    The source files carry no vest, exercise, or price-effective dates, so the
    importer has to assume them. If the user already has data, their own
    convention beats the SPEC default.
    """
    conv = Conventions()

    def modal(rows, key):
        pairs = [(d.month, d.day) for d in (_d(r.get(key)) for r in rows) if d]
        return Counter(pairs).most_common(1)[0][0] if pairs else None

    if (md := modal(grants, "vest_start")):
        conv.vest_month, conv.vest_day = md
    if (md := modal(grants, "exercise_date")):
        conv.exercise_month, conv.exercise_day = md
    # The first price is set at the first exercise rather than on the annual
    # announcement date, so it is not representative of the convention.
    if (md := modal(sorted(prices, key=lambda p: str(p.get("effective_date")))[1:],
                    "effective_date")):
        conv.price_month, conv.price_day = md
    return conv


def _severity(field_name: str, uncertain: list[str]) -> str:
    if field_name in _MATERIAL:
        return "error"
    if field_name in _CONVENTIONAL or field_name in uncertain:
        return "info"
    return "warning"


def _compare(entity: str, key: str, imported: dict, existing: dict,
             rules: dict, uncertain: list[str], fields: list[str]) -> list[Difference]:
    out = []
    for f in fields:
        a, b = imported.get(f), existing.get(f)
        if _same(a, b):
            continue
        out.append(Difference(entity, key, f, _fmt(a), _fmt(b),
                              rules.get(f, "?"), _severity(f, uncertain)))
    return out


_GRANT_FIELDS = ["shares", "price", "periods", "vest_start", "exercise_date",
                 "dp_shares", "election_83b"]
_LOAN_FIELDS = ["amount", "interest_rate", "due_date", "grant_year", "grant_type",
                "loan_type", "loan_year"]


def reconcile(proposal: Proposal, grants: list[dict], loans: list[dict],
              prices: list[dict]) -> ReconcileReport:
    """Diff a proposal against an existing dataset."""
    report = ReconcileReport(conventions=proposal.conventions)
    diffs = report.differences

    # -- Grants: matched on (year, type) --
    existing_grants = {(int(g["year"]), str(g["type"]).strip()): g for g in grants}
    for pg in proposal.grants:
        eg = existing_grants.pop(pg.key, None)
        key = f"{pg.year} {pg.type}"
        if eg is None:
            diffs.append(Difference("grant", key, "", "present", "—", "G1", "error",
                                    "The importer produced a grant that is not in your data."))
            continue
        diffs += _compare("grant", key, {
            "shares": pg.shares, "price": pg.price, "periods": pg.periods,
            "vest_start": pg.vest_start, "exercise_date": pg.exercise_date,
            "dp_shares": pg.dp_shares, "election_83b": pg.election_83b,
        }, {
            "shares": int(eg["shares"]), "price": float(eg["price"]),
            "periods": int(eg["periods"]), "vest_start": _d(eg["vest_start"]),
            "exercise_date": _d(eg["exercise_date"]),
            "dp_shares": int(eg.get("dp_shares") or 0),
            "election_83b": bool(eg.get("election_83b")),
        }, pg.rules, pg.uncertain, _GRANT_FIELDS)
    for key, eg in existing_grants.items():
        diffs.append(Difference("grant", f"{key[0]} {key[1]}", "", "—", "present", "G1",
                                "error", "In your data but the importer did not produce it."))

    # -- Loans: matched on loan number, falling back to the grant/type/year tuple --
    def loan_key(ln) -> str:
        num = str(ln.get("loan_number") or "").strip() if isinstance(ln, dict) else ln.loan_number
        if num:
            return f"#{num}"
        if isinstance(ln, dict):
            return f"{ln['grant_year']}|{ln['grant_type']}|{ln['loan_type']}|{ln['loan_year']}"
        return f"{ln.grant_year}|{ln.grant_type}|{ln.loan_type}|{ln.loan_year}"

    existing_loans = {loan_key(ln): ln for ln in loans}
    for pl in proposal.loans:
        el = existing_loans.pop(loan_key(pl), None)
        key = pl.loan_number or loan_key(pl)
        if el is None:
            diffs.append(Difference("loan", key, "", f"{pl.amount:,.2f}", "—", "L1", "error",
                                    f"{pl.source_name} — on the statement but not in your data."))
            continue
        diffs += _compare("loan", key, {
            "amount": pl.amount, "interest_rate": pl.interest_rate,
            "due_date": pl.due_date, "grant_year": pl.grant_year,
            "grant_type": pl.grant_type, "loan_type": pl.loan_type,
            "loan_year": pl.loan_year,
        }, {
            "amount": float(el["amount"]), "interest_rate": float(el["interest_rate"]),
            "due_date": _d(el["due_date"]), "grant_year": int(el["grant_year"]),
            "grant_type": str(el["grant_type"]).strip(),
            "loan_type": str(el["loan_type"]).strip(), "loan_year": int(el["loan_year"]),
        }, pl.rules, pl.uncertain, _LOAN_FIELDS)
    for key, el in existing_loans.items():
        diffs.append(Difference("loan", key.lstrip("#"), "", "—", f"{float(el['amount']):,.2f}",
                                "L5", "warning",
                                "In your data but not on this statement — paid off, refinanced, "
                                "or the statement predates it."))

    # -- Prices: matched on year, since the effective date is a convention --
    existing_prices: dict[int, dict] = {}
    for p in prices:
        d = _d(p["effective_date"])
        if d:
            existing_prices.setdefault(d.year, p)
    for pp in proposal.prices:
        ep = existing_prices.pop(pp.effective_date.year, None)
        key = str(pp.effective_date.year)
        if ep is None:
            diffs.append(Difference("price", key, "", f"{pp.price:,.2f}", "—", "P1", "error",
                                    "Derived from a purchase grant but absent from your prices."))
            continue
        diffs += _compare("price", key, {
            "price": pp.price, "effective_date": pp.effective_date,
        }, {
            "price": float(ep["price"]), "effective_date": _d(ep["effective_date"]),
        }, pp.rules, pp.uncertain, ["price", "effective_date"])
    for year, ep in existing_prices.items():
        diffs.append(Difference("price", str(year), "", "—", f"{float(ep['price']):,.2f}", "P1",
                                "warning", "In your prices but no purchase grant implies it."))

    report.counts = {
        "imported_grants": len(proposal.grants), "existing_grants": len(grants),
        "imported_loans": len(proposal.loans), "existing_loans": len(loans),
        "imported_prices": len(proposal.prices), "existing_prices": len(prices),
    }
    order = {"error": 0, "warning": 1, "info": 2}
    diffs.sort(key=lambda d: (order[d.severity], d.entity, d.key, d.field))
    return report


_RULE_HELP = {
    "G1": "CSV row label -> grant year and type",
    "G2": "Shares Granted -> grant.shares",
    "G3": "Cost Basis / Shares Granted -> grant.price (with zero-basis detection)",
    "G4": "Vest-column increments -> grant.periods",
    "G5": "Periods already elapsed -> grant.vest_start",
    "G6": "Convention -> grant.exercise_date",
    "G7": "83b Shares -> grant.election_83b",
    "G8": "Not present in either file -> grant.dp_shares",
    "L1": "Statement row -> loan number, amount, rate, due date",
    "L2": "Loan name grammar -> loan_type, loan_year, grant descriptors",
    "L3": "Descriptor + loan type -> grant_year, grant_type",
    "L4": "Multi-grant loan name -> attributed to the bonus side",
    "L5": "In your data but not on the statement",
    "P1": "Purchase grant basis -> annual share price",
    "P2": "Convention -> price.effective_date",
}


def render_markdown(proposal: Proposal, report: ReconcileReport,
                    statement_date: date | None) -> str:
    """A report the user can hand back verbatim as a bug report."""
    lines = ["# Epic import reconciliation", ""]
    lines.append(f"- Statement date: {statement_date or 'unknown'}")
    lines.append(f"- Differences: {report.errors} error, {report.warnings} warning, "
                 f"{len(report.differences) - report.errors - report.warnings} info")
    c = report.counts
    lines.append(f"- Grants {c.get('imported_grants')} imported vs {c.get('existing_grants')} "
                 f"existing · Loans {c.get('imported_loans')} vs {c.get('existing_loans')} · "
                 f"Prices {c.get('imported_prices')} vs {c.get('existing_prices')}")
    lines.append(f"- Date conventions used: {report.conventions.as_dict()}")
    lines.append("")

    if proposal.findings:
        lines += ["## Findings from the files themselves", "",
                  "| Severity | Code | Subject | Message |", "|---|---|---|---|"]
        for f in proposal.findings:
            lines.append(f"| {f.severity} | {f.code} | {f.subject or '—'} | {f.message} |")
        lines.append("")

    if not report.differences:
        lines += ["## Differences", "", "None — the import reproduces the data exactly."]
        return "\n".join(lines) + "\n"

    lines += ["## Differences", "",
              "| Severity | Rule | Entity | Key | Field | Imported | Yours | Note |",
              "|---|---|---|---|---|---|---|---|"]
    for d in report.differences:
        lines.append(f"| {d.severity} | {d.rule} | {d.entity} | {d.key} | {d.field or '—'} | "
                     f"{d.imported} | {d.existing} | {d.note} |")

    used = sorted({d.rule for d in report.differences} & set(_RULE_HELP))
    if used:
        lines += ["", "## Rules involved", ""]
        lines += [f"- **{r}** — {_RULE_HELP[r]}" for r in used]
    return "\n".join(lines) + "\n"
