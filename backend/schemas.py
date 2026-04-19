from datetime import date
from typing import Optional
from pydantic import BaseModel, field_validator, model_validator

LOAN_TYPES = {"Interest", "Tax", "Purchase"}


# Auth
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
    election_83b: bool = False

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
    election_83b: bool | None = None
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
    refinances_loan_id: int | None = None

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
    refinances_loan_id: int | None = None
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
    refinances_loan_id: int | None = None
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
    is_estimate: bool = False
    model_config = {"from_attributes": True}


class GrowthPriceRequest(BaseModel):
    annual_growth_pct: float
    first_date: date
    through_date: date

    @field_validator("annual_growth_pct")
    @classmethod
    def pct_reasonable(cls, v: float) -> float:
        if v <= 0 or v > 100:
            raise ValueError("annual_growth_pct must be between 0 and 100")
        return v

    @field_validator("through_date")
    @classmethod
    def through_after_first(cls, v: date, info) -> date:
        if "first_date" in info.data and v < info.data["first_date"]:
            raise ValueError("through_date must be >= first_date")
        return v


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
    # Manual lot overrides: [{vest_date, grant_year, grant_type, basis_price, shares}, ...]
    lot_overrides: Optional[list] = None
    # Groups related sales in a plan (payoff + cash-out from one decision)
    sale_plan_id: Optional[int] = None
    # User-recorded actual tax paid (overrides estimated for past recorded sales)
    actual_tax_paid: Optional[float] = None

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
    lot_overrides: Optional[list] = None
    sale_plan_id: Optional[int] = None
    actual_tax_paid: Optional[float] = None

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
    loan_payoff_method: str = 'epic_lifo'
    flexible_payoff_enabled: bool = False  # virtual field; populated from grant_program_settings by the endpoint
    prefer_stock_dp: bool = False
    deduct_investment_interest: bool = False
    deduction_excluded_years: list[int] | None = None
    taxable_years: list[int] = []  # virtual field; populated by the endpoint
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
    loan_payoff_method: str | None = None
    prefer_stock_dp: bool | None = None
    deduct_investment_interest: bool | None = None
    deduction_excluded_years: list[int] | None = None

class LotSummary(BaseModel):
    grant_year: int | None
    grant_type: str | None
    shares: int
    lt_shares: int
    st_shares: int


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
    lots: list[LotSummary] = []


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


# ── Grant-program content (Phase 2: content-admin editable) ────────────────

_DATE_RE = None


def _validate_iso_date(v: str) -> str:
    from datetime import date as _d
    try:
        _d.fromisoformat(v)
    except Exception:
        raise ValueError("must be YYYY-MM-DD")
    return v


class GrantTemplateCreate(BaseModel):
    year: int
    type: str
    vest_start: str
    periods: int
    exercise_date: str
    default_catch_up: bool = False
    show_dp_shares: bool = False
    zero_basis: bool = False
    default_tax_due_date: str | None = None
    display_order: int = 0
    active: bool = True
    notes: str | None = None

    @field_validator("type")
    @classmethod
    def type_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("type cannot be empty")
        return v

    @field_validator("vest_start", "exercise_date", "default_tax_due_date")
    @classmethod
    def iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("periods must be positive")
        return v

    @model_validator(mode="after")
    def check_shape(self):
        if self.show_dp_shares and self.type != "Purchase":
            raise ValueError("show_dp_shares is only valid when type='Purchase'")
        if self.zero_basis and self.type == "Purchase":
            raise ValueError("zero_basis is only valid for non-Purchase templates")
        # Tax-loan due date only makes sense for templates that actually generate tax
        # loans — zero-basis grants or templates with a catch-up sub-schedule.
        if self.default_tax_due_date is not None and not (self.zero_basis or self.default_catch_up):
            raise ValueError(
                "default_tax_due_date requires zero_basis=True or default_catch_up=True"
            )
        return self


class GrantTemplateUpdate(BaseModel):
    year: int | None = None
    type: str | None = None
    vest_start: str | None = None
    periods: int | None = None
    exercise_date: str | None = None
    default_catch_up: bool | None = None
    show_dp_shares: bool | None = None
    zero_basis: bool | None = None
    default_tax_due_date: str | None = None
    display_order: int | None = None
    active: bool | None = None
    notes: str | None = None

    @field_validator("vest_start", "exercise_date", "default_tax_due_date")
    @classmethod
    def iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("periods must be positive")
        return v


class BonusScheduleVariantCreate(BaseModel):
    grant_year: int
    grant_type: str
    variant_code: str
    periods: int
    label: str = ""
    is_default: bool = False

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("periods must be positive")
        return v


class BonusScheduleVariantUpdate(BaseModel):
    grant_year: int | None = None
    grant_type: str | None = None
    variant_code: str | None = None
    periods: int | None = None
    label: str | None = None
    is_default: bool | None = None

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("periods must be positive")
        return v


_LOAN_KINDS = {"interest", "tax", "purchase_original"}


class LoanRateCreate(BaseModel):
    loan_kind: str
    grant_type: str | None = None
    year: int
    rate: float
    due_date: str | None = None

    @field_validator("loan_kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in _LOAN_KINDS:
            raise ValueError(f"loan_kind must be one of {sorted(_LOAN_KINDS)}")
        return v

    @field_validator("due_date")
    @classmethod
    def iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)

    @field_validator("rate")
    @classmethod
    def rate_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("rate cannot be negative")
        return v

    @model_validator(mode="after")
    def check_shape(self):
        if self.loan_kind == "tax" and not self.grant_type:
            raise ValueError("tax loan rates require a grant_type")
        if self.loan_kind == "purchase_original" and not self.due_date:
            raise ValueError("purchase_original rates require a due_date")
        return self


class LoanRateUpdate(BaseModel):
    loan_kind: str | None = None
    grant_type: str | None = None
    year: int | None = None
    rate: float | None = None
    due_date: str | None = None

    @field_validator("loan_kind")
    @classmethod
    def valid_kind(cls, v):
        if v is not None and v not in _LOAN_KINDS:
            raise ValueError(f"loan_kind must be one of {sorted(_LOAN_KINDS)}")
        return v

    @field_validator("due_date")
    @classmethod
    def iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)

    @field_validator("rate")
    @classmethod
    def rate_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("rate cannot be negative")
        return v


_CHAIN_KINDS = {"purchase", "tax"}


class LoanRefinanceCreate(BaseModel):
    chain_kind: str
    grant_year: int
    grant_type: str | None = None
    orig_loan_year: int | None = None
    order_idx: int = 0
    date: str
    rate: float
    loan_year: int
    due_date: str
    orig_due_date: str | None = None

    @field_validator("chain_kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in _CHAIN_KINDS:
            raise ValueError(f"chain_kind must be one of {sorted(_CHAIN_KINDS)}")
        return v

    @field_validator("date", "due_date")
    @classmethod
    def iso_date(cls, v):
        return _validate_iso_date(v)

    @field_validator("orig_due_date")
    @classmethod
    def optional_iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)


class LoanRefinanceUpdate(BaseModel):
    chain_kind: str | None = None
    grant_year: int | None = None
    grant_type: str | None = None
    orig_loan_year: int | None = None
    order_idx: int | None = None
    date: str | None = None
    rate: float | None = None
    loan_year: int | None = None
    due_date: str | None = None
    orig_due_date: str | None = None

    @field_validator("chain_kind")
    @classmethod
    def valid_kind(cls, v):
        if v is not None and v not in _CHAIN_KINDS:
            raise ValueError(f"chain_kind must be one of {sorted(_CHAIN_KINDS)}")
        return v

    @field_validator("date", "due_date", "orig_due_date")
    @classmethod
    def iso_date(cls, v):
        if v is None:
            return v
        return _validate_iso_date(v)


class GrantProgramSettingsUpdate(BaseModel):
    tax_fallback_federal: float | None = None
    tax_fallback_state: float | None = None
    dp_min_percent: float | None = None
    dp_min_cap: float | None = None
    flexible_payoff_enabled: bool | None = None
