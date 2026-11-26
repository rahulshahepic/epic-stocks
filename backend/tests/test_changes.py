"""The one write path for several rows: preview, confirm, apply all-or-nothing."""
import pytest

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp

GRANT = {"year": 2026, "type": "Purchase", "shares": 1000, "price": 2.0,
         "vest_start": "2027-09-30", "periods": 4, "exercise_date": "2026-11-30"}
LOAN = {"grant_year": 2026, "grant_type": "Purchase", "loan_type": "Purchase", "loan_year": 2026,
        "amount": 1800, "interest_rate": 0.045, "due_date": "2035-06-30"}
PRICE = {"effective_date": "2026-01-01", "price": 2.0}


def _new_grant_with_loan():
    return [{"kind": "loan", "action": "create", "values": LOAN},
            {"kind": "grant", "action": "create", "values": GRANT, "note": "2026 purchase agreement"},
            {"kind": "price", "action": "create", "values": PRICE}]


def test_preview_saves_nothing_and_apply_saves_exactly_it(client):
    register_user(client)
    changes = _new_grant_with_loan()
    preview = client.post("/api/changes/preview", json={"changes": changes}).json()
    assert preview["applied"] is False
    assert [c["kind"] for c in preview["changes"]] == ["loan", "grant", "price"]
    assert preview["changes"][1]["note"] == "2026 purchase agreement"
    assert [v["shares"] for v in preview["changes"][1]["values"]["vesting"]] == [250, 250, 250, 250]
    assert client.get("/api/grants").json() == []

    done = client.post("/api/changes/apply", json={"changes": changes, "confirm": preview["confirm"]}).json()
    assert done["applied"] is True
    assert len(client.get("/api/grants").json()) == 1
    assert len(client.get("/api/loans").json()) == 1
    assert done["position_after"]["outstanding_loan_balance"] == preview["position_after"]["outstanding_loan_balance"]


def test_apply_refuses_changes_other_than_the_preview(client):
    register_user(client)
    changes = _new_grant_with_loan()
    token = client.post("/api/changes/preview", json={"changes": changes}).json()["confirm"]
    altered = [*changes[:2], {"kind": "price", "action": "create", "values": {**PRICE, "price": 9.0}}]
    r = client.post("/api/changes/apply", json={"changes": altered, "confirm": token})
    assert r.status_code == 422 and "preview again" in r.json()["detail"]["message"]
    assert client.get("/api/grants").json() == []


def test_apply_refuses_when_the_account_moved_since_the_preview(client):
    register_user(client)
    changes = [{"kind": "grant", "action": "create", "values": GRANT}]
    token = client.post("/api/changes/preview", json={"changes": changes}).json()["confirm"]
    client.post("/api/prices", json=PRICE)
    r = client.post("/api/changes/apply", json={"changes": changes, "confirm": token})
    assert r.status_code == 422


def test_one_bad_change_fails_them_all(client):
    register_user(client)
    changes = [{"kind": "grant", "action": "create", "values": GRANT},
               {"kind": "loan", "action": "create", "values": {**LOAN, "interest_rate": 4.5}}]
    r = client.post("/api/changes/preview", json={"changes": changes})
    assert r.status_code == 422 and r.json()["detail"]["index"] == 1
    assert client.get("/api/grants").json() == []


def test_an_update_shows_what_moves_and_a_delete_runs_children_first(client):
    register_user(client)
    changes = _new_grant_with_loan()
    token = client.post("/api/changes/preview", json={"changes": changes}).json()["confirm"]
    client.post("/api/changes/apply", json={"changes": changes, "confirm": token})
    grant = client.get("/api/grants").json()[0]
    loan = client.get("/api/loans").json()[0]

    leave = [dict(v) for v in grant["vesting"]]
    leave[1]["date"] = "2029-01-15"
    edit = [{"kind": "grant", "action": "update", "id": grant["id"], "version": grant["version"],
             "values": {"vesting": leave}}]
    preview = client.post("/api/changes/preview", json={"changes": edit}).json()
    moved = preview["changes"][0]["changes"]["vesting"]
    assert moved["from"][1]["date"] == "2028-09-30" and moved["to"][1]["date"] == "2029-01-15"

    # Listed grant-first; the loan is still removed before its grant.
    gone = [{"kind": "grant", "action": "delete", "id": grant["id"], "version": grant["version"]},
            {"kind": "loan", "action": "delete", "id": loan["id"], "version": loan["version"]}]
    token = client.post("/api/changes/preview", json={"changes": gone}).json()["confirm"]
    assert client.post("/api/changes/apply", json={"changes": gone, "confirm": token}).status_code == 200
    assert client.get("/api/grants").json() == [] and client.get("/api/loans").json() == []


def test_a_payment_can_name_its_loan_by_number(client):
    register_user(client)
    loan = {**LOAN, "loan_number": "L-1"}
    changes = [{"kind": "grant", "action": "create", "values": GRANT},
               {"kind": "loan", "action": "create", "values": loan},
               {"kind": "loan_payment", "action": "create",
                "values": {"loan_number": "L-1", "date": "2027-06-01", "amount": 100}}]
    token = client.post("/api/changes/preview", json={"changes": changes}).json()["confirm"]
    assert client.post("/api/changes/apply", json={"changes": changes, "confirm": token}).status_code == 200
    assert client.get("/api/loan-payments").json()[0]["amount"] == 100


@pytest.mark.parametrize("bad", [[], [{"kind": "stock", "action": "create", "values": {}}],
                                 [{"kind": "grant", "action": "update", "values": {"shares": 1}}],
                                 "nope"])
def test_malformed_change_sets_are_refused(client, bad):
    register_user(client)
    r = client.post("/api/changes/preview", json={"changes": bad})
    assert r.status_code == 422


def test_the_connector_previews_then_applies_with_the_token(client):
    register_user(client)
    chat = Mcp(client)
    preview = chat.call("apply_changes", changes=_new_grant_with_loan())
    assert preview["applied"] is False and "confirm" in preview
    assert chat.call("list_grants")["grants"] == []
    assert "preview" in chat.error("apply_changes", changes=_new_grant_with_loan(), confirm="wrong")
    chat.call("apply_changes", changes=_new_grant_with_loan(), confirm=preview["confirm"])
    assert len(chat.call("list_grants")["grants"]) == 1


def test_retirement_change_previews_field_diff_and_preserves_other_fields(client):
    from app.changes import apply_changes
    from database import SessionLocal
    from scaffold.models import User
    from tests.conftest import user_key

    register_user(client)
    saved = {"defaultSpend": 180, "epicExit": 4}
    assert client.put("/api/retirement/params", json={"params": saved}).status_code == 200
    changes = [{"kind": "retirement_params", "action": "update", "values": {"defaultSpend": 205}}]
    with SessionLocal() as db:
        owner = db.query(User).one()
        with user_key(owner):
            preview = apply_changes(owner, db, changes, retirement_only=True)
            assert preview["changes"][0]["changes"] == {"defaultSpend": {"from": 180, "to": 205}}
            assert owner.retirement_params == saved
            assert apply_changes(owner, db, changes, confirm=preview["confirm"], retirement_only=True)["applied"]
    assert client.get("/api/retirement/params").json()["params"] == {**saved, "defaultSpend": 205}


def test_generic_change_endpoints_refuse_retirement_changes(client):
    register_user(client)
    changes = [{"kind": "retirement_params", "action": "update", "values": {"defaultSpend": 205}}]
    mcp = Mcp(client)
    preview = mcp.call("update_retirement_params", changes=changes[0]["values"])
    for path in ("preview", "apply"):
        response = client.post(f"/api/changes/{path}", json={"changes": changes, "confirm": preview["confirm"]})
        assert response.status_code == 422
    assert "kind must be one of" in mcp.error("apply_changes", changes=changes, confirm=preview["confirm"])
    assert client.get("/api/retirement/params").json()["params"] is None


@pytest.mark.parametrize("extra", [{"action": "create"}, {"action": "delete"}, {"id": 1}, {"version": 1}])
def test_retirement_change_has_update_only_blob_semantics(extra):
    from app.changes import ChangeError, apply_changes

    change = {"kind": "retirement_params", "action": "update", "values": {"defaultSpend": 205}, **extra}
    with pytest.raises(ChangeError, match="update without a row"):
        apply_changes(None, None, [change], retirement_only=True)


def test_stale_confirmation_version_cannot_be_consumed_twice(db_session, client):
    from app.changes import ChangeError, consume_confirmation
    from scaffold.models import User

    register_user(client)
    owner = db_session.query(User).filter_by(email="test@example.com").one()

    class StaleAccount:
        id = owner.id
        change_confirmation_version = owner.change_confirmation_version

    consume_confirmation(owner, db_session)
    db_session.commit()
    with pytest.raises(ChangeError, match="already used"):
        consume_confirmation(StaleAccount(), db_session)
