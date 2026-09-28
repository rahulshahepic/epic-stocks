"""Helping a user get their equity into the app by talking to their assistant.

`epic_import/prompt.py` already builds a brief for exactly this — it just
assumes the user copies it into a chat window and pastes the answer back. These
two tools close that loop, and deliberately stop short of closing it entirely:

  get_import_guide   hands the assistant the same contract, rules and company
                     schedule the brief carries, read from the content tables
                     so nothing is invented.

  stage_import       validates a draft the assistant produced and leaves it for
                     the user to accept in the wizard.

`stage_import` does not write a grant, a price or a loan. epic_import/ requires
that acceptance goes through the wizard and never a file, and that holds
however the draft was produced — an assistant transcribing share counts is the
case that most wants a human looking at a diff. So the tool stages a proposal
and the app picks it up.
"""
import json
from datetime import datetime, timedelta, timezone

from scaffold.oauth.scopes import EQUITY_READ, IMPORT_PROPOSE
from .accounts import ACCOUNT_PROPERTY, resolve_account
from .tools import Tool, ToolContext, object_schema, register

# How long a proposal waits before the nightly job clears it away.
PROPOSAL_TTL = timedelta(days=7)

# A real account has fewer than twenty grants. This is the cap on what one call
# may carry, so a runaway model cannot post a megabyte of invented rows.
MAX_GRANTS = 100
MAX_PRICES = 200


def _skeleton(ctx: ToolContext):
    from app.content_service import load_content
    from app.epic_import.skeleton import build_skeleton

    return build_skeleton(load_content(ctx.db))


def _finding_dicts(findings) -> list[dict]:
    return [
        {
            "code": f.code,
            "severity": f.severity,
            "subject": f.subject or "",
            "message": f.message,
        }
        for f in findings
    ]


# ── the guide ───────────────────────────────────────────────────────────────

def _get_import_guide(ctx: ToolContext, args: dict):
    from app.epic_import import prompt as brief

    sk, skeleton_findings = _skeleton(ctx)
    return {
        "output_format": brief._CONTRACT,
        "rules": brief._RULES,
        "company_grant_schedule": brief._schedule_table(sk),
        "loan_rates_on_record": brief._rate_table(sk),
        "down_payment_policy": brief._dp_policy(sk),
        "checks_if_working_from_epic_files": brief._IDENTITIES,
        "chat_entry_shapes": {
            "grant": "{year, type, shares, price (cost basis per share; 0 if taxed at vest), vest_start (first vest date, YYYY-MM-DD), periods (annual), exercise_date, dp_shares (negative or 0), election_83b}",
            "loan": "{grant_year, grant_type, loan_type (Purchase|Interest|Tax), loan_year, amount (remaining principal), interest_rate (fraction: 0.02 means 2%), due_date, loan_number?, refinances_loan_id?}",
            "price": "{effective_date, price}; future-dated prices are projections, not actual valuations",
            "sale": "{date, shares, price_per_share, notes?}; use one row per real transaction, never an inferred sale",
            "correction": "list the row, then save_equity with kind, id, and values containing version plus only changed fields",
            "removal": "list the row, confirm with the user, then remove_equity with kind, id and version",
        },
        "workflow_examples": [
            "Unknown grant name: use a similar template only to frame questions; confirm year, shares, vest start, periods, exercise date and zero versus purchase basis, then create one custom grant.",
            "Leave of absence: find the existing grant by year and type, confirm its revised vest start and remaining annual periods, then correct that row by id and version.",
            "Multiple sales: ask the user for each actual transaction date, shares and proceeds per share, then save separate sale rows; do not treat unexplained missing shares as a sale.",
            "Loan extension or refinance: read the loan chain and outstanding balance before changing a due date or adding the successor loan. Do not total the whole chain as debt.",
            "No app import at all: enter confirmed grants, prices, loans and sales one row at a time; read back the records and dashboard after each batch.",
        ],
        "how_to_submit": (
            "Build the JSON object described in output_format, then call "
            "stage_import with it. That does not change anything — it leaves a "
            "draft for the user to review and accept in the app's import "
            "wizard. For chat-only entry, request equity:write and use "
            "save_equity one row at a time after the user confirms the edits. "
            "Call list_grants, list_loans, list_prices and list_sales first: "
            "a proposal is the whole picture, not an addition. Existing sales "
            "and loan history may be absent from a new document; never infer "
            "they should be deleted. For an unfamiliar grant label, suggest a "
            "nearby company template only as a starting point. Ask the user "
            "to confirm its year, type, vest_start (first vesting date/year), "
            "periods, exercise_date, and whether price is zero because it "
            "vests as income. Set custom_schedule, schedule_confirmed and "
            "basis_confirmed to true with those fields in a draft. A leave "
            "of absence can similarly change an existing grant's schedule. "
            "For a sale, ask for each actual transaction's date, quantity and "
            "per-share price; a missing balance is not proof of a sale."
        ),
        "notes": _finding_dicts(skeleton_findings),
    }


register(Tool(
    name="get_import_guide",
    title="How to prepare an import",
    description=(
        "Everything needed to build an import for this account: the exact JSON "
        "shape, the rules that apply, the company vesting schedule and loan "
        "rates on record, and the down-payment policy. Read this before helping "
        "someone enter their equity. Company templates are suggestions for "
        "unfamiliar awards; user-confirmed custom schedules and leave changes "
        "may differ. Pair with stage_import or the equity:write tools."
    ),
    input_schema=object_schema({"account": ACCOUNT_PROPERTY}),
    scope=EQUITY_READ,
    handler=_get_import_guide,
))


# ── staging a draft ─────────────────────────────────────────────────────────

def _stage_import(ctx: ToolContext, args: dict):
    from scaffold.epic_mode import is_epic_mode
    from scaffold.models import ImportProposal
    from app.epic_import.draft import (draft_from_payload, is_blocked,
                                       to_wizard_payload,
                                       validate_draft)

    owner = resolve_account(ctx.user, args.get("account"), ctx.db)

    if is_epic_mode():
        raise ValueError(
            "This deployment manages equity data externally, so an import "
            "cannot be prepared here."
        )

    payload = args.get("payload")
    if not isinstance(payload, dict):
        raise ValueError(
            "'payload' must be the JSON object described by get_import_guide"
        )
    grants, prices = payload.get("grants"), payload.get("prices")
    if not isinstance(grants, list) or not grants:
        raise ValueError("'payload.grants' must be a non-empty list")
    if len(grants) > MAX_GRANTS:
        raise ValueError(f"That is more than {MAX_GRANTS} grants — check the payload")
    if prices is not None and (not isinstance(prices, list) or len(prices) > MAX_PRICES):
        raise ValueError(f"'payload.prices' must be a list of at most {MAX_PRICES} entries")

    sk, skeleton_findings = _skeleton(ctx)
    if sk.is_empty and not all(isinstance(g, dict) and g.get("custom_schedule") is True
                               for g in grants):
        raise ValueError(
            "This deployment has no grant schedule configured, so an import "
            "cannot be checked against one."
        )

    # The same two passes an uploaded file goes through. No statement or CSV
    # rows here, so the checks that compare a statement against its own printed
    # totals do not apply; the structural rules still do.
    draft, parse_findings = draft_from_payload(payload, sk)
    findings = (list(skeleton_findings) + list(parse_findings)
                + validate_draft(draft, None, [], sk))
    blocked = is_blocked(findings)
    wizard_payload = to_wizard_payload(draft, include_unanswered_sales=True)
    custom_keys = {(g["year"], g["type"]) for g in grants
                   if isinstance(g, dict) and g.get("custom_schedule") is True
                   and g.get("schedule_confirmed") is True
                   and g.get("basis_confirmed") is True
                   and isinstance(g.get("year"), int) and isinstance(g.get("type"), str)}
    for g in wizard_payload["grants"]:
        if (g["year"], g["type"]) in custom_keys:
            g.update(custom_schedule=True, schedule_confirmed=True, basis_confirmed=True)

    now = datetime.now(timezone.utc)
    row = ctx.db.query(ImportProposal).filter(
        ImportProposal.user_id == owner.id
    ).first()
    if row is None:
        row = ImportProposal(user_id=owner.id)
        ctx.db.add(row)
    row.client_name = ctx.connector.grant.client_name or "an AI assistant"
    row.payload_json = json.dumps(wizard_payload)
    row.findings_json = json.dumps(_finding_dicts(findings))
    row.blocked = 1 if blocked else 0
    row.created_at = now
    row.expires_at = now + PROPOSAL_TTL
    ctx.db.commit()

    return {
        "staged": True,
        "blocked": blocked,
        "grants": len(wizard_payload["grants"]),
        "prices": len(wizard_payload["prices"]),
        "findings": _finding_dicts(findings),
        "prepared": wizard_payload,
        "next_step": (
            "Nothing has changed yet. Tell the user to open Epic Stocks and "
            "review the import — it is waiting on the Import page, and they "
            "accept it in the wizard."
            + (" Some checks failed; the wizard will show them." if blocked else "")
        ),
    }


register(Tool(
    name="stage_import",
    title="Prepare an import for review",
    description=(
        "Check a prepared import and leave it for the user to accept in the "
        "app. Takes the JSON object get_import_guide describes. This changes "
        "nothing on its own — the user reviews the draft in the import wizard "
        "and accepts it there, so say so rather than telling them it is done. "
        "The draft replaces what the account holds, so include every grant, not "
        "only new ones. Replaces any earlier proposal."
    ),
    input_schema=object_schema({
        "payload": {
            "type": "object",
            "description": (
                "The import, in the shape get_import_guide returns under "
                "output_format: {\"grants\": [...], \"prices\": [...]}."
            ),
        },
        "account": ACCOUNT_PROPERTY,
    }, required=["payload"]),
    scope=IMPORT_PROPOSE,
    handler=_stage_import,
    read_only=False,
    idempotent=True,
))
