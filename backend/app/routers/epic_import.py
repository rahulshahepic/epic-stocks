"""Import straight from Epic's own files, plus the reconciliation harness.

Three endpoints, all driven by the same derivation:

    POST /api/epic-import/preview   parse + derive + plan, writes nothing
    POST /api/epic-import/apply     the same, then merges into the user's data
    POST /api/epic-import/diff      derive from the files and diff against a
                                    dataset exported from the app, so the rules
                                    can be corrected against real data

/diff never touches the database. It reads only the files in the request, which
is what makes it safe to run against a production export.
"""
import io
from datetime import date

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import get_current_user
from scaffold.models import Grant, Loan, Price, User
from app.date_utils import to_date as _to_date
from app.epic_import import (Conventions, Proposal, build_proposal, learn_conventions,
                             parse_share_csv, parse_statement_pdf, reconcile)
from app.epic_import.reconcile import render_markdown
from app.excel_io import (read_grants_from_excel, read_loans_from_excel,
                          read_prices_from_excel)

router = APIRouter(prefix="/api/epic-import", tags=["epic_import"])

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_PDF_MAGIC = b"%PDF-"
_XLSX_MAGIC = b"PK\x03\x04"


def _read_upload(f: UploadFile | None, label: str, magic: bytes | None = None) -> bytes | None:
    if f is None or not f.filename:
        return None
    raw = f.file.read(_MAX_UPLOAD_BYTES + 1)
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"{label} is too large (max 5 MB)")
    if not raw:
        return None
    if magic and not raw.startswith(magic):
        raise HTTPException(status_code=400, detail=f"{label} is not a valid file of that type")
    return raw


def _parse_sources(csv_bytes: bytes | None, pdf_bytes: bytes | None,
                   conventions: Conventions | None = None) -> Proposal:
    statement, rows, findings = None, [], []
    if pdf_bytes is not None:
        try:
            statement, f = parse_statement_pdf(pdf_bytes)
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))
        findings += f
    if csv_bytes is not None:
        rows, f = parse_share_csv(csv_bytes)
        findings += f
    return build_proposal(statement, rows, conventions, findings)


# ============================================================
# SERIALISATION
# ============================================================

def _grant_json(g) -> dict:
    return {"year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
            "vest_start": g.vest_start.isoformat(), "periods": g.periods,
            "exercise_date": g.exercise_date.isoformat(), "dp_shares": g.dp_shares,
            "election_83b": g.election_83b, "source_label": g.source_label,
            "rules": g.rules, "uncertain": g.uncertain}


def _loan_json(l) -> dict:
    return {"loan_number": l.loan_number, "grant_year": l.grant_year,
            "grant_type": l.grant_type, "loan_type": l.loan_type,
            "loan_year": l.loan_year, "amount": l.amount,
            "interest_rate": l.interest_rate, "due_date": l.due_date.isoformat(),
            "source_name": l.source_name, "rules": l.rules, "uncertain": l.uncertain}


def _price_json(p) -> dict:
    return {"effective_date": p.effective_date.isoformat(), "price": p.price,
            "rules": p.rules, "uncertain": p.uncertain}


def _proposal_json(p: Proposal) -> dict:
    return {"statement_date": p.statement_date.isoformat() if p.statement_date else None,
            "conventions": p.conventions.as_dict(),
            "grants": [_grant_json(g) for g in p.grants],
            "loans": [_loan_json(l) for l in p.loans],
            "prices": [_price_json(x) for x in p.prices],
            "findings": [f.as_dict() for f in p.findings]}


# ============================================================
# CURRENT DATA -> BASELINE DICTS
# ============================================================

def _current(db: Session, user_id: int) -> tuple[list[dict], list[dict], list[dict]]:
    grants = [{"year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
               "vest_start": g.vest_start, "periods": g.periods,
               "exercise_date": g.exercise_date, "dp_shares": g.dp_shares or 0,
               "election_83b": bool(g.election_83b)}
              for g in db.query(Grant).filter(Grant.user_id == user_id).all()]
    loans = [{"loan_number": ln.loan_number or "", "grant_year": ln.grant_year,
              "grant_type": ln.grant_type, "loan_type": ln.loan_type,
              "loan_year": ln.loan_year, "amount": ln.amount,
              "interest_rate": ln.interest_rate, "due_date": ln.due_date}
             for ln in db.query(Loan).filter(Loan.user_id == user_id).all()]
    prices = [{"effective_date": p.effective_date, "price": p.price}
              for p in db.query(Price).filter(Price.user_id == user_id).all()]
    return grants, loans, prices


# ============================================================
# PREVIEW
# ============================================================

class PreviewResponse(BaseModel):
    proposal: dict
    plan: dict
    report: dict


def _stale_loans(proposal: Proposal, loans: list[dict], has_statement: bool) -> list[str]:
    """Loans in the user's data that this statement no longer lists.

    Only meaningful when a statement was actually uploaded — with the CSV alone
    there are no statement loans to be absent from.
    """
    if not has_statement:
        return []
    on_statement = {l.loan_number for l in proposal.loans}
    return sorted({str(l["loan_number"]).strip() for l in loans
                   if str(l["loan_number"]).strip()} - on_statement)


def _plan(proposal: Proposal, grants: list[dict], loans: list[dict],
          prices: list[dict], has_statement: bool) -> dict:
    """What applying this proposal would change, counted by action."""
    have_grants = {(int(g["year"]), str(g["type"]).strip()) for g in grants}
    have_loans = {str(l["loan_number"]).strip() for l in loans if l["loan_number"]}
    have_price_years = {_to_date(p["effective_date"]).year for p in prices}
    new_grants = [g for g in proposal.grants if g.key not in have_grants]
    new_loans = [l for l in proposal.loans if l.loan_number not in have_loans]
    new_prices = [p for p in proposal.prices if p.effective_date.year not in have_price_years]
    return {
        "grants_created": [f"{g.year} {g.type}" for g in new_grants],
        "grants_updated": len(proposal.grants) - len(new_grants),
        "loans_created": [l.loan_number for l in new_loans],
        "loans_updated": len(proposal.loans) - len(new_loans),
        "prices_created": [p.effective_date.isoformat() for p in new_prices],
        "loans_not_on_statement": _stale_loans(proposal, loans, has_statement),
    }


@router.post("/preview", response_model=PreviewResponse)
def preview(
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Derive grants, loans and prices from the uploaded files. Writes nothing."""
    from scaffold.rate_limit import check_rate
    check_rate(user.id, "epic_import_preview", max_calls=20, window_secs=300)

    csv_bytes = _read_upload(share_csv, "share CSV")
    pdf_bytes = _read_upload(statement_pdf, "statement PDF", _PDF_MAGIC)
    if csv_bytes is None and pdf_bytes is None:
        raise HTTPException(status_code=400,
                            detail="Upload the share summary CSV, the loan statement PDF, or both")

    grants, loans, prices = _current(db, user.id)
    # Match the user's own date conventions rather than the SPEC defaults.
    conv = learn_conventions(grants, prices) if grants or prices else None
    proposal = _parse_sources(csv_bytes, pdf_bytes, conv)
    report = reconcile(proposal, grants, loans, prices)
    return PreviewResponse(proposal=_proposal_json(proposal),
                           plan=_plan(proposal, grants, loans, prices, pdf_bytes is not None),
                           report=report.as_dict())


# ============================================================
# APPLY
# ============================================================

class ApplyResponse(BaseModel):
    grants_created: int
    grants_updated: int
    loans_created: int
    loans_updated: int
    prices_created: int
    loans_not_on_statement: list[str]
    findings: list[dict]


@router.post("/apply", response_model=ApplyResponse, status_code=201)
def apply(
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    adopt_schedule: bool = False,
    overwrite_prices: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merge the derived data into the user's own.

    Merge, not replace: an annual statement refreshes balances and share counts,
    it does not know about vest dates, down-payment shares or sales. Existing
    grants keep their schedule unless `adopt_schedule` is set, and loans the
    statement no longer lists are reported rather than deleted — they were paid
    off or refinanced, and that history lives in the app.
    """
    from scaffold.rate_limit import check_rate_db
    check_rate_db(user.id, "epic_import", max_calls=5, window_secs=300, db=db)

    csv_bytes = _read_upload(share_csv, "share CSV")
    pdf_bytes = _read_upload(statement_pdf, "statement PDF", _PDF_MAGIC)
    if csv_bytes is None and pdf_bytes is None:
        raise HTTPException(status_code=400,
                            detail="Upload the share summary CSV, the loan statement PDF, or both")

    grants, loans, prices = _current(db, user.id)
    conv = learn_conventions(grants, prices) if grants or prices else None
    proposal = _parse_sources(csv_bytes, pdf_bytes, conv)
    if proposal.has_errors:
        raise HTTPException(status_code=400, detail="\n".join(
            f"[{f.code}] {f.subject or 'file'}: {f.message}"
            for f in proposal.findings if f.severity == "error"))

    from app.routers.import_export import _save_import_backup
    _save_import_backup(user.id, bool(proposal.grants), bool(proposal.prices),
                        bool(proposal.loans), False, False, db)

    by_key = {(g.year, g.type): g for g in db.query(Grant).filter(Grant.user_id == user.id).all()}
    g_created = g_updated = 0
    for pg in proposal.grants:
        existing = by_key.get(pg.key)
        if existing is None:
            db.add(Grant(user_id=user.id, year=pg.year, type=pg.type, shares=pg.shares,
                         price=pg.price, vest_start=pg.vest_start, periods=pg.periods,
                         exercise_date=pg.exercise_date, dp_shares=pg.dp_shares,
                         election_83b=pg.election_83b))
            g_created += 1
            continue
        existing.shares = pg.shares
        existing.price = pg.price
        existing.election_83b = pg.election_83b
        if adopt_schedule:
            if "periods" not in pg.uncertain:
                existing.periods = pg.periods
            if "vest_start" not in pg.uncertain:
                existing.vest_start = pg.vest_start
        existing.version = (existing.version or 1) + 1
        g_updated += 1

    by_number = {(ln.loan_number or "").strip(): ln
                 for ln in db.query(Loan).filter(Loan.user_id == user.id).all()
                 if (ln.loan_number or "").strip()}
    l_created = l_updated = 0
    for pl in proposal.loans:
        existing = by_number.get(pl.loan_number)
        if existing is None:
            db.add(Loan(user_id=user.id, grant_year=pl.grant_year, grant_type=pl.grant_type,
                        loan_type=pl.loan_type, loan_year=pl.loan_year, amount=pl.amount,
                        interest_rate=pl.interest_rate, due_date=pl.due_date,
                        loan_number=pl.loan_number))
            l_created += 1
            continue
        existing.grant_year = pl.grant_year
        existing.grant_type = pl.grant_type
        existing.loan_type = pl.loan_type
        existing.loan_year = pl.loan_year
        existing.amount = pl.amount
        existing.interest_rate = pl.interest_rate
        existing.due_date = pl.due_date
        existing.version = (existing.version or 1) + 1
        l_updated += 1

    have_years = {p.effective_date.year: p
                  for p in db.query(Price).filter(Price.user_id == user.id).all()}
    p_created = 0
    for pp in proposal.prices:
        existing = have_years.get(pp.effective_date.year)
        if existing is None:
            db.add(Price(user_id=user.id, effective_date=pp.effective_date, price=pp.price))
            p_created += 1
        elif overwrite_prices:
            existing.price = pp.price
            existing.version = (existing.version or 1) + 1

    db.commit()
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)

    return ApplyResponse(
        grants_created=g_created, grants_updated=g_updated,
        loans_created=l_created, loans_updated=l_updated, prices_created=p_created,
        loans_not_on_statement=_stale_loans(proposal, loans, pdf_bytes is not None),
        findings=[f.as_dict() for f in proposal.findings],
    )


# ============================================================
# DIFF — the correction loop
# ============================================================

def _baseline_from_export(raw: bytes) -> tuple[list[dict], list[dict], list[dict]]:
    """Read an app Excel export into the plain dicts reconcile expects."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open the export: {e}")
    names = {s.lower(): s for s in wb.sheetnames}
    if "schedule" not in names:
        wb.close()
        raise HTTPException(status_code=400,
                            detail="The export has no Schedule sheet — use Export from the app")
    try:
        grants = read_grants_from_excel(wb[names["schedule"]])
        loans_raw = read_loans_from_excel(wb[names["loans"]]) if "loans" in names else []
        prices_raw = read_prices_from_excel(wb[names["prices"]]) if "prices" in names else []
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the export: {e}")
    finally:
        wb.close()

    loans = [{"loan_number": str(l["loan_number"] or "").strip(), "grant_year": l["grant_yr"],
              "grant_type": l["grant_type"], "loan_type": l["loan_type"],
              "loan_year": l["loan_year"], "amount": l["amount"],
              "interest_rate": l["interest_rate"], "due_date": _to_date(l["due"])}
             for l in loans_raw]
    prices = [{"effective_date": _to_date(p["date"]), "price": p["price"]} for p in prices_raw]
    for g in grants:
        g["vest_start"] = _to_date(g["vest_start"])
        g["exercise_date"] = _to_date(g["exercise_date"])
    return grants, loans, prices


class DiffResponse(BaseModel):
    proposal: dict
    report: dict
    report_with_defaults: dict
    markdown: str


@router.post("/diff", response_model=DiffResponse)
def diff(
    export_xlsx: UploadFile = File(...),
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    _user: User = Depends(get_current_user),
):
    """Diff what the importer derives from the Epic files against exported app data.

    Run twice: once with the SPEC date conventions, once with the conventions read
    out of the export. The second run is the honest measure of whether the rules
    are right — the first shows how much of the gap is only the date conventions.
    """
    from scaffold.rate_limit import check_rate
    check_rate(_user.id, "epic_import_diff", max_calls=20, window_secs=300)

    export_bytes = _read_upload(export_xlsx, "export xlsx", _XLSX_MAGIC)
    if export_bytes is None:
        raise HTTPException(status_code=400, detail="Upload the Excel export from the app")
    csv_bytes = _read_upload(share_csv, "share CSV")
    pdf_bytes = _read_upload(statement_pdf, "statement PDF", _PDF_MAGIC)
    if csv_bytes is None and pdf_bytes is None:
        raise HTTPException(status_code=400,
                            detail="Upload the share summary CSV, the loan statement PDF, or both")

    grants, loans, prices = _baseline_from_export(export_bytes)

    defaults = reconcile(_parse_sources(csv_bytes, pdf_bytes), grants, loans, prices)
    learned = learn_conventions(grants, prices)
    proposal = _parse_sources(csv_bytes, pdf_bytes, learned)
    report = reconcile(proposal, grants, loans, prices)

    return DiffResponse(
        proposal=_proposal_json(proposal),
        report=report.as_dict(),
        report_with_defaults=defaults.as_dict(),
        markdown=render_markdown(proposal, report, proposal.statement_date),
    )


@router.post("/diff.md")
def diff_markdown(
    export_xlsx: UploadFile = File(...),
    share_csv: UploadFile | None = File(default=None),
    statement_pdf: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
):
    """The same report as a downloadable Markdown file."""
    result = diff(export_xlsx=export_xlsx, share_csv=share_csv,
                  statement_pdf=statement_pdf, _user=user)
    stamp = (result.proposal.get("statement_date") or date.today().isoformat())
    return StreamingResponse(
        io.BytesIO(result.markdown.encode("utf-8")),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="import-diff-{stamp}.md"'},
    )
