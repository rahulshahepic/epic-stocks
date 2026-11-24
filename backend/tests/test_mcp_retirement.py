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
    assert "data.exitSource==='projected_exit'" in resource["text"]
    assert "value.trim()!=='')" in resource["text"]
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
            {"yearsAfter": 10, "stockPct": 0.5, "bondPct": 0.4},
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


def test_planned_event_validation_and_no_saved_equity_write():
    from app.retirement_simulation import validate_planned_events
    event = {
        "id": "college", "title": "College tuition", "kind": "education",
        "date": "2032-09-01", "amountM": 0, "annualCostM": 0.07,
        "endDate": "2036-06-01",
    }
    assert validate_changes({"plannedEvents": [event]})
    for bad in (
        {**event, "amountM": float("nan")},
        {**event, "kind": "casino"},
        {**event, "date": "2032-02-30"},
        {**event, "endDate": "2031-01-01"},
        {**event, "loanYears": 30, "downPaymentPct": 0.2, "loanRate": 1.5},
        {**event, "unexpected": "value"},
    ):
        with pytest.raises(ValueError):
            validate_planned_events([bad])
    with pytest.raises(ValueError):
        validate_planned_events([event, event])


def test_life_event_planner_compares_without_persisting(mcp, client, monkeypatch):
    from app.mcp import retirement_tools
    calls = []
    def fake_run(owner, **kwargs):
        calls.append(kwargs)
        events = kwargs["overrides"].get("plannedEvents", [])
        return {"retirementDate": "2033-01-02", "result": {
            "pctFundingShortfall": 0.01 + len(events) * 0.01,
            "medianFinalM": 10 - len(events), "p10FinalM": 4 - len(events),
        }, "saved": False}
    monkeypatch.setattr(retirement_tools, "run", fake_run)
    before = client.get("/api/retirement/params").json()["params"]
    event = {"id": "wedding", "title": "Wedding", "kind": "wedding",
             "date": "2032-06-01", "amountM": 0.1, "funding": "epic"}
    result = mcp.call("plan_life_events", events=[event], recalculate_exit=False)
    assert result["saved"] is False
    assert result["impact"]["fundingShortfallDelta"] == pytest.approx(0.01)
    assert result["hypotheticalEpicSales"][0]["netCashTargetM"] == pytest.approx(0.1)
    assert calls[0]["overrides"]["plannedEvents"] == []
    assert calls[1]["overrides"]["plannedEvents"] == [event]
    assert client.get("/api/retirement/params").json()["params"] == before
    assert "plan_life_events" in {t["name"] for t in mcp.list_tools()}


def test_retirement_api_rejects_invalid_planned_events(client):
    register_user(client)
    invalid = {"id": "trip", "title": "Trip", "kind": "travel",
               "date": "2033-01-01", "amountM": -1}
    response = client.put("/api/retirement/params", json={"params": {
        "epicExit": 5, "plannedEvents": [invalid],
    }})
    assert response.status_code == 422
    assert client.get("/api/retirement/params").json()["params"] != {
        "epicExit": 5, "plannedEvents": [invalid],
    }


@pytest.mark.parametrize("event", [
    {"id": "cash-house", "title": "Cash house", "kind": "home",
     "date": "2030-01-01", "amountM": 1.2, "downPaymentPct": 0.2,
     "loanYears": 0, "loanRate": 0.06, "inflationRate": 0.025},
    {"id": "full-down", "title": "Paid-off house", "kind": "home",
     "date": "2030-01-01", "amountM": 1.2, "downPaymentPct": 1,
     "loanYears": 30, "loanRate": 0.06},
    {"id": "resale", "title": "Resale", "kind": "vehicle",
     "date": "2030-01-01", "amountM": 0.05,
     "resaleDate": "2034-01-01"},
    {"id": "old-mortgage", "title": "Existing mortgage", "kind": "home",
     "date": "2019-01-01", "amountM": 0.4, "downPaymentPct": 0.2,
     "loanYears": 30, "loanRate": 0.05},
])
def test_web_planner_shapes_save_and_run_without_breaking_mcp(mcp, client, event, monkeypatch):
    from app.mcp import retirement_tools
    def fake_run(owner, **kwargs):
        # Exercise the real saved-parameter validation without requiring the
        # compiled Node runner in the Python-only CI job.
        engine, on, _ = prepare(owner, overrides=kwargs.get("overrides"),
                                recalculate_exit=False)
        assert engine["plannedEvents"] == [event]
        return {"retirementDate": on.isoformat(),
                "result": {"pctFundingShortfall": 0.01}, "saved": False}
    monkeypatch.setattr(retirement_tools, "run", fake_run)
    response = client.put("/api/retirement/params", json={"params": {
        "retirementDate": "2032-01-01", "epicExit": 8,
        "plannedEvents": [event],
    }})
    assert response.status_code == 200, response.text
    result = mcp.call("run_retirement_simulation", overrides={"paths": 100},
                      recalculate_exit=False)
    assert "result" in result
    assert client.get("/api/retirement/params").json()["params"]["plannedEvents"] == [event]


def test_historical_epic_purchase_is_not_a_future_sale(mcp, monkeypatch):
    from app.mcp import retirement_tools
    def fake_run(owner, **kwargs):
        return {"retirementDate": "2033-01-01",
                "result": {"pctFundingShortfall": 0.01, "medianFinalM": 9,
                           "p10FinalM": 3}, "saved": False}
    monkeypatch.setattr(retirement_tools, "run", fake_run)
    event = {"id": "old", "title": "Existing mortgage", "kind": "home",
             "date": "2019-01-01", "amountM": 0.4,
             "downPaymentPct": 0.2, "loanYears": 30, "loanRate": 0.05,
             "funding": "epic"}
    result = mcp.call("plan_life_events", events=[event], recalculate_exit=False)
    assert result["hypotheticalEpicSales"] == []
    assert any("historical purchase" in warning for warning in result["modelWarnings"])


def test_epic_sale_month_boundaries_match_cash_flow_engine(mcp, monkeypatch):
    from datetime import date
    from app.mcp import retirement_tools
    retirement_date = f"{date.today().year + 5}-01-20"

    def fake_run(owner, **kwargs):
        events = kwargs["overrides"].get("plannedEvents", [])
        return {
            "retirementDate": retirement_date,
            "result": {"pctFundingShortfall": 0.01,
                       "medianFinalM": 9, "p10FinalM": 3,
                       "planned": {"preRetirementEpicNeedM": 0.1 if events else 0,
                                   "warnings": []}},
            "saved": False,
        }

    monkeypatch.setattr(retirement_tools, "run", fake_run)
    this_month = date.today().replace(day=1).isoformat()
    event = {"id": "same-month", "title": "This month's purchase",
             "kind": "home", "date": this_month, "amountM": 0.1,
             "funding": "epic"}
    result = mcp.call("plan_life_events", events=[event],
                      recalculate_exit=False)
    assert result["preRetirementEpicNetCashTargetM"] == pytest.approx(0.1)
    assert len(result["hypotheticalEpicSales"]) == 1
    assert not any("historical purchase" in w for w in result["modelWarnings"])

    retirement_month = {**event, "id": "retirement-month",
                        "date": retirement_date[:7] + "-05"}
    result = mcp.call("plan_life_events", events=[retirement_month],
                      recalculate_exit=False)
    assert result["hypotheticalEpicSales"] == []
    assert any("post-exit portfolio" in w for w in result["modelWarnings"])


def test_unfunded_pre_retirement_gap_suppresses_misleading_comparison(mcp, monkeypatch):
    from app.mcp import retirement_tools

    def fake_run(owner, **kwargs):
        has_events = bool(kwargs["overrides"].get("plannedEvents"))
        return {
            "retirementDate": "2033-01-01",
            "result": {
                "pctFundingShortfall": 1 if has_events else 0.02,
                "medianFinalM": 5 if has_events else 9,
                "p10FinalM": 2 if has_events else 4,
                "modelFeasible": not has_events,
                "preRetirementFundingGapM": 2 if has_events else 0,
                "modelWarning": "Unfunded pre-retirement cash gap" if has_events else None,
                "planned": {"preRetirementEpicNeedM": 3 if has_events else 0,
                            "warnings": []},
            },
            "saved": False,
        }

    monkeypatch.setattr(retirement_tools, "run", fake_run)
    result = mcp.call("plan_life_events", events=[{
        "id": "house", "title": "Large house", "kind": "home",
        "date": "2030-01-01", "amountM": 3, "funding": "epic",
    }], recalculate_exit=False)
    assert result["impact"] == {
        "fundingShortfallDelta": None,
        "medianFinalDeltaM": None,
        "p10FinalDeltaM": None,
    }
    assert result["withEvents"]["result"]["preRetirementFundingGapM"] == 2
    assert "Unfunded pre-retirement cash gap" in result["modelWarnings"]
    assert result["saved"] is False


def test_causal_purchase_condition_validation():
    from app.retirement_simulation import validate_planned_events, validate_combined
    event = {"id": "car", "title": "Optional car", "kind": "vehicle",
             "date": "2037-01-01", "amountM": 0.2,
             "condition": {"requireFullSpending": True, "minPortfolioM": 5,
                           "minStartingWealthRatio": 1.2}}
    assert validate_planned_events([event]) == [event]
    for condition in (None, {}, {"futureWinner": True}, {"requireFullSpending": 1},
                      {"minPortfolioM": True}, {"minPortfolioM": float("nan")},
                      {"minStartingWealthRatio": -1}):
        with pytest.raises(ValueError):
            validate_planned_events([{**event, "condition": condition}])
    validate_combined({"retirementDate": "2038-01-01", "plannedEvents": [event]})


def test_vehicle_lifetime_validation():
    from app.retirement_simulation import validate_planned_events
    event = {"id": "car", "title": "Car", "kind": "vehicle", "date": "2037-01-01",
             "amountM": 0.2, "lifetimeYears": 15, "depreciationRate": 0}
    assert validate_planned_events([event]) == [event]
    for patch in ({"lifetimeYears": 0}, {"lifetimeYears": 51}, {"lifetimeYears": 1.5},
                  {"kind": "home"}, {"depreciationRate": 1.1},
                  {"resaleDate": "2050-01-01"}, {"replacementEveryYears": 10}):
        with pytest.raises(ValueError):
            validate_planned_events([{**event, **patch}])


def test_moving_retirement_past_conditional_purchase_does_not_block_saves(mcp, client):
    event = {"id": "car", "title": "Car", "kind": "vehicle", "date": "2035-01-01",
             "amountM": 0.2, "condition": {"requireFullSpending": True}}
    params = {"retirementDate": "2034-06-01", "epicExit": 5, "plannedEvents": [event]}
    assert client.put("/api/retirement/params", json={"params": params}).status_code == 200
    moved = {**params, "retirementDate": "2036-01-01", "defaultSpend": 200}
    assert client.put("/api/retirement/params", json={"params": moved}).status_code == 200
    assert mcp.call("update_retirement_params", changes={"defaultSpend": 210})["saved"] is True
    assert mcp.call("update_retirement_params", changes={"retirementDate": "2037-01-01"})["saved"] is True
    saved = client.get("/api/retirement/params").json()["params"]
    assert saved["defaultSpend"] == 210
    assert saved["plannedEvents"] == [event]
    assert saved["retirementDate"] == "2037-01-01"

@pytest.mark.parametrize("extra", [
    {"conditionFailure": "defer", "deadlineDate": "2039-01-01"},
    {"conditionFailure": "skip"},
])
def test_purchase_failure_policy_round_trips_through_save(mcp, client, extra):
    event = {"id": "car-wait", "title": "Car", "kind": "vehicle", "date": "2037-01-01",
             "amountM": 0.2, "condition": {"minStartingWealthRatio": 1.4}, **extra}
    mcp.call("update_retirement_params", changes={"plannedEvents": [event]})
    assert client.get("/api/retirement/params").json()["params"]["plannedEvents"] == [event]


@pytest.mark.parametrize("extra", [
    {"conditionFailure": "retry"}, {"conditionFailure": []},
    {"conditionFailure": "defer", "deadlineDate": "2036-12-01"},
    {"conditionFailure": "defer", "deadlineDate": "bad-date"},
    {"conditionFailure": "skip", "deadlineDate": "2039-01-01"},
    {"deadlineDate": "2039-01-01"},
])
def test_invalid_purchase_failure_policy_is_rejected(extra):
    event = {"id": "car", "title": "Car", "kind": "vehicle", "date": "2037-01-01",
             "amountM": 0.2, "condition": {"minPortfolioM": 5}, **extra}
    with pytest.raises(ValueError):
        validate_changes({"plannedEvents": [event]})


def test_failure_policy_cannot_be_used_without_conditions():
    with pytest.raises(ValueError):
        validate_changes({"plannedEvents": [{"id": "car", "title": "Car", "kind": "vehicle",
                          "date": "2037-01-01", "amountM": 0.2, "conditionFailure": "defer"}]})

@pytest.mark.parametrize("spouse_dob", ["1990-04-01", None, ""])
def test_run_preserves_resolved_spouse_birthdate_for_card_reruns(client, db_session, monkeypatch, tmp_path, spouse_dob):
    from types import SimpleNamespace
    from scaffold.models import User
    from app import retirement_simulation as sim
    register_user(client)
    owner = db_session.query(User).first()
    runtime = tmp_path / "retirement_runner.mjs"
    runtime.write_text("")
    runtime.with_name("retirement.math.mjs").write_text("")
    monkeypatch.setattr(sim, "RUNNER", runtime)
    monkeypatch.setattr(sim.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout="{}"))
    with user_key(owner):
        owner.retirement_params = {"epicExit": 5, "retirementDate": "2032-01-02",
                                   "includeSpouse": True, "spouseDOB": "1980-01-01"}
        answer = sim.run(owner, overrides={"spouseDOB": spouse_dob})
    assert answer["assumptions"]["spouseDOB"] == (spouse_dob or None)

@pytest.mark.parametrize("duration", [0, 1.5, 51])
def test_invalid_recurring_duration_is_rejected(duration):
    with pytest.raises(ValueError):
        validate_changes({"plannedEvents": [{"id": "college", "title": "College", "kind": "education",
                         "date": "2044-08-01", "amountM": 0, "durationYears": duration}]})


def test_saved_tuition_duration_round_trips_and_cannot_mix_with_absolute_end(mcp, client):
    event = {"id": "college", "title": "College", "kind": "education", "date": "2044-08-01",
             "amountM": 0, "annualCostM": 0.1, "durationYears": 4}
    mcp.call("update_retirement_params", changes={"plannedEvents": [event]})
    assert client.get("/api/retirement/params").json()["params"]["plannedEvents"] == [event]
    with pytest.raises(ValueError):
        validate_changes({"plannedEvents": [{**event, "endDate": "2048-07-01"}]})


def test_card_inputs_exclude_projected_exit_and_derived_defaults(client, db_session, monkeypatch, tmp_path):
    from types import SimpleNamespace
    from scaffold.models import User
    from app import retirement_simulation as sim
    register_user(client)
    owner = db_session.query(User).first()
    runtime = tmp_path / 'retirement_runner.mjs'
    runtime.write_text('')
    runtime.with_name('retirement.math.mjs').write_text('')
    monkeypatch.setattr(sim, 'RUNNER', runtime)
    monkeypatch.setattr(sim.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout='{}'))
    monkeypatch.setattr(sim, '_projected_exit', lambda owner, on: 9)
    with user_key(owner):
        owner.retirement_params = {'epicExit': 6, 'retirementDate': '2032-01-02'}
        projected = sim.run(owner, overrides={'ssMonthly': 3100}, recalculate_exit=True)
        assert projected['assumptions']['epicExit'] == 9
        assert projected['inputOverrides'] == {'ssMonthly': 3100}
        assert not {'epicExit', 'minSpend', 'currentAge', 'stateLTCGRate', 'paths', 'seed'} & projected['inputOverrides'].keys()
        restored = sim.run(owner, overrides=projected['inputOverrides'], recalculate_exit=False)
        assert restored['assumptions']['epicExit'] == 6
        assert owner.retirement_params == {'epicExit': 6, 'retirementDate': '2032-01-02'}


@pytest.mark.parametrize('saved_floor', [None, 100])
def test_lower_spending_caps_the_effective_saved_or_derived_floor(client, db_session, saved_floor):
    from scaffold.models import User
    register_user(client)
    owner = db_session.query(User).first()
    with user_key(owner):
        owner.retirement_params = {'epicExit': 6, 'retirementDate': '2032-01-02'}
        if saved_floor is not None:
            owner.retirement_params = {**owner.retirement_params, 'minSpend': saved_floor}
        params, _, _ = prepare(owner, overrides={'defaultSpend': 50})
        assert params['minSpend'] == 50
        # A later run of the saved lower spending target normalizes the floor,
        # without writing derived values back to the owner's settings.
        owner.retirement_params = {**owner.retirement_params, 'defaultSpend': 50}
        params, _, _ = prepare(owner)
        assert params['minSpend'] == 50
        if saved_floor is not None:
            assert owner.retirement_params['minSpend'] == saved_floor


@pytest.mark.parametrize("profile", ["collector", "strong", "regular", "sports", "luxury"])
def test_depreciation_profiles_roundtrip(profile, client):
    register_user(client)
    event = {"id": "car", "title": "Car", "kind": "vehicle", "date": "2032-01-01", "amountM": .1,
             "lifetimeYears": 10, "replacementEveryYears": 10, "depreciationProfile": profile, "vehicleAgeYears": 3}
    response = client.put("/api/retirement/params", json={"params": {"plannedEvents": [event]}})
    assert response.status_code == 200
    assert client.get("/api/retirement/params").json()["params"]["plannedEvents"] == [event]


@pytest.mark.parametrize("patch", [
    {"depreciationProfile": "made-up"}, {"depreciationProfile": []},
    {"depreciationProfile": "strong", "depreciationRate": .1}, {"vehicleAgeYears": 51},
])
def test_invalid_depreciation_presets_rejected(patch):
    from app.retirement_simulation import validate_planned_events
    event = {"id": "car", "title": "Car", "kind": "vehicle", "date": "2032-01-01", "amountM": .1, "lifetimeYears": 10}
    with pytest.raises(ValueError):
        validate_planned_events([{**event, **patch}])


@pytest.mark.parametrize("scope,can_project", [("comp:read", False), ("comp:read equity:read", True)])
def test_card_reports_projection_capability(client, monkeypatch, scope, can_project):
    from app.mcp import retirement_tools
    register_user(client)
    monkeypatch.setattr(retirement_tools, "run", lambda *a, **kw: {
        "retirementDate": "2032-01-02", "exitSource": "saved_exit",
        "assumptions": {}, "result": {}, "saved": False,
    })
    reader = Mcp(client, scope=scope)
    for tool in ("show_retirement", "refresh_retirement_view"):
        assert reader.call(tool)["canProjectExit"] is can_project
    events = [{"id": "college", "title": "Tuition", "kind": "education",
               "date": "2040-01-01", "amountM": 0.1}]
    monkeypatch.setattr(retirement_tools, "run", lambda *a, **kw: {
        "retirementDate": "2032-01-02", "exitSource": "saved_exit",
        "assumptions": {}, "result": {"pctFundingShortfall": 0.01, "medianFinalM": 5, "p10FinalM": 1}, "saved": False,
    })
    planned = reader.call("plan_life_events", events=events, recalculate_exit=False)
    assert planned["baseline"]["canProjectExit"] is can_project
    assert planned["withEvents"]["canProjectExit"] is can_project


def test_manual_exit_write_persists_mode_and_preserves_accounts(mcp, client):
    client.put("/api/retirement/params", json={"params": {"epicExit": 5, "epicExitMode": "auto", "traditional": 1}})
    answer = mcp.call("update_retirement_params", changes={"epicExit": 6})
    saved = client.get("/api/retirement/params").json()["params"]
    assert saved["epicExitMode"] == "manual"
    assert saved["traditional"] == 1
    assert answer["updated"] == ["epicExit"]


def test_exit_mode_is_validated():
    assert validate_changes({"epicExitMode": "auto"})["epicExitMode"] == "auto"
    with pytest.raises(ValueError, match="epicExitMode"):
        validate_changes({"epicExitMode": "surprise"})


@pytest.mark.parametrize('saved_mode,override_mode,expected', [('auto', 'manual', False), ('manual', 'auto', True)])
def test_run_respects_the_override_exit_mode(mcp, client, monkeypatch, saved_mode, override_mode, expected):
    client.put('/api/retirement/params', json={'params': {'epicExit': 5, 'epicExitMode': saved_mode}})
    monkeypatch.setattr('app.mcp.retirement_tools.run', lambda owner, overrides, recalculate_exit: {'recalculated': recalculate_exit})
    result = mcp.call('run_retirement_simulation', overrides={'epicExitMode': override_mode})
    assert result['recalculated'] is expected
