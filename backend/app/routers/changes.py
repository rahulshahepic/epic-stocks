from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import InputModel
from scaffold.auth import get_current_user
from scaffold.models import User
from app.changes import ChangeError, apply_changes

router = APIRouter(prefix="/api/changes", tags=["changes"])


class ChangeSet(InputModel):
    changes: list[dict]
    confirm: str | None = None


def _run(body: ChangeSet, user: User, db: Session, confirm):
    try:
        return apply_changes(user, db, body.changes, confirm=confirm)
    except ChangeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "index": exc.index}) from None


@router.post("/preview")
def preview(body: ChangeSet, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What the change set would do, without saving it."""
    return _run(body, user, db, None)


@router.post("/apply")
def apply(body: ChangeSet, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save the change set previewed with this `confirm` token, all or nothing."""
    if not body.confirm:
        raise HTTPException(status_code=422, detail={"message": "Preview first and send its confirm token", "index": None})
    return _run(body, user, db, body.confirm)
