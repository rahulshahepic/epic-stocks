"""Retirement simulation MCP permissions, parity, bounds and MCP Apps card."""
import pytest

from tests.conftest import register_user, user_key
from tests.test_mcp_tools import Mcp
from app.retirement_simulation import validate_changes, prepare
from app.mcp.retirement_tools import RETIREMENT_RESOURCE_URI


@pytest.fixture
def mcp(client):
    register_user(client)
    return Mcp(client)


def test_partial_update_preserves_other_saved_fields(mcp, client):
    assert client.put("/api/retirement/params", json={"params": {
        "retirementDate": "2032-01-02", "defaultSpend": 180,
        "epicExit": 7.0, "traditional": 0.6,
    }}).status_code == 200
    answer = mcp.call("update_retirement_params", changes={"defaultSpend": 205})
    assert answer["updated"] == ["defaultSpend"]
    assert client.get("/api/retirement/params").json()["params"] == {
        "retirementDate": "2032-01-02", "defaultSpend": 205,
        "epicExit": 7.0, "traditional": 0.6,
    }


def test_writer_cannot_read_existing_params_through_update(client):
    register_user(client)
    client.put("/api/retirement/params", json={"params": {"epicExit": 4.0}})
    writer = Mcp(client, scope="comp:write")
    result = writer.call("update_retirement_params", changes={"defaultSpend": 180})
    assert "epicExit" not in str(result)
    assert "get_retirement_params" not in {t["name"] for t in writer.list_tools()}


def test_read_only_connection_cannot_save(client):
    register_user(client)
    reader = Mcp(client, scope="comp:read")
    assert "update_retirement_params" not in {t["name"] for t in reader.list_tools()}
    assert "comp:write" in reader.error("update_retirement_params", changes={"defaultSpend": 205})


@pytest.mark.parametrize("patch", [
    {"paths": 1_000_000}, {"seed": -1}, {"stockPct": 1.5},
    {"defaultSpend": "205"}, {"retirementDate": "2031-02-30"},
    {"spouseDOB": "garbage"}, {"scenario": "bullish"},
    {"glidePoints": [{"yearsAfter": 0, "stockPct": 0.9, "bondPct": 0.2}]},
    {"unexpected": 1}, {"traditional": 1000000},
])
def test_invalid_changes_rejected(patch):
    with pytest.raises(ValueError):
        validate_changes(patch)


def test_spouse_birthdate_and_retirement_date_are_valid():
    assert validate_changes({"spouseDOB": "1991-02-15", "retirementDate": "2032-01-02"})


def test_combined_allocation_and_basis_rejected(mcp):
    assert "Stocks and bonds" in mcp.error(
        "update_retirement_params", changes={"stockPct": 0.9, "bondPct": 0.3})
    assert "basis" in mcp.error(
        "update_retirement_params", changes={"taxableAdditional": 0.1, "additionalBasis": 0.2})


def test_simulation_and_card_use_same_service(mcp, monkeypatch):
    from app.mcp import retirement_tools
    calls = []
    def fake_run(owner, **kwargs):
        calls.append(kwargs)
        return {
            "retirementDate": "2032-01-02", "exitSource": "saved_exit",
            "assumptions": {"defaultSpend": 180},
            "result": {"pctLiquidityShortfall": 0.02, "pctExhausted": 0.01},
            "saved": False,
        }
    monkeypatch.setattr(retirement_tools, "run", fake_run)
    expected = mcp.call("run_retirement_simulation", overrides={"defaultSpend": 180}, recalculate_exit=False)
    card = mcp.raw_call("show_retirement", overrides={"defaultSpend": 180}, recalculate_exit=False)
    assert card["structuredContent"] == expected
    assert calls == [
        {"overrides": {"defaultSpend": 180}, "recalculate_exit": False},
        {"overrides": {"defaultSpend": 180}, "recalculate_exit": False},
    ]


def test_compare_runs_scenarios_without_saving(mcp, client, monkeypatch):
    from app.mcp import retirement_tools
    def fake_run(owner, **kwargs):
        return {"result": {"pctExhausted": 0.01}, "saved": False,
                "retirementDate": kwargs["overrides"]["retirementDate"]}
    monkeypatch.setattr(retirement_tools, "run", fake_run)
    before = client.get("/api/retirement/params").json()["params"]
    result = mcp.call("compare_retirement_scenarios", scenarios=[
        {"name": "October", "overrides": {"retirementDate": "2031-10-01"}},
        {"name": "January", "overrides": {"retirementDate": "2032-01-02"}},
    ])
    assert [s["retirementDate"] for s in result["scenarios"]] == ["2031-10-01", "2032-01-02"]
    assert client.get("/api/retirement/params").json()["params"] == before


def test_card_resource_scoped_and_static(mcp, client):
    resources = mcp.rpc("resources/list")["result"]["resources"]
    assert RETIREMENT_RESOURCE_URI in {r["uri"] for r in resources}
    resource = mcp.rpc("resources/read", {"uri": RETIREMENT_RESOURCE_URI})["result"]["contents"][0]
    assert resource["mimeType"] == "text/html;profile=mcp-app"
    assert resource["_meta"]["ui"]["csp"] == {"connectDomains": [], "resourceDomains": []}
    assert "run_retirement_simulation" in {t["name"] for t in mcp.list_tools()}
    assert "show_retirement" in {t["name"] for t in mcp.list_tools()}
    assert "refresh_retirement_view" in {t["name"] for t in mcp.list_tools()}
    assert "access_token" not in resource["text"]
    assert 'id="compareDate"' in resource["text"]
    assert "Compare retirement dates" in resource["text"]
    assert "Compare Oct 2031" not in resource["text"]
    assert "recalculate_exit:projected" in resource["text"]
    reader = Mcp(client, scope="equity:read")
    assert RETIREMENT_RESOURCE_URI not in {r["uri"] for r in reader.rpc("resources/list")["result"]["resources"]}
    assert "error" in reader.rpc("resources/read", {"uri": RETIREMENT_RESOURCE_URI})


def test_prepare_uses_saved_inputs_without_mutating_them(client, db_session):
    from scaffold.models import User
    register_user(client)
    user = db_session.query(User).first()
    with user_key(user):
        user.retirement_params = {
            "retirementDate": "2032-01-02", "epicExit": 8,
            "defaultSpend": 180, "minSpend": 100, "stockPct": 0.7, "bondPct": 0.2,
            "spouseDOB": "1991-02-15", "includeSpouse": True,
        }
        db_session.commit()
        original = dict(user.retirement_params)
        params, on, source = prepare(user, overrides={"defaultSpend": 205})
        assert params["defaultSpend"] == 205
        assert params["spouseBirthDate"] == "1991-02-15"
        assert on.isoformat() == "2032-01-02"
        assert source == "saved_exit"
        assert user.retirement_params == original


def test_exit_projection_cannot_cross_equity_read_scope(client):
    register_user(client)
    reader = Mcp(client, scope="comp:read")
    assert "equity:read" in reader.error(
        "run_retirement_simulation", recalculate_exit=True)
    assert "equity:read" in reader.error(
        "compare_retirement_scenarios", scenarios=[
            {"name": "October", "overrides": {"retirementDate": "2031-10-01"}, "recalculate_exit": True},
            {"name": "January", "overrides": {"retirementDate": "2032-01-02"}, "recalculate_exit": True},
        ])

def test_bad_simulation_arguments_fail_readably(mcp):
    assert "overrides must be an object" in mcp.error(
        "run_retirement_simulation", overrides=["bad"])
    assert "true or false" in mcp.error(
        "run_retirement_simulation", recalculate_exit="yes")

def test_no_retirement_assets_does_not_report_fake_success(mcp):
    assert "Epic exit value is missing" in mcp.error("run_retirement_simulation", recalculate_exit=False)


def test_unsaved_spending_derives_from_portfolio_and_is_reported(client, db_session):
    from scaffold.models import User
    register_user(client)
    user = db_session.query(User).first()
    with user_key(user):
        user.retirement_params = {"epicExit": 5.0, "retirementDate": "2032-01-02"}
        db_session.commit()
        params, _, _ = prepare(user)
        assert params["defaultSpend"] == 150
        assert params["minSpend"] == 100


def test_legacy_balances_and_glide_points_are_migrated(client, db_session):
    from scaffold.models import User
    register_user(client)
    user = db_session.query(User).first()
    with user_key(user):
        user.retirement_params = {
            "epicExit": 5.0, "additional": 2.0, "currentAge": 50,
            "glidePoints": [
                {"age": 60, "stockPct": 0.6, "bondPct": 0.3},
                {"age": 55, "stockPct": 0.7, "bondPct": 0.2},
                {"age": 60, "stockPct": 0.5, "bondPct": 0.4},
            ],
        }
        db_session.commit()
        params, _, _ = prepare(user)
        assert params["taxableAdditional"] == 2.0
        assert params["additionalBasis"] == 0
        assert params["glidePoints"] == [
            {"yearsAfter": 5, "stockPct": 0.7, "bondPct": 0.2},
            {"yearsAfter": 10, "stockPct": 0.6, "bondPct": 0.3},
        ]
        assert params["defaultSpend"] == 210
        assert params["minSpend"] == 140


def test_lower_spend_what_if_clamps_floor(client, db_session):
    from scaffold.models import User
    register_user(client)
    user = db_session.query(User).first()
    with user_key(user):
        user.retirement_params = {"epicExit": 5.0, "defaultSpend": 180, "minSpend": 100}
        db_session.commit()
        params, _, _ = prepare(user, overrides={"defaultSpend": 90})
        assert params["defaultSpend"] == params["minSpend"] == 90
