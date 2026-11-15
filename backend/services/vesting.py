"""A grant's vesting schedule: stored dated rows, one per vesting date.

A template or an agreement suggests a schedule; once written, the rows are the
truth and core.py reads them as they are. `vest_start`/`periods` on Grant are
their summary (first date, number of dates), kept in step here.
"""
import logging
from datetime import date, datetime

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm.attributes import flag_modified

MAX_VESTING_DATES = 40


def epic_split(shares: int, first: date, count: int) -> list[tuple[date, int]]:
    """Equal yearly parts, each rounded down, the rest on the last date —
    how Epic's agreements word it ("All remaining Purchased Shares")."""
    if count < 1:
        return []
    part = shares // count
    rows = [(first + relativedelta(years=i), part) for i in range(count)]
    rows[-1] = (rows[-1][0], shares - part * (count - 1))
    return rows


def bonus_split(shares: int, first: date, count: int) -> list[tuple[date, int]]:
    """34%, 33%, then the rest, each part rounded down — how the 2021-2025
    bonus agreements word a three-year schedule. Other counts split evenly."""
    if count != 3:
        return epic_split(shares, first, count)
    a, b = shares * 34 // 100, shares * 33 // 100
    return [(first, a), (first + relativedelta(years=1), b), (first + relativedelta(years=2), shares - a - b)]


def default_split(grant_type: str | None, year: int | None, shares: int, first: date,
                  count: int) -> list[tuple[date, int]]:
    """The schedule a first date and count become for this kind of grant."""
    if grant_type == "Bonus" and (year or 0) >= 2021:
        return bonus_split(shares, first, count)
    return epic_split(shares, first, count)


def legacy_split(shares: int, first: date, count: int) -> list[tuple[date, int]]:
    """The formula the app used before schedules were stored: the remainder
    goes one share at a time to the earliest dates. Only for rows written
    before then, so their numbers do not move."""
    if count < 1:
        return []
    base, rem = divmod(shares, count)
    return [(first + relativedelta(years=i), base + (1 if i < rem else 0)) for i in range(count)]


def _day(value) -> date:
    return value.date() if isinstance(value, datetime) else value


def schedule_of(g) -> list[tuple[date, int]]:
    """(date, shares) pairs for an ORM grant, a submitted model, or a dict."""
    from scaffold.models import Grant
    rows = g.get("vesting") if isinstance(g, dict) else getattr(g, "vesting", None)
    if rows:
        return sorted((_day(r["date"] if isinstance(r, dict) else r.date),
                       int(r["shares"] if isinstance(r, dict) else r.shares)) for r in rows)
    get = g.get if isinstance(g, dict) else lambda k: getattr(g, k, None)
    first, count, shares = get("vest_start"), get("periods"), get("shares")
    if not first or not count:
        return []
    if isinstance(g, Grant):
        return legacy_split(int(shares or 0), _day(first), int(count))
    return default_split(get("type"), get("year"), int(shares or 0), _day(first), int(count))


def check_schedule(rows: list[tuple[date, int]], shares: int) -> str | None:
    if not rows:
        return "A grant needs at least one vesting date"
    if len(rows) > MAX_VESTING_DATES:
        return f"At most {MAX_VESTING_DATES} vesting dates per grant"
    if len({d for d, _ in rows}) != len(rows):
        return "Two vesting dates are the same day; combine them"
    if any(n < 0 for _, n in rows):
        return "Vesting shares cannot be negative"
    total = sum(n for _, n in rows)
    if total != shares:
        return f"Vesting dates add up to {total:,} shares but the grant has {shares:,}"
    return None


def set_schedule(grant, rows: list[tuple[date, int]]) -> None:
    """Replace a grant's vesting rows and keep the summary columns in step."""
    from scaffold.models import GrantVesting
    rows = sorted(rows)
    existing = {v.date: v for v in grant.vesting}
    keep = []
    for d, n in rows:
        v = existing.pop(d, None)
        if v is None:
            v = GrantVesting(user_id=grant.user_id, date=d, shares=n)
        else:
            v.shares = n
        keep.append(v)
    grant.vesting = keep
    grant.vest_start = rows[0][0]
    grant.periods = len(rows)
    if grant.id is not None:
        # A moved date can leave first date and count unchanged; the grant's
        # version must still move so a stale editor is refused.
        flag_modified(grant, "periods")


def resplit(rows: list[tuple[date, int]], shares: int) -> list[tuple[date, int]]:
    """Same dates, new total, in the same proportions — for a share count
    corrected without a schedule. The rest lands on the last date."""
    old = sum(n for _, n in rows)
    weights = [n for _, n in rows] if old else [1] * len(rows)
    total = sum(weights)
    parts = [(d, w * shares // total) for (d, _), w in zip(rows, weights, strict=True)]
    parts[-1] = (parts[-1][0], shares - sum(n for _, n in parts[:-1]))
    return parts


def core_grant(g) -> dict:
    """A grant as core.py takes it. One builder for every caller."""
    rows = schedule_of(g)
    as_dt = lambda d: datetime.combine(d, datetime.min.time())
    get = g.get if isinstance(g, dict) else lambda k: getattr(g, k, None)
    first = rows[0][0] if rows else _day(get("vest_start"))
    return {
        "year": get("year"), "type": get("type"), "shares": get("shares"), "price": get("price"),
        "vest_start": as_dt(first) if first else None,
        "periods": len(rows),
        "vesting": [(as_dt(d), n) for d, n in rows],
        "exercise_date": as_dt(_day(get("exercise_date"))),
        "dp_shares": get("dp_shares") or 0,
        # None (a dict without the flag) keeps core.py's original treatment.
        "election_83b": None if get("election_83b") is None else bool(get("election_83b")),
    }


def vest_years(g) -> set[int]:
    return {d.year for d, _ in schedule_of(g)}


def vested_by(g, as_of: date) -> int:
    return sum(n for d, n in schedule_of(g) if d <= as_of)


def backfill_schedules(db) -> int:
    """Write stored rows for grants created before schedules were stored, using
    the formula they were displayed with, so no number moves. Safe on every
    boot: a grant with rows is skipped, and each user commits on its own."""
    from scaffold.crypto import decrypt_user_key, encryption_enabled, set_current_key
    from scaffold.models import Grant, GrantVesting, User

    missing = (db.query(Grant.user_id).filter(~Grant.vesting.any())
               .distinct().all())
    done = 0
    for (user_id,) in missing:
        user = db.get(User, user_id)
        try:
            if encryption_enabled():
                if not user or not user.encrypted_key:
                    continue
                set_current_key(decrypt_user_key(user.encrypted_key))
            for g in db.query(Grant).filter(Grant.user_id == user_id, ~Grant.vesting.any()):
                rows = legacy_split(int(g.shares), g.vest_start, int(g.periods))
                if rows:
                    db.add_all(GrantVesting(user_id=user_id, grant_id=g.id, date=d, shares=n)
                               for d, n in rows)
                    done += 1
            db.commit()
        except Exception:
            # One account failing (or another worker backfilling it first)
            # must not stop the rest; its grants read through the same
            # formula until a later boot stores them.
            db.rollback()
            logging.getLogger(__name__).exception("Could not store vesting rows for user %s", user_id)
        finally:
            set_current_key(None)
    return done
