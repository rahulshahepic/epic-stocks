"""Preview and apply account edits all-or-nothing.

The web import, the AI connector and anything else that writes several rows
go through here. Row edits use the same router functions as the app's forms.
Retirement updates use the simulator's named-field validation. Both share the
transaction and confirmation token that bind the apply to the preview.
"""
import hashlib
import hmac
import json
import re
from datetime import date
from time import time

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import ValidationError

from scaffold.models import Grant, Loan, LoanPayment, Price, Sale, User, LoanInterestCheckpoint

KINDS = ("grant", "loan", "price", "sale", "loan_payment", "interest_checkpoint")
RETIREMENT_PARAMS = "retirement_params"
ACTIONS = ("create", "update", "delete")
MAX_CHANGES = 200
CONFIRMATION_TTL_SECONDS = 30 * 60
_CONFIRMATION = re.compile(r"(?P<issued>[0-9]{1,12})\.[0-9a-f]{32}")
# Deletes leave children first; creates and edits build parents first.
_DELETE_ORDER = ("sale", "interest_checkpoint", "loan_payment", "loan", "grant", "price")
_WRITE_ORDER = ("price", "grant", "loan", "loan_payment", "sale", "interest_checkpoint", RETIREMENT_PARAMS)
_MODELS = {"grant": Grant, "loan": Loan, "price": Price, "sale": Sale, "loan_payment": LoanPayment, "interest_checkpoint": LoanInterestCheckpoint}
_SUMMARY = ("vested_shares", "held_vested_shares", "shares_at_end_of_schedule",
            "total_stock_value", "outstanding_loan_balance", "net_equity", "current_price", "accrued_unbooked_interest", "interest_reconciliation")


class ChangeError(ValueError):
    def __init__(self, message: str, index: int | None = None):
        super().__init__(message)
        self.index = index


class _Uncommitted:
    """The session, with commit and close turned into flush and no-op, so a
    router function's own commit joins this transaction instead of ending it."""

    def __init__(self, db):
        self._db = db

    def commit(self):
        self._db.flush()

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._db, name)


def _handlers():
    from app.routers import grants, loans, prices, sales, interest_checkpoints
    import schemas as s
    return {
        "interest_checkpoint": (s.LoanInterestCheckpointCreate, s.LoanInterestCheckpointUpdate,
                                interest_checkpoints.create_checkpoint, interest_checkpoints.update_checkpoint,
                                interest_checkpoints.delete_checkpoint),
        "grant": (s.GrantCreate, s.GrantUpdate, grants.create_grant, grants.update_grant, grants.delete_grant),
        "loan": (s.LoanCreate, s.LoanUpdate, loans.create_loan, loans.update_loan, loans.delete_loan),
        "price": (s.PriceCreate, s.PriceUpdate, prices.create_price, prices.update_price, prices.delete_price),
        "sale": (s.SaleCreate, s.SaleUpdate, sales.create_sale, sales.update_sale, sales.delete_sale),
        "loan_payment": (s.LoanPaymentCreate, s.LoanPaymentUpdate, loans.create_loan_payment,
                         loans.update_loan_payment, loans.delete_loan_payment),
    }


def _normalize(changes, kinds) -> list[dict]:
    if not isinstance(changes, list) or not changes:
        raise ChangeError("Send a non-empty list of changes")
    if len(changes) > MAX_CHANGES:
        raise ChangeError(f"At most {MAX_CHANGES} changes at once")
    out = []
    for i, c in enumerate(changes):
        if not isinstance(c, dict):
            raise ChangeError("Each change is an object", i)
        kind, action = c.get("kind"), c.get("action")
        if kind not in kinds or action not in ACTIONS:
            raise ChangeError(f"kind must be one of {', '.join(kinds)} and action one of {', '.join(ACTIONS)}", i)
        row_id, version, values = c.get("id"), c.get("version"), c.get("values") or {}
        if kind == RETIREMENT_PARAMS:
            if action != "update" or row_id is not None or version is not None:
                raise ChangeError("Retirement settings take an update without a row id or version", i)
        elif action != "create" and (type(row_id) is not int or row_id < 1 or type(version) is not int):
            raise ChangeError("An update or delete names the row's id and current version", i)
        if action == "create" and row_id is not None:
            raise ChangeError("A new row has no id", i)
        if not isinstance(values, dict) or (action != "delete" and not values):
            raise ChangeError("values must be an object of fields", i)
        note = c.get("note")
        if note is not None and (not isinstance(note, str) or len(note) > 200):
            raise ChangeError("note is a short piece of text", i)
        out.append({"index": i, "kind": kind, "action": action, "id": row_id,
                    "version": version, "values": values, "note": note})
    order = lambda c: ((0, _DELETE_ORDER.index(c["kind"])) if c["action"] == "delete"
                       else (1, _WRITE_ORDER.index(c["kind"])), c["index"])
    return sorted(out, key=order)


def _plain(v):
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


def _label(kind, row) -> str:
    if row is None:
        return kind
    if kind == "grant":
        return f"{row.year} {row.type} grant"
    if kind == "loan":
        return f"{row.grant_year} {row.grant_type} {row.loan_type} loan ({row.loan_year})"
    if kind == "price":
        return f"Share price from {row.effective_date.isoformat()}"
    if kind == "sale":
        return f"Sale on {row.date.isoformat()}"
    if kind == "interest_checkpoint":
        return f"Interest checkpoint for loan {row.loan_id} through {row.accrued_through.isoformat()}"
    return f"Loan payment on {row.date.isoformat()}"


def _snapshot(kind, row, fields) -> dict:
    from services.vesting import schedule_of
    out = {}
    for f in fields:
        if kind == "grant" and f == "vesting":
            out[f] = [{"date": d.isoformat(), "shares": n} for d, n in schedule_of(row)]
        elif hasattr(row, f):
            out[f] = _plain(getattr(row, f))
    return out


def _fingerprint(user, db) -> str:
    rows = []
    for kind, model in _MODELS.items():
        for rid, ver in db.query(model.id, model.version).filter(model.user_id == user.id):
            rows.append((kind, rid, ver))
    retirement_hash = hashlib.sha256(json.dumps(user.retirement_params, sort_keys=True).encode()).hexdigest()
    return hashlib.sha256(json.dumps([sorted(rows), retirement_hash]).encode()).hexdigest()


def confirmation(user, db, changes, account_state, confirm: str | None = None) -> str:
    """Issue or validate a token under the caller's account row lock."""
    from scaffold.auth import JWT_SECRET

    now = int(time())
    match = _CONFIRMATION.fullmatch(confirm) if isinstance(confirm, str) else None
    invalid = "The account or the changes differ from the preview; preview again and confirm that"
    if confirm is not None and match is None:
        raise ChangeError(invalid)
    issued = int(match["issued"]) if match else now
    generation = user.session_version
    if user.is_synthetic:
        from scaffold.models import MCPTestAccount, ReviewerAccount
        reviewer = db.query(ReviewerAccount.generation).filter(ReviewerAccount.user_id == user.id).scalar()
        fixture = db.query(MCPTestAccount.generation).filter(MCPTestAccount.synthetic_id == user.id).scalar()
        fixture = reviewer or fixture
        if fixture is None:
            raise ChangeError("Synthetic fixture is unavailable; preview again after setup")
        generation = fixture
    body = json.dumps({"changes": changes, "user": user.id, "generation": generation,
                       "account": account_state, "issued": issued,
                       "version": user.change_confirmation_version}, sort_keys=True, default=str)
    digest = hmac.new(JWT_SECRET.encode(), b"account-changes:" + body.encode(), hashlib.sha256).hexdigest()[:32]
    token = f"{issued}.{digest}"
    if confirm is not None:
        if not hmac.compare_digest(confirm, token) or issued > now:
            raise ChangeError(invalid)
        if now - issued >= CONFIRMATION_TTL_SECONDS:
            raise ChangeError("The confirmation expired; preview again before saving")
    return token


def _position(user, db) -> dict:
    from app.routers.events import _get_dashboard_data
    data = _get_dashboard_data(user, _Uncommitted(db), as_of=date.today())
    return {k: data.get(k) for k in _SUMMARY if k in data}


def _run(c, owner, db, handlers):
    kind, values = c["kind"], dict(c["values"])
    if kind == RETIREMENT_PARAMS:
        from app.expense_funding import sync_funding_plans
        from app.retirement_simulation import validate_changes, validate_combined

        patch = validate_changes(values)
        previous = owner.retirement_params if isinstance(owner.retirement_params, dict) else {}
        merged = {**previous, **patch}
        if "epicExit" in patch and "epicExitMode" not in patch:
            merged["epicExitMode"] = "manual"
        if c.get("show_account_breakdown") and any(merged.get(k) for k in ("traditional", "roth", "additionalBasis")):
            merged["advanced"] = True
        validate_combined(merged)
        sync_funding_plans(merged, previous)
        owner.retirement_params = merged
        db.flush()
        diff = {k: {"from": previous.get(k), "to": merged.get(k)}
                for k in patch if previous.get(k) != merged.get(k)}
        return {"kind": kind, "action": "update", "label": "Retirement settings", "changes": diff}

    create_model, update_model, create, update, delete = handlers[kind]
    if kind in {"loan_payment", "interest_checkpoint"} and "loan_id" not in values and values.get("loan_number"):
        matches = db.query(Loan).filter(Loan.user_id == owner.id).all()
        hit = [l for l in matches if l.loan_number == values["loan_number"]]
        if len(hit) != 1:
            raise ChangeError("loan_number must name exactly one loan", c["index"])
        values = {**{k: v for k, v in values.items() if k != "loan_number"}, "loan_id": hit[0].id}
    model = _MODELS[kind]
    fields = set(values) - {"version"} | ({"vesting"} if kind == "grant" else set())
    before = None
    if c["action"] != "create":
        before = db.query(model).filter(model.user_id == owner.id, model.id == c["id"]).first()
        if before is None or before.version != c["version"]:
            raise ChangeError("That row is missing or changed since it was read; read it again", c["index"])
        label = _label(kind, before)
        old = _snapshot(kind, before, fields if c["action"] == "update" else ())
    if c["action"] == "delete":
        delete(c["id"], user=owner, db=db)
        return {"kind": kind, "action": "delete", "id": c["id"], "label": label}
    body = (create_model if c["action"] == "create" else update_model).model_validate(
        {**values, **({"version": c["version"]} if c["action"] == "update" else {})})
    if kind == "loan" and c["action"] == "create":
        row = create(body, generate_payoff_sale=True, user=owner, db=db)
    elif kind == "loan":
        owned = db.query(Sale).filter(Sale.user_id == owner.id, Sale.loan_id == c["id"],
                                      Sale.is_generated.is_(True)).first() is not None
        row = update(c["id"], body, regenerate_payoff_sale=owned, user=owner, db=db)
    elif c["action"] == "create":
        row = create(body, user=owner, db=db)
    else:
        row = update(c["id"], body, user=owner, db=db)
    if isinstance(row, Response):
        raise ChangeError("That row changed since it was read; read it again", c["index"])
    db.flush()
    row = db.query(model).filter(model.id == row.id).first()
    new = _snapshot(kind, row, fields)
    if c["action"] == "create":
        return {"kind": kind, "action": "create", "id": row.id, "label": _label(kind, row), "values": new}
    diff = {k: {"from": old.get(k), "to": new.get(k)} for k in new if old.get(k) != new.get(k)}
    return {"kind": kind, "action": "update", "id": row.id, "label": label, "changes": diff}


def apply_changes(owner: User, db, changes, *, confirm: str | None = None,
                  retirement_only: bool = False, show_account_breakdown: bool = False) -> dict:
    """Preview (no `confirm`) or apply (`confirm` from that preview) a change set.

    Either way every edit runs for real inside one transaction; a preview rolls
    it back, an apply commits it. One failing edit fails them all.
    Only the dedicated compensation MCP tools opt into retirement changes.
    """
    from app import event_cache
    from scaffold.epic_mode import is_epic_mode

    if not retirement_only and is_epic_mode():
        raise ChangeError("Equity is managed externally on this deployment")
    ordered = _normalize(changes, (RETIREMENT_PARAMS,) if retirement_only else KINDS)
    if retirement_only:
        if len(ordered) != 1:
            raise ChangeError("Send one retirement settings update")
        ordered[0]["show_account_breakdown"] = show_account_breakdown
    canonical = [{k: v for k, v in c.items() if k not in ("index", "note")} for c in
                 sorted(ordered, key=lambda c: c["index"])]
    session = _Uncommitted(db)
    try:
        # Reload under the lock: auth may have loaded this User before another
        # request committed a retirement write.
        db.refresh(owner, with_for_update=True)
        token = confirmation(owner, db, canonical, _fingerprint(owner, db), confirm)
        position = {} if retirement_only else {"position_before": _position(owner, db)}
        handlers = {} if retirement_only else _handlers()
        results = [None] * len(ordered)
        for c in ordered:
            try:
                results[c["index"]] = {**_run(c, owner, session, handlers),
                                       **({"note": c["note"]} if c["note"] else {})}
            except ChangeError:
                raise
            except HTTPException as exc:
                raise ChangeError(str(exc.detail), c["index"]) from None
            except ValidationError as exc:
                raise ChangeError("; ".join(
                    (".".join(map(str, e["loc"])) + ": " if e["loc"] else "") + e["msg"]
                    for e in exc.errors()), c["index"]) from None
            except ValueError as exc:
                raise ChangeError(str(exc), c["index"]) from None
        if not retirement_only:
            position["position_after"] = _position(owner, db)
    except Exception:
        db.rollback()
        raise
    if confirm is None:
        db.rollback()
        return {"applied": False, "changes": results, **position, "confirm": token}
    owner.change_confirmation_version += 1
    db.commit()
    if not retirement_only:
        event_cache.schedule_recompute(owner.id)
    return {"applied": True, "changes": results, **position}
