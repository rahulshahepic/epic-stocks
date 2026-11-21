"""Retirement MCP tools and portable MCP Apps entrypoint."""
from datetime import date
from scaffold.oauth.scopes import COMP_READ, COMP_WRITE, EQUITY_READ
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register
from app.retirement_simulation import run, validate_changes, validate_combined, MAX_SCENARIOS

RETIREMENT_RESOURCE_URI = "ui://epic-stocks/retirement-v1.html"

_EVENT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "id": {"type": "string", "maxLength": 100},
        "title": {"type": "string", "maxLength": 100},
        "kind": {"type": "string", "enum": [
            "home", "vehicle", "education", "wedding", "travel",
            "childcare", "care", "renovation", "gift", "other",
        ]},
        "date": {"type": "string", "description": "YYYY-MM-DD"},
        "amountM": {"type": "number", "description": "Purchase or one-time expense in millions of dollars"},
        "annualCostM": {"type": "number", "description": "Additional recurring annual cost in $M, not already in normal spending"},
        "endDate": {"type": "string"},
        "downPaymentPct": {"type": "number", "description": "Fraction paid upfront; required for financing"},
        "loanRate": {"type": "number", "description": "Annual nominal loan rate as a fraction"},
        "inflationRate": {"type": "number", "description": "Annual inflation for real fixed mortgage payments; default 0.025"},
        "loanYears": {"type": "number"},
        "saleOffsetM": {"type": "number", "description": "Net cash from selling an existing home or trade-in"},
        "resaleDate": {"type": "string"},
        "resaleValueM": {"type": "number"},
        "replacementEveryYears": {"type": "number"},
        "replacementCostM": {"type": "number", "description": "Optional repeat cost; 0 or omitted means repeat original amount"},
        "funding": {"type": "string", "enum": ["epic", "brokerage", "cash", "mixed"]},
        "lifetimeYears": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Vehicle ownership years before automatic sale; cannot combine with explicit resale. Each replacement starts a new ownership period."},
        "depreciationRate": {"type": "number", "minimum": 0, "maximum": 1, "description": "Annual nominal depreciation during lifetime; 0 retains nominal price. Resale is deflated by inflationRate (default 2.5%)."},
        "condition": {
            "type": "object", "additionalProperties": False, "minProperties": 1,
            "description": "All rules must hold immediately before the dated purchase, using only current portfolio state. Otherwise skip it, with no ownership costs or resale proceeds. Replacements are checked again; existing ownership costs and debt continue.",
            "properties": {
                "requireFullSpending": {"type": "boolean", "description": "Only buy when the normal spending ramp is not cutting regular spending"},
                "minPortfolioM": {"type": "number", "minimum": 0, "maximum": 1000, "description": "Minimum current portfolio net of unpaid taxes, in retirement-year $M"},
                "minStartingWealthRatio": {"type": "number", "minimum": 0, "maximum": 100, "description": "Minimum current net portfolio divided by starting retirement wealth; 1.2 means 20% above starting wealth in real terms"},
            },
        },
    },
    "required": ["id", "title", "kind", "date", "amountM"],
}


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
        "plannedEvents": {"type": "array", "maxItems": 20, "items": _EVENT_SCHEMA},
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
    if "overrides" in args and not isinstance(args["overrides"], dict):
        raise ValueError("overrides must be an object")
    if "recalculate_exit" in args and type(args["recalculate_exit"]) is not bool:
        raise ValueError("recalculate_exit must be true or false")
    if args.get("recalculate_exit") and EQUITY_READ not in ctx.connector.scopes:
        raise ValueError("Date-specific Epic exit projections require equity:read")
    saved = owner.retirement_params or {}
    missing_exit = "epicExit" not in saved and "epicExit" not in (args.get("overrides") or {})
    implicit_exit = missing_exit and "recalculate_exit" not in args and EQUITY_READ in ctx.connector.scopes
    return run(owner, overrides=args.get("overrides"),
               recalculate_exit=args.get("recalculate_exit", implicit_exit))


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
        recalc = item.get("recalculate_exit", EQUITY_READ in ctx.connector.scopes)
        saved = owner.retirement_params or {}
        if "recalculate_exit" not in item and EQUITY_READ in ctx.connector.scopes:
            if "epicExit" not in saved and "epicExit" not in (item.get("overrides") or {}):
                recalc = True
        if type(recalc) is not bool:
            raise ValueError("recalculate_exit must be true or false")
        if "overrides" in item and not isinstance(item["overrides"], dict):
            raise ValueError("overrides must be an object")
        if recalc and EQUITY_READ not in ctx.connector.scopes:
            raise ValueError("Date-specific Epic exit projections require equity:read")
        result = run(owner, overrides=item.get("overrides"),
                     recalculate_exit=recalc)
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


def _plan_life_events(ctx: ToolContext, args: dict):
    """Read-only before/after comparison. Never touches the equity sale ledger."""
    from app.retirement_simulation import validate_planned_events
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    events = validate_planned_events(args.get("events"))
    if not events:
        raise ValueError("Provide at least one planned event")
    if "overrides" in args and not isinstance(args["overrides"], dict):
        raise ValueError("overrides must be an object")
    recalc = args.get("recalculate_exit", EQUITY_READ in ctx.connector.scopes)
    if type(recalc) is not bool:
        raise ValueError("recalculate_exit must be true or false")
    if recalc and EQUITY_READ not in ctx.connector.scopes:
        raise ValueError("Date-specific Epic exit projections require equity:read")
    base = {**(args.get("overrides") or {}), "plannedEvents": []}
    before = run(owner, overrides=base, recalculate_exit=recalc)
    after = run(owner, overrides={**base, "plannedEvents": events}, recalculate_exit=recalc)
    a, b = before["result"], after["result"]
    # The shared JS cash-flow engine schedules by calendar month, not day.
    current_month = date.today().isoformat()[:7]
    retirement_month = (after.get("retirementDate") or "")[:7]
    feasible = a.get("modelFeasible", True) and b.get("modelFeasible", True)
    return {
        "baseline": before, "withEvents": after,
        "impact": {
            "fundingShortfallDelta": b["pctFundingShortfall"] - a["pctFundingShortfall"] if feasible else None,
            "medianFinalDeltaM": b["medianFinalM"] - a["medianFinalM"] if feasible else None,
            "p10FinalDeltaM": b["p10FinalM"] - a["p10FinalM"] if feasible else None,
        },
        "preRetirementEpicNetCashTargetM": b.get("planned", {}).get("preRetirementEpicNeedM", 0),
        "modelWarnings": ([b["modelWarning"]] if b.get("modelWarning") else []) +
                         b.get("planned", {}).get("warnings", []) + [
            f"{e['title']}: the historical purchase is not a future Epic sale."
            for e in events if e.get("funding") == "epic" and
            e["date"][:7] < current_month
        ] + [
            f"{e['title']}: after-retirement funding uses the post-exit portfolio, not an Epic share sale."
            for e in events if e.get("funding") == "epic" and
            (not retirement_month or e["date"][:7] >= retirement_month)
        ],
        "hypotheticalEpicSales": [
            {"eventId": e["id"], "date": e["date"],
             "netCashTargetM": max(0, e["amountM"] * (
                 e.get("downPaymentPct", 1) if e.get("loanYears", 0) else 1
             ) - e.get("saleOffsetM", 0)),
             "nextStep": "This is the one-time net target only. Check preRetirementEpicNetCashTargetM for recurring and replacement costs. Use estimate_sale with a dated share-price assumption to estimate shares, lot taxes and loan payoff. Do not record a sale."}
            for e in events if e.get("funding") == "epic" and
            e["date"][:7] >= current_month and
            retirement_month and e["date"][:7] < retirement_month
        ],
        "saved": False,
        "limitations": [
            "No real stock sale, loan, purchase or transaction is created.",
            "Pre-retirement purchases, loan payments and recurring expenses reduce the projected retirement portfolio without modeling wages, market growth or individual sale-lot taxes.",
            "Home equity is not counted as spendable retirement assets until an explicit resale event; sale prices and loan rates are assumptions.",
            "Recurring costs must be incremental to ordinary spending; otherwise they are double-counted.",
            "All amounts are in retirement-date purchasing-power dollars.",
        ],
    }


register(Tool(
    name="plan_life_events", title="Plan major purchases and life expenses",
    description=(
        "Read-only retirement what-if for a house, vehicle, wedding, college, vacation, "
        "childcare, eldercare, renovation, gifts or any other expense. Supports "
        "down payments, amortizing mortgages/loans, existing-home sale offsets, "
        "recurring ownership costs, resale, vehicle lifetime, nominal depreciation and replacement. "
        "Optional current-state purchase conditions skip unaffordable-market purchases "
        "without future knowledge; results report purchase probabilities. Compare the "
        "actual Monte Carlo results with/without events using the same seed. "
        "Can suggest a hypothetical Epic stock sale target, but NEVER creates "
        "a sale or changes any saved settings. Use estimate_sale separately "
        "to estimate shares and taxes from a stated future share price. "
        "Ask the user for missing financial assumptions instead of inventing them."
    ),
    input_schema=object_schema({
        "account": ACCOUNT_PROPERTY,
        "events": {"type": "array", "minItems": 1, "maxItems": 20, "items": _EVENT_SCHEMA},
        "overrides": _PATCH,
        "recalculate_exit": {"type": "boolean", "default": True},
    }, ["events"]),
    scope=COMP_READ, handler=_plan_life_events, blocking_io=True,
))
