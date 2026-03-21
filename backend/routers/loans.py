from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Loan
from schemas import LoanCreate, LoanUpdate, LoanOut
from auth import get_current_user

router = APIRouter(prefix="/api/loans", tags=["loans"])


@router.get("", response_model=list[LoanOut])
def list_loans(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.grant_year, Loan.loan_type).all()


@router.post("", response_model=LoanOut, status_code=201)
def create_loan(body: LoanCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = Loan(**body.model_dump(), user_id=user.id)
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan


@router.post("/bulk", response_model=list[LoanOut], status_code=201)
def bulk_create_loans(items: list[LoanCreate], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loans = [Loan(**l.model_dump(), user_id=user.id) for l in items]
    db.add_all(loans)
    db.commit()
    for l in loans:
        db.refresh(l)
    return loans


@router.get("/{loan_id}", response_model=LoanOut)
def get_loan(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.put("/{loan_id}", response_model=LoanOut)
def update_loan(loan_id: int, body: LoanUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    submitted_version = body.version
    if submitted_version is not None and loan.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": loan.version},
        )
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(loan, k, v)
    loan.version = loan.version + 1
    db.commit()
    db.refresh(loan)
    return loan


@router.delete("/{loan_id}", status_code=204)
def delete_loan(loan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()
