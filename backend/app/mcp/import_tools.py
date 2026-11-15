"""How an assistant gets someone's equity into the app.

get_import_guide hands over how to read the documents people have, the fields
each kind of row takes, the company schedule and loan rates as starting points,
and what the account already holds. The edits themselves go through
apply_changes (equity_tools.py), previewed and confirmed.
"""
from scaffold.oauth.scopes import EQUITY_READ
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register


def _account_now(owner, db) -> dict:
    """What the account holds, so the assistant adds to it rather than duplicating it."""
    from scaffold.models import Grant, Loan, Price
    from services.vesting import schedule_of

    loans = db.query(Loan).filter(Loan.user_id == owner.id).all()
    return {
        "grants": [
            {"id": g.id, "version": g.version, "year": g.year, "type": g.type, "shares": g.shares,
             "vesting": [{"date": d.isoformat(), "shares": n} for d, n in schedule_of(g)],
             "loans": sum(1 for l in loans if (l.grant_year, l.grant_type) == (g.year, g.type))}
            for g in db.query(Grant).filter(Grant.user_id == owner.id).order_by(Grant.year, Grant.type)
        ],
        "price_years": sorted({p.effective_date.year for p in
                               db.query(Price).filter(Price.user_id == owner.id)}),
    }


def _get_import_guide(ctx: ToolContext, args: dict):
    from app.content_service import load_content
    from app.epic_import import prompt as brief
    from app.epic_import.skeleton import build_skeleton
    from . import import_guide as guide

    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    sk, _ = build_skeleton(load_content(ctx.db))
    return {
        "start_here": guide.START_HERE,
        "reading_documents": guide.READING_DOCUMENTS,
        "talking_to_the_user": guide.TALKING_TO_THE_USER,
        "making_best_guesses": guide.MAKING_BEST_GUESSES,
        "fields": guide.FIELDS,
        "example": guide.EXAMPLE,
        "company_grant_schedule": brief._schedule_table(sk),
        "loan_rates_on_record": brief._rate_table(sk),
        "down_payment_policy": brief._dp_policy(sk),
        "account_now": _account_now(owner, ctx.db),
    }


register(Tool(
    name="get_import_guide",
    title="How to enter equity from documents",
    description=(
        "Read this before entering or correcting someone's equity from a purchase "
        "agreement, loan statement, Eureka file, screenshot or memory: how to read "
        "each document, the fields each row takes, the company vesting schedule and "
        "loan rates as starting points, and what the account already holds. The "
        "edits go through apply_changes."
    ),
    input_schema=object_schema({"account": ACCOUNT_PROPERTY}),
    scope=EQUITY_READ,
    handler=_get_import_guide,
))
