"""Retirement MCP tools and portable MCP Apps entrypoint."""
from datetime import date
from scaffold.oauth.scopes import COMP_READ, COMP_WRITE, EQUITY_READ
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register
from app.changes import RETIREMENT_PARAMS, apply_changes
from app.retirement_simulation import run, MAX_SCENARIOS, MAX_PATHS

RETIREMENT_RESOURCE_VERSION = 9
RETIREMENT_RESOURCE_URI = f"ui://epic-stocks/retirement-v{RETIREMENT_RESOURCE_VERSION}.html"
RETIREMENT_COMPARE_RESOURCE_URI = "ui://epic-stocks/retirement-compare-v2.html"
RETIREMENT_COMPARE_RESOURCE_URIS = frozenset({
    "ui://epic-stocks/retirement-compare-v1.html", RETIREMENT_COMPARE_RESOURCE_URI,
})
RETIREMENT_RESOURCE_URIS = frozenset(
    f"ui://epic-stocks/retirement-v{v}.html" for v in range(1, RETIREMENT_RESOURCE_VERSION + 1)
) | RETIREMENT_COMPARE_RESOURCE_URIS

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
        "priceBasisDate": {"type": "string", "description": "Optional YYYY-MM-DD price basis for expense amounts entered without a retirement date."},
        "amountM": {"type": "number", "description": "Purchase or one-time expense in millions of dollars"},
        "annualCostM": {"type": "number", "description": "Additional recurring annual cost in $M, not already in normal spending"},
        "endDate": {"type": "string", "description": "Absolute recurring-cost cutoff; cannot combine with durationYears"},
        "durationYears": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Recurring non-asset expense duration from actual start; e.g. 4 years of tuition. Cannot combine with endDate."},
        "downPaymentPct": {"type": "number", "description": "Fraction paid upfront; required for financing"},
        "loanRate": {"type": "number", "description": "Annual nominal loan rate as a fraction"},
        "inflationRate": {"type": "number", "description": "Annual inflation for real fixed mortgage payments; default 0.025"},
        "loanYears": {"type": "number"},
        "saleOffsetM": {"type": "number", "description": "Net proceeds from an existing home or car, credited only at the first purchase; later vehicle sales use the ownership schedule"},
        "resaleDate": {"type": "string"},
        "resaleValueM": {"type": "number"},
        "replacementEveryYears": {"type": "number"},
        "replacementCostM": {"type": "number", "description": "Optional repeat cost; 0 or omitted means repeat original amount"},
        "funding": {"type": "string", "enum": ["epic", "brokerage", "cash", "mixed"]},
        "conditionFailure": {"type": "string", "enum": ["skip", "defer"], "description": "Requires condition. Default skip checks only on scheduled dates. Defer retries monthly until eligible; ownership, debt, sale and replacements follow actual purchase dates."},
        "deadlineDate": {"type": "string", "description": "Optional last date to initiate a deferred purchase or replacement (YYYY-MM-DD). Requires conditionFailure=defer."},
        "lifetimeYears": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Vehicle ownership years before automatic sale; cannot combine with explicit resale. Each replacement starts a new ownership period."},
        "depreciationProfile": {"type": "string", "enum": ["collector", "strong", "regular", "sports", "luxury"], "description": "Nominal retained-value curve, requires lifetimeYears. Collector stays flat; others have a larger early decline. Choose profile or custom depreciationRate."},
        "vehicleAgeYears": {"type": "number", "minimum": 0, "maximum": 50, "description": "Age at each car purchase, default 0 (new). Used cars follow the remaining curve relative to price paid."},
        "depreciationRate": {"type": "number", "minimum": 0, "maximum": 1, "description": "Annual nominal depreciation during lifetime; 0 retains nominal price. Resale is deflated by inflationRate (default 2.5%)."},
        "condition": {
            "type": "object", "additionalProperties": False, "minProperties": 1,
            "description": "All rules must hold immediately before purchase, using only current portfolio state. conditionFailure chooses skip (default) or monthly defer. No costs or resale until purchased. Pre-retirement conditional ownership periods are skipped with a warning. Existing bills continue.",
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
    "description": "Named retirement calculator fields to override. Dollars are in $M for assets and $K/year for spending; saving requires a separate confirmed update_retirement_params call.",
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
        "paths": {"type": "integer", "minimum": 100, "maximum": MAX_PATHS,
                  "description": "Simulation paths: 100–100000; lower counts are faster but less stable."},
        "seed": {"type": "integer", "minimum": 0, "maximum": 4_294_967_295},
        "scenario": {"type": "string", "enum": ["historical", "moderate", "cautious", "custom"]},
        "rebalance": {"type": "string", "enum": ["none", "tax-advantaged", "all"]},
        "retirementDate": {"type": "string", "description": "YYYY-MM-DD"},
        "epicExitMode": {"type": "string", "enum": ["auto", "manual"], "description": "Preserve a manual exit amount or project for each retirement date"},
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
        "type": "boolean",
        "description": "Omit to respect saved automatic mode. When true, replace the saved Epic exit assumption with the app's date-specific after-tax, after-loan exit projection. Future prices may be estimates.",
    },
})
_RESULT = object_schema({
    "account_context": {"type": "object", "description": "Verified synthetic account context, when testing in staging."},
    "retirementDate": {"type": "string"},
    "exitSource": {"type": "string"},
    "canProjectExit": {"type": "boolean", "description": "Whether this connection can estimate dated Epic sale proceeds from equity data."},
    "assumptions": {"type": "object", "description": "Resolved values for display, including defaults and computed projections. Never reuse as input overrides."},
    "inputOverrides": {"type": "object", "description": "Only explicitly supplied overrides. Preserve these across interactive runs; derived assumptions are not user inputs."},
    "result": {"type": "object"},
    "saved": {"type": "boolean"},
}, ["retirementDate", "exitSource", "assumptions", "result", "saved"])


_COMPARISON_METRICS = {
    "modelFeasible": {"type": "boolean"},
    "modelWarning": {"type": ["string", "null"]},
    "preRetirementFundingGapM": {"type": "number"},
    "startingTotalM": {"type": "number"},
    "pctFundingShortfall": {"type": "number"},
    "pctLiquidityShortfall": {"type": "number"},
    "pctExhausted": {"type": "number"},
    "finalPercentiles": {"type": "array", "items": object_schema({
        "q": {"type": "number"}, "value": {"type": "number"},
    }, ["q", "value"])},
}
_COMPARISON_RESULT = object_schema({
    "account_context": _RESULT["properties"]["account_context"],
    "scenarios": {
        "type": "array", "minItems": 2, "maxItems": MAX_SCENARIOS,
        "items": object_schema({
            **{key: value for key, value in _RESULT["properties"].items() if key != "account_context"},
            "name": {"type": "string"},
            "assumptions": {"type": "object", "properties": {"epicExit": {"type": "number"}},
                            "required": ["epicExit"]},
            "result": {"type": "object", "properties": _COMPARISON_METRICS,
                       "required": list(_COMPARISON_METRICS)},
        }, ["name", *_RESULT["required"]]),
    },
    "saved": {"type": "boolean"},
    "note": {"type": "string"},
}, ["scenarios", "saved", "note"])


def _run(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    if "overrides" in args and not isinstance(args["overrides"], dict):
        raise ValueError("overrides must be an object")
    if "recalculate_exit" in args and type(args["recalculate_exit"]) is not bool:
        raise ValueError("recalculate_exit must be true or false")
    if args.get("recalculate_exit") and EQUITY_READ not in ctx.connector.scopes:
        raise ValueError("Date-specific Epic exit projections require equity:read")
    saved = owner.retirement_params or {}
    if not isinstance(saved, dict):
        raise ValueError("Saved retirement settings are invalid")
    missing_exit = "epicExit" not in saved and "epicExit" not in (args.get("overrides") or {})
    mode_auto = (args.get("overrides") or {}).get("epicExitMode", saved.get("epicExitMode")) == "auto" and "epicExit" not in (args.get("overrides") or {})
    if mode_auto and EQUITY_READ not in ctx.connector.scopes and args.get("recalculate_exit") is not False:
        raise ValueError("Automatic exit mode requires equity:read; supply an explicit epicExit or choose manual mode")
    implicit_exit = (missing_exit or mode_auto) and "recalculate_exit" not in args and EQUITY_READ in ctx.connector.scopes
    return {**run(owner, overrides=args.get("overrides"),
                  recalculate_exit=args.get("recalculate_exit", implicit_exit)),
            "canProjectExit": EQUITY_READ in ctx.connector.scopes}


RETIREMENT_CONFIRM_PROPERTY = {
    "type": "string",
    "description": "Omit to preview. After the user approves, send this token with the same inputs within 30 minutes.",
}


def apply_retirement_patch(owner, db, patch, confirm, *, show_account_breakdown=False):
    if confirm is not None and not isinstance(confirm, str):
        raise ValueError("confirm is the token a preview returned")
    result = apply_changes(
        owner, db, [{"kind": RETIREMENT_PARAMS, "action": "update", "values": patch}],
        confirm=confirm, retirement_only=True, show_account_breakdown=show_account_breakdown,
    )
    # The internal diff contains previous values. comp:write does not grant read access.
    response = {"applied": result["applied"], "saved": result["applied"]}
    if not result["applied"]:
        response.update(confirm=result["confirm"], next_step=(
            "Show the proposed values to the user. Once they approve, call this tool again "
            "with the same inputs and this confirm token."
        ))
    return response


def _update(ctx: ToolContext, args: dict):
    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    patch = args.get("changes")
    result = apply_retirement_patch(owner, ctx.db, patch, args.get("confirm"))
    if not result["applied"]:
        return {**result, "changes": patch}
    return {**result, "updated": sorted(patch),
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
        results.append({"name": name, **result,
                        "canProjectExit": EQUITY_READ in ctx.connector.scopes})
    return {"scenarios": results, "saved": False,
            "note": "All scenarios use the same random seed by default. Epic exit projections use the date-specific price assumptions and are not guarantees."}


register(Tool(
    name="run_retirement_simulation", title="Run retirement Monte Carlo",
    financial_output=True,
    description="Run the actual Epic Stocks retirement calculator (100,000 historical block-bootstrap paths by default). Read saved inputs and optionally override fields without saving. Returns funding-shortfall and portfolio-exhaustion probabilities separately, percentile wealth by age, and the assumptions used. Use recalculate_exit for date-specific Epic liquidation net cash; otherwise the saved Epic exit input is used. Results are simulations, not guarantees.",
    input_schema=_RUN_INPUT, scope=COMP_READ, handler=_run, blocking_io=True,
))
register(Tool(
    name="compare_retirement_scenarios", title="Compare retirement scenarios",
    financial_output=True,
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
    }, ["scenarios"]), output_schema=_COMPARISON_RESULT, scope=COMP_READ, handler=_compare, blocking_io=True,
    metadata={
        "ui": {"resourceUri": RETIREMENT_COMPARE_RESOURCE_URI, "visibility": ["model", "app"]},
        "openai/ui": {"entrypoints": [{"type": "global"}, {"type": "thread"}]},
        "openai/toolInvocation/invoking": "Comparing retirement scenarios…",
        "openai/toolInvocation/invoked": "Retirement comparison ready",
    },
))
register(Tool(
    name="update_retirement_params", title="Update saved retirement assumptions",
    description="Preview a patch to named retirement calculator fields by omitting confirm. Show the proposed values to the user and, once they approve, repeat the call with the same changes and the returned confirm token to save. Assets are $M, spending and insurance are $K/year. Use run_retirement_simulation for exploratory what-if runs.",
    input_schema=object_schema({
        "account": ACCOUNT_PROPERTY, "changes": _PATCH, "confirm": RETIREMENT_CONFIRM_PROPERTY,
    }, ["changes"]),
    scope=COMP_WRITE, handler=_update, read_only=False, idempotent=False, destructive=True,
))
register(Tool(
    name="show_retirement", title="Open retirement planner",
    financial_output=True,
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
    financial_output=True,
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
    for result in (before, after):
        result["canProjectExit"] = EQUITY_READ in ctx.connector.scopes
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
    financial_output=True,
    description=(
        "Read-only retirement what-if for a house, vehicle, wedding, college, vacation, "
        "childcare, eldercare, renovation, gifts or any other expense. Supports "
        "down payments, amortizing mortgages/loans, existing-home sale offsets, "
        "recurring ownership costs, resale, vehicle lifetime, nominal depreciation and replacement. "
        "Optional current-state purchase conditions skip unaffordable-market purchases "
        "without future knowledge; results report purchase probabilities. Compare the "
        "actual Monte Carlo results with/without events using the same seed. "
        "Can calculate a hypothetical Epic stock sale target, but NEVER creates "
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
