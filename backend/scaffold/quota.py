"""Per-user row ceilings for the tables a user can grow at will.

The body limit caps a single request and the mutation rate limit caps how fast
requests arrive; neither caps the total. Without a ceiling a patient stream of
perfectly valid writes still fills the shared disk, which takes every other
user down with it. The limits are far above any real holding: an account that
reaches one has stopped tracking equity and started storing data.
"""
from fastapi import HTTPException
from sqlalchemy import func

ROW_QUOTAS = {
    "Grant": 1_000,
    "Loan": 5_000,
    "Price": 2_000,
    "Sale": 10_000,
    "LoanPayment": 10_000,
}


def check_row_quota(db, model, user_id: int, adding: int = 1) -> None:
    """Raise HTTP 409 when this write would push the user past their row ceiling."""
    limit = ROW_QUOTAS.get(model.__name__)
    if limit is None:
        return
    count = db.query(func.count(model.id)).filter(model.user_id == user_id).scalar() or 0
    if count + adding > limit:
        label = model.__tablename__.replace("_", " ")
        raise HTTPException(
            status_code=409,
            detail=f"Limit reached: an account can hold at most {limit:,} {label}",
        )


def check_row_count(model, count: int) -> None:
    """Raise HTTP 409 when count alone exceeds the ceiling.

    For the replace-everything paths (import, a clearing wizard submit) where
    the incoming rows are the whole table, so the current rows do not count.
    """
    limit = ROW_QUOTAS.get(model.__name__)
    if limit is not None and count > limit:
        label = model.__tablename__.replace("_", " ")
        raise HTTPException(
            status_code=409,
            detail=f"Limit reached: an account can hold at most {limit:,} {label}",
        )
