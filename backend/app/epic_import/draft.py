"""The draft an import produces, and the checks that decide whether to trust it.

A draft is wizard-shaped: grants with their loans nested, plus a price per year.
It can come from two places — derived from the files by `derive_draft`, or handed
back by the user after an assistant repaired it (`draft_from_payload`). Both go
through `validate_draft`, because a check that only works on our own output is
not a check.

Structural fields (vest_start, periods, exercise_date) always come from the
skeleton, never from the files and never from a supplied payload — C10 rejects a
payload that tries to change them.
"""
from dataclasses import dataclass, field
from datetime import date

from .models import ERROR, INFO, WARNING, Finding, ShareRow, Statement
from .rules import (attribute_loan, basis_per_share, classify_row,
                    down_payment_in_stock, is_vest_taxed, parse_loan_name,
                    reconcile_down_payments)
from .skeleton import Skeleton, TemplateRow

_CENT = 0.005
_RATE_TOL = 1e-6

# The range a grant year may fall in, matching schemas.py so a draft cannot
# carry a year the wizard would refuse to save. Both parsers feed years to
# date arithmetic — shifting a company template onto the grant's year — and
# date() spans years 1 to 9999, so an unbounded year is an exception rather
# than a finding. A four-digit label ("9999 Purchased") is enough to reach it
# from an anonymous upload, and a repaired payload can send any integer at all.
MIN_GRANT_YEAR = 1900
MAX_GRANT_YEAR = 2100

# Failing these means we could not read a document correctly, so nothing
# downstream can be trusted: G0 is a column the share summary is missing, C1/C2
# are the statement not adding up to its own printed totals. Everything else is
# the two documents disagreeing, which is the user's call to override.
BLOCKING_CHECKS = {"G0", "C1", "C2"}


def _d(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


@dataclass
class DraftLoan:
    loan_number: str
    loan_type: str            # Purchase | Interest | Tax
    loan_year: int
    amount: float
    interest_rate: float
    due_date: date
    # False when the statement's name for the loan carried no year and the grant
    # year was used instead. Purchase loans are named "2018 Grant - Purchase
    # Loan" however many times they have been refinanced, so the statement
    # cannot say which year the outstanding one dates from.
    year_on_statement: bool = True

    def as_dict(self) -> dict:
        return {"loan_number": self.loan_number, "loan_type": self.loan_type,
                "loan_year": self.loan_year, "amount": round(self.amount, 2),
                "interest_rate": self.interest_rate,
                "due_date": self.due_date.isoformat()}


@dataclass
class DraftGrant:
    year: int
    type: str
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0
    election_83b: bool = False
    loans: list[DraftLoan] = field(default_factory=list)

    @property
    def key(self) -> tuple[int, str]:
        return (self.year, self.type)

    def as_dict(self) -> dict:
        return {"year": self.year, "type": self.type, "shares": self.shares,
                "price": round(self.price, 4), "vest_start": self.vest_start.isoformat(),
                "periods": self.periods, "exercise_date": self.exercise_date.isoformat(),
                "dp_shares": self.dp_shares, "election_83b": self.election_83b,
                "loans": [l.as_dict() for l in self.loans]}


@dataclass
class DraftPrice:
    effective_date: date
    price: float

    def as_dict(self) -> dict:
        return {"effective_date": self.effective_date.isoformat(),
                "price": round(self.price, 4)}


@dataclass
class Draft:
    grants: list[DraftGrant] = field(default_factory=list)
    prices: list[DraftPrice] = field(default_factory=list)
    statement_date: date | None = None
    # "parsed" when we derived it, "supplied" when it came back from an assistant
    origin: str = "parsed"

    def as_dict(self) -> dict:
        return {"grants": [g.as_dict() for g in self.grants],
                "prices": [p.as_dict() for p in self.prices],
                "statement_date": self.statement_date.isoformat() if self.statement_date else None,
                "origin": self.origin}

    @property
    def all_loans(self) -> list[tuple[DraftGrant, DraftLoan]]:
        return [(g, l) for g in self.grants for l in g.loans]


# ============================================================
# DERIVE — the deterministic path
# ============================================================

def year_in_range(year) -> bool:
    """True for a year this module will do date arithmetic on."""
    return isinstance(year, int) and MIN_GRANT_YEAR <= year <= MAX_GRANT_YEAR


def _shift_year(d: date, shift: int) -> date | None:
    """`d` moved by `shift` years, or None when that is not a real date.

    date.replace refuses 29 February in a common year and refuses to leave the
    1..9999 range, and both are reachable from a template plus a supplied year.
    """
    try:
        return d.replace(year=d.year + shift)
    except (ValueError, OverflowError):
        return None


def _schedule_for(sk: Skeleton, year: int, gtype: str,
                  findings: list[Finding]) -> TemplateRow:
    """Rule S1. The company schedule for this grant, or the nearest one shifted.

    Callers must have established that `year` is in range (`year_in_range`);
    the shifting below is date arithmetic and has nowhere sensible to go for a
    year outside it.
    """
    row = sk.template(year, gtype)
    if row is not None:
        return row
    same_type = sorted((t for t in sk.templates if t.type == gtype), key=lambda t: t.year)
    if same_type:
        near = min(same_type, key=lambda t: abs(t.year - year))
        shift = year - near.year
        vest_start = _shift_year(near.vest_start, shift)
        exercise_date = _shift_year(near.exercise_date, shift)
        if vest_start is not None and exercise_date is not None:
            findings.append(Finding("S1", WARNING, f"{year} {gtype}",
                                    f"No grant template for this year, so the {near.year} "
                                    f"{gtype} schedule was shifted by {shift} year(s). "
                                    f"An admin should add a template for {year}."))
            return TemplateRow(
                year=year, type=gtype,
                vest_start=vest_start,
                periods=near.periods,
                exercise_date=exercise_date,
            )
    findings.append(Finding("S1", ERROR, f"{year} {gtype}",
                            "No grant template exists for this grant and none can be "
                            "adapted — an admin must add one before importing."))
    return TemplateRow(year=year, type=gtype, vest_start=date(year + 1, 1, 1),
                       periods=4, exercise_date=date(year, 12, 31))


def derive_draft(statement: Statement | None, rows: list[ShareRow],
                 sk: Skeleton) -> tuple[Draft, list[Finding]]:
    """Build a draft from the files using the deterministic rules."""
    findings: list[Finding] = []
    draft = Draft(statement_date=statement.statement_date if statement else None)

    for row in rows:
        row.year, row.grant_type = classify_row(row.label)

    # A purchase grant's per-share basis is that year's share price, so work
    # those out first — they are what separates a bonus grant taxed at grant from
    # one taxed as it vests.
    price_by_year = {r.year: round(basis_per_share(r), 2) for r in rows
                     if r.grant_type == "Purchase" and basis_per_share(r)}

    for row in rows:
        year, gtype = row.year, row.grant_type
        if gtype is None:
            findings.append(Finding("G1", WARNING, row.label,
                                    f"No grant type mapping for this category — "
                                    f"{row.shares_granted:,} shares not imported."))
            continue
        if year is None:
            # A one-time award (rule G1): its label carries no year, so the
            # year comes from the company's own template for this type.
            candidate_years = sorted({t.year for t in sk.templates if t.type == gtype})
            if len(candidate_years) == 1:
                year = row.year = candidate_years[0]
                findings.append(Finding("G1", INFO, row.label,
                                        f"This category's label carries no year — a one-time "
                                        f"award — so the {year} company template for {gtype} "
                                        f"was used."))
            elif not candidate_years:
                findings.append(Finding("G1", ERROR, row.label,
                                        f"This category's label carries no year, and there is "
                                        f"no company template for {gtype} to infer one from — "
                                        f"{row.shares_granted:,} shares not imported. An admin "
                                        f"must add a template."))
                continue
            else:
                findings.append(Finding("G1", WARNING, row.label,
                                        f"This category's label carries no year, and more than "
                                        f"one company template exists for {gtype} "
                                        f"({', '.join(map(str, candidate_years))}) — cannot "
                                        f"tell which applies, so {row.shares_granted:,} shares "
                                        f"were not imported."))
                continue

        if not year_in_range(year):
            # The label grammar takes any four digits, and every schedule below
            # is date arithmetic on this year.
            findings.append(Finding("G1", WARNING, row.label,
                                    f"Grant year {year} is outside {MIN_GRANT_YEAR}–"
                                    f"{MAX_GRANT_YEAR} — {row.shares_granted:,} shares "
                                    f"not imported."))
            continue

        ps = basis_per_share(row) or 0.0
        vest_taxed, why = is_vest_taxed(row)
        # A bonus grant whose basis is not that year's share price was taxed as it
        # vested, so what Epic reports is accumulated value rather than a price
        # paid. On a fully vested grant the two are otherwise indistinguishable —
        # the year's price is the only thing that tells them apart.
        if not vest_taxed and gtype != "Purchase" and ps and year in price_by_year:
            if abs(ps - price_by_year[year]) > _CENT:
                vest_taxed = True
                why = (f"its basis of {ps:.2f}/share is not the {year} share price "
                       f"of {price_by_year[year]:.2f}")
        if gtype == "Catch-Up" or vest_taxed:
            price = 0.0
            if ps:
                findings.append(Finding("G3", INFO, row.label,
                                        f"Taxed at vest, so cost basis is 0 — {why or 'Catch-Up grant'}. "
                                        f"Epic reports {ps:.4f}/share, which is the running total "
                                        f"of value taxed as it vested, not a purchase price."))
        else:
            price = round(ps, 2)

        t = _schedule_for(sk, year, gtype, findings)
        draft.grants.append(DraftGrant(
            year=year, type=gtype, shares=row.shares_granted, price=price,
            vest_start=t.vest_start, periods=t.periods, exercise_date=t.exercise_date,
            dp_shares=0, election_83b=bool(row.shares_83b),
        ))

    known: dict[int, set[str]] = {}
    for g in draft.grants:
        known.setdefault(g.year, set()).add(g.type)
    by_key = {g.key: g for g in draft.grants}

    # With no grants reads there is nowhere for any loan to go. Say that once
    # rather than repeating it for every row on the statement.
    if statement and statement.loans and not draft.grants:
        findings.append(Finding("L3", WARNING, "",
                                f"No grants could be read from the stock workbook, so none "
                                f"of the {len(statement.loans)} loans on the statement "
                                f"could be attached to one."))
        return draft, findings

    for sl in (statement.loans if statement else []):
        ltype, lyear, descriptors = parse_loan_name(sl.name)
        if ltype is None:
            findings.append(Finding("L2", WARNING, sl.loan_number,
                                    f"Could not read loan name {sl.name!r} — expected "
                                    f"'<year> Grant - Purchase|Interest|Tax Loan[ - <year>]'."))
            continue
        gyear, gtype, rule, ambiguous = attribute_loan(descriptors, ltype, known)
        if gyear is None:
            findings.append(Finding("L3", WARNING, sl.loan_number,
                                    f"Could not tell which grant {sl.name!r} belongs to."))
            continue
        if ambiguous:
            findings.append(Finding("L4", INFO, sl.loan_number,
                                    f"{sl.name!r} covers more than one grant; attributed "
                                    f"in full to {gyear} {gtype}."))
        grant = by_key.get((gyear, gtype))
        if grant is None:
            findings.append(Finding("L3", WARNING, sl.loan_number,
                                    f"{sl.name!r} points at a {gyear} {gtype} grant that is "
                                    f"not in the stock workbook."))
            continue
        grant.loans.append(DraftLoan(
            loan_number=sl.loan_number, loan_type=ltype, loan_year=lyear or gyear,
            amount=sl.balance, interest_rate=sl.interest_rate, due_date=sl.due_date,
            year_on_statement=lyear is not None,
        ))

    _explain_shares_sold(draft, rows, sk, findings)

    # Rule P1 — a purchase grant's per-share basis is that year's share price.
    # Dated 1 January to match how the wizard keys prices by year.
    for g in sorted(draft.grants, key=lambda g: g.year):
        if g.type == "Purchase" and g.price > 0:
            draft.prices.append(DraftPrice(date(g.year, 1, 1), g.price))
    if not draft.prices:
        findings.append(Finding("P1", WARNING, "",
                                "No purchase grants with a cost basis, so no share prices "
                                "could be worked out."))
    return draft, findings


def _explain_shares_sold(draft: Draft, rows: list[ShareRow], sk: Skeleton,
                         findings: list[Finding]) -> None:
    """Rule G8. Account for the shares Epic reports gone from a grant.

    Epic reports shares handed back to cover a later purchase's down payment in
    the same "Shares Sold" column as shares actually sold. The difference
    between a grant's cost basis and its purchase loan says what the down
    payment was, and a down payment paid in stock is a whole number of shares —
    so when those add up to exactly the shares reported gone, that is where they
    went. Anything left over is reported as sold, which is all the CSV can
    support: it carries no sale dates or prices.
    """
    sold_total = sum(r.shares_sold or 0 for r in rows)
    if not sold_total:
        return

    candidates = []
    for g in draft.grants:
        if g.type != "Purchase" or g.price <= 0:
            continue
        purchase_loans = [l.amount for l in g.loans if l.loan_type == "Purchase"]
        if not purchase_loans:
            continue
        dp = down_payment_in_stock(g.year, g.type, g.shares, g.price,
                                   round(sum(purchase_loans), 2),
                                   sk.dp_min_percent, sk.dp_min_cap)
        if dp is not None:
            candidates.append(dp)

    chosen, outcome = reconcile_down_payments(candidates, sold_total)
    if outcome == "reconciled":
        by_key = {g.key: g for g in draft.grants}
        for dp in chosen:
            by_key[(dp.year, dp.grant_type)].dp_shares = -dp.shares
        detail = ", ".join(f"{dp.year} {dp.grant_type} ({dp.shares:,} shares, "
                           f"{dp.amount:,.2f})" for dp in chosen)
        findings.append(Finding("G8", INFO, "",
                                f"Epic reports {sold_total:,} shares gone from your grants. "
                                f"They account exactly for the down payments on {detail}, so "
                                f"they are recorded as share exchanges at exercise rather than "
                                f"sales. An exchange is not a taxable disposal, and no sales "
                                f"are created."))
        return

    if outcome == "ambiguous":
        findings.append(Finding("G8", WARNING, "",
                                f"Epic reports {sold_total:,} shares gone, and more than one "
                                f"combination of down payments would account for them, so none "
                                f"were applied. Set the down payment shares by hand in the "
                                f"wizard if these were exchanges rather than sales."))

    for row in rows:
        if row.shares_sold:
            findings.append(Finding("G2", INFO, row.label,
                                    f"Epic reports {row.shares_sold:,} shares sold from this grant. "
                                    f"The CSV carries no sale dates or prices, so no sales are "
                                    f"created — add them on the Sales page. If they were handed "
                                    f"back as a down payment on a later purchase, record that on "
                                    f"the grant instead."))


# ============================================================
# SUPPLIED — a draft handed back after repair
# ============================================================

def _finite_int(v) -> int:
    """int(v) that refuses NaN and infinity.

    int(float('inf')) raises OverflowError, which is not in the (KeyError,
    TypeError, ValueError) family the callers below catch, so it escaped as a
    500. This whole payload is text someone pasted in from an assistant.
    """
    f = float(v)
    if f != f or f in (float("inf"), float("-inf")):
        raise ValueError("not a finite number")
    return int(round(f))


def draft_from_payload(payload: dict, sk: Skeleton) -> tuple[Draft, list[Finding]]:
    """Read a draft returned by an assistant. Tolerant about shape, strict about types.

    Nothing in here may raise: the payload is whatever an assistant handed the
    user, pasted through unchanged, so every malformed shape has to come back
    as a finding the repair loop can show and act on.
    """
    findings: list[Finding] = []
    # Before anything reads a key off it — a JSON array has no .get, and that
    # was an exception rather than the message below.
    if not isinstance(payload, dict):
        return Draft(origin="supplied"), [Finding("R1", ERROR, "", "Expected a JSON object.")]

    draft = Draft(origin="supplied", statement_date=_d(payload.get("statement_date")))

    grants = payload.get("grants")
    if not isinstance(grants, list) or not grants:
        return draft, [Finding("R1", ERROR, "",
                               "No 'grants' array in the JSON. Paste the whole object the "
                               "assistant produced, starting at '{'.")]

    for i, raw in enumerate(grants):
        if not isinstance(raw, dict):
            findings.append(Finding("R1", ERROR, f"grants[{i}]", "Not an object."))
            continue
        try:
            year, gtype = int(raw["year"]), str(raw["type"]).strip()
            shares = _finite_int(raw["shares"])
            price = float(raw.get("price") or 0.0)
        except (KeyError, TypeError, ValueError, OverflowError) as e:
            findings.append(Finding("R1", ERROR, f"grants[{i}]",
                                    f"Missing or unreadable year/type/shares/price ({e})."))
            continue
        if shares <= 0:
            findings.append(Finding("R1", ERROR, f"{year} {gtype}", "shares must be positive."))
            continue
        if not year_in_range(year):
            findings.append(Finding("R1", ERROR, f"grants[{i}]",
                                    f"year {year} is outside {MIN_GRANT_YEAR}–"
                                    f"{MAX_GRANT_YEAR}."))
            continue

        # Structure is never taken from the payload — C10 reports any attempt.
        t = _schedule_for(sk, year, gtype, findings)
        for supplied, ours, label in ((_d(raw.get("vest_start")), t.vest_start, "vest_start"),
                                      (_d(raw.get("exercise_date")), t.exercise_date, "exercise_date")):
            if supplied is not None and supplied != ours:
                findings.append(Finding("C10", WARNING, f"{year} {gtype}",
                                        f"{label} was changed to {supplied}; the company "
                                        f"schedule says {ours} and that is what was used."))
        if raw.get("periods") is not None:
            try:
                supplied_periods = _finite_int(raw["periods"])
            except (TypeError, ValueError, OverflowError):
                findings.append(Finding("R1", WARNING, f"{year} {gtype}",
                                        f"periods {raw['periods']!r} is not a number; the "
                                        f"company schedule's {t.periods} was used."))
            else:
                if supplied_periods != t.periods:
                    findings.append(Finding("C10", WARNING, f"{year} {gtype}",
                                            f"periods was changed to {supplied_periods}; the "
                                            f"company schedule says {t.periods} and that is "
                                            f"what was used."))

        raw_loans = raw.get("loans") or []
        if not isinstance(raw_loans, list):
            findings.append(Finding("R1", ERROR, f"{year} {gtype}", "'loans' is not an array."))
            raw_loans = []
        loans: list[DraftLoan] = []
        for j, rl in enumerate(raw_loans):
            if not isinstance(rl, dict):
                findings.append(Finding("R1", ERROR, f"{year} {gtype} loans[{j}]",
                                        "Not an object."))
                continue
            try:
                loan_year = _finite_int(rl.get("loan_year") or year)
                loans.append(DraftLoan(
                    loan_number=str(rl.get("loan_number") or "").strip(),
                    loan_type=str(rl["loan_type"]).strip().capitalize(),
                    loan_year=loan_year,
                    amount=float(rl["amount"]),
                    interest_rate=float(rl["interest_rate"]),
                    due_date=_d(rl["due_date"]),
                ))
            except (KeyError, TypeError, ValueError, OverflowError) as e:
                findings.append(Finding("R1", ERROR, f"{year} {gtype} loans[{j}]",
                                        f"Unreadable loan ({e})."))
                continue
            if loans[-1].due_date is None:
                findings.append(Finding("R1", ERROR, f"{year} {gtype} loans[{j}]",
                                        "due_date is not a date."))
                loans.pop()

        try:
            dp_shares = _finite_int(raw.get("dp_shares") or 0)
        except (TypeError, ValueError, OverflowError):
            findings.append(Finding("R1", WARNING, f"{year} {gtype}",
                                    f"dp_shares {raw.get('dp_shares')!r} is not a number; "
                                    f"0 was used."))
            dp_shares = 0

        draft.grants.append(DraftGrant(
            year=year, type=gtype, shares=shares, price=price,
            vest_start=t.vest_start, periods=t.periods, exercise_date=t.exercise_date,
            dp_shares=dp_shares,
            election_83b=bool(raw.get("election_83b")), loans=loans,
        ))

    raw_prices = payload.get("prices") or []
    if not isinstance(raw_prices, list):
        findings.append(Finding("R1", WARNING, "prices", "'prices' is not an array."))
        raw_prices = []
    for i, raw in enumerate(raw_prices):
        if not isinstance(raw, dict):
            findings.append(Finding("R1", WARNING, f"prices[{i}]", "Not an object."))
            continue
        d, p = _d(raw.get("effective_date")), raw.get("price")
        if d is None or p in (None, ""):
            findings.append(Finding("R1", WARNING, f"prices[{i}]",
                                    "Skipped — needs an effective_date and a price."))
            continue
        try:
            draft.prices.append(DraftPrice(d, float(p)))
        except (TypeError, ValueError, OverflowError):
            findings.append(Finding("R1", WARNING, f"prices[{i}]", "Price is not a number."))
    return draft, findings


# ============================================================
# VALIDATE — same checks whatever produced the draft
# ============================================================

def validate_draft(draft: Draft, statement: Statement | None, rows: list[ShareRow],
                   sk: Skeleton) -> list[Finding]:
    out: list[Finding] = []
    loans = draft.all_loans

    if statement is not None:
        by_year: dict[int, float] = {}
        for _, l in loans:
            by_year[l.due_date.year] = by_year.get(l.due_date.year, 0.0) + l.amount

        if statement.subtotals:                                            # C1
            for year, printed in sorted(statement.subtotals.items()):
                got = round(by_year.get(year, 0.0), 2)
                if abs(got - printed) > _CENT:
                    out.append(Finding("C1", ERROR, str(year),
                                       f"The statement's own subtotal for {year} is "
                                       f"{printed:,.2f}, but the loans due that year add up "
                                       f"to {got:,.2f} — a difference of "
                                       f"{abs(printed - got):,.2f}."))
        printed_total = statement.printed_total or statement.total_principal
        if printed_total is not None:                                      # C2
            got = round(sum(l.amount for _, l in loans), 2)
            if abs(got - printed_total) > _CENT:
                out.append(Finding("C2", ERROR, "",
                                   f"The statement's own total is {printed_total:,.2f}, but "
                                   f"the loans add up to {got:,.2f} — a difference of "
                                   f"{abs(printed_total - got):,.2f}."))
        if not statement.subtotals and printed_total is None:
            out.append(Finding("C2", WARNING, "",
                               "The statement's subtotals and total could not be read, so "
                               "there is nothing to check the loan figures against."))

    by_key = {g.key: g for g in draft.grants}
    for row in rows:
        year, gtype = (row.year, row.grant_type) if row.year else classify_row(row.label)
        if year is None:
            continue
        grant = by_key.get((year, gtype))
        if grant is None:
            out.append(Finding("C8", ERROR, row.label,
                               f"The stock workbook lists {row.shares_granted:,} shares for "
                               f"this grant but the draft has no {year} {gtype} grant."))
            continue

        if grant.shares != row.shares_granted:                              # C8
            out.append(Finding("C8", ERROR, row.label,
                               f"Draft has {grant.shares:,} shares; the stock workbook says "
                               f"{row.shares_granted:,}."))

        if statement is not None and row.loan_balance is not None:          # C3
            got = round(sum(l.amount for l in grant.loans), 2)
            if abs(got - row.loan_balance) > _CENT:
                out.append(Finding("C3", ERROR, row.label,
                                   f"The stock workbook reports a loan balance of "
                                   f"{row.loan_balance:,.2f}; the loans on this grant add up "
                                   f"to {got:,.2f}."))
        if statement is not None and row.annual_interest_due is not None:   # C4
            got = round(sum(l.amount * l.interest_rate for l in grant.loans), 2)
            if abs(got - row.annual_interest_due) > 0.02:
                out.append(Finding("C4", ERROR, row.label,
                                   f"The stock workbook reports {row.annual_interest_due:,.2f} "
                                   f"of annual interest; the loans on this grant imply "
                                   f"{got:,.2f}."))
        if row.loan_due_year and grant.loans:                               # C7
            years = {l.due_date.year for l in grant.loans}
            if years != {row.loan_due_year}:
                out.append(Finding("C7", WARNING, row.label,
                                   f"The stock workbook says the loans are due in "
                                   f"{row.loan_due_year}; the draft has {sorted(years)}."))

        ps = basis_per_share(row)                                           # C5
        if ps and row.shares_remaining is not None and not is_vest_taxed(row)[0]:
            for i, uv in enumerate(row.unvested_value[:len(row.vested)]):
                expected = (row.shares_remaining - row.vested[i]) * ps
                if abs(uv - expected) > 0.02:
                    out.append(Finding("C5", WARNING, row.label,
                                       f"Unvested value at checkpoint {i + 1} is {uv:,.2f}, "
                                       f"but the vested-share counts imply {expected:,.2f}."))
                    break
        if row.shares_remaining is not None:                                # C6
            expected = row.shares_granted - (row.shares_sold or 0)
            if row.shares_remaining != expected:
                out.append(Finding("C6", WARNING, row.label,
                                   f"Shares Remaining is {row.shares_remaining:,} but "
                                   f"Granted - Sold is {expected:,}."))

    for grant, loan in loans:                                               # C9
        # Purchase loans get refinanced, so the rate on record is the original
        # one and no longer matches a current balance. Only interest and tax
        # loans keep the rate they were written at.
        if loan.loan_type == "Purchase":
            continue
        expected = sk.rate_for(loan.loan_type, grant.type, loan.loan_year)
        if expected is not None and abs(loan.interest_rate - expected) > _RATE_TOL:
            out.append(Finding("C9", WARNING, loan.loan_number or f"{grant.year} {grant.type}",
                               f"Rate {loan.interest_rate:.4%} does not match the "
                               f"{loan.loan_year} {loan.loan_type.lower()} rate of "
                               f"{expected:.4%} on record."))

    reported_sold = [r.shares_sold for r in rows if r.shares_sold is not None]
    sold_total = sum(reported_sold)                                         # C11
    dp_total = sum(abs(g.dp_shares) for g in draft.grants)
    if reported_sold and dp_total > sold_total:
        out.append(Finding("C11", WARNING, "",
                           f"The draft hands back {dp_total:,} shares as down payments, but "
                           f"the stock workbook reports only {sold_total:,} gone from your "
                           f"grants."))
    for g in draft.grants:                                                  # C11
        if not g.dp_shares or g.price <= 0:
            continue
        purchase_loans = [l.amount for l in g.loans if l.loan_type == "Purchase"]
        if not purchase_loans:
            continue
        gap = round(g.shares * g.price - sum(purchase_loans), 2)
        expected = round(abs(g.dp_shares) * g.price, 2)
        if abs(gap - expected) > _CENT:
            out.append(Finding("C11", WARNING, f"{g.year} {g.type}",
                               f"{abs(g.dp_shares):,} shares handed back come to "
                               f"{expected:,.2f}, but the cost basis exceeds the purchase "
                               f"loan by {gap:,.2f}."))

    for g in draft.grants:                                                  # C10
        t = sk.template(g.year, g.type)
        if t and (g.periods != t.periods or g.vest_start != t.vest_start):
            out.append(Finding("C10", WARNING, f"{g.year} {g.type}",
                               f"Vesting schedule differs from the company schedule "
                               f"({t.periods} periods from {t.vest_start})."))
    return out


def supersede_parse_findings(findings: list[Finding]) -> list[Finding]:
    """Demote complaints about reading the files once a corrected draft arrives.

    A supplied draft replaces whatever we managed to parse, so "could not read
    this row" describes history rather than an outstanding problem. Kept visible
    as context but no longer counted — otherwise a correct repair still reads as
    failing and the loop can never terminate.
    """
    return [Finding(f.code, INFO, f.subject, f"(before your correction) {f.message}")
            if f.severity != INFO else f for f in findings]


def is_blocked(findings: list[Finding]) -> bool:
    """True when we misread the documents themselves — nothing downstream is trustworthy."""
    return any(f.code in BLOCKING_CHECKS and f.severity == ERROR for f in findings)


def to_wizard_payload(draft: Draft) -> dict:
    """The shape POST /api/wizard/submit accepts."""
    return {
        "grants": [{
            "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
            "vest_start": g.vest_start.isoformat(), "periods": g.periods,
            "exercise_date": g.exercise_date.isoformat(), "dp_shares": g.dp_shares,
            "election_83b": g.election_83b,
            "loans": [{"loan_number": l.loan_number, "loan_type": l.loan_type,
                       "loan_year": l.loan_year, "amount": round(l.amount, 2),
                       "interest_rate": l.interest_rate,
                       "due_date": l.due_date.isoformat()} for l in g.loans],
        } for g in draft.grants],
        "prices": [{"effective_date": p.effective_date.isoformat(),
                    "price": p.price} for p in draft.prices],
    }
