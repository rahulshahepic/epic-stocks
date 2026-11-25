"""One way to change an account's equity: a list of row edits, previewed, then
applied all-or-nothing.

The web import, the AI connector and anything else that writes several rows
go through here. Every edit runs through the same router function the app's
own forms call, so validation is never re-implemented; this module only adds
the transaction around them, the preview, and a confirmation token that ties
an apply to the exact preview the person saw.
"""
import hashlib
import json
from datetime import date

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import ValidationError

from scaffold.models import Grant, Loan, LoanPayment, Price, Sale, User, LoanInterestCheckpoint

KINDS = ("grant", "loan", "price", "sale", "loan_payment", "interest_checkpoint")
ACTIONS = ("create", "update", "delete")
MAX_CHANGES = 200
# Deletes leave children first; creates and edits build parents first.
_DELETE_ORDER = ("sale", "interest_checkpoint", "loan_payment", "loan", "grant", "price")
_WRITE_ORDER = ("price", "grant", "loan", "loan_payment", "sale", "interest_checkpoint")
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


def _normalize(changes) -> list[dict]:
    if not isinstance(changes, list) or not changes:
        raise ChangeError("Send a non-empty list of changes")
    if len(changes) > MAX_CHANGES:
        raise ChangeError(f"At most {MAX_CHANGES} changes at once")
    out = []
    for i, c in enumerate(changes):
        if not isinstance(c, dict):
            raise ChangeError("Each change is an object", i)
        kind, action = c.get("kind"), c.get("action")
        if kind not in KINDS or action not in ACTIONS:
            raise ChangeError(f"kind must be one of {', '.join(KINDS)} and action one of {', '.join(ACTIONS)}", i)
        row_id, version, values = c.get("id"), c.get("version"), c.get("values") or {}
        if action != "create" and (type(row_id) is not int or row_id < 1 or type(version) is not int):
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
    return hashlib.sha256(json.dumps(sorted(rows)).encode()).hexdigest()


def confirmation(user, db, changes) -> str:
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
                       "account": _fingerprint(user, db)}, sort_keys=True, default=str)
    return hashlib.sha256(body.encode()).hexdigest()[:24]


def _position(user, db) -> dict:
    from app.routers.events import _get_dashboard_data
    data = _get_dashboard_data(user, _Uncommitted(db), as_of=date.today())
    return {k: data.get(k) for k in _SUMMARY if k in data}


def _run(c, owner, db, handlers):
    create_model, update_model, create, update, delete = handlers[c["kind"]]
    kind, values = c["kind"], dict(c["values"])
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


def apply_changes(owner: User, db, changes, *, confirm: str | None = None) -> dict:
    """Preview (no `confirm`) or apply (`confirm` from that preview) a change set.

    Either way every edit runs for real inside one transaction; a preview rolls
    it back, an apply commits it. One failing edit fails them all.
    """
    from app import event_cache
    from scaffold.epic_mode import is_epic_mode

    if is_epic_mode():
        raise ChangeError("Equity is managed externally on this deployment")
    ordered = _normalize(changes)
    canonical = [{k: c[k] for k in ("kind", "action", "id", "version", "values")} for c in
                 sorted(ordered, key=lambda c: c["index"])]
    db.query(User).filter(User.id == owner.id).with_for_update().first()
    token = confirmation(owner, db, canonical)
    if confirm is not None and confirm != token:
        raise ChangeError("The account or the changes differ from the preview; preview again and confirm that")
    handlers = _handlers()
    session = _Uncommitted(db)
    try:
        before = _position(owner, db)
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
        after = _position(owner, db)
    except Exception:
        db.rollback()
        raise
    if confirm is None:
        db.rollback()
        return {"applied": False, "changes": results, "position_before": before,
                "position_after": after, "confirm": token}
    db.commit()
    event_cache.schedule_recompute(owner.id)
    return {"applied": True, "changes": results, "position_before": before, "position_after": after}
