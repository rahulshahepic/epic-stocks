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
    GrantTypeDef,
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
    GrantTypeDefCreate,
    GrantTypeDefUpdate,
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


@router.get("/admin")
def get_admin_content(
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return the same content as GET /api/content but as flat lists keyed by row id.

    Used by the content-admin UI so it can edit and delete individual rows.
    """
    templates = db.query(GrantTemplate).order_by(
        GrantTemplate.display_order, GrantTemplate.id
    ).all()
    type_defs = db.query(GrantTypeDef).order_by(
        GrantTypeDef.display_order, GrantTypeDef.name
    ).all()
    variants = db.query(BonusScheduleVariant).order_by(
        BonusScheduleVariant.grant_year,
        BonusScheduleVariant.grant_type,
        BonusScheduleVariant.variant_code,
    ).all()
    rates = db.query(LoanRate).order_by(
        LoanRate.loan_kind, LoanRate.grant_type, LoanRate.year
    ).all()
    refis = db.query(LoanRefinance).order_by(
        LoanRefinance.chain_kind,
        LoanRefinance.grant_year,
        LoanRefinance.grant_type,
        LoanRefinance.order_idx,
    ).all()
    settings_row = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()

    return {
        "grant_templates": [
            {
                "id": t.id,
                "year": t.year,
                "type": t.type,
                "vest_start": t.vest_start,
                "periods": t.periods,
                "exercise_date": t.exercise_date,
                "default_catch_up": bool(t.default_catch_up),
                "show_dp_shares": bool(t.show_dp_shares),
                "display_order": t.display_order,
                "active": bool(t.active),
                "notes": t.notes,
            }
            for t in templates
        ],
        "grant_type_defs": [
            {
                "name": td.name,
                "color_class": td.color_class,
                "description": td.description,
                "is_pre_tax_when_zero_price": bool(td.is_pre_tax_when_zero_price),
                "display_order": td.display_order,
                "active": bool(td.active),
            }
            for td in type_defs
        ],
        "bonus_schedule_variants": [
            {
                "id": v.id,
                "grant_year": v.grant_year,
                "grant_type": v.grant_type,
                "variant_code": v.variant_code,
                "periods": v.periods,
                "label": v.label,
                "is_default": bool(v.is_default),
            }
            for v in variants
        ],
        "loan_rates": [
            {
                "id": r.id,
                "loan_kind": r.loan_kind,
                "grant_type": r.grant_type,
                "year": r.year,
                "rate": r.rate,
                "due_date": r.due_date,
            }
            for r in rates
        ],
        "loan_refinances": [
            {
                "id": r.id,
                "chain_kind": r.chain_kind,
                "grant_year": r.grant_year,
                "grant_type": r.grant_type,
                "orig_loan_year": r.orig_loan_year,
                "order_idx": r.order_idx,
                "date": r.date,
                "rate": r.rate,
                "loan_year": r.loan_year,
                "due_date": r.due_date,
                "orig_due_date": r.orig_due_date,
            }
            for r in refis
        ],
        "grant_program_settings": {
            "loan_term_years": settings_row.loan_term_years if settings_row else 10,
            "latest_rate_year": settings_row.latest_rate_year if settings_row else 2025,
            "dp_shares_start_year": settings_row.dp_shares_start_year if settings_row else 2023,
            "tax_fallback_federal": settings_row.tax_fallback_federal if settings_row else 0.37,
            "tax_fallback_state": settings_row.tax_fallback_state if settings_row else 0.0765,
            "default_purchase_due_month_day_pre2022": settings_row.default_purchase_due_month_day_pre2022 if settings_row else "07-15",
            "default_purchase_due_month_day_post2022": settings_row.default_purchase_due_month_day_post2022 if settings_row else "06-30",
            "price_years_start": settings_row.price_years_start if settings_row else 2018,
            "price_years_end": settings_row.price_years_end if settings_row else 2026,
            "flexible_payoff_enabled": bool(settings_row.flexible_payoff_enabled) if settings_row else False,
        },
    }


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


# ── Grant type defs (keyed by name) ────────────────────────────────────────

@router.post("/grant-type-defs", status_code=201)
def create_grant_type_def(
    body: GrantTypeDefCreate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    if db.get(GrantTypeDef, body.name):
        raise HTTPException(409, "Grant type already exists")
    row = GrantTypeDef(**body.model_dump())
    db.add(row)
    db.commit()
    return {"name": row.name}


@router.put("/grant-type-defs/{name}", status_code=200)
def update_grant_type_def(
    name: str,
    body: GrantTypeDefUpdate,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(GrantTypeDef, name)
    if not row:
        raise HTTPException(404, "Grant type not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    return {"name": row.name}


@router.delete("/grant-type-defs/{name}", status_code=204)
def delete_grant_type_def(
    name: str,
    _admin: User = Depends(get_content_admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(GrantTypeDef, name)
    if not row:
        raise HTTPException(404, "Grant type not found")
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
    # Enforce the same shape rules as create: after the patch, tax rows need grant_type,
    # purchase_original rows need due_date.
    if row.loan_kind == "tax" and not row.grant_type:
        db.rollback()
        raise HTTPException(400, "tax loan rates require a grant_type")
    if row.loan_kind == "purchase_original" and not row.due_date:
        db.rollback()
        raise HTTPException(400, "purchase_original rates require a due_date")
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
