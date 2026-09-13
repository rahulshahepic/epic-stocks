"""Regression coverage for the September financial-integrity review."""

from datetime import date
from types import SimpleNamespace
from .conftest import register_user


def grant(client, year=2020, price=1.0, shares=100):
    r = client.post(
        "/api/grants",
        json=dict(
            year=year,
            type="Purchase",
            shares=shares,
            price=price,
            vest_start=f"{year + 1}-01-01",
            periods=1,
            exercise_date=f"{year}-01-01",
        ),
    )
    assert r.status_code == 201, r.text
    return r.json()


def loan(client, **kw):
    body = dict(
        grant_year=2020,
        grant_type="Purchase",
        loan_type="Purchase",
        loan_year=2020,
        amount=100,
        interest_rate=0.03,
        due_date="2030-01-01",
    )
    body.update(kw)
    r = client.post("/api/loans?generate_payoff_sale=false", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_sale_preview_accounts_for_previously_sold_lots(client):
    register_user(client)
    grant(client, 2020, 1.0)
    grant(client, 2021, 9.0)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    client.put("/api/tax-settings", json={"lot_selection_method": "fifo"})
    first = client.post(
        "/api/sales", json={"date": "2024-01-01", "shares": 100, "price_per_share": 10}
    )
    assert first.status_code == 201
    lots = client.get("/api/sales/lots?sale_date=2025-01-01").json()
    estimate = client.get(
        "/api/sales/estimate?sale_date=2025-01-01&shares=100&price_per_share=10"
    ).json()
    second = client.post(
        "/api/sales", json={"date": "2025-01-01", "shares": 100, "price_per_share": 10}
    ).json()
    actual = client.get(f"/api/sales/{second['id']}/tax").json()
    assert lots["total_shares"] == 100
    assert estimate["estimated_tax"] == actual["estimated_tax"]


def test_early_payoff_uses_today_instead_of_due_date(client):
    register_user(client)
    grant(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    ln = loan(client)
    r = client.post(f"/api/loans/{ln['id']}/execute-payoff")
    assert r.status_code == 201, r.text
    assert r.json()["date"] == date.today().isoformat()


def test_refinanced_and_cash_paid_loans_do_not_block_cashout(client):
    register_user(client)
    grant(client)
    old = loan(client, due_date="2024-01-01")
    loan(client, loan_year=2024, refinances_loan_id=old["id"])
    paid = loan(client, loan_year=2021, due_date="2023-01-01")
    payment = client.post(
        "/api/loan-payments",
        json={
            "loan_id": paid["id"],
            "date": "2022-12-31",
            "amount": 100,
        },
    )
    assert payment.status_code == 201, payment.text
    sale = client.post(
        "/api/sales",
        json={
            "date": "2025-01-01",
            "shares": 1,
            "price_per_share": 10,
        },
    )
    assert sale.status_code == 201, sale.text


def test_refinance_cycle_is_rejected_without_hiding_debt(client):
    register_user(client)
    grant(client)
    a = loan(client)
    b = loan(client, loan_year=2022, refinances_loan_id=a["id"])
    r = client.put(f"/api/loans/{a['id']}", json={"refinances_loan_id": b["id"]})
    assert r.status_code == 422, r.text
    dash = client.get("/api/dashboard").json()
    assert dash["total_loan_principal"] == 100


def test_future_refinance_does_not_erase_historical_debt():
    from app.routers.events import _compute_outstanding_principal

    loans = [
        SimpleNamespace(id=1, refinances_loan_id=None, loan_year=2020, amount=100),
        SimpleNamespace(id=2, refinances_loan_id=1, loan_year=2030, amount=100),
    ]
    assert _compute_outstanding_principal(loans, [], [], date(2025, 1, 1)) == 100


def test_grant_identity_cannot_change_while_a_loan_references_it(client):
    register_user(client)
    g = grant(client)
    loan(client)
    r = client.put(f"/api/grants/{g['id']}", json={"year": 2021})
    assert r.status_code == 409
    assert client.get("/api/loans").json()[0]["grant_year"] == 2020


def test_bulk_grant_create_rejects_duplicate_identity(client):
    register_user(client)
    g = grant(client)
    for k in ["id", "version"]:
        g.pop(k)
    r = client.post("/api/grants/bulk", json=[g, g])
    assert r.status_code == 409
    assert len(client.get("/api/grants").json()) == 1


def test_payment_refreshes_generated_payoff_sale(client):
    register_user(client)
    grant(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10})
    ln = loan(client)
    before = client.post(f"/api/loans/{ln['id']}/execute-payoff").json()
    r = client.post(
        "/api/loan-payments",
        json={"loan_id": ln["id"], "date": "2026-01-01", "amount": 100},
    )
    assert r.status_code == 201, r.text
    after = client.get("/api/sales").json()
    suggestion = client.get(f"/api/loans/{ln['id']}/payoff-sale-suggestion").json()
    assert before["shares"] > 0
    assert after == []
    assert suggestion["shares"] == 0


def test_invalid_inputs_are_rejected():
    import pytest
    from pydantic import ValidationError
    from schemas import PriceUpdate, SaleCreate

    for value in (None, "NaN"):
        with pytest.raises(ValidationError):
            PriceUpdate(price=value)
    with pytest.raises(ValidationError):
        SaleCreate(
            date="2026-01-01", shares=1, price_per_share=10, lot_overrides=[None]
        )


def test_backup_restore_preserves_relationships_metadata_and_estimate_flag(
    client, db_session
):
    from .conftest import user_key
    from scaffold.models import User
    from app.routers.import_export import _save_import_backup

    register_user(client)
    grant(client)
    ln = loan(client)
    client.post(
        "/api/loan-payments",
        json={"loan_id": ln["id"], "date": "2026-01-01", "amount": 25},
    )
    client.post("/api/prices", json={"effective_date": "2031-01-01", "price": 20})
    client.post(
        "/api/sales",
        json={
            "loan_id": ln["id"],
            "date": "2030-01-01",
            "shares": 10,
            "price_per_share": 10,
            "actual_tax_paid": 12,
            "federal_lt_cg_rate": 0.1,
        },
    )
    user = db_session.query(User).first()
    with user_key(user):
        _save_import_backup(user.id, True, True, True, True, True, db_session)
        db_session.commit()
    backup = client.get("/api/import/backups").json()[0]
    r = client.post(f"/api/import/backups/{backup['id']}/restore")
    assert r.status_code == 200, r.text
    payments = client.get("/api/loan-payments").json()
    sale = client.get("/api/sales").json()[0]
    price = client.get("/api/prices").json()[0]
    assert len(payments) == 1 and payments[0]["amount"] == 25
    assert sale["loan_id"] is not None and sale["actual_tax_paid"] == 12
    assert sale["federal_lt_cg_rate"] == 0.1
    assert price["is_estimate"] is True


def test_optimistic_lock_rejects_second_prechecked_writer(client, db_session):
    from .conftest import user_key, TEST_ENGINE
    from sqlalchemy.orm import Session
    from scaffold.models import User, Grant
    from scaffold.crud import version_conflict, apply_update
    from schemas import GrantUpdate

    register_user(client)
    g = grant(client)
    user = db_session.query(User).first()
    with user_key(user), Session(TEST_ENGINE) as s1, Session(TEST_ENGINE) as s2:
        a = s1.get(Grant, g["id"])
        b = s2.get(Grant, g["id"])
        assert version_conflict(a, 1) is None and version_conflict(b, 1) is None
        apply_update(a, GrantUpdate(shares=200, version=1))
        apply_update(b, GrantUpdate(shares=300, version=1))
        s1.commit()
        import pytest
        from sqlalchemy.orm.exc import StaleDataError

        with pytest.raises(StaleDataError):
            s2.commit()
    db_session.expire_all()
    final = client.get("/api/grants").json()[0]
    assert final["shares"] == 200 and final["version"] == 2


def test_nonfinite_price_never_reaches_database(client, db_session):
    from scaffold.models import Price

    register_user(client)
    r = client.post(
        "/api/prices", json={"effective_date": "2025-01-01", "price": "NaN"}
    )
    assert r.status_code == 422
    assert db_session.query(Price).count() == 0


def test_nonfinite_estimate_query_and_negative_recorded_tax_are_rejected(client):
    register_user(client)
    estimate = client.get("/api/sales/estimate?price_per_share=NaN&shares=1")
    assert estimate.status_code == 422
    sale = client.post(
        "/api/sales",
        json={
            "date": "2025-01-01",
            "shares": 1,
            "price_per_share": 10,
            "actual_tax_paid": -1,
        },
    )
    assert sale.status_code == 422
