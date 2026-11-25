from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from schemas import InputModel
from pydantic import Field
from scaffold.auth import get_current_user
from scaffold.models import User
from app.changes import ChangeError, apply_changes

router = APIRouter(prefix="/api/changes", tags=["changes"])


class ChangeSet(InputModel):
    changes: list[dict]
    confirm: str | None = None
    onboarding_token: str | None = Field(default=None, max_length=48)


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
def apply(body: ChangeSet, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save the change set previewed with this `confirm` token, all or nothing."""
    if not body.confirm:
        raise HTTPException(status_code=422, detail={"message": "Preview first and send its confirm token", "index": None})
    result = _run(body, user, db, body.confirm)
    if body.onboarding_token:
        from scaffold import onboarding
        if request.headers.get('dnt') == '1':
            onboarding.safely(db, lambda: onboarding.forget(db, body.onboarding_token))
        elif body.changes:
            onboarding.safely(db, lambda: onboarding.saved(db, body.onboarding_token, user))
    return result
