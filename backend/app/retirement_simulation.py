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
SIDE_CARS = {"retirementDate", "spouseDOB"}
EDITABLE = NUMERIC | BOOLEANS | set(ENUMS) | {"glidePoints"} | SIDE_CARS


def _date(value, label, *, birth=False):
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a YYYY-MM-DD date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be a valid YYYY-MM-DD date") from None
    if not (1900 if birth else 2020) <= parsed.year <= (2100 if not birth else 2099):
        raise ValueError(f"{label} is outside the supported date range")
    return parsed


def _age(birth, on):
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


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
            limit = (1_000 if key in MILLIONS else
                     10_000 if key in THOUSANDS else
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
        elif key == "glidePoints":
            if not isinstance(value, list) or len(value) > 20:
                raise ValueError("glidePoints must be a list of at most 20 entries")
            last = -1
            for point in value:
                if not isinstance(point, dict) or set(point) != {"yearsAfter", "stockPct", "bondPct"}:
                    raise ValueError("Each glide point needs yearsAfter, stockPct and bondPct")
                y, s, b = point["yearsAfter"], point["stockPct"], point["bondPct"]
                if type(y) is not int or not 0 <= y <= 120 or y <= last:
                    raise ValueError("Glide point yearsAfter must increase from 0 to 120")
                if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in (s, b)) or s + b > 1.00000001:
                    raise ValueError("Glide stock and bond weights must sum to at most 1")
                last = y
        elif key == "retirementDate":
            _date(value, key)
        elif key == "spouseDOB":
            if value is not None and value != "":
                _date(value, key)
    return changes


def validate_combined(params):
    if params.get("stockPct", 0.7) + params.get("bondPct", 0.2) > 1.00000001:
        raise ValueError("Stocks and bonds cannot exceed 100% together")
    if params.get("additionalBasis", 0) > params.get("taxableAdditional", 0):
        raise ValueError("Taxable cost basis cannot exceed the taxable balance")
    if params.get("minSpend", 0) > params.get("defaultSpend", 0):
        raise ValueError("Minimum spending cannot exceed target spending")
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
    base = {k: v for k, v in saved.items() if k in EDITABLE}
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
        params["spouseCurrentAge"] = _age(_date(spouse_dob, "spouseDOB", birth=True), retirement_date)
    if recalculate_exit:
        params["epicExit"] = _projected_exit(owner, retirement_date)
    params["paths"] = params.get("paths", MAX_PATHS)
    params["seed"] = params.get("seed", DEFAULT_SEED)
    validate_combined(params)
    # Sidecar fields are not part of the TypeScript engine.
    engine = {k: v for k, v in params.items() if k not in SIDE_CARS}
    engine["simulationStartDate"] = retirement_date.isoformat()
    if spouse_dob:
        engine["spouseBirthDate"] = spouse_dob
    return engine, retirement_date, "projected_exit" if recalculate_exit else "saved_exit"


def run(owner, *, overrides=None, recalculate_exit=False):
    params, on, exit_source = prepare(owner, overrides=overrides, recalculate_exit=recalculate_exit)
    if not RUNNER.is_file() or not RUNNER.with_name("retirement.math.mjs").is_file():
        raise ValueError("Retirement simulation runtime is not installed on this server")
    if not SIM_SLOTS.acquire(blocking=False):
        raise ValueError("Retirement simulations are busy; please retry shortly")
    try:
        try:
            proc = subprocess.run(
                ["node", str(RUNNER)],
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
        "assumptions": {k: params.get(k) for k in (
            "epicExit", "taxableAdditional", "traditional", "roth",
            "defaultSpend", "minSpend", "healthInsurance", "scenario",
            "stockPct", "bondPct", "currentAge", "endAge", "paths", "seed",
        )},
        "result": summary,
        "saved": False,
    }
