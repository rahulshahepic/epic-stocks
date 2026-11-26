"""Chat edits to equity: one change set, previewed, confirmed, applied.

The same service the web import uses (app/changes.py). A preview runs every
edit for real and rolls back, so what the person is shown is what the app
would store; the apply must carry the preview's confirm token, so it cannot
save something other than what they saw.
"""
from app.changes import KINDS, MAX_CHANGES, ChangeError, apply_changes
from scaffold.oauth.scopes import EQUITY_READ, EQUITY_WRITE
from app.tax_settings import tax_settings_or_defaults
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register


def _apply(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    confirm = args.get("confirm")
    if confirm is not None and not isinstance(confirm, str):
        raise ValueError("confirm is the token a preview returned")
    try:
        result = apply_changes(owner, ctx.db, args.get("changes"), confirm=confirm)
    except ChangeError as exc:
        where = f" (change {exc.index + 1})" if exc.index is not None else ""
        raise ValueError(f"{exc}{where}") from None
    if not result["applied"]:
        result["next_step"] = ("Nothing is saved yet. Walk the person through each change in plain "
                               "words; once they say yes, call apply_changes again with the same "
                               "changes and this confirm token.")
    return result


register(Tool(
    name="apply_changes", title="Add, correct or remove equity records", scope=EQUITY_WRITE,
    description=(
        "Record or correct the person's grants, loans, share prices, sales, loan payments and statement interest checkpoints. This only edits tracking records: it never executes a securities sale, pays a loan or moves money. Hypothetical events remain planning assumptions. Changes run in one "
        "all-or-nothing step. Call it first WITHOUT confirm: that previews — every change is "
        "checked exactly as the app would store it, nothing is saved — and returns each "
        "change, the position before and after, and a confirm token. Show the person what "
        "will change; when they agree, call again with the same changes and the token. "
        "Read get_import_guide first. Each change is {kind, action, id?, version?, values?, "
        "note?}: kind is grant | loan | price | sale | loan_payment | interest_checkpoint; action is create | update "
        "| delete; update and delete need the row's id and version from the list tools; an "
        "update sends only the fields that change. A grant's schedule is `vesting`, a list "
        "of {date, shares} — or vest_start and periods for equal yearly parts. Loan "
        "interest_rate is a fraction (0.045 = 4.5%). Never delete a row merely because a "
        "document does not mention it."
    ),
    input_schema=object_schema({
        "changes": {
            "type": "array", "maxItems": MAX_CHANGES,
            "items": {"type": "object", "properties": {
                "kind": {"type": "string", "enum": list(KINDS)},
                "action": {"type": "string", "enum": ["create", "update", "delete"]},
                "id": {"type": "integer"}, "version": {"type": "integer"},
                "values": {"type": "object"},
                "note": {"type": "string", "description": "Where this came from, e.g. '2026 purchase agreement'."},
            }, "required": ["kind", "action"]},
        },
        "confirm": {"type": "string", "description": "The token from the preview the person agreed to. Valid for 30 minutes. Omit to preview."},
        "account": ACCOUNT_PROPERTY,
    }, required=["changes"]),
    handler=_apply, read_only=False, idempotent=False, destructive=True,
))



def _get_investment_interest_method(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    settings = tax_settings_or_defaults(owner, ctx.db)
    return {"method": settings.investment_interest_method,
            "deduction_enabled": settings.deduct_investment_interest}


def _set_investment_interest_method(ctx: ToolContext, args: dict):
    from app.routers.sales import _save_tax_settings
    from schemas import TaxSettingsUpdate

    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    method = args.get("method")
    if method not in ("accrual", "cash"):
        raise ValueError("method must be accrual or cash")
    _save_tax_settings(owner, ctx.db, TaxSettingsUpdate(investment_interest_method=method))
    return {"method": method}


register(Tool(
    name="get_investment_interest_method", title="Read investment interest projection method",
    scope=EQUITY_READ, handler=_get_investment_interest_method,
    description=("Read the saved investment interest projection method (accrual by default or cash) "
                 "and whether estimated deductions are enabled."),
    input_schema=object_schema({"account": ACCOUNT_PROPERTY}),
))

register(Tool(
    name="set_investment_interest_method", title="Set investment interest projection method",
    scope=EQUITY_WRITE, handler=_set_investment_interest_method, read_only=False, destructive=True,
    description=("With the person's permission, set only the investment interest projection method. "
                 "Accrual counts interest in the year it accrues. Cash counts it in the year it is paid. "
                 "This changes app estimates, not the person's tax return or whether the deduction is enabled."),
    input_schema=object_schema({
        "method": {"type": "string", "enum": ["accrual", "cash"]},
        "account": ACCOUNT_PROPERTY,
    }, required=["method"]),
))
