"""Chat-driven equity entry using the same validated writes as the app.

Each call changes one row. Edits and removals require the version returned by
the read tool, so an old conversation cannot silently overwrite newer work.
"""
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import ValidationError

from scaffold.epic_mode import is_epic_mode
from scaffold.models import Grant, Loan, Price, Sale, User
from scaffold.oauth.scopes import EQUITY_WRITE
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register


def _save(ctx: ToolContext, args: dict):
    from app.routers import grants, loans, prices, sales
    from schemas import (GrantCreate, GrantUpdate, LoanCreate, LoanUpdate,
                         PriceCreate, PriceUpdate, SaleCreate, SaleUpdate)

    if is_epic_mode():
        raise ValueError("Equity is managed externally on this deployment")
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    kind, values = args.get("kind"), args.get("values")
    choices = {
        "grant": (Grant, GrantCreate, GrantUpdate, grants.create_grant, grants.update_grant),
        "loan": (Loan, LoanCreate, LoanUpdate, loans.create_loan, loans.update_loan),
        "price": (Price, PriceCreate, PriceUpdate, prices.create_price, prices.update_price),
        "sale": (Sale, SaleCreate, SaleUpdate, sales.create_sale, sales.update_sale),
    }
    if kind not in choices or not isinstance(values, dict):
        raise ValueError("Choose kind grant, loan, price or sale and supply a values object")
    row_id = args.get("id")
    if row_id is not None and (type(row_id) is not int or row_id < 1):
        raise ValueError("id must be a positive integer from a list tool")
    if row_id is not None and (type(values.get("version")) is not int or values["version"] < 1):
        raise ValueError("For a correction, include the row's version from the list tool")
    model, create_model, update_model, create, update = choices[kind]
    if row_id:
        ctx.db.query(User).filter(User.id == owner.id).with_for_update().first()
        row = ctx.db.query(model).filter(model.user_id == owner.id, model.id == row_id).first()
        if row is None or row.version != values["version"]:
            raise ValueError("Row missing or changed since you read it; list it again before correcting")
    try:
        body = (update_model if row_id else create_model).model_validate(values)
        if kind == "loan":
            # The app's own defaults: a new loan gets its payoff sale, an edit
            # leaves the sale alone. A loan entered in chat must produce the
            # same timeline as the same loan entered on the Loans page.
            result = (update(row_id, body, regenerate_payoff_sale=True, user=owner, db=ctx.db)
                      if row_id else create(body, generate_payoff_sale=True, user=owner, db=ctx.db))
        else:
            result = (update(row_id, body, user=owner, db=ctx.db)
                      if row_id else create(body, user=owner, db=ctx.db))
    except ValidationError as exc:
        raise ValueError(str(exc)) from None
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from None
    if isinstance(result, Response):
        raise ValueError("Row changed since you read it; list it again before correcting")
    return {"saved": kind, "row": (update_model if row_id else create_model).model_validate(
        values).model_dump(mode="json"), "id": result.id, "version": result.version,
        "next_step": "Read the account again to verify the resulting position."}


register(Tool(
    name="save_equity", title="Add or correct equity data", scope=EQUITY_WRITE,
    description=(
        "Create or update ONE grant, loan, share price or sale immediately. Read "
        "get_import_guide and the existing rows first. For a grant outside the "
        "company schedule or shifted by leave, ask the user to confirm the "
        "vesting start date, first vesting year, number of annual periods, "
        "exercise date and whether cost basis is zero (taxed as income when "
        "vesting). Never infer those from a similar name. A sale requires its "
        "actual date, shares and per-share price; never infer a transaction "
        "from shares missing in a statement. When updating, send only changed "
        "fields plus version, and use the id from list_grants/list_loans/"
        "list_prices/list_sales. Loan interest_rate is a fraction. Ask the "
        "user to approve the exact write before calling. Reads after writing "
        "show whether the resulting position makes sense."
    ),
    input_schema=object_schema({
        "kind": {"type": "string", "enum": ["grant", "loan", "price", "sale"]},
        "values": {"type": "object", "description": "Fields of the matching create/update endpoint; updates include version."},
        "id": {"type": "integer", "description": "Existing row id for correction; omit to create."},
        "account": ACCOUNT_PROPERTY,
    }, required=["kind", "values"]),
    handler=_save, read_only=False, idempotent=False,
))


def _remove(ctx: ToolContext, args: dict):
    from app.routers import grants, loans, prices, sales

    if is_epic_mode():
        raise ValueError("Equity is managed externally on this deployment")
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    kind, row_id, version = args.get("kind"), args.get("id"), args.get("version")
    choices = {
        "grant": (Grant, grants.delete_grant), "loan": (Loan, loans.delete_loan),
        "price": (Price, prices.delete_price), "sale": (Sale, sales.delete_sale),
    }
    if kind not in choices or type(row_id) is not int or row_id < 1 or type(version) is not int:
        raise ValueError("Choose a kind and give its positive id and current version")
    model, delete = choices[kind]
    ctx.db.query(User).filter(User.id == owner.id).with_for_update().first()
    row = ctx.db.query(model).filter(model.user_id == owner.id, model.id == row_id).first()
    if row is None or row.version != version:
        raise ValueError("Row missing or changed since you read it; list it again before removing")
    try:
        delete(row_id, user=owner, db=ctx.db)
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from None
    return {"removed": kind, "id": row_id}


register(Tool(
    name="remove_equity", title="Remove an incorrect equity row", scope=EQUITY_WRITE,
    description=("Remove one row immediately after the user explicitly confirms "
                 "its kind and id. Read the row first, including its version. "
                 "Deleting grants with attached loans is refused. Never remove "
                 "rows merely because an uploaded document does not mention them."),
    input_schema=object_schema({
        "kind": {"type": "string", "enum": ["grant", "loan", "price", "sale"]},
        "id": {"type": "integer"}, "version": {"type": "integer"},
        "account": ACCOUNT_PROPERTY,
    }, required=["kind", "id", "version"]),
    handler=_remove, read_only=False, idempotent=False, destructive=True,
))
