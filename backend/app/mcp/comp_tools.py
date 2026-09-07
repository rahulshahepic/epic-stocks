"""The write tools, and the only ones there are.

What they cover is the hand-entered half of the app: salary and bonus history
for the compensation tab, and the account balances the retirement simulator
starts from. Both are figures the user types, that nothing computes from and
that nothing else is derived from — which is exactly why these are safe to
write and a grant or a price is not. A wrong grant restates someone's entire
timeline through core.py; a wrong salary row is one line on one chart, and the
user is looking at it.

Both live as JSON blobs the frontend owns the schema of (users.comp_entries and
users.retirement_params), so these tools deliberately do *not* accept a blob.
Handing a model the whole document invites it to return three fields and drop
the other twenty. Every tool here changes named fields and leaves the rest of
the document exactly as it found it.

Nothing returns the document it just changed. A connection may hold comp:write
without comp:read, and a write must not become a way to read.
"""
from datetime import date

from scaffold.oauth.scopes import COMP_WRITE
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register

# The comp tab is a working life's worth of raises and bonuses — a few dozen
# rows for a long career. This is the ceiling on the stored list, so a runaway
# model cannot grow an unbounded column on the users table.
MAX_COMP_ENTRIES = 400
MAX_ENTRIES_PER_CALL = 50

MAX_NOTE_LEN = 200

# Salary and bonus figures are annual dollars. The bound is what a plausible
# figure cannot exceed rather than a policy — it is here to catch a misplaced
# unit, not to judge anyone's pay.
MAX_COMP_AMOUNT = 100_000_000

# Retirement buckets are stored in millions of dollars, because that is what
# the simulator's inputs are labelled in ("$M"). That makes a unit slip the
# likeliest way for a model to be wrong here by a factor of a million, so the
# ceiling is low enough to catch one and the error says which way to go.
MAX_PORTFOLIO_MILLIONS = 1_000

# Entry dates are bounded for the same reason grant years are in draft.py:
# every downstream use is `date` arithmetic.
MIN_COMP_YEAR = 1950
MAX_COMP_YEAR = 2100


# ── argument handling ───────────────────────────────────────────────────────
#
# Same contract as the read tools: arguments come from a language model, so a
# bad one raises ValueError and becomes a readable tool error, never a 500.

def _account(ctx: ToolContext, args: dict):
    return resolve_account(ctx.user, args.get("account"), ctx.db)


def _entry_date(raw, label: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{label} is required, as a date like 2026-04-01")
    try:
        parsed = date.fromisoformat(raw.strip())
    except ValueError:
        raise ValueError(f"'{raw}' is not a valid {label} — use YYYY-MM-DD") from None
    if not MIN_COMP_YEAR <= parsed.year <= MAX_COMP_YEAR:
        raise ValueError(
            f"{label} '{raw}' is outside {MIN_COMP_YEAR}-{MAX_COMP_YEAR}"
        )
    return parsed.isoformat()


def _amount(raw, label: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ValueError(f"{label} must be a number of dollars")
    try:
        value = float(str(raw).strip().replace(",", "").lstrip("$"))
    except ValueError:
        raise ValueError(f"'{raw}' is not a number") from None
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError(f"{label} must be a real number")
    if value < 0:
        raise ValueError(f"{label} cannot be negative")
    if value > MAX_COMP_AMOUNT:
        raise ValueError(
            f"{label} of {value:,.0f} is implausibly large — these are annual "
            f"dollars, so a salary is a figure like 185000"
        )
    return round(value, 2)


def _millions(raw, label: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ValueError(f"'{label}' must be a number of millions of dollars")
    try:
        value = float(str(raw).strip().replace(",", "").lstrip("$"))
    except ValueError:
        raise ValueError(f"'{raw}' is not a number") from None
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError(f"'{label}' must be a real number")
    if value < 0:
        raise ValueError(f"'{label}' cannot be negative")
    if value > MAX_PORTFOLIO_MILLIONS:
        # Almost always dollars typed into a field that wanted millions.
        raise ValueError(
            f"'{label}' is in millions of dollars, so {value:,.0f} would be "
            f"${value:,.0f} million. For a balance of ${value:,.0f} pass "
            f"{value / 1_000_000:g}."
        )
    return value


def _entry_list(args: dict):
    entries = args.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError(
            "'entries' must be a non-empty list of salary and bonus records"
        )
    if len(entries) > MAX_ENTRIES_PER_CALL:
        raise ValueError(
            f"That is more than {MAX_ENTRIES_PER_CALL} entries in one call — "
            f"send them in smaller batches"
        )
    return entries


def _held(owner) -> list:
    """The stored history, defensively — the column is a blob the app owns."""
    entries = owner.comp_entries
    return list(entries) if isinstance(entries, list) else []


def _next_id(existing: list) -> str:
    """Ids only have to be unique within the list; the frontend uses UUIDs and
    reads whatever it finds, so a short stable one is enough."""
    used = {e.get("id") for e in existing if isinstance(e, dict)}
    n = len(used) + 1
    while f"mcp-{n}" in used:
        n += 1
    return f"mcp-{n}"


def _same_entry(a: dict, b: dict) -> bool:
    """Whether two entries say the same thing.

    A model that retries a call it never saw the answer to must not double a
    raise or a bonus, and the user would have no way to tell which of the two
    identical rows was the duplicate.
    """
    if a.get("type") != b.get("type"):
        return False
    key = "effective_date" if a.get("type") == "salary" else "date"
    return a.get(key) == b.get(key) and a.get("amount") == b.get("amount")


# ── salary and bonus history ────────────────────────────────────────────────

def _normalise(raw, existing: list) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Each entry must be an object with 'type', a date and 'amount'")

    kind = raw.get("type")
    if not isinstance(kind, str) or kind.strip().lower() not in ("salary", "bonus"):
        raise ValueError("Each entry needs \"type\": \"salary\" or \"bonus\"")
    kind = kind.strip().lower()

    # The stored shapes differ by one key — a salary rate takes effect on a
    # date, a bonus is paid on one. Accept either spelling and store the one
    # the app reads, rather than making the model remember which is which.
    when = raw.get("effective_date") if kind == "salary" else raw.get("date")
    if when in (None, ""):
        when = raw.get("date") if kind == "salary" else raw.get("effective_date")

    amount = _amount(raw.get("amount"), "'amount'")

    if kind == "salary":
        entry = {
            "id": _next_id(existing),
            "type": "salary",
            "effective_date": _entry_date(when, "'effective_date'"),
            "amount": amount,
        }
    else:
        entry = {
            "id": _next_id(existing),
            "type": "bonus",
            "date": _entry_date(when, "'date'"),
            "amount": amount,
        }
        note = raw.get("note")
        if note not in (None, ""):
            if not isinstance(note, str):
                raise ValueError("'note' must be text")
            note = note.strip()[:MAX_NOTE_LEN]
            if note:
                entry["note"] = note
    return entry


def _add_compensation(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)
    held = _held(owner)

    added, duplicates = [], 0
    for raw in _entry_list(args):
        entry = _normalise(raw, held + added)
        if any(_same_entry(entry, e) for e in held + added if isinstance(e, dict)):
            duplicates += 1
            continue
        added.append(entry)

    if len(held) + len(added) > MAX_COMP_ENTRIES:
        raise ValueError(
            f"That would take the history past {MAX_COMP_ENTRIES} entries. "
            f"Remove some with remove_compensation first."
        )

    if added:
        # Assigning a new list matters: the column is a JSON TypeDecorator and
        # mutating the loaded value in place would not be flushed.
        owner.comp_entries = held + added
        ctx.db.commit()

    return {
        "added": added,
        "skipped_as_duplicates": duplicates,
        "entries_now": len(held) + len(added),
        "next_step": (
            "These are saved. They show on the Compensation tab, which prorates "
            "a salary across the year it changes in."
        ),
    }


register(Tool(
    name="add_compensation",
    title="Record salary changes and bonuses",
    description=(
        "Add salary-change and bonus entries to the compensation history. A "
        "salary entry is an annual rate and the date it took effect — record a "
        "raise, not a fresh total each year, since the app prorates a change "
        "across the year it lands in. A bonus is a single payment on a date. "
        "Amounts are annual dollars (185000, not 185). Adds to what is already "
        "there rather than replacing it, and an entry identical to one already "
        "stored is skipped, so this is safe to retry. Call get_compensation "
        "first to see what is on record."
    ),
    input_schema=object_schema({
        "entries": {
            "type": "array",
            "maxItems": MAX_ENTRIES_PER_CALL,
            "description": "The salary changes and bonuses to record.",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["salary", "bonus"],
                        "description": (
                            "'salary' for a new annual rate from a date; "
                            "'bonus' for a one-off payment."
                        ),
                    },
                    "effective_date": {
                        "type": "string",
                        "description": "Salary entries: the date the rate took effect (YYYY-MM-DD).",
                    },
                    "date": {
                        "type": "string",
                        "description": "Bonus entries: the date it was paid (YYYY-MM-DD).",
                    },
                    "amount": {
                        "type": "number",
                        "description": (
                            "Dollars — the annual salary rate, or the bonus paid."
                        ),
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional label for a bonus, e.g. 'annual bonus'.",
                    },
                },
                "required": ["type", "amount"],
            },
        },
        "account": ACCOUNT_PROPERTY,
    }, required=["entries"]),
    scope=COMP_WRITE,
    handler=_add_compensation,
    read_only=False,
    idempotent=True,
))


def _remove_compensation(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)

    ids = args.get("ids")
    if not isinstance(ids, list) or not ids:
        raise ValueError(
            "'ids' must be a non-empty list of entry ids, from get_compensation"
        )
    if len(ids) > MAX_ENTRIES_PER_CALL:
        raise ValueError(f"That is more than {MAX_ENTRIES_PER_CALL} ids in one call")
    wanted = {str(i) for i in ids}

    held = _held(owner)
    kept = [e for e in held if not (isinstance(e, dict) and str(e.get("id")) in wanted)]
    removed = len(held) - len(kept)

    if removed:
        owner.comp_entries = kept
        ctx.db.commit()

    missing = sorted(
        wanted - {str(e.get("id")) for e in held if isinstance(e, dict)}
    )
    return {
        "removed": removed,
        "entries_now": len(kept),
        # Named rather than silently ignored: a stale id usually means the model
        # is working from a copy of the list that has since changed.
        "not_found": missing,
    }


register(Tool(
    name="remove_compensation",
    title="Delete salary or bonus entries",
    description=(
        "Delete entries from the salary and bonus history by id. Get the ids "
        "from get_compensation. Use this to correct a mistake — deleting a "
        "salary entry changes every year after it, because each rate applies "
        "until the next one replaces it."
    ),
    input_schema=object_schema({
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": MAX_ENTRIES_PER_CALL,
            "description": "Ids of the entries to delete, from get_compensation.",
        },
        "account": ACCOUNT_PROPERTY,
    }, required=["ids"]),
    scope=COMP_WRITE,
    handler=_remove_compensation,
    read_only=False,
    idempotent=True,
    destructive=True,
))


# ── retirement account balances ─────────────────────────────────────────────
#
# Four of the simulator's inputs, named as the user sees them and mapped to the
# keys the frontend stores. The rest of the scenario — ages, spending, growth
# assumptions, the glidepath — is left to the app, where there are sliders and
# a chart that responds to them.

_BUCKETS: dict[str, tuple[str, str]] = {
    "traditional_401k": ("traditional", "401(k) and traditional IRA"),
    "roth": ("roth", "Roth IRA and Roth 401(k)"),
    "taxable_brokerage": ("taxableAdditional", "taxable brokerage"),
    "brokerage_basis": ("additionalBasis", "cost basis of the taxable brokerage"),
}

# Setting a retirement balance while the app is in its simple view would store
# a figure the user cannot see: the simple view shows one "additional
# portfolio" box, and collapsing the breakdown folds 401(k) and Roth back into
# it. So a write that splits the buckets opens the breakdown too.
_BREAKDOWN_KEYS = ("traditional", "roth", "additionalBasis")


def _set_retirement_accounts(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)

    given = {name: args[name] for name in _BUCKETS if args.get(name) not in (None, "")}
    if not given:
        raise ValueError(
            "Give at least one balance to set: " + ", ".join(_BUCKETS)
        )

    changes = {
        _BUCKETS[name][0]: _millions(raw, name) for name, raw in given.items()
    }

    held = owner.retirement_params
    params = dict(held) if isinstance(held, dict) else {}

    basis = changes.get("additionalBasis", params.get("additionalBasis"))
    total = changes.get("taxableAdditional", params.get("taxableAdditional"))
    if isinstance(basis, (int, float)) and isinstance(total, (int, float)) and basis > total:
        raise ValueError(
            f"The brokerage cost basis (${basis:g}M) cannot exceed the "
            f"brokerage balance (${total:g}M) — the basis is what was paid for "
            f"the assets that balance is now worth."
        )

    params.update(changes)
    if any(params.get(k) for k in _BREAKDOWN_KEYS):
        params["advanced"] = True

    owner.retirement_params = params
    ctx.db.commit()

    return {
        # Only what was asked for. A connection may hold comp:write without
        # comp:read, so this must not hand back the rest of the scenario.
        "set": {name: changes[_BUCKETS[name][0]] for name in given},
        "units": "millions of dollars",
        "next_step": (
            "Saved. The Retirement page picks these up as the starting "
            "balances; the ages, spending and market assumptions are set there."
        ),
    }


register(Tool(
    name="set_retirement_accounts",
    title="Set retirement account balances",
    description=(
        "Set the account balances the retirement simulator starts from. "
        "**Every figure is in millions of dollars** — a $850,000 401(k) is "
        "0.85, not 850000. Only the balances you pass are changed; the rest of "
        "the saved scenario is left alone. The Epic position is not set here — "
        "the app computes that from the grants and prices on the account."
    ),
    input_schema=object_schema({
        "traditional_401k": {
            "type": "number",
            "description": (
                "401(k) and traditional IRA balance, in $M. Taxed as income on "
                "withdrawal and locked until 59½."
            ),
        },
        "roth": {
            "type": "number",
            "description": (
                "Roth IRA and Roth 401(k) balance, in $M. Tax-free on "
                "withdrawal and locked until 59½."
            ),
        },
        "taxable_brokerage": {
            "type": "number",
            "description": (
                "Taxable brokerage balance, in $M — what it is worth now, "
                "excluding the Epic position."
            ),
        },
        "brokerage_basis": {
            "type": "number",
            "description": (
                "What was originally paid for that brokerage balance, in $M. "
                "Only the growth above it is taxed when sold. Cannot exceed "
                "taxable_brokerage."
            ),
        },
        "account": ACCOUNT_PROPERTY,
    }),
    scope=COMP_WRITE,
    handler=_set_retirement_accounts,
    read_only=False,
    idempotent=True,
))
