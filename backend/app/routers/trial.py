"""Session-only preview: parse Epic's own files and compute a timeline.

    POST /api/trial/analyze   files -> computed timeline + a wizard_payload
                              to hand to /api/wizard/submit after signup

No account and no auth — this is the no-signup on-ramp. None of the
uploaded data is written anywhere; the only thing that touches the
database is a daily counter keyed by the date alone (see _bump), so the
funnel can be measured without recording anything about a visitor.

It reuses the same parsing/reconciliation rules as /api/epic-import/analyze
but skips the paste-out repair loop: if a file can't be fully read, the fix
is to sign up and finish it in the real wizard, not to repair a session that
disappears on refresh. IP rate limited instead of user rate limited, since
there is no user yet.
"""
import logging
from datetime import date as _date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import insert, update
from sqlalchemy.orm import Session

from database import get_db
from schemas import TaxSettingsRead
from scaffold.auth import get_current_user
from scaffold.models import TaxSettings, TrialDailyStat, User
from app.content_service import load_content
from app.core import compute_timeline, generate_all_events
from app.date_utils import to_date as _to_date
from app.epic_import import build_skeleton, derive_draft, is_blocked, to_wizard_payload, validate_draft
from app.routers.epic_import import (_PDF_MAGIC, _parse_files, _read_upload, _summary,
                                     _wizard_prefill)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trial", tags=["trial"])


def _bump(db: Session, column: str) -> None:
    """Add one to today's counter for the preview funnel.

    Anonymous by construction: the row is keyed by the date alone, so there is
    nothing here to tie a count back to whoever caused it. Failures are
    swallowed — a miscounted preview is never worth failing the request that
    was being counted.
    """
    today = _date.today()
    bump = (update(TrialDailyStat)
            .where(TrialDailyStat.day == today)
            .values({column: getattr(TrialDailyStat, column) + 1}))
    for attempt in (1, 2):
        try:
            if db.execute(bump).rowcount:
                db.commit()
                return
            db.execute(insert(TrialDailyStat).values(day=today, **{column: 1}))
            db.commit()
            return
        except Exception:
            # Another replica created today's row between the update and the
            # insert. Roll back and take the update path on the second pass.
            db.rollback()
            if attempt == 2:
                logger.warning("trial funnel counter %s not recorded", column)


def _default_tax_settings() -> TaxSettingsRead:
    """The rates a brand-new account starts with.

    Read off the model's own column defaults rather than restated here, so the
    figures someone sees before signing up cannot drift from the ones they get
    the moment they do.
    """
    cols = TaxSettings.__table__.columns
    return TaxSettingsRead(**{
        name: cols[name].default.arg
        for name in TaxSettingsRead.model_fields
        if name in cols and cols[name].default is not None
    })


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
    # The same flat grant/loan/price shapes the signed-in app renders from, so
    # the preview can show a real dashboard rather than a reduced summary. Ids
    # are negative — nothing here is a saved row.
    grants: list[dict]
    loans: list[dict]
    prices: list[dict]
    timeline: list[dict]
    summary: dict
    tax_defaults: TaxSettingsRead
    # True when the newest price the files carry is from an earlier year, so the
    # UI can ask for the current one rather than quietly valuing at a stale price.
    price_is_stale: bool
    findings: list[dict]
    blocked: bool
    reconciles: bool


@router.post("/analyze", response_model=TrialAnalyzeResponse)
def analyze(
    request: Request,
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    current_price: float | None = Form(default=None),
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

    prefill = _wizard_prefill(draft)

    # The files carry the prices Epic has already announced, and nothing newer.
    # Valuing a position at a price a year or more stale understates it badly, so
    # the preview lets someone supply the current one. It lands as an ordinary
    # price point dated today, in *both* the payload the timeline is computed
    # from and the price list the charts render — anything else would show a
    # dashboard and a chart that disagree about what a share is worth.
    today_iso = _date.today().isoformat()
    if wizard_payload["prices"]:
        latest = max(p["effective_date"] for p in wizard_payload["prices"])
        if current_price is not None and current_price > 0 and today_iso > latest:
            wizard_payload["prices"].append(
                {"effective_date": today_iso, "price": current_price})
            prefill["prices"].append({
                "id": -(len(prefill["prices"]) + 1), "effective_date": today_iso,
                "price": current_price, "is_estimate": False, "version": 1,
            })

    # Stale once the newest price held — including one just supplied — is from an
    # earlier year than today.
    price_is_stale = bool(wizard_payload["prices"]) and max(
        p["effective_date"] for p in wizard_payload["prices"])[:4] < today_iso[:4]

    grants, prices, loans, initial_price = _source_data(wizard_payload)
    events = generate_all_events(grants, prices, loans)
    timeline = [_serialize_event(e) for e in compute_timeline(events, initial_price)]
    _bump(db, "previews")

    return TrialAnalyzeResponse(
        wizard_payload=wizard_payload,
        grants=prefill["grants"],
        loans=prefill["loans"],
        prices=prefill["prices"],
        timeline=timeline,
        summary=_summary(draft),
        tax_defaults=_default_tax_settings(),
        price_is_stale=price_is_stale,
        findings=[x.as_dict() for x in findings],
        blocked=blocked,
        reconciles=reconciles,
    )


# ============================================================
# FUNNEL COUNTERS
# ============================================================
# Two endpoints whose only job is to add one to a daily total. They exist
# because the preview writes nothing else: without them there is no way to tell
# a feature nobody uses from one everybody uses and abandons.


@router.post("/save-intent", status_code=204)
def save_intent(request: Request, db: Session = Depends(get_db)):
    """Someone pressed save on a preview and is heading for sign-in."""
    from scaffold.rate_limit import check_rate_ip
    client_ip = request.client.host if request.client else "unknown"
    check_rate_ip(client_ip, "trial_save_intent", max_calls=20, window_secs=300)
    _bump(db, "save_clicked")
    return Response(status_code=204)


@router.post("/converted", status_code=204)
def converted(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """A new account finished signing up carrying preview data with it."""
    from scaffold.rate_limit import check_rate
    check_rate(user.id, "trial_converted", max_calls=3, window_secs=3600)
    _bump(db, "signups_from_trial")
    return Response(status_code=204)
