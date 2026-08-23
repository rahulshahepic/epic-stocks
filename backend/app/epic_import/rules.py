"""Derivation rules turning parsed Epic files into proposed Grants/Loans/Prices.

Every rule has an id. Each proposed field records the rule that produced it and
every cross-check records the check that failed, so a wrong number in the
reconciliation report names the rule to change.

    G1  CSV row label            -> grant year + type
    G2  Shares Granted           -> grant.shares
    G3  Cost Basis / Shares      -> grant.price, with zero-basis detection
    G4  Vest column increments   -> grant.periods
    G5  Periods already elapsed  -> grant.vest_start
    G6  Convention               -> grant.exercise_date
    G7  83b Shares               -> grant.election_83b
    G8  Not in either file       -> grant.dp_shares (left at 0 / preserved on merge)

    L1  Statement row            -> loan number, amount, rate, due date
    L2  Loan name grammar        -> loan_type, loan_year, grant descriptors
    L3  Descriptor + loan type   -> loan.grant_year, loan.grant_type
    L4  Multi-grant loan name    -> attributed to the bonus side

    P1  Purchase grant basis     -> annual share price
    P2  Convention               -> price.effective_date

Cross-checks (computed from the files alone, so a parse or attribution error is
caught before anything is written):

    C1  statement subtotal per due year == sum of parsed rows for that year
    C2  statement printed total         == sum of all parsed rows
    C3  CSV Loan Balance                == sum of loans attributed to the grant
    C4  CSV Annual Interest Due         == sum(balance * rate) of those loans
    C5  CSV Unvested Value              == (remaining - vested) * basis per share
    C6  CSV Shares Remaining            == Granted - Sold
    C7  CSV Loan Due Year               == due year of the attributed loans
"""
import re
from datetime import date
from statistics import mean

from .models import (ERROR, INFO, WARNING, Conventions, Finding, ProposedGrant,
                     ProposedLoan, ProposedPrice, Proposal, ShareRow, Statement)

# Money comparisons: statements are penny-rounded, so allow half a cent.
_CENT = 0.005

# --- G1: CSV row label -> (year, app grant type) -----------------------------
_LABEL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(\d{4})\s+purchased$", re.I), "Purchase"),
    (re.compile(r"^(\d{4})\s+catch[-\s]?up$", re.I), "Catch-Up"),
    (re.compile(r"^(\d{4})\s+bonus\s+shares$", re.I), "Bonus"),
    (re.compile(r"^(\d{4})\s+free$", re.I), "Free"),
]


def classify_row(label: str) -> tuple[int | None, str | None]:
    """Rule G1. Returns (year, grant type), or (None, None) for unmapped categories."""
    clean = re.sub(r"\s+", " ", label.strip())
    for pattern, gtype in _LABEL_RULES:
        m = pattern.match(clean)
        if m:
            return int(m.group(1)), gtype
    return None, None


# --- L2: loan name grammar ---------------------------------------------------
# "<grant>[/<grant>] - <Purchase|Interest|Tax> Loan[ - <year>]"
_LOAN_NAME = re.compile(
    r"^(?P<grants>.+?)\s*-\s*(?P<ltype>Purchase|Interest|Tax)\s+Loan"
    r"(?:\s*-\s*(?P<lyear>\d{4}))?\s*$", re.I)
_DESCRIPTOR = re.compile(r"^(?P<year>\d{4})\s+(?P<kind>Grant|Bonus|Catch[-\s]?up|Free)$", re.I)


def parse_loan_name(name: str) -> tuple[str | None, int | None, list[str]]:
    """Rule L2. Returns (loan_type, loan_year, grant descriptors)."""
    m = _LOAN_NAME.match(re.sub(r"\s+", " ", name.strip()))
    if not m:
        return None, None, []
    ltype = m.group("ltype").capitalize()
    lyear = int(m.group("lyear")) if m.group("lyear") else None
    descriptors = [d.strip() for d in m.group("grants").split("/") if d.strip()]
    return ltype, lyear, descriptors


def _descriptor_type(kind: str) -> str:
    k = kind.lower().replace(" ", "-")
    return {"grant": "Purchase", "bonus": "Bonus", "catch-up": "Catch-Up",
            "free": "Free"}.get(k, "Purchase")


def attribute_loan(descriptors: list[str], loan_type: str,
                   known: dict[int, set[str]]) -> tuple[int | None, str | None, str, bool]:
    """Rules L3/L4. Returns (grant_year, grant_type, rule_id, is_ambiguous).

    `known` maps grant year -> the grant types that exist that year, which is how
    an unqualified "2018 Grant" Tax loan gets routed to the Catch-Up grant.
    """
    parsed = []
    for d in descriptors:
        m = _DESCRIPTOR.match(d)
        if m:
            parsed.append((int(m.group("year")), _descriptor_type(m.group("kind"))))
    if not parsed:
        return None, None, "L3", True

    ambiguous = len(parsed) > 1
    if ambiguous:
        # L4: a loan covering several grants is reported against the bonus side.
        bonus = [p for p in parsed if p[1] == "Bonus"]
        year, gtype = bonus[0] if bonus else parsed[0]
        rule = "L4"
    else:
        year, gtype = parsed[0]
        rule = "L3"

    # L3: tax withholding belongs to the zero-basis grant of that year. Epic names
    # those loans after the "<year> Grant" even when the shares are the Catch-Up.
    if gtype == "Purchase" and loan_type == "Tax":
        for candidate in ("Catch-Up", "Bonus"):
            if candidate in known.get(year, set()):
                return year, candidate, rule, ambiguous
    return year, gtype, rule, ambiguous


# --- G3: cost basis per share ------------------------------------------------

def basis_per_share(row: ShareRow) -> float | None:
    if not row.shares_granted or row.cost_basis is None:
        return None
    return row.cost_basis / row.shares_granted


def is_vest_taxed(row: ShareRow) -> tuple[bool, str]:
    """Rule G3. True when the grant's basis accrues at vest rather than at grant.

    Two hard signals, either of which is conclusive:
      a) the per-share basis is not a whole number of cents — it is a blend of
         several years' share prices, not one purchase price;
      b) shares are still unvested but carry no unvested value — no basis has
         attached to them yet.
    """
    ps = basis_per_share(row)
    if ps is None or ps == 0:
        return False, ""
    if abs(ps - round(ps, 2)) > 1e-9:
        return True, "per-share basis is not a round number of cents"
    if row.vested and row.unvested_value and row.shares_remaining is not None:
        unvested_shares = row.shares_remaining - row.vested[0]
        if unvested_shares > 0 and abs(row.unvested_value[0]) < _CENT:
            return True, "shares are unvested but carry no unvested value"
    return False, ""


# --- G4/G5: vesting shape ----------------------------------------------------

def infer_schedule(row: ShareRow) -> tuple[int | None, int, list[int]]:
    """Rules G4/G5. Returns (periods, remaining vests, increments).

    The CSV gives cumulative vested shares at 16 unlabelled future checkpoints.
    Each distinct step up is one vest; the step size divided into the total gives
    the number of periods, and the periods not visible have already happened.
    """
    increments = [row.vested[i] - row.vested[i - 1]
                  for i in range(1, len(row.vested))
                  if row.vested[i] > row.vested[i - 1]]
    remaining = len(increments)
    if not increments or not row.shares_granted:
        return None, remaining, increments
    periods = max(remaining, round(row.shares_granted / mean(increments)))
    return periods, remaining, increments


# --- Proposal assembly -------------------------------------------------------

def build_grants(rows: list[ShareRow], statement_year: int,
                 conv: Conventions, proposal: Proposal) -> list[ProposedGrant]:
    grants: list[ProposedGrant] = []
    for row in rows:
        year, gtype = classify_row(row.label)
        row.year, row.grant_type = year, gtype
        if year is None:
            proposal.add("G1", WARNING, row.label,
                         f"No grant type mapping for this category — "
                         f"{row.shares_granted:,} shares skipped. Map it by hand.")
            continue

        rules = {"year": "G1", "type": "G1", "shares": "G2"}
        uncertain: list[str] = []

        # G3 — price
        ps = basis_per_share(row) or 0.0
        vest_taxed, why = is_vest_taxed(row)
        if gtype == "Catch-Up" or vest_taxed:
            price = 0.0
            if ps:
                proposal.add("G3", INFO, row.label,
                             f"Treated as taxed at vest (price 0) — {why or 'Catch-Up grant'}. "
                             f"Epic reports a basis of {ps:.4f}/share, which is the running "
                             f"total of value taxed as it vested, not a purchase price.")
        else:
            price = round(ps, 2)
        rules["price"] = "G3"

        # G4/G5 — vesting shape
        periods, remaining, _ = infer_schedule(row)
        if periods is None:
            periods = 4
            uncertain += ["periods", "vest_start"]
            proposal.add("G4", WARNING, row.label,
                         "Fully vested in the CSV, so the vesting schedule is not visible. "
                         f"Assumed {periods} periods; existing data wins on merge.")
            vest_year = year + 1
        else:
            vest_year = statement_year - (periods - remaining)
        rules["periods"] = "G4"
        rules["vest_start"] = "G5"

        grants.append(ProposedGrant(
            year=year,
            type=gtype,
            shares=row.shares_granted,
            price=price,
            vest_start=date(vest_year, conv.vest_month, conv.vest_day),
            periods=periods,
            exercise_date=date(year, conv.exercise_month, conv.exercise_day),
            dp_shares=0,
            election_83b=bool(row.shares_83b),
            source_label=row.label,
            rules={**rules, "exercise_date": "G6", "election_83b": "G7", "dp_shares": "G8"},
            uncertain=uncertain + ["exercise_date", "dp_shares"],
        ))
    return grants


def build_loans(statement: Statement, known: dict[int, set[str]],
                proposal: Proposal) -> list[ProposedLoan]:
    loans: list[ProposedLoan] = []
    for sl in statement.loans:
        ltype, lyear, descriptors = parse_loan_name(sl.name)
        sl.loan_type, sl.loan_year, sl.grant_descriptors = ltype, lyear, descriptors
        if ltype is None:
            proposal.add("L2", ERROR, sl.loan_number,
                         f"Could not read loan name {sl.name!r} — expected "
                         f"'<year> Grant - Purchase|Interest|Tax Loan[ - <year>]'.")
            continue

        gyear, gtype, rule, ambiguous = attribute_loan(descriptors, ltype, known)
        sl.grant_year, sl.grant_type = gyear, gtype
        if gyear is None:
            proposal.add("L3", ERROR, sl.loan_number,
                         f"Could not tell which grant {sl.name!r} belongs to.")
            continue
        if ambiguous:
            proposal.add("L4", INFO, sl.loan_number,
                         f"{sl.name!r} covers more than one grant; "
                         f"attributed in full to {gyear} {gtype}.")

        loans.append(ProposedLoan(
            loan_number=sl.loan_number,
            grant_year=gyear,
            grant_type=gtype,
            loan_type=ltype,
            # A purchase loan carries no year in its name; it is taken in the grant year.
            loan_year=lyear or gyear,
            amount=sl.balance,
            interest_rate=sl.interest_rate,
            due_date=sl.due_date,
            source_name=sl.name,
            rules={"loan_number": "L1", "amount": "L1", "interest_rate": "L1",
                   "due_date": "L1", "loan_type": "L2", "loan_year": "L2",
                   "grant_year": rule, "grant_type": rule},
            uncertain=["grant_type"] if ambiguous else [],
        ))
    return loans


def build_prices(grants: list[ProposedGrant], conv: Conventions,
                 proposal: Proposal) -> list[ProposedPrice]:
    """Rules P1/P2. A purchase grant's per-share basis is that year's share price."""
    by_year: dict[int, float] = {}
    for g in grants:
        if g.type == "Purchase" and g.price > 0:
            by_year[g.year] = g.price

    prices = [ProposedPrice(effective_date=date(y, conv.price_month, conv.price_day),
                            price=p, rules={"price": "P1", "effective_date": "P2"},
                            uncertain=["effective_date"])
              for y, p in sorted(by_year.items())]

    # A bonus/free grant priced off a year with no purchase grant tells us nothing
    # about that year's price; a mismatch against a year we do know is worth saying.
    for g in grants:
        if g.type in ("Bonus", "Free") and g.price > 0 and g.year in by_year:
            if abs(g.price - by_year[g.year]) > _CENT:
                proposal.add("G3", WARNING, g.source_label,
                             f"Basis {g.price:.2f}/share does not match the {g.year} share "
                             f"price {by_year[g.year]:.2f}. That is the signature of a grant "
                             f"taxed at each vest rather than at grant. The basis Epic reports "
                             f"is kept as the price — tell us if it should be 0 instead.")
    if not prices:
        proposal.add("P1", WARNING, "",
                     "No purchase grants in the CSV, so no share prices could be derived.")
    return prices


# --- Cross-checks ------------------------------------------------------------

def cross_check(statement: Statement | None, rows: list[ShareRow],
                loans: list[ProposedLoan], proposal: Proposal) -> None:
    if statement is not None:
        by_year: dict[int, float] = {}
        for sl in statement.loans:
            by_year[sl.due_date.year] = by_year.get(sl.due_date.year, 0.0) + sl.balance
        for year, printed in statement.subtotals.items():          # C1
            got = round(by_year.get(year, 0.0), 2)
            if abs(got - printed) > _CENT:
                proposal.add("C1", ERROR, str(year),
                             f"Statement subtotal for {year} is {printed:,.2f} but the rows "
                             f"parsed for that year add up to {got:,.2f} — a row was misread.")
        printed_total = statement.printed_total or statement.total_principal
        if printed_total is not None:                              # C2
            got = round(sum(sl.balance for sl in statement.loans), 2)
            if abs(got - printed_total) > _CENT:
                proposal.add("C2", ERROR, "",
                             f"Statement total is {printed_total:,.2f} but the parsed rows add "
                             f"up to {got:,.2f} — {abs(printed_total - got):,.2f} unaccounted for.")

    if not rows:
        return

    attributed: dict[tuple[int, str], list[ProposedLoan]] = {}
    for ln in loans:
        attributed.setdefault((ln.grant_year, ln.grant_type), []).append(ln)

    # C3/C4/C7 compare the CSV against the statement, so they only mean anything
    # when a statement was uploaded. With the CSV alone there is nothing to
    # reconcile against, and the absence of loans is not a disagreement.
    for row in rows:
        if row.year is None:
            continue
        mine = attributed.get((row.year, row.grant_type), [])

        if statement is not None and row.loan_balance is not None and (mine or row.loan_balance):   # C3
            got = round(sum(l.amount for l in mine), 2)
            if abs(got - row.loan_balance) > _CENT:
                proposal.add("C3", ERROR, row.label,
                             f"CSV reports a loan balance of {row.loan_balance:,.2f} but the "
                             f"statement loans attributed here add up to {got:,.2f}. The "
                             f"attribution rule (L3/L4) is picking the wrong grant.")

        if (statement is not None and row.annual_interest_due is not None
                and (mine or row.annual_interest_due)):                    # C4
            got = round(sum(l.amount * l.interest_rate for l in mine), 2)
            if abs(got - row.annual_interest_due) > 0.02:
                proposal.add("C4", ERROR, row.label,
                             f"CSV reports {row.annual_interest_due:,.2f} of annual interest but "
                             f"the attributed loans imply {got:,.2f} — a balance, a rate, or the "
                             f"attribution is wrong.")

        ps = basis_per_share(row)                                          # C5
        if ps and row.shares_remaining is not None and not is_vest_taxed(row)[0]:
            for i, uv in enumerate(row.unvested_value[:len(row.vested)]):
                expected = (row.shares_remaining - row.vested[i]) * ps
                if abs(uv - expected) > 0.02:
                    proposal.add("C5", WARNING, row.label,
                                 f"Unvested value at checkpoint {i + 1} is {uv:,.2f}, expected "
                                 f"{expected:,.2f} from the vested-share counts — the vest "
                                 f"columns may not line up with the basis.")
                    break

        if row.shares_remaining is not None:                               # C6
            expected = row.shares_granted - (row.shares_sold or 0)
            if row.shares_remaining != expected:
                proposal.add("C6", WARNING, row.label,
                             f"Shares Remaining is {row.shares_remaining:,} but Granted - Sold "
                             f"is {expected:,}.")

        if row.loan_due_year and mine:                                     # C7
            years = {l.due_date.year for l in mine}
            if years != {row.loan_due_year}:
                proposal.add("C7", WARNING, row.label,
                             f"CSV says the loans are due in {row.loan_due_year} but the "
                             f"attributed loans are due in {sorted(years)}.")

        if row.shares_sold:
            proposal.add("G2", INFO, row.label,
                         f"Epic reports {row.shares_sold:,} shares sold from this grant. The CSV "
                         f"has no sale dates or prices, so no sales are created — record them on "
                         f"the Sales page if they are missing.")


def build_proposal(statement: Statement | None, rows: list[ShareRow],
                   conventions: Conventions | None = None,
                   parse_findings: list[Finding] | None = None) -> Proposal:
    """Run every rule over the parsed files. Reads no user data and writes nothing."""
    conv = conventions or Conventions()
    proposal = Proposal(statement_date=statement.statement_date if statement else None,
                        conventions=conv)
    proposal.findings.extend(parse_findings or [])

    statement_year = (proposal.statement_date or date.today()).year
    proposal.grants = build_grants(rows, statement_year, conv, proposal)

    known: dict[int, set[str]] = {}
    for g in proposal.grants:
        known.setdefault(g.year, set()).add(g.type)

    if statement is not None:
        proposal.loans = build_loans(statement, known, proposal)
    proposal.prices = build_prices(proposal.grants, conv, proposal)
    cross_check(statement, rows, proposal.loans, proposal)
    return proposal
