"""A draft read from Epic's files, as the list of edits it implies for an account.

The list goes to app/changes.py like any other change set: the person sees it
on one screen, unticks what they do not want, previews and applies. Nothing
here writes.

- A grant the draft names is created, or updated where a figure differs. A
  stored schedule whose first date and count already match is left alone, so
  dates moved for a leave survive a re-import.
- A grant the draft does not name is never touched.
- A loan statement is the current state of the loans: a stored loan under a
  grant the statement covers that the statement no longer lists (paid off, or
  an earlier link of a refinance) is proposed for removal, listed separately
  so it can be unticked.
"""
from collections import Counter

from services.vesting import schedule_of

from scaffold.models import Grant, Loan, Price, Sale
from .draft import Draft

_TOL = 0.005


def _iso(d):
    return d.isoformat() if d else None


def _money(v):
    return f"${v:,.2f}"


def _grant_values(g) -> dict:
    values = {"year": g.year, "type": g.type, "shares": g.shares, "price": round(g.price, 4),
              "exercise_date": _iso(g.exercise_date), "dp_shares": g.dp_shares,
              "election_83b": g.election_83b}
    if g.vesting:
        values["vesting"] = [{"date": _iso(d), "shares": n} for d, n in g.vesting]
    else:
        values.update(vest_start=_iso(g.vest_start), periods=g.periods)
    return values


def _loan_values(g, l) -> dict:
    return {"grant_year": g.year, "grant_type": g.type, "loan_type": l.loan_type,
            "loan_year": l.loan_year, "amount": round(l.amount, 2),
            "interest_rate": l.interest_rate, "due_date": _iso(l.due_date),
            **({"loan_number": l.loan_number} if l.loan_number else {})}


def _change(kind, action, label, detail, values=None, row=None, selected=True, group="update"):
    c = {"kind": kind, "action": action, "label": label, "detail": detail,
         "selected": selected, "group": group}
    if values is not None:
        c["values"] = values
    if row is not None:
        c["id"], c["version"] = row.id, row.version
    return c


def _grant_diff(g, old) -> dict:
    diff = {}
    if old.shares != g.shares:
        diff["shares"] = g.shares
    if abs((old.price or 0) - g.price) > _TOL:
        diff["price"] = round(g.price, 4)
    if old.exercise_date != g.exercise_date:
        diff["exercise_date"] = _iso(g.exercise_date)
    if (g.dp_shares or 0) != (old.dp_shares or 0):
        diff["dp_shares"] = g.dp_shares
    if bool(g.election_83b) != bool(old.election_83b):
        diff["election_83b"] = g.election_83b
    stored = schedule_of(old)
    if g.vesting:
        if list(g.vesting) != stored:
            diff["vesting"] = [{"date": _iso(d), "shares": n} for d, n in g.vesting]
    elif (stored[0][0] if stored else None, len(stored)) != (g.vest_start, g.periods):
        diff.update(vest_start=_iso(g.vest_start), periods=g.periods)
    return diff


def _loan_diff(g, l, old) -> dict:
    diff = {}
    if abs(old.amount - l.amount) > _TOL:
        diff["amount"] = round(l.amount, 2)
    if abs(old.interest_rate - l.interest_rate) > 1e-9:
        diff["interest_rate"] = l.interest_rate
    if old.due_date != l.due_date:
        diff["due_date"] = _iso(l.due_date)
    if old.loan_type != l.loan_type:
        diff["loan_type"] = l.loan_type
    if old.loan_year != l.loan_year:
        diff["loan_year"] = l.loan_year
    if l.loan_number and old.loan_number != l.loan_number:
        diff["loan_number"] = l.loan_number
    return diff


def draft_changes(draft: Draft, user_id: int, db) -> list[dict]:
    out: list[dict] = []
    grants = {(g.year, g.type): g for g in db.query(Grant).filter(Grant.user_id == user_id)}
    loans = db.query(Loan).filter(Loan.user_id == user_id).all()
    prices = {p.effective_date: p for p in db.query(Price).filter(Price.user_id == user_id)}
    sales = db.query(Sale).filter(Sale.user_id == user_id).all()

    for price in sorted(draft.prices, key=lambda p: p.effective_date):
        old = prices.get(price.effective_date)
        label = f"Share price from {_iso(price.effective_date)}"
        if old is None:
            out.append(_change("price", "create", label, _money(price.price), price.as_dict(), group="add"))
        else:
            diff = {}
            if abs(old.price - price.price) > _TOL:
                diff["price"] = price.price
            if price.is_estimate is False and old.is_estimate:
                diff["is_estimate"] = False
            if price.announced_date and price.announced_date != old.announced_date:
                diff["announced_date"] = _iso(price.announced_date)
            if diff:
                detail = (f"{_money(old.price)} → {_money(price.price)}" if "price" in diff
                          else "confirmed as announced")
                out.append(_change("price", "update", label, detail, diff, old))

    for g in sorted(draft.grants, key=lambda g: g.key):
        name = f"{g.year} {g.type} grant"
        old = grants.get(g.key)
        if old is None:
            out.append(_change("grant", "create", name, f"{g.shares:,} shares at {_money(g.price)}",
                               _grant_values(g), group="add"))
        else:
            diff = _grant_diff(g, old)
            if diff:
                out.append(_change("grant", "update", name, ", ".join(sorted(diff)) + " updated", diff, old))

        stored = [l for l in loans if (l.grant_year, l.grant_type) == g.key]
        matched = set()
        for l in g.loans:
            hit = next((s for s in stored if s.id not in matched and l.loan_number
                        and s.loan_number == l.loan_number), None) or next(
                (s for s in stored if s.id not in matched and not s.loan_number
                 and (s.loan_type, s.loan_year) == (l.loan_type, l.loan_year)), None)
            label = f"{g.year} {g.type} {l.loan_type.lower()} loan" + (f" {l.loan_number}" if l.loan_number else "")
            if hit is None:
                out.append(_change("loan", "create", label,
                                   f"{_money(l.amount)} at {l.interest_rate:.2%}, due {_iso(l.due_date)}",
                                   _loan_values(g, l), group="add"))
                continue
            matched.add(hit.id)
            diff = _loan_diff(g, l, hit)
            if diff:
                out.append(_change("loan", "update", label, ", ".join(sorted(diff)) + " updated", diff, hit))
        if draft.statement_date and g.loans:
            for s in stored:
                if s.id not in matched:
                    out.append(_change(
                        "loan", "delete",
                        f"{g.year} {g.type} {s.loan_type.lower()} loan" + (f" {s.loan_number}" if s.loan_number else ""),
                        f"{_money(s.amount)} — not on your statement of {_iso(draft.statement_date)} "
                        f"(paid off or refinanced)", row=s, group="remove"))

    # Matched one for one, so two identical sales stay two and a re-import of
    # the same file adds none.
    have = Counter((s.date, s.shares, round(s.price_per_share, 4)) for s in sales)
    for sale in draft.sales:
        if not sale.is_complete:
            continue
        key = (sale.sale_date, sale.shares, round(sale.price_per_share, 4))
        if have[key]:
            have[key] -= 1
            continue
        out.append(_change("sale", "create", f"Sale on {_iso(sale.sale_date)}",
                           f"{sale.shares:,} shares at {_money(sale.price_per_share)}",
                           {"date": _iso(sale.sale_date), "shares": sale.shares,
                            "price_per_share": sale.price_per_share, "notes": sale.notes or ""},
                           group="add"))
    return out
