from datetime import date
from typing import Optional
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
    version: int | None = None

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
    version: int = 1
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
    version: int | None = None

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
    version: int = 1
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
    version: int | None = None

    @field_validator("price")
    @classmethod
    def price_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("price must be positive")
        return v

class PriceOut(PriceCreate):
    id: int
    version: int = 1
    model_config = {"from_attributes": True}


# Sale
class SaleCreate(BaseModel):
    date: date
    shares: int
    price_per_share: float
    notes: str = ""
    # If set, this sale was recorded to cover this loan's payoff.
    loan_id: Optional[int] = None
    # Per-sale tax rate overrides (None = use user's TaxSettings)
    federal_income_rate: Optional[float] = None
    federal_lt_cg_rate: Optional[float] = None
    federal_st_cg_rate: Optional[float] = None
    niit_rate: Optional[float] = None
    state_income_rate: Optional[float] = None
    state_lt_cg_rate: Optional[float] = None
    state_st_cg_rate: Optional[float] = None
    lt_holding_days: Optional[int] = None

    @field_validator("shares")
    @classmethod
    def shares_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price_per_share")
    @classmethod
    def price_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("price_per_share must be positive")
        return v

_Date = date  # alias to avoid field-name shadowing Optional[date] = None in Pydantic v2

class SaleUpdate(BaseModel):
    date: Optional[_Date] = None
    shares: Optional[int] = None
    price_per_share: Optional[float] = None
    notes: Optional[str] = None
    version: Optional[int] = None
    federal_income_rate: Optional[float] = None
    federal_lt_cg_rate: Optional[float] = None
    federal_st_cg_rate: Optional[float] = None
    niit_rate: Optional[float] = None
    state_income_rate: Optional[float] = None
    state_lt_cg_rate: Optional[float] = None
    state_st_cg_rate: Optional[float] = None
    lt_holding_days: Optional[int] = None

    @field_validator("shares")
    @classmethod
    def shares_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price_per_share")
    @classmethod
    def price_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("price_per_share must be positive")
        return v

class SaleOut(SaleCreate):
    id: int
    version: int = 1
    model_config = {"from_attributes": True}


# LoanPayment
class LoanPaymentCreate(BaseModel):
    loan_id: int
    date: date
    amount: float
    notes: str = ""

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

class LoanPaymentUpdate(BaseModel):
    date: Optional[_Date] = None
    amount: Optional[float] = None
    notes: Optional[str] = None
    version: Optional[int] = None

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("amount must be positive")
        return v

class LoanPaymentOut(LoanPaymentCreate):
    id: int
    version: int = 1
    model_config = {"from_attributes": True}


# Tax Settings
class TaxSettingsRead(BaseModel):
    federal_income_rate: float
    federal_lt_cg_rate: float
    federal_st_cg_rate: float
    niit_rate: float
    state_income_rate: float
    state_lt_cg_rate: float
    state_st_cg_rate: float
    lt_holding_days: int
    lot_selection_method: str = 'lifo'
    model_config = {"from_attributes": True}

class TaxSettingsUpdate(BaseModel):
    federal_income_rate: float | None = None
    federal_lt_cg_rate: float | None = None
    federal_st_cg_rate: float | None = None
    niit_rate: float | None = None
    state_income_rate: float | None = None
    state_lt_cg_rate: float | None = None
    state_st_cg_rate: float | None = None
    lt_holding_days: int | None = None
    lot_selection_method: str | None = None

class TaxBreakdown(BaseModel):
    gross_proceeds: float
    cost_basis: float
    net_gain: float
    lt_shares: int
    lt_gain: float
    lt_rate: float
    lt_tax: float
    st_shares: int
    st_gain: float
    st_rate: float
    st_tax: float
    unvested_shares: int
    unvested_proceeds: float
    unvested_rate: float
    unvested_tax: float
    estimated_tax: float
    net_proceeds: float


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
