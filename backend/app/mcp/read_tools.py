"""The read tools.

Each one is a thin call through to the service function the matching HTTP
endpoint uses — mostly the `_get_*_data(user, db)` helpers in app/routers/,
which already take an arbitrary user because the sharing feature needed that
first. That is deliberate: an assistant and the web app must not be able to
disagree about what a user's vesting schedule says.

Tool names are verbs and nouns, one job each, because that is what a model
picks correctly from a list.
"""
from datetime import date

from scaffold.models import Grant, Loan, Price, Sale
from scaffold.oauth.scopes import COMP_READ, EQUITY_READ
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register

MAX_EVENTS = 2000
DEFAULT_EVENT_LIMIT = 500


# ── argument handling ───────────────────────────────────────────────────────
#
# Arguments arrive from a language model, so every one of them is untrusted and
# possibly the wrong type. A bad argument raises ValueError, which the transport
# reports as a failed tool call the model can read and correct — never as an
# exception, which would be a 500 and an error_logs row.

def _account(ctx: ToolContext, args: dict):
    return resolve_account(ctx.user, args.get("account"), ctx.db)


def _opt_date(args: dict, key: str) -> date | None:
    raw = args.get(key)
    if raw in (None, ""):
        return None
    if not isinstance(raw, str):
        raise ValueError(f"'{key}' must be a date string like 2027-03-31")
    try:
        return date.fromisoformat(raw.strip())
    except ValueError:
        raise ValueError(f"'{raw}' is not a valid date — use YYYY-MM-DD") from None


def _opt_int(args: dict, key: str) -> int | None:
    raw = args.get(key)
    if raw in (None, ""):
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ValueError(f"'{key}' must be a whole number")
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise ValueError(f"'{raw}' is not a whole number") from None
    return value


def _opt_float(args: dict, key: str) -> float | None:
    raw = args.get(key)
    if raw in (None, ""):
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ValueError(f"'{key}' must be a number")
    try:
        return float(str(raw).strip())
    except ValueError:
        raise ValueError(f"'{raw}' is not a number") from None


def _flag(args: dict, key: str) -> bool:
    value = args.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1")
    return bool(value)


def _as_date(value) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _last_real_price_date(owner, db) -> date | None:
    """The newest valuation that is not one of the user's own projections.

    Everything on the timeline after this is priced at an assumption, which is
    the distinction the app draws and the connector did not.
    """
    row = (
        db.query(Price)
        .filter(Price.user_id == owner.id, Price.is_estimate.is_(False))
        .order_by(Price.effective_date.desc())
        .first()
    )
    return row.effective_date if row else None


def _rows(model, owner, db, order):
    return [
        {c.name: getattr(row, c.name) for c in model.__table__.columns if c.name != "user_id"}
        for row in db.query(model).filter(model.user_id == owner.id).order_by(order).all()
    ]


_ACCOUNT_ONLY = object_schema({"account": ACCOUNT_PROPERTY})


# ── equity ──────────────────────────────────────────────────────────────────

def _get_dashboard(ctx: ToolContext, args: dict):
    from app.routers.events import _get_dashboard_data

    # Bounded to today. Left unbounded this reports the *end* of the timeline,
    # which on an account carrying price projections is years out — an assistant
    # read `current_price` as the current price and it was a projected 2034 one.
    payload = _get_dashboard_data(_account(ctx, args), ctx.db, as_of=date.today())
    # An estimate whose date has since passed with no real valuation behind it
    # is still the price in effect. The flag alone is easy to skim past.
    if payload.get("price_is_estimate"):
        payload["projection_warning"] = (
            "The price in effect today is one the user assumed for planning, "
            "not a real valuation, so every figure here is derived from it. "
            "Say so before quoting any of them."
        )
    return payload


register(Tool(
    name="get_dashboard",
    title="Equity summary",
    description=(
        "The headline numbers as they stand today: shares held and vested, the "
        "current share price, outstanding loan balance, income and capital "
        "gains realised so far. Start here when asked how someone's equity is "
        "doing. Everything is as of today — `as_of` says which day. If "
        "`price_is_estimate` is true these figures rest on a price the user "
        "projected rather than a real valuation, and you must say so."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=EQUITY_READ,
    handler=_get_dashboard,
))


def _list_events(ctx: ToolContext, args: dict):
    from app.routers.events import _get_events_data

    owner = _account(ctx, args)
    start, end = _opt_date(args, "from_date"), _opt_date(args, "to_date")
    if start and end and start > end:
        raise ValueError("'from_date' is after 'to_date'")

    kinds = args.get("event_types")
    if kinds is not None:
        if not isinstance(kinds, list) or not all(isinstance(k, str) for k in kinds):
            raise ValueError("'event_types' must be a list of strings")
        kinds = {k.strip().lower() for k in kinds}

    limit = _opt_int(args, "limit") or DEFAULT_EVENT_LIMIT
    limit = max(1, min(limit, MAX_EVENTS))

    # Future vesting dates and share counts are fixed facts — the schedule is
    # company-wide. What they are *worth* after the newest real valuation is
    # priced at the user's own assumption, and that is the part an assistant
    # must not repeat as though it were known.
    priced_to = _last_real_price_date(owner, ctx.db)

    events = _get_events_data(owner, ctx.db)
    selected = []
    for event in events:
        when = event.get("date")
        if start and (not when or when < start.isoformat()):
            continue
        if end and (not when or when > end.isoformat()):
            continue
        if kinds and str(event.get("event_type", "")).lower() not in kinds:
            continue
        when_date = _as_date(when)
        event = dict(event)
        event["valuation_is_projected"] = bool(
            priced_to and when_date and when_date > priced_to
        )
        selected.append(event)

    shown = selected[:limit]
    projected = sum(1 for e in shown if e["valuation_is_projected"])
    payload = {
        "events": shown,
        "returned": len(shown),
        "matched": len(selected),
        # Say so rather than letting the model total a truncated list and
        # present the answer as complete.
        "truncated": len(selected) > limit,
        "priced_to": priced_to.isoformat() if priced_to else None,
    }
    if projected:
        payload["projection_warning"] = (
            f"{projected} of these events fall after the newest real valuation "
            f"({priced_to}), so every figure on them — value, income, gains — is "
            "computed from prices the user assumed for planning. The dates and "
            "share counts are real; the money is not. Say which is which, and "
            "do not total projected figures into a headline number."
        )
    return payload


register(Tool(
    name="list_events",
    title="Vesting and cash-flow timeline",
    description=(
        "The computed timeline: vesting tranches, share price changes, loan "
        "payments and payoffs, sales, and the running totals after each. These "
        "are calculated from grants, prices and loans on every request, never "
        "stored, so this is always current. Filter by date range or event type "
        "rather than pulling everything."
    ),
    input_schema=object_schema({
        "from_date": {"type": "string", "description": "Only events on or after this date (YYYY-MM-DD)."},
        "to_date": {"type": "string", "description": "Only events on or before this date (YYYY-MM-DD)."},
        "event_types": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Filter to these event types, e.g. ['Vesting'], ['Share Price'], "
                "['Sale']. Case-insensitive. Omit for all types."
            ),
        },
        "limit": {
            "type": "integer",
            "description": f"Maximum events to return. Default {DEFAULT_EVENT_LIMIT}, ceiling {MAX_EVENTS}.",
        },
        "account": ACCOUNT_PROPERTY,
    }),
    scope=EQUITY_READ,
    handler=_list_events,
))


def _list_grants(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)
    return {"grants": _rows(Grant, owner, ctx.db, Grant.year)}


register(Tool(
    name="list_grants",
    title="Equity grants",
    description=(
        "Every grant on the account: year, type (Purchase, Catch-up, Free, "
        "Bonus, Developer Bonus Shares), share count, purchase price per share, "
        "vesting start and number of vesting periods, and exercise date. Use "
        "`explain` with topic 'grant_types' for what each type means for tax."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=EQUITY_READ,
    handler=_list_grants,
))


def _list_loans(ctx: ToolContext, args: dict):
    from scaffold.models import LoanPayment

    owner = _account(ctx, args)
    loans = _rows(Loan, owner, ctx.db, Loan.due_date)
    paid: dict[int, float] = {}
    for payment in ctx.db.query(LoanPayment).filter(LoanPayment.user_id == owner.id).all():
        paid[payment.loan_id] = paid.get(payment.loan_id, 0.0) + payment.amount
    for loan in loans:
        already = paid.get(loan["id"], 0.0)
        loan["paid_early"] = round(already, 2)
        loan["balance"] = round(max(0.0, (loan.get("amount") or 0.0) - already), 2)
    return {"loans": loans}


register(Tool(
    name="list_loans",
    title="Loans against equity",
    description=(
        "Loans tied to grants — the ones that funded a purchase, plus interest "
        "and tax loans: amount, interest rate, due date, early payments made "
        "and the balance outstanding."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=EQUITY_READ,
    handler=_list_loans,
))


def _list_prices(ctx: ToolContext, args: dict):
    """Real valuations by default; the user's projections only if asked for.

    Returning both in one ascending list invited exactly one mistake: read the
    last row as the current price. On an account that projects out to 2034 that
    is a decade of invented growth reported as fact. Projecting the future is
    the app's job — it has a simulator for it — so this hands over what is
    known and names the current price rather than leaving it to be inferred.
    """
    owner = _account(ctx, args)
    today = date.today()
    rows = _rows(Price, owner, ctx.db, Price.effective_date)

    actual = [p for p in rows if not p.get("is_estimate")]
    projected = [p for p in rows if p.get("is_estimate")]

    in_effect = None
    for p in actual:
        if _as_date(p.get("effective_date")) and _as_date(p["effective_date"]) <= today:
            in_effect = p

    payload = {
        "current_price": in_effect.get("price") if in_effect else None,
        "current_price_date": in_effect.get("effective_date") if in_effect else None,
        "prices": actual,
        "note": (
            "Real valuations only. Each applies forward until the next one, so "
            "current_price is the one in effect today."
        ),
    }
    if in_effect is None:
        payload["note"] += (
            " This account has no real valuation dated on or before today, so "
            "there is no current price to report."
        )

    if _flag(args, "include_projections"):
        payload["projected_prices"] = projected
        payload["projection_warning"] = (
            "These are the user's own assumptions entered into the app's "
            "planner, not valuations and not a forecast by anyone else. Never "
            "present a projected price as the current or expected price, and "
            "never total them into a figure without saying they are assumed."
        )
    elif projected:
        payload["note"] += (
            f" The account also holds {len(projected)} projected price(s) the "
            "user entered for planning; pass include_projections to see them."
        )
    return payload


register(Tool(
    name="list_prices",
    title="Share price history",
    description=(
        "The share price history the account's figures are computed from: an "
        "effective date and a price per share, each applying until the next "
        "entry. Future-dated entries flagged as estimates are the user's "
        "projections, not real valuations — say so when using them."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=EQUITY_READ,
    handler=_list_prices,
))


def _list_sales(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)
    return {"sales": _rows(Sale, owner, ctx.db, Sale.date)}


register(Tool(
    name="list_sales",
    title="Share sales",
    description=(
        "Sales recorded on the account, past and planned: date, shares, price "
        "per share, and which lots were used. A future-dated sale is a plan, "
        "not something that happened."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=EQUITY_READ,
    handler=_list_sales,
))


def _estimate_sale(ctx: ToolContext, args: dict):
    from app.routers.sales import estimate_sale

    owner = _account(ctx, args)
    price = _opt_float(args, "price_per_share")
    if price is None:
        raise ValueError("'price_per_share' is required — the price to model the sale at")
    if price <= 0:
        raise ValueError("'price_per_share' must be greater than zero")

    shares = _opt_int(args, "shares")
    target = _opt_float(args, "target_net_cash")
    if shares is None and target is None:
        raise ValueError(
            "Give either 'shares' (how many to sell) or 'target_net_cash' "
            "(how much cash is needed after tax)"
        )
    if shares is not None and target is not None:
        raise ValueError("Give 'shares' or 'target_net_cash', not both")
    if shares is not None and shares <= 0:
        raise ValueError("'shares' must be greater than zero")

    sale_date = _opt_date(args, "sale_date")
    return estimate_sale(
        price_per_share=price,
        target_net_cash=target,
        shares=shares,
        sale_date=sale_date.isoformat() if sale_date else None,
        loan_id=_opt_int(args, "loan_id"),
        grant_year=None,
        grant_type=None,
        user=owner,
        db=ctx.db,
    )


register(Tool(
    name="estimate_sale",
    title="Estimate a sale",
    description=(
        "Model a sale without recording it: gross proceeds, estimated tax and "
        "net cash. Give 'shares' to price a specific number, or "
        "'target_net_cash' to work backwards to how many shares are needed to "
        "clear that much after tax. Nothing is saved. You supply "
        "price_per_share, so the answer is only as real as that price — use "
        "current_price from list_prices unless the user asks for a "
        "what-if, and say which you used."
    ),
    input_schema=object_schema({
        "price_per_share": {"type": "number", "description": "Price per share to model the sale at."},
        "shares": {"type": "integer", "description": "How many shares to sell."},
        "target_net_cash": {
            "type": "number",
            "description": "Cash needed after tax; the tool works out the share count.",
        },
        "sale_date": {"type": "string", "description": "Date of the sale (YYYY-MM-DD). Defaults to today."},
        "loan_id": {"type": "integer", "description": "Check whether the proceeds would clear this loan."},
        "account": ACCOUNT_PROPERTY,
    }, required=["price_per_share"]),
    scope=EQUITY_READ,
    handler=_estimate_sale,
))


def _get_tax_breakdown(ctx: ToolContext, args: dict):
    from fastapi import HTTPException

    from app.routers.sales import get_sale_tax

    owner = _account(ctx, args)
    sale_id = _opt_int(args, "sale_id")
    if sale_id is None:
        raise ValueError("'sale_id' is required — get it from list_sales")
    try:
        return get_sale_tax(sale_id, owner, ctx.db)
    except HTTPException as exc:
        # A missing sale is the model citing a stale id, not a server fault.
        raise ValueError(f"No sale with id {sale_id} on this account") from exc


register(Tool(
    name="get_tax_breakdown",
    title="Tax on a sale",
    description=(
        "The full tax working for one recorded sale: which lots it consumes, "
        "ordinary income, short- and long-term capital gains, and the tax on "
        "each. Get the sale id from list_sales."
    ),
    input_schema=object_schema({
        "sale_id": {"type": "integer", "description": "Which sale, from list_sales."},
        "account": ACCOUNT_PROPERTY,
    }, required=["sale_id"]),
    scope=EQUITY_READ,
    handler=_get_tax_breakdown,
))


# ── explanation ─────────────────────────────────────────────────────────────
#
# Without this an assistant guesses at how the scheme works, and equity schemes
# are exactly the thing a general model guesses wrong. The prose describes the
# data model, which is stable; every specific figure comes from the content
# tables at request time and none of it is hardcoded.

_TOPICS: dict[str, str] = {
    "vesting": (
        "Vesting is how ownership is earned over time. Until a tranche vests the "
        "shares cannot be sold. Each grant has a vesting start date and a number "
        "of periods; the timeline from list_events is computed from those, never "
        "stored, so it always reflects the current grants and prices."
    ),
    "grant_types": (
        "Purchase grants are bought at the grant-time fair market value, usually "
        "funded by a loan, and vesting only lifts the sale restriction. Catch-up, "
        "Free and Developer Bonus Shares grants have a zero cost basis, so the "
        "market value of each tranche is ordinary income at vest. Bonus grants "
        "are either kind: the earliest were pre-tax with a zero basis, later ones "
        "post-tax at market value and so behave like a purchase."
    ),
    "taxes": (
        "Two taxable moments. First, for zero-basis grants, the market value of "
        "each vesting tranche is ordinary income on the vest date, and that value "
        "becomes the cost basis. Purchase and post-tax bonus grants skip this — "
        "their basis is what was paid. Second, selling above the cost basis is a "
        "capital gain: long-term where the lot has been held at least the "
        "configured holding period from its vest date, short-term otherwise, and "
        "short-term is taxed at the ordinary income rate."
    ),
    "lots": (
        "A lot is the shares from one vesting event — one grant, one vest date, "
        "one cost basis. A sale consumes lots in the order set by the account's "
        "lot selection method, and which lots are consumed changes the tax, which "
        "is why estimate_sale and get_tax_breakdown report the allocation."
    ),
    "prices": (
        "Two prices are always in play: the grant or purchase price, fixed when "
        "the grant was made and zero for zero-basis grants, and the share price "
        "or fair market value, which changes over time. The spread between them "
        "drives every tax figure. This is a private company, so the market price "
        "is set periodically rather than quoted continuously."
    ),
    "data_model": (
        "Everything derives from four tables at request time — grants, prices, "
        "loans and sales. Vesting and payoff events are computed on every "
        "request and never saved, so a changed price or date recalculates the "
        "whole timeline immediately and nothing goes stale."
    ),
}


def _explain(ctx: ToolContext, args: dict):
    topic = args.get("topic")
    if not isinstance(topic, str) or topic.strip().lower() not in _TOPICS:
        raise ValueError(
            f"Unknown topic. Choose one of: {', '.join(sorted(_TOPICS))}"
        )
    topic = topic.strip().lower()

    payload: dict = {"topic": topic, "explanation": _TOPICS[topic]}

    if topic in ("grant_types", "vesting"):
        from app.content_service import load_content
        content = load_content(ctx.db)
        payload["grant_schedule"] = content.get("grantTemplates") or content.get("grant_templates")
    return payload


register(Tool(
    name="explain",
    title="How this equity scheme works",
    description=(
        "How this particular scheme works — vesting, grant types, how tax is "
        "computed, what a lot is, and why two prices matter. Read the relevant "
        "topic before reasoning about someone's numbers rather than assuming "
        "the usual RSU rules; several of them do not apply here."
    ),
    input_schema=object_schema({
        "topic": {
            "type": "string",
            "enum": sorted(_TOPICS),
            "description": "Which topic to explain.",
        },
    }, required=["topic"]),
    scope=EQUITY_READ,
    handler=_explain,
))


# ── compensation ────────────────────────────────────────────────────────────

def _get_compensation(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)
    return {
        "entries": owner.comp_entries or [],
        "note": "Salary and bonus history the user entered for the comp calculator.",
    }


register(Tool(
    name="get_compensation",
    title="Salary and bonus history",
    description=(
        "The salary and bonus entries the user keeps for the total-compensation "
        "calculator. Use with get_dashboard to talk about equity as a share of "
        "total pay."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=COMP_READ,
    handler=_get_compensation,
))


def _get_retirement_params(ctx: ToolContext, args: dict):
    owner = _account(ctx, args)
    return {"params": owner.retirement_params or {}}


register(Tool(
    name="get_retirement_params",
    title="Retirement plan settings",
    description=(
        "The saved inputs to the retirement simulator — target retirement age, "
        "spending assumptions, growth rates and the rest of the scenario the "
        "user last modelled."
    ),
    input_schema=_ACCOUNT_ONLY,
    scope=COMP_READ,
    handler=_get_retirement_params,
))
