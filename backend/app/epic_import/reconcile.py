"""Compare a draft against real data exported from the app.

The importer will not be right first time. This diffs a draft against a dataset
the user exported and reports every difference with the id of the rule behind
the value, so feedback arrives as "S1 puts vest_start a year early" rather than
"the import is wrong".

Baseline rows are plain dicts in the shape the Excel export writes:

    grant:  year type shares price vest_start periods exercise_date dp_shares
            election_83b
    loan:   loan_number grant_year grant_type loan_type loan_year amount
            interest_rate due_date
    price:  effective_date price
"""
from dataclasses import dataclass, field
from datetime import date

from .draft import Draft
from .models import Finding

# Fields the import exists to get right — a difference here is a real bug.
_MATERIAL = {"shares", "price", "amount", "interest_rate"}
# Fields no source file carries; the company schedule or the user supplies them.
_STRUCTURAL = {"vest_start", "periods", "exercise_date", "dp_shares"}

_MONEY_TOL = 0.005
_RATE_TOL = 1e-6

# Which rule produced each field, for the report.
_FIELD_RULE = {
    "shares": "G2", "price": "G3", "election_83b": "G7",
    "vest_start": "S1", "periods": "S1", "exercise_date": "S1", "dp_shares": "S1",
    "amount": "L1", "interest_rate": "L1", "due_date": "L1",
    "loan_type": "L2", "loan_year": "L2",
    "grant_year": "L3", "grant_type": "L3",
    "effective_date": "P1",
}

_RULE_HELP = {
    "G1": "CSV row label -> grant year and type",
    "G2": "Shares Granted -> grant.shares",
    "G3": "Cost Basis / Shares Granted -> grant.price (with zero-basis detection)",
    "G7": "83b Shares -> grant.election_83b",
    "S1": "Company grant template -> vest_start, periods, exercise_date",
    "L1": "Statement row -> loan number, amount, rate, due date",
    "L2": "Loan name grammar -> loan_type, loan_year",
    "L3": "Descriptor + loan type -> which grant the loan belongs to",
    "L4": "Multi-grant loan name -> attributed to the bonus side",
    "L5": "In your data but not on the statement",
    "P1": "Purchase grant basis -> annual share price",
}


@dataclass
class Difference:
    entity: str        # grant | loan | price
    key: str
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
    counts: dict = field(default_factory=dict)

    @property
    def errors(self) -> int:
        return sum(1 for d in self.differences if d.severity == "error")

    @property
    def warnings(self) -> int:
        return sum(1 for d in self.differences if d.severity == "warning")

    def as_dict(self) -> dict:
        return {"differences": [d.as_dict() for d in self.differences],
                "counts": self.counts, "errors": self.errors, "warnings": self.warnings}


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


def _severity(field_name: str) -> str:
    if field_name in _MATERIAL:
        return "error"
    if field_name in _STRUCTURAL:
        return "warning"
    return "warning"


def _compare(entity: str, key: str, mine: dict, theirs: dict) -> list[Difference]:
    return [Difference(entity, key, f, _fmt(mine[f]), _fmt(theirs.get(f)),
                       _FIELD_RULE.get(f, "?"), _severity(f))
            for f in mine if not _same(mine[f], theirs.get(f))]


def reconcile(draft: Draft, grants: list[dict], loans: list[dict],
              prices: list[dict]) -> ReconcileReport:
    report = ReconcileReport()
    diffs = report.differences

    existing_grants = {(int(g["year"]), str(g["type"]).strip()): g for g in grants}
    for dg in draft.grants:
        eg = existing_grants.pop(dg.key, None)
        key = f"{dg.year} {dg.type}"
        if eg is None:
            diffs.append(Difference("grant", key, "", "present", "—", "G1", "error",
                                    "Produced by the import but absent from your data."))
            continue
        diffs += _compare("grant", key, {
            "shares": dg.shares, "price": dg.price, "periods": dg.periods,
            "vest_start": dg.vest_start, "exercise_date": dg.exercise_date,
            "dp_shares": dg.dp_shares, "election_83b": dg.election_83b,
        }, {
            "shares": int(eg["shares"]), "price": float(eg["price"]),
            "periods": int(eg["periods"]), "vest_start": _d(eg["vest_start"]),
            "exercise_date": _d(eg["exercise_date"]),
            "dp_shares": int(eg.get("dp_shares") or 0),
            "election_83b": bool(eg.get("election_83b")),
        })
    for (year, gtype), _ in existing_grants.items():
        diffs.append(Difference("grant", f"{year} {gtype}", "", "—", "present", "G1",
                                "error", "In your data but the import did not produce it."))

    def loan_key(num, gy, gt, lt, ly) -> str:
        num = str(num or "").strip()
        return f"#{num}" if num else f"{gy}|{gt}|{lt}|{ly}"

    existing_loans = {loan_key(l.get("loan_number"), l["grant_year"], l["grant_type"],
                               l["loan_type"], l["loan_year"]): l for l in loans}
    for dg, dl in draft.all_loans:
        k = loan_key(dl.loan_number, dg.year, dg.type, dl.loan_type, dl.loan_year)
        el = existing_loans.pop(k, None)
        key = dl.loan_number or k
        if el is None:
            diffs.append(Difference("loan", key, "", f"{dl.amount:,.2f}", "—", "L1", "error",
                                    "On the statement but not in your data."))
            continue
        diffs += _compare("loan", key, {
            "amount": dl.amount, "interest_rate": dl.interest_rate,
            "due_date": dl.due_date, "grant_year": dg.year, "grant_type": dg.type,
            "loan_type": dl.loan_type, "loan_year": dl.loan_year,
        }, {
            "amount": float(el["amount"]), "interest_rate": float(el["interest_rate"]),
            "due_date": _d(el["due_date"]), "grant_year": int(el["grant_year"]),
            "grant_type": str(el["grant_type"]).strip(),
            "loan_type": str(el["loan_type"]).strip(), "loan_year": int(el["loan_year"]),
        })
    for k, el in existing_loans.items():
        diffs.append(Difference("loan", k.lstrip("#"), "", "—", f"{float(el['amount']):,.2f}",
                                "L5", "warning",
                                "In your data but not on this statement — paid off, "
                                "refinanced, or the statement predates it."))

    existing_prices: dict[int, dict] = {}
    for p in prices:
        d = _d(p["effective_date"])
        if d:
            existing_prices.setdefault(d.year, p)
    for dp in draft.prices:
        ep = existing_prices.pop(dp.effective_date.year, None)
        key = str(dp.effective_date.year)
        if ep is None:
            diffs.append(Difference("price", key, "", f"{dp.price:,.2f}", "—", "P1", "error",
                                    "Derived from a purchase grant but absent from your prices."))
            continue
        if not _same(dp.price, float(ep["price"])):
            diffs.append(Difference("price", key, "price", _fmt(dp.price),
                                    _fmt(float(ep["price"])), "P1", "error"))
    for year, ep in existing_prices.items():
        diffs.append(Difference("price", str(year), "", "—", f"{float(ep['price']):,.2f}",
                                "P1", "warning",
                                "In your prices but no purchase grant implies it."))

    report.counts = {
        "imported_grants": len(draft.grants), "existing_grants": len(grants),
        "imported_loans": len(draft.all_loans), "existing_loans": len(loans),
        "imported_prices": len(draft.prices), "existing_prices": len(prices),
    }
    order = {"error": 0, "warning": 1, "info": 2}
    diffs.sort(key=lambda d: (order[d.severity], d.entity, d.key, d.field))
    return report


def render_markdown(draft: Draft, findings: list[Finding],
                    report: ReconcileReport) -> str:
    """A report the user can hand back verbatim as a bug report."""
    lines = ["# Epic import reconciliation", "",
             f"- Statement date: {draft.statement_date or 'unknown'}",
             f"- Differences: {report.errors} error, {report.warnings} warning, "
             f"{len(report.differences) - report.errors - report.warnings} info"]
    c = report.counts
    lines.append(f"- Grants {c.get('imported_grants')} imported vs {c.get('existing_grants')} "
                 f"existing · Loans {c.get('imported_loans')} vs {c.get('existing_loans')} · "
                 f"Prices {c.get('imported_prices')} vs {c.get('existing_prices')}")
    lines.append("")

    if findings:
        lines += ["## Findings from the files themselves", "",
                  "| Severity | Code | Subject | Message |", "|---|---|---|---|"]
        lines += [f"| {f.severity} | {f.code} | {f.subject or '—'} | {f.message} |"
                  for f in findings]
        lines.append("")

    if not report.differences:
        return "\n".join(lines + ["## Differences", "",
                                  "None — the import reproduces the data exactly."]) + "\n"

    lines += ["## Differences", "",
              "| Severity | Rule | Entity | Key | Field | Imported | Yours | Note |",
              "|---|---|---|---|---|---|---|---|"]
    lines += [f"| {d.severity} | {d.rule} | {d.entity} | {d.key} | {d.field or '—'} | "
              f"{d.imported} | {d.existing} | {d.note} |" for d in report.differences]

    used = sorted({d.rule for d in report.differences} & set(_RULE_HELP))
    if used:
        lines += ["", "## Rules involved", ""]
        lines += [f"- **{r}** — {_RULE_HELP[r]}" for r in used]
    return "\n".join(lines) + "\n"
