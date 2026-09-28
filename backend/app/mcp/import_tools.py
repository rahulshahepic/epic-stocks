"""Helping a user get their equity into the app by talking to their assistant.

This is meant to be the ordinary way in: someone shares a grant letter, a
Shareworks file, a screenshot or just what they remember, and their assistant
drafts the import with them. Two tools, which deliberately stop short of
closing the loop:

  get_import_guide   how to draft it and talk it through (import_guide.py),
                     plus the company schedule and loan rates from the content
                     tables and what the account already holds.

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
MAX_ASSUMPTIONS = 50
MAX_ASSUMPTION_LEN = 500


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

def _account_now(owner, db) -> dict:
    """What the account holds, so a proposal replaces it knowingly."""
    from scaffold.models import Grant, Loan, Price

    loans = db.query(Loan).filter(Loan.user_id == owner.id).all()
    return {
        "grants": [
            {"year": g.year, "type": g.type, "shares": g.shares,
             "loans": sum(1 for l in loans if (l.grant_year, l.grant_type) == (g.year, g.type))}
            for g in db.query(Grant).filter(Grant.user_id == owner.id)
            .order_by(Grant.year, Grant.type)
        ],
        "price_years": sorted({p.effective_date.year for p in
                               db.query(Price).filter(Price.user_id == owner.id)}),
    }


def _get_import_guide(ctx: ToolContext, args: dict):
    from app.epic_import import prompt as brief
    from . import import_guide as guide

    owner = resolve_account(ctx.user, args.get("account"), ctx.db)
    sk, skeleton_findings = _skeleton(ctx)
    return {
        "start_here": guide.START_HERE,
        "talking_to_the_user": guide.TALKING_TO_THE_USER,
        "making_best_guesses": guide.MAKING_BEST_GUESSES,
        "unusual_grants": guide.UNUSUAL_GRANTS,
        "output_format": guide.OUTPUT_FORMAT,
        "rules": guide.RULES,
        "company_grant_schedule": brief._schedule_table(sk),
        "loan_rates_on_record": brief._rate_table(sk),
        "down_payment_policy": brief._dp_policy(sk),
        "checks_if_working_from_epic_files": brief._IDENTITIES,
        "account_now": _account_now(owner, ctx.db),
        "how_to_submit": (
            "Call stage_import with the payload once the person has confirmed "
            "it. That does not change anything — it leaves a draft for them to "
            "review and accept in the app. Grants you leave out are kept as they "
            "are, so adding one new grant needs only that grant."
        ),
        "notes": _finding_dicts(skeleton_findings),
    }


register(Tool(
    name="get_import_guide",
    title="How to prepare an import",
    description=(
        "Read this first whenever someone wants to add or update their grants, "
        "loans or share prices — from a grant letter, a Shareworks file, a "
        "screenshot or memory. It explains how to draft the import, how to walk "
        "the person through it in plain words, what may be guessed, the company "
        "vesting schedule and loan rates, and what the account already holds. "
        "Pair it with stage_import."
    ),
    input_schema=object_schema({"account": ACCOUNT_PROPERTY}),
    scope=EQUITY_READ,
    handler=_get_import_guide,
))


# ── staging a draft ─────────────────────────────────────────────────────────

def _assumptions(raw) -> list[dict]:
    """The guesses the assistant made, as the review screen shows them.

    Tolerant like the rest of the payload: strings or {subject, note} objects,
    anything else dropped rather than refusing the whole draft over a note.
    """
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_ASSUMPTIONS]:
        if isinstance(item, str):
            subject, note = "", item
        elif isinstance(item, dict):
            subject, note = item.get("subject") or "", item.get("note") or ""
        else:
            continue
        note = str(note).strip()[:MAX_ASSUMPTION_LEN]
        if note:
            out.append({"subject": str(subject).strip()[:100], "note": note})
    return out


def _stage_import(ctx: ToolContext, args: dict):
    from scaffold.epic_mode import is_epic_mode
    from scaffold.models import ImportProposal
    from app.epic_import.draft import (draft_from_payload, is_blocked,
                                       to_wizard_payload, validate_draft)
    from app.epic_import.changes import changes_for
    from . import import_guide as guide

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
    if sk.is_empty:
        raise ValueError(
            "This deployment has no grant schedule configured, so an import "
            "cannot be checked against one."
        )

    # The same two passes an uploaded file goes through. No statement or CSV
    # rows here, so the checks that compare a statement against its own printed
    # totals do not apply; the structural rules still do. Nothing is
    # superseded: that is for a repair replacing an earlier parse of files, and
    # here the payload is the only thing that was read — demoting its findings
    # turned "shares must be positive" into an "(before your correction)" note.
    draft, parse_findings = draft_from_payload(payload, sk)
    findings = (list(skeleton_findings) + list(parse_findings)
                + validate_draft(draft, None, [], sk))
    blocked = is_blocked(findings)
    wizard_payload = to_wizard_payload(draft)
    assumptions = _assumptions(payload.get("assumptions"))
    changes = changes_for(draft, owner.id, ctx.db)

    now = datetime.now(timezone.utc)
    row = ctx.db.query(ImportProposal).filter(
        ImportProposal.user_id == owner.id
    ).first()
    if row is None:
        row = ImportProposal(user_id=owner.id)
        ctx.db.add(row)
    client = ctx.connector.grant.client_name or "an AI assistant"
    row.client_name = client
    # Assumptions ride in the same encrypted blob: they quote the user's figures.
    row.payload_json = json.dumps({**wizard_payload, "assumptions": assumptions})
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
        "changes_vs_account": changes,
        "assumptions": assumptions,
        "prepared": wizard_payload,
        "next_step": (
            "Nothing has changed yet. Go through changes_vs_account with the "
            "person in plain words — above all anything under loans_removed or "
            "grants_updated they did not ask for — and restage if it is wrong. "
            "Explain any warning in findings without its code. Then pass on "
            "tell_the_user."
            + (" Some checks failed; the review screen will show them too." if blocked else "")
        ),
        "tell_the_user": guide.TELL_THE_USER.format(client=client),
    }


register(Tool(
    name="stage_import",
    title="Prepare an import for review",
    description=(
        "Leave a prepared import for the person to review and accept in the "
        "app. Takes the object get_import_guide describes; call it once they "
        "have confirmed the draft with you. It changes nothing on its own, so "
        "never tell them it is done. Returns what accepting it would change "
        "(walk them through that) and the words to tell them next. Grants left "
        "out are kept as they are. Replaces any earlier proposal."
    ),
    input_schema=object_schema({
        "payload": {
            "type": "object",
            "description": (
                "The import, in the shape get_import_guide returns under "
                "output_format: {\"grants\": [...], \"prices\": [...], "
                "\"sales\": [...], \"assumptions\": [...]}."
            ),
        },
        "account": ACCOUNT_PROPERTY,
    }, required=["payload"]),
    scope=IMPORT_PROPOSE,
    handler=_stage_import,
    read_only=False,
    idempotent=True,
))
