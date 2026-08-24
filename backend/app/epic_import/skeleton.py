"""The structural facts an import must not invent.

Vest dates, vesting periods, exercise dates, loan rates and due dates are
company-wide: they live in the admin-managed content tables, not in the files a
user uploads. Neither the deterministic parser nor an assistant helping a user
repair a draft gets to supply them — both fill share counts, cost basis and
balances into this skeleton.

Built from the dict `content_service.load_content()` returns, so this module
stays free of database access.
"""
from dataclasses import dataclass, field
from datetime import date

from .models import Finding, WARNING


def _date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


@dataclass
class TemplateRow:
    """One (year, type) row of the company grant schedule."""
    year: int
    type: str                      # Purchase | Catch-Up | Bonus | Free
    vest_start: date
    periods: int
    exercise_date: date
    purchase_due_date: date | None = None
    tax_due_date: date | None = None
    show_dp_shares: bool = False

    @property
    def key(self) -> tuple[int, str]:
        return (self.year, self.type)


@dataclass
class Skeleton:
    templates: list[TemplateRow] = field(default_factory=list)
    # year -> rate
    interest_rates: dict[int, float] = field(default_factory=dict)
    # (grant_type, year) -> rate
    tax_rates: dict[tuple[str, int], float] = field(default_factory=dict)
    # year -> rate
    purchase_rates: dict[int, float] = field(default_factory=dict)

    def template(self, year: int, gtype: str) -> TemplateRow | None:
        return next((t for t in self.templates if t.key == (year, gtype)), None)

    def rate_for(self, loan_type: str, grant_type: str, year: int) -> float | None:
        """The rate the content tables say applies. Used to check a draft, not to fill it."""
        if loan_type == "Interest":
            return self.interest_rates.get(year)
        if loan_type == "Tax":
            return self.tax_rates.get((grant_type, year))
        if loan_type == "Purchase":
            return self.purchase_rates.get(year)
        return None

    @property
    def is_empty(self) -> bool:
        return not self.templates


def build_skeleton(content: dict) -> tuple[Skeleton, list[Finding]]:
    """Shape `load_content()` output into the structure an import fills in.

    Catch-Up grants have no template row of their own — a Purchase template
    carrying `default_catch_up` implies one on the same schedule, which is how
    the wizard generates them too.
    """
    findings: list[Finding] = []
    sk = Skeleton()

    for t in content.get("grant_templates", []):
        vest_start, exercise = _date(t.get("vest_start")), _date(t.get("exercise_date"))
        if vest_start is None or exercise is None:
            findings.append(Finding("S1", WARNING, f"{t.get('year')} {t.get('type')}",
                                    "Grant template has no usable vest or exercise date; "
                                    "skipped."))
            continue
        purchase_due = _date(t.get("default_purchase_due_date"))
        tax_due = _date(t.get("default_tax_due_date"))
        sk.templates.append(TemplateRow(
            year=int(t["year"]), type=str(t["type"]).strip(),
            vest_start=vest_start, periods=int(t["periods"]), exercise_date=exercise,
            purchase_due_date=purchase_due, tax_due_date=tax_due,
            show_dp_shares=bool(t.get("show_dp_shares")),
        ))
        if t.get("default_catch_up") and str(t["type"]).strip() == "Purchase":
            sk.templates.append(TemplateRow(
                year=int(t["year"]), type="Catch-Up",
                vest_start=vest_start, periods=int(t["periods"]), exercise_date=exercise,
                tax_due_date=tax_due or purchase_due,
            ))

    # A bonus grant with alternate schedules uses the variant marked default.
    for v in content.get("bonus_schedule_variants", []):
        if not v.get("is_default"):
            continue
        row = sk.template(int(v["grant_year"]), str(v["grant_type"]).strip())
        if row:
            row.periods = int(v["periods"])

    rates = content.get("loan_rates", {}) or {}
    for year, rate in (rates.get("interest") or {}).items():
        sk.interest_rates[int(year)] = float(rate)
    for gtype, by_year in (rates.get("tax") or {}).items():
        for year, rate in (by_year or {}).items():
            sk.tax_rates[(gtype, int(year))] = float(rate)
    for year, entry in (rates.get("purchase_original") or {}).items():
        sk.purchase_rates[int(year)] = float(entry["rate"] if isinstance(entry, dict) else entry)

    if sk.is_empty:
        findings.append(Finding("S1", WARNING, "",
                                "No grant templates are configured, so vesting schedules "
                                "cannot be filled in from the company schedule."))
    return sk, findings
