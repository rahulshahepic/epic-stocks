"""Optional statement balances, shared by HTTP and the connector change set."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import get_current_user
from scaffold.crud import apply_update, get_owned, version_conflict
from scaffold.models import Grant, Loan, LoanInterestCheckpoint, User
from scaffold.quota import check_row_quota
from schemas import LoanInterestCheckpointCreate, LoanInterestCheckpointUpdate, LoanInterestCheckpointOut
from app import event_cache

router = APIRouter(prefix="/api/loan-interest-checkpoints", tags=["loans"])


def _validate(values, user, db, row_id=None):
    loan = get_owned(db, Loan, values["loan_id"], user, "Loan")
    cutoff, statement = values["accrued_through"], values["statement_date"]
    if cutoff > statement or statement > date.today():
        raise HTTPException(422, "Interest cutoff must be on or before the statement date, and neither may be future-dated")
    from app.loan_projection import loan_start_date
    from services.vesting import core_grant
    loans = db.query(Loan).filter(Loan.user_id == user.id).all()
    grants = {(g.year, g.type): core_grant(g) for g in db.query(Grant).filter(Grant.user_id == user.id)}
    start = loan_start_date(loan, grants, {l.id: l for l in loans})
    if cutoff < start:
        raise HTTPException(422, "Interest cutoff cannot precede the loan's disbursement")
    from app.loan_state import refinanced_loan_ids
    if loan.id in refinanced_loan_ids(loans, cutoff):
        raise HTTPException(422, "Interest cutoff must precede this loan’s refinance; reconcile the successor loan")
    existing = db.query(LoanInterestCheckpoint).filter(
        LoanInterestCheckpoint.user_id == user.id, LoanInterestCheckpoint.loan_id == loan.id,
        LoanInterestCheckpoint.accrued_through == cutoff).first()
    if existing and existing.id != row_id:
        raise HTTPException(422, "A checkpoint exists for this loan and cutoff; read it and update its current version")
    return loan


def _refresh(user, db):
    from app.routers.loans import _regenerate_future_payoff_sales
    # Relationships loaded earlier during a preview must see newly flushed rows.
    for loan in db.query(Loan).filter(Loan.user_id == user.id).all():
        db.expire(loan, ["interest_checkpoints"])
    _regenerate_future_payoff_sales(user, db, create_missing=False, commit=False)
    db.commit()
    event_cache.schedule_recompute(user.id)


@router.get("", response_model=list[LoanInterestCheckpointOut])
def list_checkpoints(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(LoanInterestCheckpoint).filter(LoanInterestCheckpoint.user_id == user.id).order_by(
        LoanInterestCheckpoint.accrued_through, LoanInterestCheckpoint.id).all()


@router.post("", response_model=LoanInterestCheckpointOut, status_code=201)
def create_checkpoint(body: LoanInterestCheckpointCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _validate(body.model_dump(), user, db)
    check_row_quota(db, LoanInterestCheckpoint, user.id)
    row = LoanInterestCheckpoint(**body.model_dump(), user_id=user.id)
    db.add(row)
    db.flush()
    _refresh(user, db)
    db.refresh(row)
    return row


@router.put("/{checkpoint_id}", response_model=LoanInterestCheckpointOut)
def update_checkpoint(checkpoint_id: int, body: LoanInterestCheckpointUpdate,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = get_owned(db, LoanInterestCheckpoint, checkpoint_id, user, "Interest checkpoint")
    stale = version_conflict(row, body.version)
    if stale:
        return stale
    values = {k: getattr(row, k) for k in ("loan_id", "statement_date", "accrued_through", "accrued_interest", "source")}
    values.update(body.model_dump(exclude_unset=True, exclude={"version"}))
    _validate(values, user, db, row.id)
    apply_update(row, body)
    db.flush()
    _refresh(user, db)
    db.refresh(row)
    return row


@router.delete("/{checkpoint_id}", status_code=204)
def delete_checkpoint(checkpoint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = get_owned(db, LoanInterestCheckpoint, checkpoint_id, user, "Interest checkpoint")
    db.delete(row)
    db.flush()
    _refresh(user, db)
