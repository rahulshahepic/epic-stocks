"""Date-aware refinance state and graph validation shared by account operations."""

from fastapi import HTTPException


def refinanced_loan_ids(loans, as_of=None):
    return {
        loan.refinances_loan_id
        for loan in loans
        if loan.refinances_loan_id is not None
        and loan.refinances_loan_id != loan.id
        and (as_of is None or loan.loan_year <= as_of.year)
    }


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
