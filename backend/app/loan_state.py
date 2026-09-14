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

from fastapi import HTTPException


def superseded_from_year(loans) -> dict[int, int]:
    """Loan id -> the earliest year in which another row refinances it.

    Supersession is not a fact about a row, it is a fact about a row *and a
    date*: a 2030 refinance says nothing about what is owed in 2026. This is the
    one place that relationship is derived; everything else in this module is a
    view of it.
    """
    first_year: dict[int, int] = {}
    for loan in loans:
        target = loan.refinances_loan_id
        if target is None or target == loan.id:
            continue
        year = loan.loan_year
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
    first_year = superseded_from_year(loans)
    if as_of is None:
        return set(first_year)
    return {loan_id for loan_id, year in first_year.items() if year <= as_of.year}


def interest_accrual_end_year(loan, first_year: dict[int, int], cap_year: int | None = None) -> int:
    """Last year `loan` accrues interest on its own principal.

    A refinance moves the principal to its successor, so the old row stops
    accruing *from the refinance year on* — it does not retroactively stop
    having accrued. Dropping a superseded loan from the projection entirely
    erased the interest it really did accrue in the years before the refinance,
    which is the deduction those years are owed.
    """
    end = loan.due_date.year
    superseded_in = first_year.get(loan.id)
    if superseded_in is not None:
        end = min(end, superseded_in - 1)
    if cap_year is not None:
        end = min(end, cap_year)
    return end


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
