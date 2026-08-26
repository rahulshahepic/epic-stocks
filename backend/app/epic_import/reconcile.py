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
    "L4": "Multi-grant loan name -> attributed to the purchase side",
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


# Neither file carries these, so a difference is expected rather than wrong.
_NOT_IN_THE_FILES = {"dp_shares"}

# A money field read straight off a statement row is Epic's own figure. When it
# sits this close to the user's, the two are the same number written differently
# — Epic's balance to the penny against a hand-entered round original — not the
# rules misreading the row. Anything a rule could get wrong (the wrong row, the
# wrong grant) is out by far more than a hundredth of a percent.
_ROUNDING = 1e-4


def _rounding_apart(a: float, b: float) -> bool:
    scale = max(abs(a), abs(b))
    return scale > 0 and abs(a - b) / scale <= _ROUNDING


def _severity(field_name: str) -> str:
    if field_name in _NOT_IN_THE_FILES:
        return "info"
    if field_name in _MATERIAL:
        return "error"
    return "warning"


def _compare(entity: str, key: str, mine: dict, theirs: dict,
             notes: dict[str, str] | None = None) -> list[Difference]:
    notes = notes or {}
    return [Difference(entity, key, f, _fmt(mine[f]), _fmt(theirs.get(f)),
                       _FIELD_RULE.get(f, "?"), _severity(f), notes.get(f, ""))
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
        notes = {"dp_shares": "Down-payment shares are on neither file, so the draft "
                              "shows 0 — accepting an import keeps the number you "
                              "already have rather than writing this one."}
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
        }, notes)
    for (year, gtype), _ in existing_grants.items():
        diffs.append(Difference("grant", f"{year} {gtype}", "", "—", "present", "G1",
                                "error", "In your data but the import did not produce it."))

    # Loan numbers are not a reliable key. Data entered through the wizard carries
    # generated numbers ("wiz-2018-I2020") rather than Epic's, so matching on the
    # number alone reports every loan as both missing and extra. Fall back to the
    # grant/type/year tuple, which both sides always have.
    def tuple_of(gy, gt, lt, ly) -> tuple:
        return (int(gy), str(gt).strip(), str(lt).strip(), int(ly))

    # A loan another loan refinances is a historical link in a chain; the
    # statement only ever shows the current one.
    superseded = {str(l.get("refinances_loan_number") or "").strip()
                  for l in loans} - {""}

    unmatched = list(loans)
    # Epic's loan number replacing a wizard placeholder is what an import is for,
    # not a disagreement. Collected here and reported as one line.
    renumbered: list[tuple[str, str]] = []

    def pick(candidates, amount):
        """Prefer the current loan in a refinance chain, then the closest amount."""
        tips = [i for i in candidates
                if str(unmatched[i].get("loan_number") or "").strip() not in superseded]
        pool = tips or candidates
        return min(pool, key=lambda i: abs(float(unmatched[i]["amount"]) - amount))

    def take(dl, dg):
        """Returns (existing loan, how it was matched)."""
        num = dl.loan_number.strip()
        for i, el in enumerate(unmatched):
            if num and str(el.get("loan_number") or "").strip() == num:
                return unmatched.pop(i), "number"

        # A refinanced purchase loan keeps the grant year in its name but is
        # recorded under the year it was refinanced, so the loan year cannot be
        # part of the match — and the original must not win over the loan that is
        # actually outstanding, which is what the statement shows.
        if dl.loan_type == "Purchase":
            chain = [i for i, el in enumerate(unmatched)
                     if int(el["grant_year"]) == dg.year
                     and str(el["grant_type"]).strip() == dg.type
                     and str(el["loan_type"]).strip() == "Purchase"]
            if chain:
                return unmatched.pop(pick(chain, dl.amount)), "chain"

        want = tuple_of(dg.year, dg.type, dl.loan_type, dl.loan_year)
        exact = [i for i, el in enumerate(unmatched)
                 if tuple_of(el["grant_year"], el["grant_type"],
                             el["loan_type"], el["loan_year"]) == want]
        if exact:
            return unmatched.pop(pick(exact, dl.amount)), "tuple"

        # Same loan, filed against a different grant. Epic attributes a loan that
        # covers two grants to the bonus side; a user may have filed it under the
        # purchase grant. Match it so the disagreement reads as one row, not two.
        cross = [i for i, el in enumerate(unmatched)
                 if int(el["grant_year"]) == dg.year
                 and str(el["loan_type"]).strip() == dl.loan_type
                 and int(el["loan_year"]) == dl.loan_year]
        if cross:
            return unmatched.pop(pick(cross, dl.amount)), "cross-grant"
        return None, None

    for dg, dl in draft.all_loans:
        el, how = take(dl, dg)
        key = dl.loan_number or f"{dg.year} {dg.type} {dl.loan_type}"
        if el is None:
            # The row is on the statement verbatim, so the import did not invent
            # it: either the user's data predates it or it belongs to a grant
            # they have not entered. Worth acting on, but not a rule misfiring.
            diffs.append(Difference("loan", key, "", f"{dl.amount:,.2f}", "—", "L1",
                                    "warning",
                                    "Epic lists this loan and your data has no match for "
                                    "it — importing would add it."))
            continue
        if how != "number":
            renumbered.append((key, str(el.get("loan_number") or "").strip() or "—"))
        for d in _compare("loan", key, {
            "amount": dl.amount, "interest_rate": dl.interest_rate,
            "due_date": dl.due_date, "grant_year": dg.year, "grant_type": dg.type,
            "loan_type": dl.loan_type, "loan_year": dl.loan_year,
        }, {
            "amount": float(el["amount"]), "interest_rate": float(el["interest_rate"]),
            "due_date": _d(el["due_date"]), "grant_year": int(el["grant_year"]),
            "grant_type": str(el["grant_type"]).strip(),
            "loan_type": str(el["loan_type"]).strip(), "loan_year": int(el["loan_year"]),
        }):
            if d.field == "amount" and _rounding_apart(dl.amount, float(el["amount"])):
                d.severity = "info"
                d.note = ("Epic's is the principal outstanding to the penny; yours is "
                          "the same loan rounded. Importing takes Epic's.")
            elif d.field == "grant_type" and how == "cross-grant":
                d.note = ("Epic files this loan against a different grant than you "
                          "do. The workbook's per-grant Loan Balance settles it: with "
                          "C3 and C4 clear above, Epic's filing is the one that "
                          "reconciles and yours is the one to change.")
            elif d.field == "loan_year" and not dl.year_on_statement:
                d.severity = "info"
                d.note = ("The statement names this loan without a year, so the import "
                          "falls back to the grant year — nothing in the files says "
                          "which year the outstanding loan dates from.")
            diffs.append(d)

    # Loans are drawn each year, so the newest year the statement carries is as
    # far as it reaches. A loan of the user's dated after that is one they have
    # projected forward, the same way they project share prices.
    reach = max((dl.loan_year for _, dl in draft.all_loans), default=None)
    for el in unmatched:
        num = str(el.get("loan_number") or "").strip()
        key = num or f"{el['grant_year']} {el['grant_type']} {el['loan_type']}"
        amount = f"{float(el['amount']):,.2f}"
        if num in superseded:
            diffs.append(Difference("loan", key, "", "—", amount, "L5", "info",
                                    "An earlier loan in a refinance chain — the statement "
                                    "only lists the loan currently outstanding."))
        elif reach is not None and int(el["loan_year"]) > reach:
            # Past what this statement can speak to. Whether that is the user
            # projecting forward or a loan drawn since the statement was issued
            # is not something the files can settle — but Epic's own numbers are
            # all digits, so one of those means Epic issued it, while a wizard
            # placeholder or no number at all means the user entered it.
            origin = ("carries an Epic loan number, so it likely comes off a newer "
                      "statement than the one uploaded"
                      if num.isdigit() else
                      "carries no Epic loan number, so it is one of your own — a "
                      "projection, or entered by hand")
            diffs.append(Difference("loan", key, "", "—", amount, "L5", "info",
                                    f"Dated {el['loan_year']}, past the {reach} loans this "
                                    f"statement reaches. It {origin}. Either way this "
                                    f"statement cannot confirm it and an import leaves "
                                    f"it alone."))
        else:
            diffs.append(Difference("loan", key, "", "—", amount, "L5", "warning",
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
    # Prices are derived from purchase grants, so the import only ever produces
    # them for years a grant exists in. Anything later is a projection the user
    # entered themselves — reporting it as a disagreement is a category error.
    latest = max((p.effective_date.year for p in draft.prices), default=None)
    for year, ep in sorted(existing_prices.items()):
        if latest is not None and year > latest:
            diffs.append(Difference("price", str(year), "", "—",
                                    f"{float(ep['price']):,.2f}", "P1", "info",
                                    "Later than any purchase grant — a projection of "
                                    "your own, which an import does not replace."))
        else:
            diffs.append(Difference("price", str(year), "", "—",
                                    f"{float(ep['price']):,.2f}", "P1", "warning",
                                    "In your prices but no purchase grant implies it."))

    if renumbered:
        diffs.append(Difference(
            "loan", "—", "loan_number", f"{len(renumbered)} Epic numbers", "placeholders",
            "L1", "info",
            f"{len(renumbered)} of your loans matched on grant, type and year rather than "
            f"on number, and would take Epic's own number in place of a wizard "
            f"placeholder. That is the import doing its job, not a disagreement."))

    report.counts = {
        "renumbered_loans": len(renumbered),
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
