"""Refinance state and graph validation shared by account operations.

A refinance chain keeps every link as a row, so any aggregate that sums `amount`
across the rows without consulting this module charges one debt once per link —
a four-link chain on one 76k loan reported 305k.

The `!= loan.id` below is what stops the opposite error. A row pointing at itself
supersedes nothing — it is a live loan carrying bad data — and reading the
self-reference as supersession dropped a real 6,432.84 debt from every total.
Writes have refused a self-link since the bulk resolvers started comparing ids,
but rows that predate that are still on file, so the predicate has to hold
rather than assume they are gone.
"""

from datetime import date, datetime

from fastapi import HTTPException


def loan_is_drawn(loan, as_of) -> bool:
    """Explicit disbursement date, with the legacy loan-year fallback."""
    if as_of is None:
        return True
    get = loan.get if isinstance(loan, dict) else lambda k: getattr(loan, k, None)
    disbursed = get("disbursed_on")
    if isinstance(disbursed, str):
        disbursed = date.fromisoformat(disbursed)
    elif isinstance(disbursed, datetime):
        disbursed = disbursed.date()
    return get("loan_year") <= as_of.year and (disbursed is None or disbursed <= as_of)


def superseded_from_year(loans) -> dict[int, int]:
    """Loan id -> the earliest year in which another row refinances it.

    Supersession is not a fact about a row, it is a fact about a row *and a
    date*: a 2030 refinance says nothing about what is owed in 2026. This is the
    one place that relationship is derived; everything else in this module is a
    view of it.
    """
    first_year: dict[int, int] = {}
    for loan in loans:
        get = loan.get if isinstance(loan, dict) else lambda k, loan=loan: getattr(loan, k)
        target = get("refinances_loan_id")
        if target is None or target == get("id"):
            continue
        year = get("loan_year")
        if target not in first_year or year < first_year[target]:
            first_year[target] = year
    return first_year


def refinanced_loan_ids(loans, as_of) -> set[int]:
    """Ids of loans another row has superseded.

    `as_of` is required rather than defaulted because the two answers differ and
    picking the wrong one is silent:

    - **a date** — superseded *by then*. Use it for "what is owed, paid or
      accruing as of X": a refinance dated after X has not relieved anything yet.
    - **None** — superseded at any point on the schedule. Use it for "does this
      loan ever reach its own payoff date": a loan the schedule replaces before
      maturity shows a $0 "Refinanced" event instead of a payoff, and must not
      also be given a payoff sale.

    Mixing the two across figures the app shows side by side is what this
    signature exists to prevent — `total_loan_principal` and the outstanding
    principal disagreeing by a whole loan is not a rounding difference, and the
    MCP connector tells a model the only difference between them is early
    payments.
    """
    return set(superseded_from_year(
        [loan for loan in loans if loan_is_drawn(loan, as_of)]
    ))


def validate_refinance_graph(loans):
    edges = {
        loan.id: loan.refinances_loan_id
        for loan in loans
        if loan.refinances_loan_id is not None and loan.refinances_loan_id != loan.id
    }
    done = set()
    for start in edges:
        path = set()
        current = start
        while current in edges and current not in done:
            if current in path:
                raise HTTPException(
                    status_code=422, detail="Refinance links cannot form a cycle"
                )
            path.add(current)
            current = edges[current]
        done.update(path)
