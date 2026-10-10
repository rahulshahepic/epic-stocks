from datetime import date

import pytest

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, GRANT


def test_tentative_backdated_price_then_announcement(client):
    register_user(client)
    client.post("/api/grants", json=GRANT)
    year = date.today().year - 1
    applicable = f"{year}-01-01"
    response = client.post("/api/prices", json={"effective_date": applicable,
        "price": 110, "is_estimate": True})
    assert response.status_code == 201
    estimate = response.json()
    assert estimate["expected_announcement_date"] == f"{year}-03-01"
    assert estimate["is_estimate"] is True
    mcp = Mcp(client)
    assert mcp.call("get_dashboard")["price_is_estimate"] is True
    response = client.put(f'/api/prices/{estimate["id"]}', json={
        "price": 112, "announced_date": f"{year}-02-27", "version": estimate["version"]})
    assert response.status_code == 200
    assert response.json()["is_estimate"] is False
    rows = client.get("/api/prices").json()
    assert len(rows) == 1 and rows[0]["effective_date"] == applicable
    assert mcp.call("get_dashboard")["price_is_estimate"] is False


def test_date_edit_does_not_confirm_estimate(client):
    register_user(client)
    response = client.post("/api/prices", json={"effective_date": "2090-01-01", "price": 100})
    row = response.json()
    response = client.put(f'/api/prices/{row["id"]}', json={
        "effective_date": "2020-01-01", "version": row["version"]})
    assert response.status_code == 200
    assert response.json()["is_estimate"] is True


def test_announcement_validation(client):
    register_user(client)
    for extra in ({"announced_date": "2090-03-01"},
                  {"is_estimate": True, "announced_date": "2020-03-01"}):
        response = client.post("/api/prices", json={"effective_date": "2020-01-01",
                                                   "price": 100, **extra})
        assert response.status_code == 422


def test_announcement_remains_tentative_as_of_january():
    from services.price_state import price_values, price_metadata
    from scaffold.models import Price
    values = price_values({"effective_date": "2027-01-01", "is_estimate": True}, today=date(2027, 1, 15))
    assert values["is_estimate"]
    price = Price(price=110, **values)
    assert price_metadata(price, date(2027, 3, 2))["price_is_estimate"]
    price.is_estimate = False
    price.announced_date = date(2027, 2, 27)
    assert price_metadata(price, date(2027, 1, 15))["price_is_estimate"]
    assert not price_metadata(price, date(2027, 2, 27))["price_is_estimate"]


def test_announced_price_notification_uses_announcement_not_applicable_date(client, db_session):
    from scaffold.notifications import get_todays_events_for_user, build_notification_payload
    from scaffold.email_sender import build_event_email
    from scaffold.models import User
    from tests.conftest import user_key
    register_user(client)
    response = client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 110,
        "announced_date": "2020-02-27"})
    assert response.status_code == 201
    user = db_session.query(User).first()
    with user_key(user):
        assert get_todays_events_for_user(user, db_session, date(2020, 1, 1)) == []
        events = get_todays_events_for_user(user, db_session, date(2020, 2, 27))
    assert len(events) == 1 and events[0]["event_type"] == "Price Announcement"
    assert "confirmed, effective 2020-01-01" in build_notification_payload(events)["body"]
    assert build_notification_payload(events, date(2020, 2, 27))["data"]["url"] == "/prices"
    assert "confirmed, effective 2020-01-01" in build_event_email(events)[1]


def test_tentative_notification_qualifies_values():
    from scaffold.notifications import build_notification_payload
    from scaffold.email_sender import build_event_email
    events = [{"event_type": "Vesting", "price_is_estimate": True,
               "expected_announcement_date": "2027-03-01"}]
    assert "tentative" in build_notification_payload(events)["body"]
    assert "2027-03-01" in build_event_email(events)[2]


def test_plugin_can_save_and_confirm_backdated_estimate(client):
    register_user(client)
    mcp = Mcp(client)
    saved = mcp.call("save_equity", kind="price", values={"effective_date": "2020-01-01",
        "price": 110, "is_estimate": True, "expected_announcement_date": "2020-03-01"})
    assert mcp.call("list_prices", include_projections=True)["projected_prices"][0]["is_estimate"]
    mcp.call("save_equity", kind="price", id=saved["id"], values={
        "price": 112, "announced_date": "2020-02-27", "version": saved["version"]})
    prices = mcp.call("list_prices")["prices"]
    assert len(prices) == 1 and prices[0]["announced_date"] == "2020-02-27"


def test_workbook_roundtrip_preserves_tentative_status(client):
    import io
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 110,
        "is_estimate": True, "expected_announcement_date": "2020-03-05"})
    export = client.get("/api/export/excel")
    assert export.status_code == 200
    from app.routers.epic_import import _payload_from_xlsx
    workbook_payload = _payload_from_xlsx(export.content)
    assert workbook_payload["prices"][0]["expected_announcement_date"] == "2020-03-05"
    imported = client.post("/api/import/excel", files={"file":
        ("prices.xlsx", io.BytesIO(export.content), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert imported.status_code == 201, imported.text
    prices = client.get("/api/prices").json()
    assert len(prices) == 1
    assert prices[0]["is_estimate"] is True
    assert prices[0]["expected_announcement_date"] == "2020-03-05"
    assert prices[0]["announced_date"] is None


def test_import_wizard_confirmation_changes_status_at_same_price(client):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 110,
        "is_estimate": True})
    payload = {"grants": [], "prices": [{"effective_date": "2020-01-01", "price": 110,
        "announced_date": "2020-02-27"}], "clear_existing": False, "generate_payoff_sales": False}
    response = client.post("/api/wizard/preview", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["prices"][0]["status"] == "updated"
    assert client.post("/api/wizard/submit", json=payload).status_code == 201
    prices = client.get("/api/prices").json()
    assert len(prices) == 1 and prices[0]["is_estimate"] is False


def test_growth_can_start_at_current_january_after_it_has_passed(client):
    register_user(client)
    year = date.today().year
    client.post("/api/prices", json={"effective_date": f"{year-1}-01-01", "price": 100})
    response = client.post("/api/flows/growth-price", json={"annual_growth_pct": 10,
        "first_date": f"{year}-01-01", "through_date": f"{year+1}-01-01"})
    assert response.status_code == 201, response.text
    assert [p["price"] for p in response.json()] == [110, 121]
    assert all(p["is_estimate"] for p in response.json())
    assert response.json()[0]["expected_announcement_date"] == f"{year}-03-01"


def test_migration_keeps_legacy_status_and_does_not_invent_actual_dates():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine, text
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).parents[1] / "alembic/versions/j1k2l3m4n5o6_price_announcement_dates.py"
    spec = importlib.util.spec_from_file_location("price_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE prices (id INTEGER PRIMARY KEY, effective_date DATE, is_estimate BOOLEAN)"))
        connection.execute(text("INSERT INTO prices VALUES (1, '2027-01-01', 1), (2, '2026-01-01', 0)"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        rows = connection.execute(text("SELECT is_estimate, expected_announcement_date, announced_date FROM prices ORDER BY id")).all()
        assert rows == [(1, "2027-03-01", None), (0, None, None)]


@pytest.mark.parametrize("bad", [12, [], {}, True, "not-a-date"])
def test_draft_rejects_invalid_announcement_without_exception(bad, db_session):
    from app.epic_import import draft_from_payload
    from app.epic_import.skeleton import Skeleton
    draft, findings = draft_from_payload({"grants": [], "prices": [{"effective_date": "2020-01-01",
        "price": 110, "is_estimate": True, "expected_announcement_date": bad}]}, Skeleton())
    assert not draft.prices
    assert any(f.code == "R1" for f in findings)


@pytest.mark.parametrize("email_success", [True, False])
def test_late_announcement_is_pending_until_daily_notification_marks_it(client, db_session, email_success):
    from scaffold.models import User, Price
    from scaffold.notifications import get_todays_events_for_user, send_daily_notifications
    from tests.conftest import user_key
    from unittest.mock import patch
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 110,
                                   "announced_date": "2020-02-27"})
    user = db_session.query(User).first()
    with user_key(user):
        events = get_todays_events_for_user(user, db_session, date(2020, 3, 2))
        assert len(events) == 1 and events[0]["announced_date"] == "2020-02-27"
    # Daily dispatch records delivery state even when the announcement day passed.
    with (patch("scaffold.notifications.SessionLocal", return_value=db_session),
          patch("scaffold.email_sender.email_configured", return_value=True),
          patch("scaffold.email_sender.send_email", return_value=email_success) as send):
        send_daily_notifications(date(2020, 3, 2))
        assert send.call_count == 1
    user = db_session.query(User).first()
    with user_key(user):
        assert (db_session.query(Price).first().announcement_notified_at is not None) == email_success
        assert bool(get_todays_events_for_user(user, db_session, date(2020, 3, 3))) == (not email_success)
