from datetime import date
from pydantic import BaseModel, field_validator

LOAN_TYPES = {"Interest", "Tax", "Principal", "Purchase"}


# Auth
class GoogleAuthRequest(BaseModel):
    token: str

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Grant — type is free-form (Purchase, Bonus, Catch-Up, Free, etc.)
class GrantCreate(BaseModel):
    year: int
    type: str
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0

    @field_validator("type")
    @classmethod
    def type_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("type cannot be empty")
        return v

    @field_validator("year")
    @classmethod
    def year_range(cls, v: int) -> int:
        if v < 1900 or v > 2100:
            raise ValueError("year must be between 1900 and 2100")
        return v

    @field_validator("shares")
    @classmethod
    def shares_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price")
    @classmethod
    def price_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("price cannot be negative")
        return v

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("periods must be positive")
        return v

class GrantUpdate(BaseModel):
    year: int | None = None
    type: str | None = None
    shares: int | None = None
    price: float | None = None
    vest_start: date | None = None
    periods: int | None = None
    exercise_date: date | None = None
    dp_shares: int | None = None

    @field_validator("type")
    @classmethod
    def type_not_empty(cls, v):
        if v is not None and (not v or not v.strip()):
            raise ValueError("type cannot be empty")
        return v

    @field_validator("year")
    @classmethod
    def year_range(cls, v):
        if v is not None and (v < 1900 or v > 2100):
            raise ValueError("year must be between 1900 and 2100")
        return v

    @field_validator("shares")
    @classmethod
    def shares_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price")
    @classmethod
    def price_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("price cannot be negative")
        return v

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("periods must be positive")
        return v

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

    @field_validator("grant_type")
    @classmethod
    def grant_type_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("grant_type cannot be empty")
        return v

    @field_validator("loan_type")
    @classmethod
    def valid_loan_type(cls, v: str) -> str:
        if v not in LOAN_TYPES:
            raise ValueError(f"loan_type must be one of {sorted(LOAN_TYPES)}")
        return v

    @field_validator("grant_year", "loan_year")
    @classmethod
    def year_range(cls, v: int) -> int:
        if v < 1900 or v > 2100:
            raise ValueError("year must be between 1900 and 2100")
        return v

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("interest_rate")
    @classmethod
    def rate_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("interest_rate cannot be negative")
        return v

class LoanUpdate(BaseModel):
    grant_year: int | None = None
    grant_type: str | None = None
    loan_type: str | None = None
    loan_year: int | None = None
    amount: float | None = None
    interest_rate: float | None = None
    due_date: date | None = None
    loan_number: str | None = None

    @field_validator("grant_type")
    @classmethod
    def grant_type_not_empty(cls, v):
        if v is not None and (not v or not v.strip()):
            raise ValueError("grant_type cannot be empty")
        return v

    @field_validator("loan_type")
    @classmethod
    def valid_loan_type(cls, v):
        if v is not None and v not in LOAN_TYPES:
            raise ValueError(f"loan_type must be one of {sorted(LOAN_TYPES)}")
        return v

    @field_validator("grant_year", "loan_year")
    @classmethod
    def year_range(cls, v):
        if v is not None and (v < 1900 or v > 2100):
            raise ValueError("year must be between 1900 and 2100")
        return v

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("interest_rate")
    @classmethod
    def rate_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("interest_rate cannot be negative")
        return v

class LoanOut(LoanCreate):
    id: int
    model_config = {"from_attributes": True}


# Price
class PriceCreate(BaseModel):
    effective_date: date
    price: float

    @field_validator("price")
    @classmethod
    def price_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("price must be positive")
        return v

class PriceUpdate(BaseModel):
    effective_date: date | None = None
    price: float | None = None

    @field_validator("price")
    @classmethod
    def price_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("price must be positive")
        return v

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
