"""What accepting a draft would do to the account, in words a person reads.

The wizard merges: a grant the draft names replaces the stored one (loans
included), a grant it leaves out is carried through untouched, and a price year
it names replaces that year's price. That is right for an assistant adding one
new grant, and wrong in a way nobody notices for one that forgot a loan — so an
assistant is shown this before it tells the user the draft is ready, and the
review screen shows it again.

`describe_changes` is pure; `changes_for` reads the rows for it. Loan matching mirrors wizard.py:_merge
(loan number, else type and year), because that is what decides what survives.
"""
from dataclasses import dataclass, field

from .draft import Draft

_TOL = 0.005


@dataclass
class Changes:
    grants_added: list[str] = field(default_factory=list)
    grants_updated: list[str] = field(default_factory=list)
    grants_kept: list[str] = field(default_factory=list)
    loans_added: list[str] = field(default_factory=list)
    loans_updated: list[str] = field(default_factory=list)
    loans_removed: list[str] = field(default_factory=list)
    prices_added: list[str] = field(default_factory=list)
    prices_updated: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @property
    def is_empty(self) -> bool:
        return not any(self.__dict__.values())


def _money(v: float) -> str:
    return f"${v:,.2f}"


def _loan_label(loan_type: str, amount: float, number: str | None) -> str:
    return (f"{loan_type.lower()} loan of {_money(amount)}"
            + (f" (no. {number})" if number else ""))


def describe_changes(draft: Draft, grants: list, loans: list, prices: list) -> Changes:
    """`grants`, `loans`, `prices` are the account's stored ORM rows."""
    out = Changes()
    stored = {(g.year, g.type): g for g in grants}
    drafted = {g.key for g in draft.grants}

    for g in sorted(draft.grants, key=lambda g: (g.year, g.type)):
        name = f"{g.year} {g.type}"
        old = stored.get(g.key)
        if old is None:
            out.grants_added.append(f"{name}: {g.shares:,} shares")
        else:
            diffs = []
            if old.shares != g.shares:
                diffs.append(f"shares {old.shares:,} → {g.shares:,}")
            if abs((old.price or 0) - g.price) > _TOL:
                diffs.append(f"paid per share {_money(old.price or 0)} → {_money(g.price)}")
            if (old.vest_start, old.periods) != (g.vest_start, g.periods):
                diffs.append(f"vesting {old.periods} from {old.vest_start} → "
                             f"{g.periods} from {g.vest_start}")
            if old.exercise_date != g.exercise_date:
                diffs.append(f"exercise date {old.exercise_date} → {g.exercise_date}")
            if bool(old.election_83b) != g.election_83b:
                diffs.append(f"83(b) election {bool(old.election_83b)} → {g.election_83b}")
            if (old.dp_shares or 0) != g.dp_shares:
                diffs.append(f"shares traded in {abs(old.dp_shares or 0):,} → "
                             f"{abs(g.dp_shares):,}")
            if diffs:
                out.grants_updated.append(f"{name}: " + "; ".join(diffs))

        mine = [l for l in loans if (l.grant_year, l.grant_type) == g.key]
        matched: set[int] = set()
        for dl in g.loans:
            hit = next((l for l in mine if l.id not in matched and (
                (dl.loan_number and l.loan_number == dl.loan_number) or
                (not dl.loan_number and l.loan_type == dl.loan_type
                 and l.loan_year == dl.loan_year))), None)
            if hit is None:
                out.loans_added.append(
                    f"{name}: {_loan_label(dl.loan_type, dl.amount, dl.loan_number)}")
            else:
                matched.add(hit.id)
                # wizard._merge rewrites these on a matched loan. The refinance
                # link is not among them: a proposal carries none, and the
                # merge only sets one when a loan number is named.
                diffs = []
                if abs(hit.amount - dl.amount) > _TOL:
                    diffs.append(f"amount {_money(hit.amount)} → {_money(dl.amount)}")
                if abs(hit.interest_rate - dl.interest_rate) > 1e-9:
                    diffs.append(f"rate {hit.interest_rate:.2%} → {dl.interest_rate:.2%}")
                if hit.due_date != dl.due_date:
                    diffs.append(f"due {hit.due_date} → {dl.due_date}")
                if (hit.loan_type, hit.loan_year) != (dl.loan_type, dl.loan_year):
                    diffs.append(f"{hit.loan_year} {hit.loan_type.lower()} → "
                                 f"{dl.loan_year} {dl.loan_type.lower()}")
                if diffs:
                    label = f"loan no. {hit.loan_number}" if hit.loan_number else \
                        f"{hit.loan_type.lower()} loan"
                    out.loans_updated.append(f"{name}: {label} " + "; ".join(diffs))
        for l in mine:
            if l.id not in matched:
                out.loans_removed.append(
                    f"{name}: {_loan_label(l.loan_type, l.amount, l.loan_number)}")

    for key in sorted(k for k in stored if k not in drafted):
        out.grants_kept.append(f"{key[0]} {key[1]}")

    # A year the draft names replaces every saved price in that year
    # (_wizard_prefill drops them, the wizard deletes what it omits), so compare
    # whole years, with dates: two saved prices becoming one is a removal.
    def _year(rows) -> dict[int, list]:
        out_: dict[int, list] = {}
        for r in sorted(rows, key=lambda r: r.effective_date):
            out_.setdefault(r.effective_date.year, []).append(r)
        return out_

    def _fmt(rows) -> str:
        return ", ".join(f"{_money(r.price)} applicable {r.effective_date}" +
                         (f" (tentative; announcement expected {r.expected_announcement_date})" if r.is_estimate
                          else f" (announced {r.announced_date})" if r.announced_date else " (confirmed)")
                         for r in rows)

    saved = _year(prices)
    for year, new in sorted(_year(draft.prices).items()):
        old = saved.get(year, [])
        if not old:
            out.prices_added.append(f"{year}: {_fmt(new)}")
        elif [(r.effective_date, round(r.price, 4), r.is_estimate, r.announced_date) for r in old] != \
                [(r.effective_date, round(r.price, 4), bool(r.is_estimate), r.announced_date) for r in new]:
            out.prices_updated.append(f"{year}: {_fmt(old)} → {_fmt(new)}")
    return out


def changes_for(draft: Draft, user_id: int, db) -> dict:
    """`describe_changes` against what the account holds right now."""
    from scaffold.models import Grant, Loan, Price

    return describe_changes(
        draft,
        db.query(Grant).filter(Grant.user_id == user_id).all(),
        db.query(Loan).filter(Loan.user_id == user_id).all(),
        db.query(Price).filter(Price.user_id == user_id).all(),
    ).as_dict()
