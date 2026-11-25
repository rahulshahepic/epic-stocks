"""Shared retirement simulation boundary for MCP and the ChatGPT card.

The financial math is compiled from the browser's Retirement.math.ts. This
module validates assistant-supplied inputs, anchors dates to the owner's DOB,
and runs the isolated Node process with resource limits. No data is persisted.
"""
from __future__ import annotations

from datetime import date
import json
import math
from pathlib import Path
import subprocess
import threading

from database import SessionLocal
from app.financial_literacy import MAX_PORTFOLIO_MILLIONS, MAX_SPENDING_THOUSANDS

RUNNER = Path(__file__).with_name("retirement_runner.mjs")
SIM_SLOTS = threading.BoundedSemaphore(2)
MAX_PATHS = 100_000
MAX_SCENARIOS = 3
MAX_OUTPUT_BYTES = 200_000
DEFAULT_SEED = 1729

MILLIONS = {"epicExit", "taxableAdditional", "additionalBasis", "traditional", "roth"}
THOUSANDS = {"defaultSpend", "minSpend", "healthInsurance", "spouseWorkIncome"}
FRACTIONS = {"stockPct", "bondPct", "stateLTCGRate"}
INTEGERS = {"paths", "seed"}
NUMERIC = MILLIONS | THOUSANDS | FRACTIONS | INTEGERS | {
    "customStockShift", "customBondShift", "ssMonthly", "claimAge",
    "currentAge", "endAge", "fra", "spouseCurrentAge", "spouseSsMonthly",
    "spouseClaimAge", "spouseFra", "spouseStopWorkAge",
}
BOOLEANS = {"zeroHIPost65", "includeSpouse", "spouseHasEmployerHI", "advanced"}
ENUMS = {
    "scenario": {"historical", "moderate", "cautious", "custom"},
    "rebalance": {"none", "tax-advantaged", "all"},
}
SIDE_CARS = {"retirementDate", "spouseDOB", "epicExitMode"}
EDITABLE = NUMERIC | BOOLEANS | set(ENUMS) | {"glidePoints", "plannedEvents"} | SIDE_CARS


def _date(value, label, *, birth=False, historical=False):
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a YYYY-MM-DD date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be a valid YYYY-MM-DD date") from None
    if not (1900 if birth or historical else 2020) <= parsed.year <= (2100 if not birth else 2099):
        raise ValueError(f"{label} is outside the supported date range")
    return parsed


def _age(birth, on):
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


def migrate_saved_params(saved):
    """Match the browser's migrateLoadedParams before applying input limits."""
    migrated = dict(saved)
    additional = migrated.pop("additional", None)
    migrated.pop("refillTaxDrag", None)
    if type(additional) in (int, float) and math.isfinite(additional):
        migrated.setdefault("taxableAdditional", additional)
        migrated.setdefault("additionalBasis", 0)
    points = migrated.get("glidePoints")
    if isinstance(points, list) and points and isinstance(points[0], dict) and "age" in points[0]:
        base_age = migrated.get("currentAge", 0)
        if type(base_age) not in (int, float) or not math.isfinite(base_age):
            base_age = 0
        converted = []
        for point in points:
            if not isinstance(point, dict) or type(point.get("age")) not in (int, float):
                raise ValueError("Legacy glide points must have numeric ages")
            converted.append({
                "yearsAfter": max(0, math.floor(point["age"] - base_age + 0.5)),
                "stockPct": point.get("stockPct"), "bondPct": point.get("bondPct"),
            })
        migrated["glidePoints"] = converted
    # Browser interpolation stable-sorts and *keeps* duplicate years.
    # The last duplicate at the final year controls the later allocation.
    if isinstance(migrated.get("glidePoints"), list):
        pts = migrated["glidePoints"]
        if all(isinstance(p, dict) and type(p.get("yearsAfter")) is int for p in pts):
            migrated["glidePoints"] = sorted(pts, key=lambda p: p["yearsAfter"])
    return migrated



EVENT_KINDS = {"home", "vehicle", "education", "wedding", "travel", "childcare", "care", "renovation", "gift", "other"}
EVENT_FUNDING = {"epic", "brokerage", "cash", "mixed"}
EVENT_NUMBERS = {"amountM", "annualCostM", "downPaymentPct", "loanRate", "loanYears",
                 "saleOffsetM", "resaleValueM", "replacementEveryYears", "replacementCostM", "inflationRate", "lifetimeYears", "depreciationRate", "durationYears", "vehicleAgeYears"}
EVENT_FIELDS = {"id", "title", "kind", "date", "endDate", "resaleDate", "funding", "condition",
                "conditionFailure", "deadlineDate", "depreciationProfile", "priceBasisDate"} | EVENT_NUMBERS


def validate_planned_events(events):
    """Strict input boundary shared by MCP what-ifs and saved scenarios."""
    if not isinstance(events, list) or len(events) > 20:
        raise ValueError("plannedEvents must be a list of at most 20 hypothetical events")
    ids = set()
    for index, event in enumerate(events):
        label = f"plannedEvents[{index}]"
        if not isinstance(event, dict) or set(event) - EVENT_FIELDS:
            raise ValueError(f"{label} has unknown fields")
        for key in ("id", "title", "kind", "date", "amountM"):
            if key not in event:
                raise ValueError(f"{label} requires {key}")
        if any(not isinstance(event[k], str) or not event[k].strip() or len(event[k]) > 100
               for k in ("id", "title")):
            raise ValueError(f"{label} id/title must be nonempty strings (max 100)")
        if event["id"] in ids:
            raise ValueError("planned event IDs must be unique")
        ids.add(event["id"])
        if not isinstance(event["kind"], str) or event["kind"] not in EVENT_KINDS:
            raise ValueError(f"{label} has an unsupported kind")
        if not isinstance(event.get("funding", "mixed"), str) or event.get("funding", "mixed") not in EVENT_FUNDING:
            raise ValueError(f"{label} has an unsupported funding source")
        when = _date(event["date"], f"{label}.date", historical=True)
        if "priceBasisDate" in event:
            basis = _date(event["priceBasisDate"], f"{label}.priceBasisDate", historical=True)
            if basis.isoformat() != event["priceBasisDate"]:
                raise ValueError(f"{label}.priceBasisDate must be a YYYY-MM-DD date")
        if "conditionFailure" in event:
            if event["conditionFailure"] not in ("skip", "defer") or "condition" not in event:
                raise ValueError(f"{label}.conditionFailure requires a condition and must be skip or defer")
        if "deadlineDate" in event:
            if event.get("conditionFailure") != "defer":
                raise ValueError(f"{label}.deadlineDate requires deferred purchase conditions")
            if _date(event["deadlineDate"], f"{label}.deadlineDate", historical=True) < when:
                raise ValueError(f"{label}.deadlineDate must not precede the event")
        if "condition" in event:
            condition = event["condition"]
            if not isinstance(condition, dict) or not condition or set(condition) - {
                "requireFullSpending", "minPortfolioM", "minStartingWealthRatio",
            }:
                raise ValueError(f"{label}.condition needs supported current-state rules")
            if "requireFullSpending" in condition and type(condition["requireFullSpending"]) is not bool:
                raise ValueError(f"{label}.condition.requireFullSpending must be true or false")
            for key in ("minPortfolioM", "minStartingWealthRatio"):
                if key in condition:
                    value = condition[key]
                    maximum = 1000 if key == "minPortfolioM" else 100
                    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
                        raise ValueError(f"{label}.condition.{key} must be a finite number between 0 and {maximum}")
        for key in ("endDate", "resaleDate"):
            if key in event and event[key] is not None:
                other = _date(event[key], f"{label}.{key}", historical=True)
                if other < when:
                    raise ValueError(f"{label}.{key} must not precede the event")
        for key in EVENT_NUMBERS & set(event):
            value = event[key]
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError(f"{label}.{key} must be a finite number")
            maximum = (1 if key in {"downPaymentPct", "loanRate", "inflationRate", "depreciationRate"} else
                       50 if key in {"loanYears", "replacementEveryYears", "lifetimeYears", "durationYears"} else 1000)
            if not 0 <= value <= maximum:
                raise ValueError(f"{label}.{key} must be between 0 and {maximum}")
        if "durationYears" in event:
            if event["kind"] in {"home", "vehicle"} or event.get("endDate") or not float(event["durationYears"]).is_integer() or event["durationYears"] < 1:
                raise ValueError(f"{label} duration must be 1–50 whole years for a non-asset expense; choose duration or endDate")
        if any(key in event and not float(event[key]).is_integer() for key in ("loanYears", "replacementEveryYears")):
            raise ValueError(f"{label} loan and replacement terms must be whole years")
        if event.get("loanYears", 0) and "downPaymentPct" not in event:
            raise ValueError(f"{label} financed purchases require downPaymentPct")
        # Cash purchases may carry redundant loan fields from a web form.
        # planCashFlows creates debt only for a positive financed balance.
        if event.get("replacementEveryYears", 0) and not (event.get("replacementCostM", 0) or event["amountM"]):
            raise ValueError(f"{label} needs a replacement cost")
        if "depreciationProfile" in event:
            if not isinstance(event["depreciationProfile"], str) or event["depreciationProfile"] not in {"collector", "strong", "regular", "sports", "luxury"}:
                raise ValueError(f"{label} has an unsupported depreciation profile")
            if "depreciationRate" in event:
                raise ValueError(f"{label} choose a depreciation profile or custom rate, not both")
        if ("depreciationProfile" in event or "vehicleAgeYears" in event) and "lifetimeYears" not in event:
            raise ValueError(f"{label} depreciation profile and vehicle age require a vehicle lifetime")
        if "vehicleAgeYears" in event and event["vehicleAgeYears"] > 50:
            raise ValueError(f"{label} vehicle age must be 0–50 years")
        if "lifetimeYears" in event:
            lifetime = event["lifetimeYears"]
            if event["kind"] != "vehicle" or lifetime < 1 or not float(lifetime).is_integer():
                raise ValueError(f"{label} lifetime must be a whole number from 1 to 50 for a vehicle")
            if event.get("resaleDate") or "resaleValueM" in event:
                raise ValueError(f"{label} choose lifetime or explicit resale, not both")
            if event.get("replacementEveryYears", 0) and event["replacementEveryYears"] < lifetime:
                raise ValueError(f"{label} replacement interval cannot be shorter than lifetime")
        elif "depreciationRate" in event:
            raise ValueError(f"{label} depreciation requires a vehicle lifetime")
        # A missing resaleValueM means zero, as in the shared simulator.
    return events


def validate_changes(changes):
    """Validate a *partial* named-field patch, never replace a saved blob."""
    if not isinstance(changes, dict) or not changes:
        raise ValueError("Provide a nonempty changes object")
    unknown = set(changes) - EDITABLE
    if unknown:
        raise ValueError("Unknown retirement setting: " + ", ".join(sorted(unknown)))
    for key, value in changes.items():
        if key in BOOLEANS:
            if type(value) is not bool:
                raise ValueError(f"{key} must be true or false")
        elif key in ENUMS:
            if not isinstance(value, str) or value not in ENUMS[key]:
                raise ValueError(f"{key} must be one of {', '.join(sorted(ENUMS[key]))}")
        elif key in NUMERIC:
            if type(value) not in (float, int) or not math.isfinite(value):
                raise ValueError(f"{key} must be a finite number")
            limit = (MAX_PORTFOLIO_MILLIONS if key in MILLIONS else
                     MAX_SPENDING_THOUSANDS if key in THOUSANDS else
                     1 if key in FRACTIONS else
                     100_000 if key in {"ssMonthly", "spouseSsMonthly"} else
                     200 if key in {"currentAge", "endAge", "spouseCurrentAge",
                                    "claimAge", "spouseClaimAge", "spouseStopWorkAge", "fra", "spouseFra"} else
                     MAX_PATHS if key == "paths" else
                     4_294_967_295 if key == "seed" else 2)
            if value < (100 if key == "paths" else -2 if key.startswith("custom") else 0) or value > limit:
                raise ValueError(f"{key} is outside the supported range")
            if key in INTEGERS and not isinstance(value, int):
                raise ValueError(f"{key} must be an integer")
        elif key == "plannedEvents":
            validate_planned_events(value)
        elif key == "glidePoints":
            if not isinstance(value, list) or len(value) > 20:
                raise ValueError("glidePoints must be a list of at most 20 entries")
            last = -1
            for point in value:
                if not isinstance(point, dict) or set(point) != {"yearsAfter", "stockPct", "bondPct"}:
                    raise ValueError("Each glide point needs yearsAfter, stockPct and bondPct")
                y, s, b = point["yearsAfter"], point["stockPct"], point["bondPct"]
                if type(y) is not int or not 0 <= y <= 120 or y < last:
                    raise ValueError("Glide point yearsAfter must increase from 0 to 120")
                if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in (s, b)) or s + b > 1.00000001:
                    raise ValueError("Glide stock and bond weights must sum to at most 1")
                last = y
        elif key == "epicExitMode":
            if value not in ("auto", "manual"):
                raise ValueError("epicExitMode must be auto or manual")
        elif key == "retirementDate":
            _date(value, key)
        elif key == "spouseDOB":
            if value is not None and value != "":
                _date(value, key, birth=True)
    return changes


def validate_combined(params):
    if params.get("stockPct", 0.7) + params.get("bondPct", 0.2) > 1.00000001:
        raise ValueError("Stocks and bonds cannot exceed 100% together")
    if params.get("additionalBasis", 0) > params.get("taxableAdditional", 0):
        raise ValueError("Taxable cost basis cannot exceed the taxable balance")
    if "plannedEvents" in params:
        validate_planned_events(params["plannedEvents"])

    if params.get("endAge", 91) <= params.get("currentAge", 50):
        raise ValueError("End age must be later than retirement age")


def _projected_exit(owner, retirement_date):
    # The shared exit service closes its DB session; give it an independent one.
    from app.routers.events import _preview_exit_data
    with SessionLocal() as db:
        preview = _preview_exit_data(owner, db, retirement_date.isoformat())
    if not preview or preview.get("net_cash") is None:
        raise ValueError("No Epic exit projection is available for this date")
    return max(0, preview["net_cash"] / 1_000_000)


def prepare(owner, *, overrides=None, recalculate_exit=False):
    saved = owner.retirement_params or {}
    if not isinstance(saved, dict):
        raise ValueError("Saved retirement settings are invalid")
    # Validate saved values too, to keep a corrupted legacy record from
    # becoming an unbounded process request.
    migrated = migrate_saved_params(saved)
    base = {k: v for k, v in migrated.items() if k in EDITABLE}
    if base:
        validate_changes(base)
    patch = validate_changes(overrides) if overrides else {}
    params = {**base, **patch}
    retirement_date = _date(params.get("retirementDate", date.today().isoformat()), "retirementDate")
    if owner.date_of_birth:
        params["currentAge"] = _age(owner.date_of_birth, retirement_date)
    elif "retirementDate" in patch:
        raise ValueError("Set your date of birth in Epic Stocks before comparing retirement dates")
    spouse_dob = params.get("spouseDOB")
    if params.get("includeSpouse") and spouse_dob:
        parsed_spouse = _date(spouse_dob, "spouseDOB", birth=True)
        params["spouseCurrentAge"] = _age(parsed_spouse, retirement_date)
        params["spouseFra"] = (66 if parsed_spouse.year <= 1954 else
                               67 if parsed_spouse.year >= 1960 else
                               66 + (parsed_spouse.year - 1954) / 6)
    if recalculate_exit:
        params["epicExit"] = _projected_exit(owner, retirement_date)
    if "epicExit" not in params:
        raise ValueError("Epic exit value is missing. Grant equity:read for a date-specific projection or supply an epicExit assumption.")
    # The browser derives untouched spending fields from 3% / 2% of wealth.
    total_k = sum(params.get(k, 0) for k in ("epicExit", "taxableAdditional", "traditional", "roth")) * 1000
    if total_k > 0:
        params.setdefault("defaultSpend", math.floor(total_k * 0.03 + 0.5))
        params.setdefault("minSpend", math.floor(total_k * 0.02 + 0.5))
    if "minSpend" not in patch and params.get("minSpend", 0) > params.get("defaultSpend", 0):
        params["minSpend"] = params["defaultSpend"]
    # Match the browser's TaxSettings refresh rather than stale saved values.
    # An explicit what-if override remains an intentional scenario input.
    if "stateLTCGRate" not in patch:
        from app.tax_settings import tax_settings_or_defaults
        with SessionLocal() as db:
            tax = tax_settings_or_defaults(owner, db)
        rate = getattr(tax, "state_lt_cg_rate", 0)
        params["stateLTCGRate"] = rate if type(rate) in (int, float) and math.isfinite(rate) else 0
    params["paths"] = params.get("paths", MAX_PATHS)
    params["seed"] = params.get("seed", DEFAULT_SEED)
    validate_combined(params)
    if sum(params.get(k, 0) for k in ("epicExit", "taxableAdditional", "traditional", "roth")) <= 0:
        raise ValueError("Enter an Epic exit value or retirement account balances before simulating")
    # Sidecar fields are not part of the TypeScript engine.
    engine = {k: v for k, v in params.items() if k not in SIDE_CARS}
    engine["simulationStartDate"] = retirement_date.isoformat()
    engine["asOfDate"] = date.today().isoformat()
    if spouse_dob:
        engine["spouseBirthDate"] = spouse_dob
    return engine, retirement_date, "projected_exit" if recalculate_exit else "saved_exit"


def run(owner, *, overrides=None, recalculate_exit=False):
    params, on, exit_source = prepare(owner, overrides=overrides, recalculate_exit=recalculate_exit)
    if not RUNNER.is_file() or not RUNNER.with_name("retirement.math.mjs").is_file():
        raise ValueError("Retirement simulation runtime is not installed on this server")
    if not SIM_SLOTS.acquire(timeout=5):
        raise ValueError("Retirement simulations are busy; please retry shortly")
    try:
        try:
            proc = subprocess.run(
                ["node", "--max-old-space-size=256", str(RUNNER)],
                input=json.dumps({"params": params}), text=True, capture_output=True,
                timeout=45, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("Retirement simulation unavailable or timed out") from exc
        if proc.returncode:
            raise ValueError("Retirement simulation failed; check the saved inputs")
        if len(proc.stdout) > MAX_OUTPUT_BYTES:
            raise ValueError("Retirement simulation output exceeded the safety limit")
        summary = json.loads(proc.stdout)
    finally:
        SIM_SLOTS.release()
    return {
        "retirementDate": on.isoformat(),
        "exitSource": exit_source,
        "inputOverrides": dict(overrides or {}),
        "assumptions": {**{k: v for k, v in params.items() if k in EDITABLE},
                        "spouseDOB": params.get("spouseBirthDate")},
        "result": summary,
        "saved": False,
    }
