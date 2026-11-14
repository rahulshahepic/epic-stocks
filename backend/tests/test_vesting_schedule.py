"""A grant's vesting schedule is stored dated rows; events follow them exactly."""
import io
from datetime import date

import openpyxl

from scaffold.models import Grant, GrantVesting, User
from services.vesting import backfill_schedules, epic_split, legacy_split
from tests.conftest import register_user, user_key

BASE = {"year": 2026, "type": "Purchase", "shares": 1001, "price": 2.0,
        "exercise_date": "2026-11-30"}


def _vest_events(client):
    return [(e["date"], e["vested_shares"]) for e in client.get("/api/events").json()
            if e["event_type"] == "Vesting"]


def test_equal_parts_round_down_with_the_rest_last(client):
    register_user(client)
    g = client.post("/api/grants", json={**BASE, "vest_start": "2027-09-30", "periods": 4}).json()
    assert [v["shares"] for v in g["vesting"]] == [250, 250, 250, 251]
    assert (g["vest_start"], g["periods"]) == ("2027-09-30", 4)


def test_explicit_dates_are_stored_and_drive_events(client):
    register_user(client)
    rows = [{"date": "2027-09-30", "shares": 300}, {"date": "2028-12-15", "shares": 300},
            {"date": "2030-09-30", "shares": 401}]
    g = client.post("/api/grants", json={**BASE, "vesting": rows}).json()
    assert g["vesting"] == rows and g["periods"] == 3
    client.post("/api/prices", json={"effective_date": "2026-01-01", "price": 2.0})
    assert _vest_events(client) == [(r["date"], r["shares"]) for r in rows]


def test_a_schedule_must_add_up(client):
    register_user(client)
    r = client.post("/api/grants", json={**BASE, "vesting": [{"date": "2027-09-30", "shares": 1000}]})
    assert r.status_code == 422 and "1,001" in r.text
    r = client.post("/api/grants", json={k: v for k, v in BASE.items()})
    assert r.status_code == 422


def test_moving_one_date_for_a_leave_bumps_the_version(client):
    register_user(client)
    g = client.post("/api/grants", json={**BASE, "vest_start": "2027-09-30", "periods": 4}).json()
    moved = [dict(v) for v in g["vesting"]]
    moved[1]["date"] = "2029-01-15"
    r = client.put(f"/api/grants/{g['id']}", json={"vesting": moved, "version": g["version"]})
    assert r.status_code == 200
    assert r.json()["vesting"][1]["date"] == "2029-01-15"
    assert r.json()["version"] > g["version"]
    stale = client.put(f"/api/grants/{g['id']}", json={"shares": 2000, "version": g["version"]})
    assert stale.status_code == 409


def test_a_corrected_share_count_keeps_the_moved_dates(client):
    register_user(client)
    g = client.post("/api/grants", json={**BASE, "vesting": [
        {"date": "2027-09-30", "shares": 500}, {"date": "2029-01-15", "shares": 501}]}).json()
    r = client.put(f"/api/grants/{g['id']}", json={"shares": 2000, "version": g["version"]}).json()
    assert [v["date"] for v in r["vesting"]] == ["2027-09-30", "2029-01-15"]
    assert sum(v["shares"] for v in r["vesting"]) == 2000


def test_deleting_a_grant_removes_its_schedule(client, db_session):
    register_user(client)
    g = client.post("/api/grants", json={**BASE, "vest_start": "2027-09-30", "periods": 4}).json()
    assert client.delete(f"/api/grants/{g['id']}").status_code == 204
    assert db_session.query(GrantVesting).count() == 0


def test_backfill_stores_old_grants_without_moving_a_number(client, db_session):
    register_user(client)
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 2.0})
    user = db_session.query(User).one()
    with user_key(user):
        db_session.add(Grant(user_id=user.id, year=2020, type="Purchase", shares=7, price=1.0,
                             vest_start=date(2021, 3, 1), periods=3, exercise_date=date(2020, 12, 31)))
        db_session.commit()
    before = _vest_events(client)
    assert [n for _, n in before] == [3, 2, 2]
    assert backfill_schedules(db_session) == 1
    assert backfill_schedules(db_session) == 0
    assert _vest_events(client) == before
    with user_key(user):
        assert [v.shares for v in db_session.query(GrantVesting).order_by(GrantVesting.date)] == [3, 2, 2]


def test_workbook_round_trip_keeps_a_moved_date(client):
    register_user(client)
    rows = [{"date": "2027-09-30", "shares": 500}, {"date": "2029-01-15", "shares": 501}]
    client.post("/api/grants", json={**BASE, "vesting": rows})
    exported = client.get("/api/export/excel").content
    assert "Vesting" in openpyxl.load_workbook(io.BytesIO(exported)).sheetnames
    r = client.post("/api/import/excel", files={"file": ("v.xlsx", exported, "application/octet-stream")})
    assert r.status_code == 201, r.text
    assert client.get("/api/grants").json()[0]["vesting"] == rows


def test_split_rules():
    assert [n for _, n in epic_split(7, date(2027, 9, 30), 3)] == [2, 2, 3]
    assert [n for _, n in legacy_split(7, date(2027, 9, 30), 3)] == [3, 2, 2]
