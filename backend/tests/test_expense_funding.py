from datetime import date, timedelta

from scaffold.models import TaxSettings
from tests.conftest import register_user


BASE = "/api/retirement/expense-funding"


def year_ahead(years):
    return f"{date.today().year + years}-12-01"


def save_expense(client, **changes):
    expense = {
        "id": "car", "title": "Car", "date": year_ahead(1), "kind": "vehicle",
        "amountM": 0.05, "downPaymentPct": 0.2, "loanYears": 5, "loanRate": 0,
        "saleOffsetM": 0.002, "annualCostM": 0.0012, "inflationRate": 0,
        **changes,
    }
    assert client.patch("/api/retirement/params", json={"plannedEvents": [expense]}).status_code == 200
    return expense


def seed_equity(client):
    year = date.today().year - 4
    assert client.post("/api/prices", json={"effective_date": f"{year}-01-01", "price": 20}).status_code == 201
    assert client.post("/api/grants", json={
        "year": year, "type": "Purchase", "shares": 1000, "price": 10, "vest_start": f"{year}-01-01",
        "periods": 1, "exercise_date": f"{year}-01-01",
    }).status_code == 201


def test_preview_and_confirm_are_separate_and_sale_stays_tentative(client):
    register_user(client)
    seed_equity(client)
    expense = save_expense(client)
    result = client.get(f"{BASE}/car")
    assert result.status_code == 200
    preview = result.json()
    assert preview["initial_cash"] == 8000
    assert preview["monthly_cost"] == 766.67
    assert preview["sale"]["date"] == expense["date"]
    assert preview["sale"]["net_proceeds"] >= 8000
    assert preview["sale"]["estimated_tax"] > 0
    assert client.get(BASE).json() == {}
    assert client.get("/api/sales").json() == []

    choice = {"method": "epic", "confirmation": preview["confirmation"]}
    saved = client.post(f"{BASE}/car", json=choice)
    assert saved.status_code == 200
    assert client.post(f"{BASE}/car", json=choice).json() == saved.json()
    assert client.get(BASE).json() == {"car": saved.json()}
    assert client.get("/api/sales").json() == []
    assert client.get("/api/retirement/params").json()["params"]["plannedEvents"] == [expense]

    # General retirement autosaves preserve the linked funding plan.
    assert client.put("/api/retirement/params", json={
        "params": {"defaultSpend": 90}, "preserve_planned_expenses": True,
    }).status_code == 200
    assert client.get(BASE).json() == {"car": saved.json()}

    save_expense(client, amountM=0.06)
    assert client.get(BASE).json() == {}
    assert client.post(f"{BASE}/car", json=choice).status_code == 409


def test_savings_plan_uses_first_recurring_payment_and_creates_no_sale(client):
    register_user(client)
    save_expense(client, amountM=0, annualCostM=0.012, saleOffsetM=0, loanYears=0)
    preview = client.get(f"{BASE}/car").json()
    assert preview["initial_cash"] == 1000
    assert preview["monthly_cost"] == 1000
    assert preview["sale"] is None
    choice = {"method": "savings", "confirmation": preview["confirmation"]}
    assert client.post(f"{BASE}/car", json=choice).json()["sale"] is None
    assert client.delete(f"{BASE}/car").status_code == 204
    assert client.get(BASE).json() == {}


def test_stock_option_can_cover_only_part_of_the_bill(client, make_client):
    register_user(client)
    seed_equity(client)
    save_expense(client, downPaymentPct=1)
    preview = client.get(f"{BASE}/car").json()
    assert preview["sale"]["shares"] == 1000
    assert 0 < preview["sale"]["net_proceeds"] < preview["initial_cash"]
    with make_client("other@example.com") as other:
        assert other.get(f"{BASE}/car").status_code == 404
        assert other.get(BASE).json() == {}


def test_retirement_month_expense_does_not_offer_working_life_funding(client):
    register_user(client)
    save_expense(client)
    assert client.put("/api/retirement/params", json={
        "params": {"retirementDate": year_ahead(1)}, "preserve_planned_expenses": True,
    }).status_code == 200
    assert client.get(f"{BASE}/car").status_code == 422


def test_other_tentative_sales_reduce_projected_share_availability(client):
    register_user(client)
    seed_equity(client)
    first = save_expense(client, amountM=0.1, downPaymentPct=1)
    second = dict(first, id="second", date=year_ahead(2))
    assert client.patch("/api/retirement/params", json={"plannedEvents": [first, second]}).status_code == 200

    preview = client.get(f"{BASE}/car").json()
    assert preview["sale"]["shares"] == 1000
    assert client.post(f"{BASE}/car", json={"method": "epic", "confirmation": preview["confirmation"]}).status_code == 200
    assert client.get(f"{BASE}/second").json()["sale"] is None

    # Removing the estimate restores the shares for other planning scenarios.
    assert client.delete(f"{BASE}/car").status_code == 204
    assert client.get(f"{BASE}/second").json()["sale"]["shares"] == 1000


def test_funding_quote_does_not_extend_compensation_only_mcp_scope(client):
    from tests.test_mcp_tools import Mcp

    register_user(client)
    seed_equity(client)
    expense = save_expense(client)
    preview = client.get(f"{BASE}/car").json()
    assert client.post(f"{BASE}/car", json={"method": "epic", "confirmation": preview["confirmation"]}).status_code == 200
    comp = Mcp(client, scope="comp:read")
    assert comp.call("get_retirement_params") == {"params": {"plannedEvents": [expense]}}


def test_later_saved_sale_is_reserved_on_its_sale_date(client):
    register_user(client)
    seed_equity(client)
    save_expense(client)
    future_sale = year_ahead(2)
    assert client.post("/api/sales", json={"date": future_sale, "shares": 1000, "price_per_share": 20}).status_code == 201
    preview = client.get(f"{BASE}/car").json()
    assert preview["sale"] is None

    # These shares cannot fund the expense directly, but vest in time to
    # replace the earlier shares reserved for the later sale.
    year = date.today().year + 2
    assert client.post("/api/grants", json={
        "year": year, "type": "Purchase", "shares": 1000, "price": 10,
        "vest_start": f"{year}-01-01", "periods": 1, "exercise_date": f"{year}-01-01",
    }).status_code == 201
    assert client.get(f"{BASE}/car").json()["sale"]["net_proceeds"] >= 8000


def test_quote_matches_sales_estimator_without_creating_tax_settings(client, db_session):
    register_user(client)
    seed_equity(client)
    vest = date.today() - timedelta(days=30)
    assert client.post("/api/grants", json={
        "year": vest.year, "type": "Purchase", "shares": 100, "price": 5,
        "vest_start": vest.isoformat(), "periods": 1, "exercise_date": vest.isoformat(),
    }).status_code == 201
    expense = save_expense(
        client, amountM=0.001, loanYears=0, saleOffsetM=0,
        date=(date.today() + timedelta(days=45)).isoformat(),
    )
    expected = client.get("/api/sales/estimate", params={
        "price_per_share": 20, "target_net_cash": 1000, "sale_date": expense["date"],
    }).json()
    preview = client.get(f"{BASE}/car").json()
    assert preview["sale"]["shares"] == expected["shares_needed"]
    assert preview["sale"]["estimated_tax"] == expected["estimated_tax"]
    assert client.post(f"{BASE}/car", json={"method": "savings", "confirmation": preview["confirmation"]}).status_code == 200
    assert db_session.query(TaxSettings).count() == 0


def test_elapsed_tentative_sale_never_consumes_shares(client, monkeypatch):
    from app import expense_funding

    register_user(client)
    seed_equity(client)
    expense = save_expense(client, amountM=0.1, downPaymentPct=1)
    preview = client.get(f"{BASE}/car").json()
    assert client.post(f"{BASE}/car", json={"method": "epic", "confirmation": preview["confirmation"]}).status_code == 200

    class Later(date):
        @classmethod
        def today(cls):
            return cls(date.fromisoformat(expense["date"]).year, 12, 2)

    monkeypatch.setattr(expense_funding, "date", Later)
    second = dict(expense, id="second", date=year_ahead(2))
    assert client.patch("/api/retirement/params", json={"plannedEvents": [expense, second]}).status_code == 200
    assert client.get(BASE).json()["car"]["sale"]["date"] == expense["date"]
    assert client.get("/api/sales").json() == []
    assert client.get(f"{BASE}/second").json()["sale"]["shares"] == 1000


def test_funding_cannot_reuse_lots_reserved_by_a_later_manual_sale(client):
    register_user(client)
    seed_equity(client)
    year = date.today().year - 2
    vest = f"{year}-01-01"
    assert client.post("/api/grants", json={
        "year": year, "type": "Purchase", "shares": 1000, "price": 5,
        "vest_start": vest, "periods": 1, "exercise_date": vest,
    }).status_code == 201
    save_expense(client, amountM=0.1, downPaymentPct=1)
    overrides = [{"vest_date": vest, "grant_year": year, "grant_type": "Purchase", "basis_price": 5, "shares": 1000}]
    assert client.post("/api/sales", json={
        "date": year_ahead(2), "shares": 1000, "price_per_share": 20, "lot_overrides": overrides,
    }).status_code == 201

    preview = client.get(f"{BASE}/car").json()
    assert preview["sale"] is None
    assert "another planned sale" in preview["sale_unavailable"]
