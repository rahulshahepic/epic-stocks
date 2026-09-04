"""Derivation rules turning parsed Epic files into proposed Grants/Loans/Prices.

Every rule has an id. Each proposed field records the rule that produced it and
every cross-check records the check that failed, so a wrong number in the
reconciliation report names the rule to change.

    G1  CSV row label            -> grant year + type
    G2  Shares Granted           -> grant.shares
    G3  Cost Basis / Shares      -> grant.price, with zero-basis detection
    G7  83b Shares               -> grant.election_83b
    G8  Cost basis - purchase loan -> grant.dp_shares (down payment paid in stock)
    S1  Company grant template   -> vest_start, periods, exercise_date (draft.py)

    L1  Statement row            -> loan number, amount, rate, due date
    L2  Loan name grammar        -> loan_type, loan_year, grant descriptors
    L3  Descriptor + loan type   -> loan.grant_year, loan.grant_type
    L4  Multi-grant loan name    -> attributed to the bonus side

    P1  Purchase grant basis     -> annual share price

The checks that decide whether a draft can be trusted (C1-C10) live in draft.py,
because they must work on a draft from any source, not only on our own output.
"""
import re
from dataclasses import dataclass
from itertools import combinations

from .models import ShareRow

# Money comparisons: statements are penny-rounded, so allow half a cent.
_CENT = 0.005

# --- G1: CSV row label -> (year, app grant type) -----------------------------
_LABEL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(\d{4})\s+purchased$", re.I), "Purchase"),
    (re.compile(r"^(\d{4})\s+catch[-\s]?up$", re.I), "Catch-Up"),
    # Ahead of the plain bonus rule: "2020 Developer Bonus Shares" is its own grant.
    (re.compile(r"^(\d{4})\s+developer\s+bonus\s+shares$", re.I), "Developer Bonus Shares"),
    (re.compile(r"^(\d{4})\s+bonus\s+shares$", re.I), "Bonus"),
    (re.compile(r"^(\d{4})\s+free$", re.I), "Free"),
]

# Grant types Epic reports without a year anywhere in the label: one-time
# awards (a new-hire bonus, granted once) rather than an annual program. There
# is no year to parse out of the CSV, so derive_draft resolves it from the
# company's own template for the type instead — there can only be one.
_YEARLESS_LABEL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^developer\s+bonus\s+shares$", re.I), "Developer Bonus Shares"),
]


def classify_row(label: str) -> tuple[int | None, str | None]:
    """Rule G1. Returns (year, grant type).

    Year is None with a type set for a one-time award reported with no year in
    its label (see _YEARLESS_LABEL_RULES) — the caller resolves the year from
    the company template. Both None means the category is not recognized at all.
    """
    clean = re.sub(r"\s+", " ", label.strip())
    for pattern, gtype in _LABEL_RULES:
        m = pattern.match(clean)
        if m:
            return int(m.group(1)), gtype
    for pattern, gtype in _YEARLESS_LABEL_RULES:
        if pattern.match(clean):
            return None, gtype
    return None, None


# --- L2: loan name grammar ---------------------------------------------------
# "<grant>[/<grant>] - <Purchase|Interest|Tax> Loan[ - <year>]"
_LOAN_NAME = re.compile(
    r"^(?P<grants>.+?)\s*-\s*(?P<ltype>Purchase|Interest|Tax)\s+Loan"
    r"(?:\s*-\s*(?P<lyear>\d{4}))?\s*$", re.I)
_DESCRIPTOR = re.compile(
    r"^(?P<year>\d{4})\s+(?P<kind>Developer\s+Bonus|Grant|Bonus|Catch[-\s]?up|Free)$", re.I)


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
    k = re.sub(r"\s+", "-", kind.lower().strip())
    return {"grant": "Purchase", "bonus": "Bonus", "catch-up": "Catch-Up",
            "free": "Free", "developer-bonus": "Developer Bonus Shares"}.get(k, "Purchase")


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
        bonus = [p for p in parsed if p[1] in ("Bonus", "Developer Bonus Shares")]
        year, gtype = bonus[0] if bonus else parsed[0]
        rule = "L4"
    else:
        year, gtype = parsed[0]
        rule = "L3"

    # L3: tax withholding belongs to the zero-basis grant of that year. Epic names
    # those loans after the "<year> Grant" even when the shares are the Catch-Up.
    if gtype == "Purchase" and loan_type == "Tax":
        for candidate in ("Catch-Up", "Bonus", "Developer Bonus Shares"):
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


# --- G8: cost basis - purchase loan -> a down payment paid in stock ----------
# Epic's CSV reports shares that left a grant as "Shares Sold" whether they were
# sold or handed back to cover the down payment on a later purchase. The
# documents never say which, but the arithmetic does: a down payment paid in
# stock is a whole number of shares at that year's price, and the policy
# minimum rounded up to the next whole share is what it costs. Shares that were
# genuinely sold do not land on that number.
#
# Only a down payment at the policy minimum is recognised. Someone who chose to
# put more down in stock reads as unexplained shares instead, which is the safe
# way to be wrong: the shares are reported rather than quietly reclassified.


@dataclass(frozen=True)
class DownPayment:
    """A purchase grant's down payment, read as a whole number of shares."""
    year: int
    grant_type: str
    shares: int
    amount: float


def down_payment_in_stock(year: int, grant_type: str, shares: int, price: float,
                          loan_balance: float, dp_min_percent: float,
                          dp_min_cap: float) -> DownPayment | None:
    """Rule G8, one grant. The down payment as whole shares, or None.

    None means the gap between cost basis and loan is not one: it is not a whole
    number of shares, or it is not the policy minimum — which is also what a loan
    that has been paid down since looks like.
    """
    if shares <= 0 or price <= 0 or loan_balance <= 0:
        return None
    basis = shares * price
    amount = round(basis - loan_balance, 2)
    if amount <= 0:
        return None
    n = round(amount / price)
    if n <= 0 or abs(amount - n * price) > _CENT:
        return None
    minimum = min(basis * dp_min_percent, dp_min_cap)
    # The minimum itself, or the next whole share up from it — nothing further.
    if not (minimum - _CENT <= amount < minimum + price):
        return None
    return DownPayment(year=year, grant_type=grant_type, shares=n, amount=amount)


# A CSV covers one grant per year, so this stays small; the cap is only here so
# a malformed file cannot turn the search exponential.
_MAX_CANDIDATES = 16


def reconcile_down_payments(candidates: list[DownPayment], shares_sold: int
                            ) -> tuple[list[DownPayment], str]:
    """Rule G8, across the file. Which down payments account for the shares gone.

    Returns (chosen, outcome): "reconciled" when exactly one combination of down
    payments adds up to the shares Epic reports sold, "ambiguous" when several
    do, "none" when nothing does. Only an exact, unique match is acted on — a
    subset that merely comes close is a coincidence, not evidence.
    """
    if shares_sold <= 0 or not candidates or len(candidates) > _MAX_CANDIDATES:
        return [], "none"
    matches = [combo for size in range(1, len(candidates) + 1)
               for combo in combinations(candidates, size)
               if sum(c.shares for c in combo) == shares_sold]
    if not matches:
        return [], "none"
    if len(matches) > 1:
        return [], "ambiguous"
    return sorted(matches[0], key=lambda c: c.year), "reconciled"
