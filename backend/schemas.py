from datetime import date
from pydantic import BaseModel


# Auth
class GoogleAuthRequest(BaseModel):
    token: str

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Grant
class GrantCreate(BaseModel):
    year: int
    type: str
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0

class GrantUpdate(BaseModel):
    year: int | None = None
    type: str | None = None
    shares: int | None = None
    price: float | None = None
    vest_start: date | None = None
    periods: int | None = None
    exercise_date: date | None = None
    dp_shares: int | None = None

class GrantOut(GrantCreate):
    id: int
    model_config = {"from_attributes": True}


# Loan
class LoanCreate(BaseModel):
    grant_year: int
    grant_type: str
    loan_type: str
    loan_year: int
    amount: float
    interest_rate: float
    due_date: date
    loan_number: str | None = None

class LoanUpdate(BaseModel):
    grant_year: int | None = None
    grant_type: str | None = None
    loan_type: str | None = None
    loan_year: int | None = None
    amount: float | None = None
    interest_rate: float | None = None
    due_date: date | None = None
    loan_number: str | None = None

class LoanOut(LoanCreate):
    id: int
    model_config = {"from_attributes": True}


# Price
class PriceCreate(BaseModel):
    effective_date: date
    price: float

class PriceUpdate(BaseModel):
    effective_date: date | None = None
    price: float | None = None

class PriceOut(PriceCreate):
    id: int
    model_config = {"from_attributes": True}


# Push Subscription
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys

class PushSubscriptionOut(BaseModel):
    id: int
    endpoint: str
    model_config = {"from_attributes": True}
