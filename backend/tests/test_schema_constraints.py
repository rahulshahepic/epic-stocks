"""The shared field constraints in schemas.py.

The bounds used to live twice — once in each Create model, once in its Update
twin — so the pair could drift apart without anything noticing. They are one
Annotated type each now, and the pairing test below is what keeps them that way.
"""
import pytest
from pydantic import ValidationError

import schemas


def _err(model, **payload) -> str:
    with pytest.raises(ValidationError) as exc:
        model(**payload)
    return "; ".join(e["msg"] for e in exc.value.errors())


GRANT = dict(year=2020, type="Purchase", shares=100, price=1.5,
             vest_start="2021-01-01", periods=4, exercise_date="2020-12-31")
LOAN = dict(grant_year=2020, grant_type="Purchase", loan_type="Tax", loan_year=2020,
            amount=1000.0, interest_rate=0.05, due_date="2030-01-01")
SALE = dict(date="2020-01-01", shares=10, price_per_share=1.5)


# ── The bounds themselves ────────────────────────────────────────────────────

@pytest.mark.parametrize("field,value,message", [
    ("year", 1899, "year must be between 1900 and 2100"),
    ("year", 2101, "year must be between 1900 and 2100"),
    ("shares", 0, "shares must be positive"),
    ("shares", -1, "shares must be positive"),
    ("shares", 10_000_001, "shares cannot exceed 10,000,000"),
    ("price", -0.01, "price cannot be negative"),
    ("price", 1_000_001, "price cannot exceed 1,000,000"),
    ("periods", 0, "periods must be positive"),
    ("periods", 1201, "periods cannot exceed 1200"),
    ("type", "", "type cannot be empty"),
    ("type", "   ", "type cannot be empty"),
    ("type", "x" * 101, "type cannot exceed 100 characters"),
])
def test_grant_bounds(field, value, message):
    assert message in _err(schemas.GrantCreate, **{**GRANT, field: value})


@pytest.mark.parametrize("field,value,message", [
    ("amount", 0, "amount must be positive"),
    ("amount", 100_000_001, "amount cannot exceed 100,000,000"),
    ("interest_rate", -0.01, "interest_rate cannot be negative"),
    ("interest_rate", 100.01, "interest_rate cannot exceed 100 (100%)"),
    ("loan_type", "Nope", "loan_type must be one of ['Interest', 'Purchase', 'Tax']"),
    ("grant_type", "", "grant_type cannot be empty"),
    ("loan_number", "x" * 101, "loan_number cannot exceed 100 characters"),
])
def test_loan_bounds(field, value, message):
    assert message in _err(schemas.LoanCreate, **{**LOAN, field: value})


@pytest.mark.parametrize("field,value,message", [
    ("price_per_share", 0, "price_per_share must be positive"),
    ("price_per_share", 1_000_001, "price_per_share cannot exceed 1,000,000"),
    ("notes", "x" * 2001, "notes cannot exceed 2000 characters"),
    ("lot_overrides", [{}] * 501, "lot_overrides cannot exceed 500 items"),
])
def test_sale_bounds(field, value, message):
    assert message in _err(schemas.SaleCreate, **{**SALE, field: value})


def test_a_zero_cost_basis_is_allowed_but_a_zero_sale_price_is_not():
    """A grant can be given for nothing; a sale for $0 is a mistake."""
    assert schemas.GrantCreate(**{**GRANT, "price": 0}).price == 0
    assert "price_per_share must be positive" in _err(schemas.SaleCreate, **{**SALE, "price_per_share": 0})


def test_the_two_rate_scales_stay_apart():
    """A loan's rate is a percentage; a content-table rate is a fraction.

    Both validators were called `rate_non_negative` and differed only in their
    ceiling, which is how 0.05 and 5 got confused for each other.
    """
    assert schemas.LoanCreate(**{**LOAN, "interest_rate": 5}).interest_rate == 5
    assert "rate cannot exceed 1.0 (100%)" in _err(
        schemas.LoanRateCreate, loan_kind="interest", year=2020, rate=5)


@pytest.mark.parametrize("value", ["nope", "2020-13-01", ""])
def test_content_dates_must_be_iso(value):
    assert "must be YYYY-MM-DD" in _err(
        schemas.GrantTemplateCreate,
        year=2020, type="Purchase", vest_start=value, periods=4, exercise_date="2020-12-31")


# ── The pairing ──────────────────────────────────────────────────────────────

PAIRS = [
    (schemas.GrantCreate, schemas.GrantUpdate, GRANT,
     [("year", 1899), ("shares", 0), ("shares", 10_000_001), ("price", -1),
      ("periods", 0), ("periods", 1201), ("type", "")]),
    (schemas.LoanCreate, schemas.LoanUpdate, LOAN,
     [("grant_year", 2101), ("loan_year", 1899), ("amount", 0), ("amount", 100_000_001),
      ("interest_rate", -1), ("interest_rate", 101), ("loan_type", "Nope"),
      ("grant_type", ""), ("loan_number", "x" * 101)]),
    (schemas.PriceCreate, schemas.PriceUpdate, dict(effective_date="2020-01-01", price=1.5),
     [("price", 0), ("price", 1_000_001)]),
    (schemas.SaleCreate, schemas.SaleUpdate, SALE,
     [("shares", 0), ("price_per_share", 0), ("notes", "x" * 2001), ("lot_overrides", [{}] * 501)]),
    (schemas.LoanPaymentCreate, schemas.LoanPaymentUpdate,
     dict(loan_id=1, date="2020-01-01", amount=100.0),
     [("amount", 0), ("amount", 100_000_001), ("notes", "x" * 2001)]),
    (schemas.BonusScheduleVariantCreate, schemas.BonusScheduleVariantUpdate,
     dict(grant_year=2020, grant_type="Bonus", variant_code="A", periods=2),
     [("periods", 0)]),
    (schemas.LoanRateCreate, schemas.LoanRateUpdate,
     dict(loan_kind="interest", year=2020, rate=0.05),
     [("loan_kind", "nope"), ("rate", -1), ("rate", 1.01)]),
    (schemas.LoanRefinanceCreate, schemas.LoanRefinanceUpdate,
     dict(chain_kind="purchase", grant_year=2020, date="2020-01-01", rate=0.05,
          loan_year=2020, due_date="2030-01-01"),
     [("chain_kind", "nope"), ("date", "nope"), ("due_date", "nope")]),
]


@pytest.mark.parametrize("create,update,base,cases", PAIRS, ids=lambda a: getattr(a, "__name__", ""))
def test_update_rejects_exactly_what_create_rejects(create, update, base, cases):
    for field, bad in cases:
        created = _err(create, **{**base, field: bad})
        updated = _err(update, **{field: bad})
        assert created == updated, f"{create.__name__}.{field}={bad!r}: {created!r} vs {updated!r}"


@pytest.mark.parametrize("create,update,base,cases", PAIRS, ids=lambda a: getattr(a, "__name__", ""))
def test_an_update_may_leave_every_field_out(create, update, base, cases):
    """The None branch of `Shares | None` is what replaced the is-not-None guards."""
    assert update() is not None
