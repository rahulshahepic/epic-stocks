"""Cross-runtime parity; requires the frontend's installed TypeScript compiler."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest

from app import retirement_simulation as sim
from scaffold.models import User
from tests.conftest import register_user, user_key
from tests.test_mcp_tools import Mcp
from tests.test_mcp_retirement import _assert_comparison_schema


@pytest.fixture(scope="module")
def runtime(tmp_path_factory):
    root = Path(__file__).resolve().parents[2]
    compiler = root / "frontend/node_modules/.bin/tsc"
    if not compiler.is_file() or not shutil.which("node"):
        pytest.skip("Cross-runtime parity requires Node and installed frontend dependencies")
    target = tmp_path_factory.mktemp("retirement-parity")
    subprocess.run([str(compiler), "--target", "ES2022", "--module", "ES2022",
                    "--moduleResolution", "bundler", "--skipLibCheck", "--outDir", str(target),
                    "src/app/pages/Retirement.math.ts"], cwd=root / "frontend", check=True,
                   capture_output=True, text=True)
    (target / "Retirement.math.js").rename(target / "retirement.math.mjs")
    shutil.copy(root / "backend/app/retirement_runner.mjs", target)
    return target / "retirement_runner.mjs"


@pytest.mark.parametrize("saved_floor", [None, 100])
def test_saved_low_target_matches_web_engine_and_mcp_run(
        client, db_session, monkeypatch, runtime, saved_floor):
    register_user(client)
    owner = db_session.query(User).first()
    monkeypatch.setattr(sim, "RUNNER", runtime)
    with user_key(owner):
        saved = {"epicExit": 10, "retirementDate": "2032-01-02", "defaultSpend": 50,
                 "paths": 100, "seed": 51}
        if saved_floor is not None:
            saved["minSpend"] = saved_floor
        owner.retirement_params = saved
        mcp = sim.run(owner)
        web_params, _, _ = sim.prepare(owner)
        # The website retains the saved floor, or derives 2% of its $10M balance.
        web_params["minSpend"] = saved_floor if saved_floor is not None else 200
        script = """import {DEFAULT_PARAMS, simulate, computeFanPercentiles} from './retirement.math.mjs';
import {readFileSync} from 'node:fs';
const r=simulate({...DEFAULT_PARAMS,...JSON.parse(readFileSync(0,'utf8'))});
console.log(JSON.stringify({pctFundingShortfall:r.pctRuin, pctExhausted:r.pctExhausted,
  medianFinalM:r.medianFinalM, wealthByAge:computeFanPercentiles(r)}));
"""
        web = json.loads(subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=runtime.parent,
            input=json.dumps(web_params), capture_output=True, text=True, check=True).stdout)
        assert mcp["assumptions"]["minSpend"] == 50
        for key, value in web.items():
            assert mcp["result"][key] == value
        assert owner.retirement_params == saved


def test_confirmed_mcp_changes_become_simulation_assumptions(client, monkeypatch, runtime):
    register_user(client)
    monkeypatch.setattr(sim, "RUNNER", runtime)
    mcp = Mcp(client)
    mcp.confirm_write("update_retirement_params", changes={"epicExit": 4, "defaultSpend": 205})
    mcp.confirm_write("set_retirement_accounts", roth=0.3)
    simulation = mcp.call("run_retirement_simulation", overrides={"paths": 100}, recalculate_exit=False)
    assert simulation["assumptions"]["defaultSpend"] == 205
    assert simulation["assumptions"]["roth"] == 0.3


def test_comparison_runner_output_matches_advertised_schema(client, monkeypatch, runtime):
    register_user(client)
    monkeypatch.setattr(sim, "RUNNER", runtime)
    mcp = Mcp(client, scope="comp:read")
    result = mcp.raw_call("compare_retirement_scenarios", scenarios=[
        {"name": "Base", "overrides": {"epicExit": 4, "paths": 100}},
        {"name": "Lower spending", "overrides": {"epicExit": 4, "paths": 100, "defaultSpend": 90}},
    ])
    tool = next(t for t in mcp.list_tools() if t["name"] == "compare_retirement_scenarios")
    _assert_comparison_schema(tool["outputSchema"], result["structuredContent"])
    assert json.loads(result["content"][0]["text"]) == result["structuredContent"]
