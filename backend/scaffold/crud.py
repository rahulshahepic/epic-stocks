"""The three things every user-owned CRUD endpoint does.

Fetch one of the caller's own rows or 404. Refuse a write that would clobber an
edit made somewhere else. Apply the fields the caller actually sent and bump the
row's version. Each of these was written out at all sixteen call sites, which is
sixteen chances for one of them to leave out the `user_id` filter.
"""
from typing import TypeVar

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from scaffold.models import User

T = TypeVar("T")


def get_owned(db: Session, model: type[T], row_id: int, user: User, name: str) -> T:
    """One of this user's rows, or a 404.

    The `user_id` filter is the access check — a row belonging to someone else is
    reported as missing, not as forbidden, so an id cannot be probed for.
    """
    row = db.query(model).filter(model.id == row_id, model.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{name} not found")
    return row


def version_conflict(row, submitted_version: int | None) -> JSONResponse | None:
    """The 409 a stale write earns, or None to carry on.

    A client that sends no version is not doing optimistic locking and is let
    through; the frontend turns the 409 into "changed on another device".
    """
    if submitted_version is not None and row.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": row.version},
        )
    return None


def apply_update(row, body) -> dict:
    """Write the fields the caller actually sent, bump the version, return what changed.

    `exclude_unset` is what separates "set this to null" from "leave this alone",
    so it must stay; `version` is the lock, never a column to copy over.
    """
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(row, k, v)
    row.version = row.version + 1
    return updates
