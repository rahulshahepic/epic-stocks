"""Interest and tax loans the statements have not booked yet.

Epic books interest once a year: every 31 December the year's unpaid interest
on a grant's loans becomes a new Interest loan, due with that grant's purchase
loan, and itself accrues from then on. A vest of a zero-basis grant (Free,
Catch-Up, pre-tax Bonus) is withheld through a Tax loan. Until a statement
books those rows, the app has to project them, or a payoff and an exit both
leave out money that will be owed.

This module is the one place that projection lives. Pure functions over plain
values, no I/O. Accrual is actual/365 from each loan's disbursement date (or
from 1 January after the last booked year, whichever is later); a group's
first partial year rolls into the following 31 December, as Epic's statements
do. A projected row is dropped as soon as a real Interest row covers its year
(`booked_through`), so importing a statement replaces projections rather than
adding to them. Projected Tax loans exist only for future vests of zero-basis
grants without an 83(b) election, with no real Tax row for that grant and year.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

DEFAULT_WITHHOLDING_RATE = 0.52
DAYS = 365.0


def _d(v) -> date:
    return v.date() if isinstance(v, datetime) else v


def _get(o, k, default=None):
    return o.get(k, default) if isinstance(o, dict) else getattr(o, k, default)


@dataclass
class PLoan:
    key: str
    loan_id: int | None
    grant_year: int
    grant_type: str
    loan_type: str
    loan_year: int
    amount: float
    rate: float
    accrue_from: date
    end: date
    due: date
    group: tuple
    projected: bool = False
    payments: list = field(default_factory=list)   # [(date, amount)]
    superseded: bool = False
    prepaid: bool = False   # repaid in full by the user's own payments

    def balance_at(self, d: date) -> float:
        return max(0.0, self.amount - sum(a for pd, a in self.payments if pd <= d))

    def interest(self, a: date, b: date) -> float:
        a, b = max(a, self.accrue_from), min(b, self.end)
        if b <= a or self.rate <= 0:
            return 0.0
        cuts = sorted({a, b, *(pd + timedelta(days=1) for pd, _ in self.payments if a < pd + timedelta(days=1) < b)})
        return sum(self.balance_at(x - timedelta(days=1)) * self.rate * (y - x).days / DAYS
                   for x, y in zip(cuts, cuts[1:], strict=False))


@dataclass
class Payoff:
    """Everything one group owes on one date."""
    date: date
    group: tuple
    real_ids: list
    anchor_id: int | None
    projected_principal: float = 0.0      # projected Tax loans
    projected_interest: float = 0.0       # projected Interest loans
    accrued: float = 0.0                  # since the last 31 December
    real_interest: float = 0.0            # booked Interest rows repaid here
    prepaid_interest: float = 0.0         # accrued on a loan the user repaid early

    @property
    def extra(self) -> float:
        """What a payoff owes beyond the real rows' own balances."""
        return self.projected_principal + self.projected_interest + self.accrued

    @property
    def interest_paid(self) -> float:
        return self.real_interest + self.projected_interest + self.accrued + self.prepaid_interest


@dataclass
class Projection:
    loans: list            # every PLoan, real and projected
    payoffs: list          # [Payoff], chronological
    stop: date | None
    assumed_rate: float

    @property
    def projected(self) -> list:
        return [l for l in self.loans if l.projected]

    def extra_for(self, loan_id: int) -> float:
        return round(sum(p.extra for p in self.payoffs if p.anchor_id == loan_id), 2)

    def payoff_for(self, loan_id: int) -> Payoff | None:
        return next((p for p in self.payoffs if p.anchor_id == loan_id), None)

    def orphan_payoffs(self) -> list:
        """Payoffs with no real row to carry them (a projected Tax loan on a
        grant with no other debt due that day)."""
        return [p for p in self.payoffs if p.anchor_id is None and p.extra > 0]

    def interest_paid_by_year(self) -> dict[int, float]:
        out: dict[int, float] = {}
        for p in self.payoffs:
            out[p.date.year] = out.get(p.date.year, 0.0) + p.interest_paid
        return out


def assumed_rate_from(loans) -> float:
    """The latest Interest-loan rate on record, the default for future rows."""
    interest = [l for l in loans if _get(l, "loan_type") == "Interest"]
    if not interest:
        interest = list(loans)
    if not interest:
        return 0.0
    best = max(interest, key=lambda l: (_get(l, "loan_year") or 0, _get(l, "id") or 0))
    return float(_get(best, "interest_rate") or 0.0)


def _groups(loans) -> dict:
    """Which grant's interest series each loan's interest is booked under.

    Its own grant's when that grant has Interest rows; otherwise the same
    year's Purchase grant when that has loans — Epic books a Catch-Up grant's
    tax-loan interest into the Purchase grant's annual Interest loan.
    """
    own_interest = {(_get(l, "grant_year"), _get(l, "grant_type"))
                    for l in loans if _get(l, "loan_type") == "Interest"}
    purchase_years = {_get(l, "grant_year") for l in loans if _get(l, "grant_type") == "Purchase"}

    def group(gy, gt):
        if (gy, gt) in own_interest or gt == "Purchase":
            return (gy, gt)
        if gy in purchase_years:
            return (gy, "Purchase")
        return (gy, gt)
    return group


def project(
    loans,
    grants,
    prices,
    *,
    today: date,
    stop: date | None = None,
    assumed_rate: float | None = None,
    withholding_rate: float | None = DEFAULT_WITHHOLDING_RATE,
    tax_due_dates: dict | None = None,
    loan_payments=(),
    sales=(),
) -> Projection:
    """Simulate every live loan forward.

    `loans` are Loan rows (or dicts with the same fields, `disbursed_on`
    optional). `grants` are core grant dicts. `prices` are core price dicts.
    `stop` ends every loan on that date, as a full exit does: whatever is owed
    then is paid then. Payoffs at `stop` therefore carry everything still open.
    """
    loans = list(loans)
    rate = assumed_rate if assumed_rate is not None else assumed_rate_from(loans)
    group_of = _groups(loans)
    grant_by_key = {(g["year"], g["type"]): g for g in grants}

    superseded_in: dict[int, int] = {}
    for l in loans:
        t = _get(l, "refinances_loan_id")
        if t is not None and t != _get(l, "id"):
            superseded_in[t] = min(superseded_in.get(t, 9999), _get(l, "loan_year"))

    settled_on: dict[int, date] = {}
    for s in sales:
        lid = _get(s, "loan_id")
        if lid is not None:
            sd = _d(_get(s, "date"))
            settled_on[lid] = min(sd, settled_on.get(lid, sd))
    payments: dict[int, list] = {}
    for lp in loan_payments:
        payments.setdefault(_get(lp, "loan_id"), []).append((_d(_get(lp, "date")), float(_get(lp, "amount"))))

    booked: dict[tuple, int] = {}
    for l in loans:
        if _get(l, "loan_type") == "Interest" and _get(l, "id") not in superseded_in:
            g = group_of(_get(l, "grant_year"), _get(l, "grant_type"))
            booked[g] = max(booked.get(g, 0), _get(l, "loan_year"))

    by_id = {_get(l, "id"): l for l in loans}

    def default_start(l, seen=()) -> date:
        disbursed = _get(l, "disbursed_on")
        if disbursed:
            return _d(disbursed)
        ly, lt = _get(l, "loan_year"), _get(l, "loan_type")
        g = grant_by_key.get((_get(l, "grant_year"), _get(l, "grant_type")))
        if lt == "Interest":
            return date(ly + 1, 1, 1)
        if lt == "Tax" and g:
            vests = [_d(d) for d, _ in g["vesting"] if _d(d).year == ly]
            if vests:
                return vests[0]
        ref = _get(l, "refinances_loan_id")
        if ref is not None and ref != _get(l, "id") and ref in by_id and ref not in seen:
            # A refinance carries the same debt on: it accrues from where the
            # loan it replaced did, or from 1 January of its own year.
            return max(date(ly, 1, 1), default_start(by_id[ref], (*seen, _get(l, "id"))))
        if lt == "Purchase" and g:
            ex = _d(g["exercise_date"])
            if ex.year == ly:
                return ex
        return date(ly, 1, 1)

    plist: list[PLoan] = []
    for l in loans:
        lid = _get(l, "id")
        gy, gt = _get(l, "grant_year"), _get(l, "grant_type")
        grp = group_of(gy, gt)
        due = _d(_get(l, "due_date"))
        end = due
        sup = lid in superseded_in
        if sup:
            end = min(end, date(superseded_in[lid], 1, 1))
        if lid in settled_on:
            end = min(end, settled_on[lid])
        pays = sorted(payments.get(lid, []))
        prepaid = False
        if pays:
            paid = 0.0
            for pd, amt in pays:
                paid += amt
                if paid >= float(_get(l, "amount")) - 0.005 and pd < end:
                    end, prepaid = pd, True
                    break
        start = default_start(l)
        if grp in booked:
            start = max(start, date(booked[grp] + 1, 1, 1))
        plist.append(PLoan(
            key=f"loan:{lid}", loan_id=lid, grant_year=gy, grant_type=gt,
            loan_type=_get(l, "loan_type"), loan_year=_get(l, "loan_year"),
            amount=float(_get(l, "amount")), rate=float(_get(l, "interest_rate")),
            accrue_from=start, end=end, due=due, group=grp,
            payments=pays, superseded=sup, prepaid=prepaid,
        ))

    # Projected Tax loans: future vests of zero-basis grants with no real Tax row.
    if withholding_rate:
        real_tax = {(_get(l, "grant_year"), _get(l, "grant_type"), _get(l, "loan_year"))
                    for l in loans if _get(l, "loan_type") == "Tax"}
        tax_due_dates = tax_due_dates or {}
        sorted_prices = sorted(((_d(p["date"]), p["price"]) for p in prices), key=lambda x: x[0])

        def price_at(d):
            out = 0.0
            for pd, pr in sorted_prices:
                if pd <= d:
                    out = pr
                else:
                    break
            return out

        for g in grants:
            # A purchase has no vest income; an 83(b) grant was taxed at grant.
            if (g.get("price") or 0) > 0 or g.get("election_83b") is True:
                continue
            gy, gt = g["year"], g["type"]
            grp = group_of(gy, gt)
            for vd, n in g["vesting"]:
                vd = _d(vd)
                if vd <= today or (stop and vd > stop) or n <= 0 or (gy, gt, vd.year) in real_tax:
                    continue
                due = tax_due_dates.get((gy, gt))
                if due is None:
                    group_dues = [p.due for p in plist if p.group == grp and not p.superseded]
                    if not group_dues:
                        continue
                    due = max(group_dues)
                due = _d(due)
                if due < vd:
                    due = vd
                plist.append(PLoan(
                    key=f"proj-tax:{gy}:{gt}:{vd.year}", loan_id=None, grant_year=gy, grant_type=gt,
                    loan_type="Tax", loan_year=vd.year,
                    amount=round(n * price_at(vd) * withholding_rate, 2), rate=rate,
                    accrue_from=vd, end=due, due=due, group=grp, projected=True,
                ))

    if stop:
        for p in plist:
            if p.end > stop:
                p.end = stop

    # Year-by-year accrual and 31 December capitalisation, per group.
    paid_accrual: dict[str, float] = {}
    by_group: dict[tuple, list] = {}
    for p in plist:
        by_group.setdefault(p.group, []).append(p)
    for grp, members in by_group.items():
        live = [m for m in members if not m.superseded and m.end > m.accrue_from]
        if not live:
            continue
        accr: dict[str, float] = {}
        capitalised = grp in booked
        first = min(m.accrue_from for m in live).year
        last = max(m.end for m in live).year
        purchase_due = [m.due for m in members if m.loan_type == "Purchase" and not m.superseded]
        y = first
        while y <= last:
            ys, ye = date(y, 1, 1), date(y + 1, 1, 1)
            for m in live:
                if m.accrue_from < ye and m.end > ys:
                    accr[m.key] = accr.get(m.key, 0.0) + m.interest(ys, ye)
                if ys <= m.end < ye and not m.superseded:
                    paid_accrual[m.key] = paid_accrual.get(m.key, 0.0) + accr.pop(m.key, 0.0)
            still = [m for m in live if m.end >= ye and m.accrue_from < ye]
            stub = not capitalised and all(m.accrue_from > ys for m in still)
            if still and not stub and y > booked.get(grp, 0):
                amount = sum(accr.pop(m.key, 0.0) for m in still)
                if amount > 0:
                    due = max(purchase_due) if purchase_due and max(purchase_due) >= ye else max(m.due for m in still)
                    end = min(due, stop) if stop else due
                    p = PLoan(
                        key=f"proj-int:{grp[0]}:{grp[1]}:{y}", loan_id=None, grant_year=grp[0],
                        grant_type=grp[1], loan_type="Interest", loan_year=y, amount=round(amount, 2),
                        rate=rate, accrue_from=ye, end=end, due=due, group=grp, projected=True,
                    )
                    plist.append(p)
                    live.append(p)
                    last = max(last, end.year)
                capitalised = True
            y += 1

    # Bucket by (group, date) for payoffs.
    buckets: dict[tuple, Payoff] = {}
    for p in plist:
        if p.superseded:
            continue
        k = (p.group, p.end)
        b = buckets.get(k)
        if b is None:
            b = buckets[k] = Payoff(date=p.end, group=p.group, real_ids=[], anchor_id=None)
        if p.prepaid:
            # The payment that cleared it is taken to have covered its interest.
            b.prepaid_interest += paid_accrual.get(p.key, 0.0)
            continue
        b.accrued += paid_accrual.get(p.key, 0.0)
        if p.projected:
            remaining = p.amount
            if p.loan_type == "Tax":
                b.projected_principal += remaining
            else:
                b.projected_interest += remaining
        else:
            b.real_ids.append(p)
            if p.loan_type == "Interest":
                b.real_interest += p.balance_at(p.end)
    for b in buckets.values():
        if b.real_ids:
            purchase = [p for p in b.real_ids if p.loan_type == "Purchase"]
            anchor = purchase[0] if purchase else max(b.real_ids, key=lambda p: p.amount)
            b.anchor_id = anchor.loan_id
        b.real_ids = [p.loan_id for p in b.real_ids]
        b.accrued = round(b.accrued, 2)
        b.projected_interest = round(b.projected_interest, 2)
        b.projected_principal = round(b.projected_principal, 2)

    payoffs = sorted(buckets.values(), key=lambda b: (b.date, b.group))
    return Projection(loans=plist, payoffs=payoffs, stop=stop, assumed_rate=rate)


def outstanding_at_stop(proj: Projection) -> dict:
    """What an exit on `proj.stop` pays beyond the real loans' principal."""
    out = {"projected_principal": 0.0, "projected_interest": 0.0, "accrued": 0.0, "real_interest": 0.0}
    for p in proj.payoffs:
        if proj.stop and p.date == proj.stop:
            out["projected_principal"] += p.projected_principal
            out["projected_interest"] += p.projected_interest
            out["accrued"] += p.accrued
            out["real_interest"] += p.real_interest
    return {k: round(v, 2) for k, v in out.items()}
