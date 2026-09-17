from datetime import date
from typing import Annotated, ClassVar, Optional

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

from app.grant_types import TAX_LOAN_TEMPLATE_TYPES, TAX_LOAN_TEMPLATE_TYPES_TEXT


class InputModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class UpdateModel(InputModel):
    non_nullable: ClassVar[set[str]] = set()

    @model_validator(mode="before")
    @classmethod
    def reject_null_required_fields(cls, values):
        if isinstance(values, dict):
            for name in cls.non_nullable:
                if name in values and values[name] is None:
                    raise ValueError(f"{name} cannot be null; omit it to leave it unchanged")
        return values


LOAN_TYPES = {"Interest", "Tax", "Purchase"}

# Bounds on free-text and list inputs. The per-request body limit caps one
# write; these cap what a run of valid writes can accumulate in the database,
# where encrypted columns store several times the bytes they are given.
MAX_LABEL_LEN = 100       # types, loan numbers, short identifiers
MAX_NOTES_LEN = 2000      # free-form notes
MAX_BULK_ITEMS = 500      # items in one bulk create
MAX_LOT_OVERRIDES = 500   # manual lots on one sale


def bounded(v, limit: int, name: str):
    """Reject a string longer than limit. None and non-strings pass through."""
    if isinstance(v, str) and len(v) > limit:
        raise ValueError(f"{name} cannot exceed {limit} characters")
    return v


def bounded_list(v, limit: int, name: str):
    if isinstance(v, list) and len(v) > limit:
        raise ValueError(f"{name} cannot exceed {limit} items")
    return v


def _validate_iso_date(v: str) -> str:
    from datetime import date as _d
    try:
        _d.fromisoformat(v)
    except Exception:
        raise ValueError("must be YYYY-MM-DD") from None
    return v


# ── Field constraints ────────────────────────────────────────────────────────
# Every rule below used to be written twice: once in a Create model, and again
# in its Update twin with `if v is not None and` in front of each clause. That
# put each bound — 1900..2100, ten million shares, a thousand-two-hundred
# periods — in two places that had to be changed together.
#
# They are Annotated types now: `shares: Shares` on the Create model,
# `shares: Shares | None` on the Update. The None branch of that union is what
# lets a partial update leave the field out, so the "is not None" guards are
# gone with the duplication. Messages are unchanged — they are what the API
# returns and what the import tests read.

def _bounds(name: str, *, low: float, low_inclusive: bool, high: float, high_text: str | None = None):
    """A numeric range, phrased the way this API already phrases it."""
    too_low = f"{name} cannot be negative" if low_inclusive else f"{name} must be positive"
    too_high = f"{name} cannot exceed {high_text or format(high, ',')}"

    def check(v):
        below = (v < low) if low_inclusive else (v <= low)
        if below:
            raise ValueError(too_low)
        if v > high:
            raise ValueError(too_high)
        return v

    return AfterValidator(check)


def _positive(name: str):
    """A lower bound with no ceiling — admin-managed content, not user figures."""
    def check(v):
        if v <= 0:
            raise ValueError(f"{name} must be positive")
        return v

    return AfterValidator(check)


def _one_of(name: str, allowed: set):
    def check(v):
        if v not in allowed:
            raise ValueError(f"{name} must be one of {sorted(allowed)}")
        return v

    return AfterValidator(check)


def _required_label(name: str):
    def check(v):
        if not v or not v.strip():
            raise ValueError(f"{name} cannot be empty")
        return bounded(v, MAX_LABEL_LEN, name)

    return AfterValidator(check)


def _year(v: int) -> int:
    if v < 1900 or v > 2100:
        raise ValueError("year must be between 1900 and 2100")
    return v


Year = Annotated[int, AfterValidator(_year)]
Shares = Annotated[int, _bounds("shares", low=0, low_inclusive=False, high=10_000_000)]
DownPaymentShares = Annotated[int, Field(ge=-10_000_000, le=0)]
Periods = Annotated[int, _bounds("periods", low=0, low_inclusive=False, high=1200, high_text="1200")]
#: A cost basis, which may be $0 for a grant that was given rather than bought.
CostBasis = Annotated[float, _bounds("price", low=0, low_inclusive=True, high=1_000_000)]
Price = Annotated[float, _bounds("price", low=0, low_inclusive=False, high=1_000_000)]
SharePrice = Annotated[float, _bounds("price_per_share", low=0, low_inclusive=False, high=1_000_000)]
Money = Annotated[float, _bounds("amount", low=0, low_inclusive=False, high=100_000_000)]
TaxPaid = Annotated[float, Field(ge=0, le=100_000_000)]
#: A loan's own rate, carried as a fraction: 0.045 is 4.5%. Every consumer
#: multiplies by it directly (`amount * interest_rate` in the interest pool, the
#: workbook export's "0.00%" cell format), and the Loans page divides the typed
#: percentage by 100 before sending. The old ceiling of 100 let a client that
#: sent "4.5" store a 450% rate that every one of those consumers would honour.
InterestRate = Annotated[float, _bounds("interest_rate", low=0, low_inclusive=True, high=1, high_text="1.0 (100%)")]
#: An admin-managed rate from the content tables, carried as a fraction.
ContentRate = Annotated[float, _bounds("rate", low=0, low_inclusive=True, high=1, high_text="1.0 (100%)")]
#: Vesting periods on a schedule template, where the ceiling above does not apply.
TemplatePeriods = Annotated[int, _positive("periods")]
GrantTypeLabel = Annotated[str, _required_label("type")]
LoanGrantTypeLabel = Annotated[str, _required_label("grant_type")]
LoanTypeName = Annotated[str, _one_of("loan_type", LOAN_TYPES)]
LoanNumber = Annotated[str, AfterValidator(lambda v: bounded(v, MAX_LABEL_LEN, "loan_number"))]
Notes = Annotated[str, AfterValidator(lambda v: bounded(v, MAX_NOTES_LEN, "notes"))]


class LotOverride(InputModel):
    vest_date: str
    grant_year: Year | None = None
    grant_type: GrantTypeLabel | None = None
    basis_price: CostBasis
    shares: Shares

    _date = field_validator("vest_date")(_validate_iso_date)


LotOverrides = Annotated[
    list[LotOverride],
    BeforeValidator(lambda v: bounded_list(v, MAX_LOT_OVERRIDES, "lot_overrides")),
]
TaxRate = Annotated[float, Field(ge=0, le=1)]
HoldingDays = Annotated[int, Field(ge=1, le=36500)]
IsoDate = Annotated[str, AfterValidator(_validate_iso_date)]


# Auth
class AuthResponse(InputModel):
    access_token: str
    token_type: str = "bearer"


# Grant — type is free-form (Purchase, Bonus, Catch-Up, Free, etc.)
class GrantCreate(InputModel):
    year: Year
    type: GrantTypeLabel
    shares: Shares
    price: CostBasis
    vest_start: date
    periods: Periods
    exercise_date: date
    dp_shares: DownPaymentShares = 0
    election_83b: bool = False

class GrantUpdate(UpdateModel):
    non_nullable = {
        "dp_shares", "election_83b", "exercise_date", "periods", "price",
        "shares", "type", "vest_start", "year",
    }
    year: Year | None = None
    type: GrantTypeLabel | None = None
    shares: Shares | None = None
    price: CostBasis | None = None
    vest_start: date | None = None
    periods: Periods | None = None
    exercise_date: date | None = None
    dp_shares: DownPaymentShares | None = None
    election_83b: bool | None = None
    version: int | None = None

class GrantOut(GrantCreate):
    """A stored grant on its way out.

    Every `*Out` model below re-declares its parent's constrained fields with
    the storage's own shape. The bounds on the `*Create` models describe what a
    **write** may contain; applying them to a read turns a row that predates the
    bound into a `ResponseValidationError`, which `main.py` serves as a 500 and
    logs to `error_logs` — and because these are list endpoints, one unreadable
    row takes every other row down with it. Reads must show what is stored so
    the user can see and correct it. `test_output_models_never_bound_reads`
    walks these classes so a new field cannot inherit a bound by accident.
    """
    id: int
    version: int = 1
    year: int
    type: str
    shares: int
    price: float
    periods: int
    dp_shares: int
    model_config = {"from_attributes": True}


# Loan
class LoanCreate(InputModel):
    grant_year: Year
    grant_type: LoanGrantTypeLabel
    loan_type: LoanTypeName
    loan_year: Year
    amount: Money
    interest_rate: InterestRate
    due_date: date
    loan_number: LoanNumber | None = None
    refinances_loan_id: int | None = None


class LoanUpdate(UpdateModel):
    non_nullable = {
        "amount", "due_date", "grant_type", "grant_year", "interest_rate",
        "loan_type", "loan_year",
    }
    grant_year: Year | None = None
    grant_type: LoanGrantTypeLabel | None = None
    loan_type: LoanTypeName | None = None
    loan_year: Year | None = None
    amount: Money | None = None
    interest_rate: InterestRate | None = None
    due_date: date | None = None
    loan_number: LoanNumber | None = None
    refinances_loan_id: int | None = None
    version: int | None = None


class LoanOut(LoanCreate):
    """See GrantOut: a read reports what is stored, bounds included."""
    id: int
    version: int = 1
    refinances_loan_id: int | None = None
    grant_year: int
    grant_type: str
    loan_type: str
    loan_year: int
    amount: float
    interest_rate: float
    loan_number: str | None = None
    model_config = {"from_attributes": True}


class PayoffSaleOptions(InputModel):
    """How the server should maintain a computed payoff sale for a loan.

    The client may choose the tax assumptions, but it cannot choose
    ``is_generated``: ownership follows from the server doing the calculation.
    """
    enabled: bool = True
    federal_income_rate: TaxRate | None = None
    federal_lt_cg_rate: TaxRate | None = None
    federal_st_cg_rate: TaxRate | None = None
    niit_rate: TaxRate | None = None
    state_income_rate: TaxRate | None = None
    state_lt_cg_rate: TaxRate | None = None
    state_st_cg_rate: TaxRate | None = None
    lt_holding_days: HoldingDays | None = None


class LoanWithPayoffCreate(InputModel):
    loan: LoanCreate
    payoff_sale: PayoffSaleOptions


class LoanWithPayoffUpdate(InputModel):
    loan: LoanUpdate
    payoff_sale: PayoffSaleOptions


# Price
class PriceCreate(InputModel):
    effective_date: date
    price: Price


class PriceUpdate(UpdateModel):
    non_nullable = {'effective_date', 'price'}
    effective_date: date | None = None
    price: Price | None = None
    version: int | None = None


class PriceOut(PriceCreate):
    """See GrantOut: a read reports what is stored, bounds included."""
    id: int
    version: int = 1
    is_estimate: bool = False
    price: float
    model_config = {"from_attributes": True}


class GrowthPriceRequest(InputModel):
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
class SaleCreate(InputModel):
    date: date
    shares: Shares
    price_per_share: SharePrice
    notes: Notes = ""
    # If set, this sale was recorded to cover this loan's payoff.
    loan_id: Optional[int] = None
    # Per-sale tax rate overrides (None = use user's TaxSettings)
    federal_income_rate: Optional[TaxRate] = None
    federal_lt_cg_rate: Optional[TaxRate] = None
    federal_st_cg_rate: Optional[TaxRate] = None
    niit_rate: Optional[TaxRate] = None
    state_income_rate: Optional[TaxRate] = None
    state_lt_cg_rate: Optional[TaxRate] = None
    state_st_cg_rate: Optional[TaxRate] = None
    lt_holding_days: Optional[HoldingDays] = None
    # Manual lot overrides: [{vest_date, grant_year, grant_type, basis_price, shares}, ...]
    lot_overrides: Optional[LotOverrides] = None
    # Groups related sales in a plan (payoff + cash-out from one decision)
    sale_plan_id: Optional[int] = None
    # User-recorded actual tax paid (overrides estimated for past recorded sales)
    actual_tax_paid: Optional[TaxPaid] = None

_Date = date  # alias to avoid field-name shadowing Optional[date] = None in Pydantic v2

class SaleUpdate(UpdateModel):
    non_nullable = {"date", "notes", "price_per_share", "shares"}
    date: Optional[_Date] = None
    shares: Optional[Shares] = None
    price_per_share: Optional[SharePrice] = None
    notes: Optional[Notes] = None
    version: Optional[int] = None
    federal_income_rate: Optional[TaxRate] = None
    federal_lt_cg_rate: Optional[TaxRate] = None
    federal_st_cg_rate: Optional[TaxRate] = None
    niit_rate: Optional[TaxRate] = None
    state_income_rate: Optional[TaxRate] = None
    state_lt_cg_rate: Optional[TaxRate] = None
    state_st_cg_rate: Optional[TaxRate] = None
    lt_holding_days: Optional[HoldingDays] = None
    lot_overrides: Optional[LotOverrides] = None
    sale_plan_id: Optional[int] = None
    actual_tax_paid: Optional[TaxPaid] = None

class SaleOut(SaleCreate):
    """See GrantOut: a read reports what is stored, bounds included.

    The per-sale tax rates and `lt_holding_days` were unbounded until the bounds
    landed, and `lot_overrides` was an unvalidated list, so rows violating all
    three are on file.
    """
    id: int
    version: int = 1
    #: True while this is the app's own computed payoff figure; cleared when the
    #: user edits it. The Sales page uses it to say which rows it maintains.
    is_generated: bool = False
    shares: int
    price_per_share: float
    notes: str = ""
    federal_income_rate: Optional[float] = None
    federal_lt_cg_rate: Optional[float] = None
    federal_st_cg_rate: Optional[float] = None
    niit_rate: Optional[float] = None
    state_income_rate: Optional[float] = None
    state_lt_cg_rate: Optional[float] = None
    state_st_cg_rate: Optional[float] = None
    lt_holding_days: Optional[int] = None
    lot_overrides: Optional[list] = None
    actual_tax_paid: Optional[float] = None
    model_config = {"from_attributes": True}


# LoanPayment
class LoanPaymentCreate(InputModel):
    loan_id: int
    date: date
    amount: Money
    notes: Notes = ""

class LoanPaymentUpdate(UpdateModel):
    non_nullable = {"amount", "date", "notes"}
    date: Optional[_Date] = None
    amount: Optional[Money] = None
    notes: Optional[Notes] = None
    version: Optional[int] = None

class LoanPaymentOut(LoanPaymentCreate):
    """See GrantOut: a read reports what is stored, bounds included."""
    id: int
    version: int = 1
    amount: float
    notes: str = ""
    model_config = {"from_attributes": True}


# Tax Settings
class TaxSettingsRead(InputModel):
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

class TaxSettingsUpdate(UpdateModel):
    non_nullable = {
        "deduct_investment_interest", "federal_income_rate", "federal_lt_cg_rate",
        "federal_st_cg_rate", "loan_payoff_method", "lot_selection_method",
        "lt_holding_days", "niit_rate", "prefer_stock_dp", "state_income_rate",
        "state_lt_cg_rate", "state_st_cg_rate",
    }
    federal_income_rate: TaxRate | None = None
    federal_lt_cg_rate: TaxRate | None = None
    federal_st_cg_rate: TaxRate | None = None
    niit_rate: TaxRate | None = None
    state_income_rate: TaxRate | None = None
    state_lt_cg_rate: TaxRate | None = None
    state_st_cg_rate: TaxRate | None = None
    lt_holding_days: HoldingDays | None = None
    lot_selection_method: str | None = None
    loan_payoff_method: str | None = None
    prefer_stock_dp: bool | None = None
    deduct_investment_interest: bool | None = None
    deduction_excluded_years: list[int] | None = None

class LotSummary(InputModel):
    grant_year: int | None
    grant_type: str | None
    shares: int
    lt_shares: int
    st_shares: int


class TaxBreakdown(InputModel):
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
class PushSubscriptionKeys(InputModel):
    p256dh: str
    auth: str

class PushSubscriptionCreate(InputModel):
    endpoint: str
    keys: PushSubscriptionKeys

class PushSubscriptionOut(InputModel):
    id: int
    endpoint: str
    model_config = {"from_attributes": True}


# ── Grant-program content (Phase 2: content-admin editable) ────────────────

_DATE_RE = None


class GrantTemplateCreate(InputModel):
    year: int
    type: GrantTypeLabel
    vest_start: IsoDate
    periods: TemplatePeriods
    exercise_date: IsoDate
    default_catch_up: bool = False
    show_dp_shares: bool = False
    default_purchase_due_date: IsoDate | None = None
    default_tax_due_date: IsoDate | None = None
    display_order: int = 0
    active: bool = True
    notes: str | None = None

    @model_validator(mode="after")
    def check_shape(self):
        if self.show_dp_shares and self.type != "Purchase":
            raise ValueError("show_dp_shares is only valid when type='Purchase'")
        if self.default_catch_up and self.type != "Purchase":
            raise ValueError("default_catch_up is only valid when type='Purchase'")
        if self.default_purchase_due_date is not None and self.type != "Purchase":
            raise ValueError("default_purchase_due_date is only valid when type='Purchase'")
        # Tax-loan due date only makes sense on templates that can generate tax loans:
        # zero-basis grant templates (when the user enters $0 cost basis) or Purchase
        # templates with a catch-up sub-schedule.
        if self.default_tax_due_date is not None and not (
            self.type in TAX_LOAN_TEMPLATE_TYPES or self.default_catch_up
        ):
            raise ValueError(
                f"default_tax_due_date is only valid for {TAX_LOAN_TEMPLATE_TYPES_TEXT} "
                "templates or Purchase templates with default_catch_up=True"
            )
        return self


class GrantTemplateUpdate(InputModel):
    year: int | None = None
    # Deliberately a bare str: unlike the Create model this has never rejected an
    # empty type, and tightening it would fail admin writes that work today.
    type: str | None = None
    vest_start: IsoDate | None = None
    periods: TemplatePeriods | None = None
    exercise_date: IsoDate | None = None
    default_catch_up: bool | None = None
    show_dp_shares: bool | None = None
    default_purchase_due_date: IsoDate | None = None
    default_tax_due_date: IsoDate | None = None
    display_order: int | None = None
    active: bool | None = None
    notes: str | None = None


class BonusScheduleVariantCreate(InputModel):
    grant_year: int
    grant_type: str
    variant_code: str
    periods: TemplatePeriods
    label: str = ""
    is_default: bool = False


class BonusScheduleVariantUpdate(InputModel):
    grant_year: int | None = None
    grant_type: str | None = None
    variant_code: str | None = None
    periods: TemplatePeriods | None = None
    label: str | None = None
    is_default: bool | None = None


_LOAN_KINDS = {"interest", "tax", "purchase_original"}
LoanKind = Annotated[str, _one_of("loan_kind", _LOAN_KINDS)]


class LoanRateCreate(InputModel):
    loan_kind: LoanKind
    grant_type: str | None = None
    year: int
    rate: ContentRate

    @model_validator(mode="after")
    def check_shape(self):
        if self.loan_kind == "tax" and not self.grant_type:
            raise ValueError("tax loan rates require a grant_type")
        return self


class LoanRateUpdate(InputModel):
    loan_kind: LoanKind | None = None
    grant_type: str | None = None
    year: int | None = None
    rate: ContentRate | None = None


_CHAIN_KINDS = {"purchase", "tax"}
ChainKind = Annotated[str, _one_of("chain_kind", _CHAIN_KINDS)]


class LoanRefinanceCreate(InputModel):
    chain_kind: ChainKind
    grant_year: int
    grant_type: str | None = None
    orig_loan_year: int | None = None
    order_idx: int = 0
    date: IsoDate
    rate: float
    loan_year: int
    due_date: IsoDate
    orig_due_date: IsoDate | None = None


class LoanRefinanceUpdate(InputModel):
    chain_kind: ChainKind | None = None
    grant_year: int | None = None
    grant_type: str | None = None
    orig_loan_year: int | None = None
    order_idx: int | None = None
    date: IsoDate | None = None
    rate: float | None = None
    loan_year: int | None = None
    due_date: IsoDate | None = None
    orig_due_date: IsoDate | None = None


class GrantProgramSettingsUpdate(InputModel):
    tax_fallback_federal: float | None = None
    tax_fallback_state: float | None = None
    dp_min_percent: float | None = None
    dp_min_cap: float | None = None
    flexible_payoff_enabled: bool | None = None
