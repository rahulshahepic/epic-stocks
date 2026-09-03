"""Session-only preview: parse Epic's own files and compute a timeline.

    POST /api/trial/analyze   files -> computed timeline + a wizard_payload
                              to hand to /api/wizard/submit after signup

No account, no auth, nothing written to the database — this is the
no-signup on-ramp. It reuses the same parsing/reconciliation rules as
/api/epic-import/analyze but skips the paste-out repair loop: if a file
can't be fully read, the fix is to sign up and finish it in the real
wizard, not to repair a session that disappears on refresh. IP rate
limited instead of user rate limited, since there is no user yet.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from app.content_service import load_content
from app.core import compute_timeline, generate_all_events
from app.date_utils import to_date as _to_date
from app.epic_import import build_skeleton, derive_draft, is_blocked, to_wizard_payload, validate_draft
from app.routers.epic_import import _PDF_MAGIC, _parse_files, _read_upload, _summary

router = APIRouter(prefix="/api/trial", tags=["trial"])


def _source_data(payload: dict):
    """The wizard_payload shape, converted into the plain dicts core.py expects."""
    grants_payload = sorted(payload["grants"], key=lambda g: (g["year"], g["type"]))
    grants = [{
        "year": g["year"], "type": g["type"], "shares": g["shares"], "price": g["price"],
        "vest_start": datetime.combine(_to_date(g["vest_start"]), datetime.min.time()),
        "periods": g["periods"],
        "exercise_date": datetime.combine(_to_date(g["exercise_date"]), datetime.min.time()),
        "dp_shares": g.get("dp_shares") or 0,
    } for g in grants_payload]

    prices_payload = sorted(payload["prices"], key=lambda p: p["effective_date"])
    prices = [{"date": datetime.combine(_to_date(p["effective_date"]), datetime.min.time()),
              "price": p["price"]} for p in prices_payload]

    loans = [{
        "grant_yr": g["year"], "grant_type": g["type"],
        "loan_type": l["loan_type"], "loan_year": l["loan_year"],
        "amount": l["amount"], "interest_rate": l["interest_rate"],
        "due": datetime.combine(_to_date(l["due_date"]), datetime.min.time()),
        "loan_number": l.get("loan_number"),
    } for g in grants_payload for l in g.get("loans", [])]

    initial_price = prices[0]["price"] if prices else 0.0
    return grants, prices, loans, initial_price


def _serialize_event(e: dict) -> dict:
    return {k: (v.strftime("%Y-%m-%d") if isinstance(v, datetime) else v)
            for k, v in e.items() if k != "source"}


class TrialAnalyzeResponse(BaseModel):
    wizard_payload: dict
    timeline: list[dict]
    summary: dict
    findings: list[dict]
    blocked: bool
    reconciles: bool


@router.post("/analyze", response_model=TrialAnalyzeResponse)
def analyze(
    request: Request,
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
):
    from scaffold.rate_limit import check_rate_ip
    client_ip = request.client.host if request.client else "unknown"
    check_rate_ip(client_ip, "trial_analyze", max_calls=10, window_secs=300)

    csv_bytes = _read_upload(share_csv, "share CSV")
    pdf_bytes = _read_upload(statement_pdf, "statement PDF", _PDF_MAGIC)
    if csv_bytes is None and pdf_bytes is None:
        raise HTTPException(status_code=400,
                            detail="Upload your share summary CSV, your Stock Loan "
                                   "Statement PDF, or both")

    sk, findings = build_skeleton(load_content(db))
    statement, rows, parse_findings, _statement_text, _csv_text = _parse_files(csv_bytes, pdf_bytes)
    findings += parse_findings

    draft, f = derive_draft(statement, rows, sk)
    findings += f
    draft.statement_date = draft.statement_date or (
        statement.statement_date if statement else None)
    findings += validate_draft(draft, statement, rows, sk)

    blocked = is_blocked(findings)
    reconciles = not any(x.severity == "error" for x in findings)

    wizard_payload = to_wizard_payload(draft)
    grants, prices, loans, initial_price = _source_data(wizard_payload)
    events = generate_all_events(grants, prices, loans)
    timeline = [_serialize_event(e) for e in compute_timeline(events, initial_price)]

    return TrialAnalyzeResponse(
        wizard_payload=wizard_payload,
        timeline=timeline,
        summary=_summary(draft),
        findings=[x.as_dict() for x in findings],
        blocked=blocked,
        reconciles=reconciles,
    )
