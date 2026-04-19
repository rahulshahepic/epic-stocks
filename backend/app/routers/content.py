"""Content endpoints for the wizard.

GET /api/content is readable by any logged-in user (content is global, not
per-user).  All write endpoints require content-admin access (is_admin OR
is_content_admin) and mutate the six content tables introduced in Phase 1.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import (
    User,
    GrantTemplate,
    BonusScheduleVariant,
    LoanRate,
    LoanRefinance,
    GrantProgramSettings,
)
from scaffold.auth import get_current_user, get_content_admin_user
from app.content_service import load_content
from schemas import (
    GrantTemplateCreate,
    GrantTemplateUpdate,
    BonusScheduleVariantCreate,
    BonusScheduleVariantUpdate,
    LoanRateCreate,
    LoanRateUpdate,
    LoanRefinanceCreate,
    LoanRefinanceUpdate,
    GrantProgramSettingsUpdate,
)

router = APIRouter(prefix="/api/content", tags=["content"])


@router.get("")
def get_content(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return the full wizard content blob (grant schedule, loan rates, refi chains, etc.)."""
    return load_content(db)


def _commit_or_409(db: Session, msg: str = "Constraint violation"):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=msg)


# ── Grant templates ────────────────────────────────────────────────────────

@router.post("/grant-templates", status_code=201)
def create_grant_template(
    body: GrantTemplateCreate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = GrantTemplate(**body.model_dump())
    db.add(row)
    _commit_or_409(db, "Grant template already exists for this (year, type)")
    db.refresh(row)
    return {"id": row.id}


@router.put("/grant-templates/{tpl_id}", status_code=200)
def update_grant_template(
    tpl_id: int,
    body: GrantTemplateUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(GrantTemplate, tpl_id)
    if not row:
        raise HTTPException(404, "Grant template not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    # Same check_shape invariants as create (Pydantic can't run them on a partial
    # update because fields may come from the stored row).
    if row.show_dp_shares and row.type != "Purchase":
        db.rollback()
        raise HTTPException(422, "show_dp_shares is only valid when type='Purchase'")
    if row.default_catch_up and row.type != "Purchase":
        db.rollback()
        raise HTTPException(422, "default_catch_up is only valid when type='Purchase'")
    if row.zero_basis and row.type == "Purchase":
        db.rollback()
        raise HTTPException(422, "zero_basis is only valid for non-Purchase templates")
    if row.default_purchase_due_date is not None and row.type != "Purchase":
        db.rollback()
        raise HTTPException(422, "default_purchase_due_date is only valid when type='Purchase'")
    if row.default_tax_due_date is not None and not (row.zero_basis or row.default_catch_up):
        db.rollback()
        raise HTTPException(
            422,
            "default_tax_due_date requires zero_basis=True or default_catch_up=True",
        )
    _commit_or_409(db, "Grant template constraint violation")
    return {"id": row.id}


@router.delete("/grant-templates/{tpl_id}", status_code=204)
def delete_grant_template(
    tpl_id: int,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(GrantTemplate, tpl_id)
    if not row:
        raise HTTPException(404, "Grant template not found")
    db.delete(row)
    db.commit()


# ── Bonus schedule variants ────────────────────────────────────────────────

@router.post("/bonus-schedule-variants", status_code=201)
def create_bonus_variant(
    body: BonusScheduleVariantCreate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = BonusScheduleVariant(**body.model_dump())
    db.add(row)
    _commit_or_409(db, "Bonus variant already exists")
    db.refresh(row)
    return {"id": row.id}


@router.put("/bonus-schedule-variants/{vid}", status_code=200)
def update_bonus_variant(
    vid: int,
    body: BonusScheduleVariantUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(BonusScheduleVariant, vid)
    if not row:
        raise HTTPException(404, "Bonus variant not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    _commit_or_409(db, "Bonus variant constraint violation")
    return {"id": row.id}


@router.delete("/bonus-schedule-variants/{vid}", status_code=204)
def delete_bonus_variant(
    vid: int,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(BonusScheduleVariant, vid)
    if not row:
        raise HTTPException(404, "Bonus variant not found")
    db.delete(row)
    db.commit()


# ── Loan rates ─────────────────────────────────────────────────────────────

@router.post("/loan-rates", status_code=201)
def create_loan_rate(
    body: LoanRateCreate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = LoanRate(**body.model_dump())
    db.add(row)
    _commit_or_409(db, "Loan rate already exists")
    db.refresh(row)
    return {"id": row.id}


@router.put("/loan-rates/{rid}", status_code=200)
def update_loan_rate(
    rid: int,
    body: LoanRateUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(LoanRate, rid)
    if not row:
        raise HTTPException(404, "Loan rate not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    # Enforce the same shape rules as create: after the patch, tax rows need grant_type.
    if row.loan_kind == "tax" and not row.grant_type:
        db.rollback()
        raise HTTPException(400, "tax loan rates require a grant_type")
    _commit_or_409(db, "Loan rate constraint violation")
    return {"id": row.id}


@router.delete("/loan-rates/{rid}", status_code=204)
def delete_loan_rate(
    rid: int,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(LoanRate, rid)
    if not row:
        raise HTTPException(404, "Loan rate not found")
    db.delete(row)
    db.commit()


# ── Loan refinances ────────────────────────────────────────────────────────

@router.post("/loan-refinances", status_code=201)
def create_loan_refinance(
    body: LoanRefinanceCreate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = LoanRefinance(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@router.put("/loan-refinances/{rid}", status_code=200)
def update_loan_refinance(
    rid: int,
    body: LoanRefinanceUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(LoanRefinance, rid)
    if not row:
        raise HTTPException(404, "Loan refinance not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    return {"id": row.id}


@router.delete("/loan-refinances/{rid}", status_code=204)
def delete_loan_refinance(
    rid: int,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(LoanRefinance, rid)
    if not row:
        raise HTTPException(404, "Loan refinance not found")
    db.delete(row)
    db.commit()


# ── Grant program settings (singleton) ─────────────────────────────────────

@router.put("/grant-program-settings", status_code=200)
def update_grant_program_settings(
    body: GrantProgramSettingsUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
    if not row:
        row = GrantProgramSettings(id=1)
        db.add(row)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    return {"id": row.id}
