"""Retirement MCP tools and ChatGPT MCP Apps entrypoint."""
from scaffold.oauth.scopes import COMP_READ, COMP_WRITE, EQUITY_READ
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register
from app.retirement_simulation import run, validate_changes, validate_combined, MAX_SCENARIOS

RETIREMENT_RESOURCE_URI = "ui://epic-stocks/retirement-v1.html"

_PATCH = {
    "type": "object",
    "description": "Named retirement calculator fields to override. Dollars are in $M for assets and $K/year for spending; no saved values change unless update_retirement_params is called.",
    "additionalProperties": False,
    "properties": {
        **{k: {"type": "number"} for k in (
            "epicExit", "taxableAdditional", "additionalBasis", "traditional", "roth",
            "stockPct", "bondPct", "defaultSpend", "minSpend", "healthInsurance",
            "customStockShift", "customBondShift", "ssMonthly", "claimAge",
            "currentAge", "endAge", "paths", "seed", "fra", "spouseCurrentAge",
            "spouseSsMonthly", "spouseClaimAge", "spouseFra", "spouseWorkIncome",
            "spouseStopWorkAge", "stateLTCGRate",
        )},
        **{k: {"type": "boolean"} for k in (
            "zeroHIPost65", "includeSpouse", "spouseHasEmployerHI", "advanced",
        )},
        "scenario": {"type": "string", "enum": ["historical", "moderate", "cautious", "custom"]},
        "rebalance": {"type": "string", "enum": ["none", "tax-advantaged", "all"]},
        "retirementDate": {"type": "string", "description": "YYYY-MM-DD"},
        "spouseDOB": {"type": ["string", "null"], "description": "YYYY-MM-DD or null"},
        "glidePoints": {"type": "array", "maxItems": 20, "items": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "yearsAfter": {"type": "integer"},
                "stockPct": {"type": "number"},
                "bondPct": {"type": "number"},
            },
            "required": ["yearsAfter", "stockPct", "bondPct"],
        }},
    },
}
_RUN_INPUT = object_schema({
    "account": ACCOUNT_PROPERTY,
    "overrides": _PATCH,
    "recalculate_exit": {
        "type": "boolean", "default": False,
        "description": "When true, replace the saved Epic exit assumption with the app's date-specific after-tax, after-loan exit projection. Future prices may be estimates.",
    },
})
_RESULT = object_schema({
    "retirementDate": {"type": "string"},
    "exitSource": {"type": "string"},
    "assumptions": {"type": "object"},
    "result": {"type": "object"},
    "saved": {"type": "boolean"},
}, ["retirementDate", "exitSource", "assumptions", "result", "saved"])


def _run(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    return run(owner, overrides=args.get("overrides"),
               recalculate_exit=args.get("recalculate_exit", False))


def _update(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    patch = validate_changes(args.get("changes"))
    held = owner.retirement_params
    merged = {**(held if isinstance(held, dict) else {}), **patch}
    validate_combined(merged)
    owner.retirement_params = merged
    ctx.db.commit()
    # Do not return the saved blob: comp:write does not imply comp:read.
    return {"updated": sorted(patch), "saved": True,
            "next_step": "Run the retirement simulation to check the updated plan."}


def _compare(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    scenarios = args.get("scenarios")
    if not isinstance(scenarios, list) or not 2 <= len(scenarios) <= MAX_SCENARIOS:
        raise ValueError("Provide 2 or 3 retirement scenarios")
    names = set()
    results = []
    for item in scenarios:
        if not isinstance(item, dict) or set(item) - {"name", "overrides", "recalculate_exit"}:
            raise ValueError("Each scenario needs a name, overrides and optional recalculate_exit")
        name = item.get("name")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60 or name in names:
            raise ValueError("Scenario names must be unique and 1-60 characters")
        names.add(name)
        result = run(owner, overrides=item.get("overrides"),
                     recalculate_exit=item.get("recalculate_exit", True))
        results.append({"name": name, **result})
    return {"scenarios": results, "saved": False,
            "note": "All scenarios use the same random seed by default. Epic exit projections use the date-specific price assumptions and are not guarantees."}


register(Tool(
    name="run_retirement_simulation", title="Run retirement Monte Carlo",
    description="Run the actual Epic Stocks retirement calculator (100,000 historical block-bootstrap paths by default). Read saved inputs and optionally override fields without saving. Returns funding-shortfall and portfolio-exhaustion probabilities separately, percentile wealth by age, and the assumptions used. Use recalculate_exit for date-specific Epic liquidation net cash; otherwise the saved Epic exit input is used. Results are simulations, not guarantees.",
    input_schema=_RUN_INPUT, scope=COMP_READ, handler=_run, blocking_io=True,
))
register(Tool(
    name="compare_retirement_scenarios", title="Compare retirement scenarios",
    description="Run 2 or 3 retirement scenarios with the exact same calculator and random seed. Each scenario can override retirementDate, spending, Epic exit, asset allocation or other saved assumptions. By default recalculates after-tax, after-debt Epic exit for each date; no settings are saved.",
    input_schema=object_schema({
        "account": ACCOUNT_PROPERTY,
        "scenarios": {"type": "array", "minItems": 2, "maxItems": MAX_SCENARIOS, "items": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "name": {"type": "string", "maxLength": 60},
                "overrides": _PATCH,
                "recalculate_exit": {"type": "boolean", "default": True},
            },
            "required": ["name"],
        }},
    }, ["scenarios"]), scope=COMP_READ, handler=_compare, blocking_io=True,
))
register(Tool(
    name="update_retirement_params", title="Update saved retirement assumptions",
    description="Save only named fields in the user's retirement calculator. Preserve all other saved settings. Use only when the user explicitly wants to save changes. Assets are $M, spending and insurance are $K/year. This writes immediately; do not use for exploratory what-if runs.",
    input_schema=object_schema({"account": ACCOUNT_PROPERTY, "changes": _PATCH}, ["changes"]),
    scope=COMP_WRITE, handler=_update, read_only=False, idempotent=True,
))
register(Tool(
    name="show_retirement", title="Open retirement planner",
    description="Open the interactive ChatGPT retirement simulation card with success metrics, wealth percentiles and editable what-if controls. Uses the saved Epic Stocks calculator assumptions and does not save exploratory changes.",
    input_schema=_RUN_INPUT, output_schema=_RESULT, scope=COMP_READ, handler=_run,
    blocking_io=True,
    metadata={
        "ui": {"resourceUri": RETIREMENT_RESOURCE_URI, "visibility": ["model", "app"]},
        "openai/ui": {"entrypoints": [{"type": "global"}, {"type": "thread"}]},
        "openai/toolInvocation/invoking": "Running retirement simulation…",
        "openai/toolInvocation/invoked": "Retirement simulation ready",
    },
))
register(Tool(
    name="refresh_retirement_view", title="Recalculate retirement card",
    description="App-only interactive what-if recalculation without saving assumptions.",
    input_schema=_RUN_INPUT, output_schema=_RESULT, scope=COMP_READ, handler=_run,
    blocking_io=True, metadata={"ui": {"visibility": ["app"]}},
))
