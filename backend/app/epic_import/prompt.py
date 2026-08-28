"""The prompt a user pastes into their own assistant to repair a draft.

The app never calls a model. When the deterministic parse cannot be trusted, it
hands the user a self-contained brief — the output contract, the company
schedule they must not change, the draft so far, exactly what failed, and the
source text — for them to paste into whichever assistant they already use. What
comes back is validated by the same checks that rejected the draft.

The arithmetic identities are stated explicitly so the assistant has something
to check itself against rather than guessing at intent.
"""
import json

from .draft import Draft, to_wizard_payload
from .models import Finding, Statement
from .skeleton import Skeleton

_CONTRACT = """\
Return ONE JSON object and nothing else — no explanation before or after, no
markdown fences. It must have this shape:

{
  "grants": [
    {
      "year": 2021,
      "type": "Purchase",          // Purchase | Catch-Up | Bonus | Free
      "shares": 100000,            // whole shares granted
      "price": 2.83,               // cost basis PER SHARE, 0 if taxed at vest
      "dp_shares": 0,              // shares handed back at exercise, negative or 0
      "election_83b": false,
      "loans": [
        {
          "loan_number": "022270",
          "loan_type": "Purchase", // Purchase | Interest | Tax
          "loan_year": 2021,
          "amount": 263000.00,     // principal balance
          "interest_rate": 0.0086, // decimal fraction, NOT a percentage
          "due_date": "2030-07-15"
        }
      ]
    }
  ],
  "prices": [
    { "effective_date": "2021-01-01", "price": 2.83 }   // one per year, dated 1 January
  ]
}
"""

_RULES = """\
Rules you must follow:

1. Do NOT invent or alter vest_start, periods or exercise_date. They are company
   wide, they are listed below, and they are ignored if you send them.
2. Every grant in the stock workbook that has a share count must appear exactly
   once. Match on year and type.
3. interest_rate is a decimal fraction: 0.86% is 0.0086.
4. price is the cost basis PER SHARE — divide the reported total cost basis by
   the shares granted. Use 0 when the grant is taxed as it vests (the reported
   per-share basis is not a round number of cents, or unvested shares carry no
   unvested value). Catch-Up grants are always 0.
5. Attribute every loan on the statement to exactly one grant. Loan names follow
   "<year> Grant|Bonus - Purchase|Interest|Tax Loan[ - <year>]". Tax loans on an
   unqualified "<year> Grant" belong to that year's zero-basis grant (Catch-Up
   if there is one, otherwise Bonus). A loan naming two grants goes entirely to
   the bonus side.
6. A purchase grant's loan is its cost basis less the down payment. When the
   down payment works out to a whole number of shares at that year's price, and
   it is the policy minimum listed below, it was paid by handing shares back:
   set dp_shares to minus that number of shares. Those are the shares the CSV
   reports as sold — Epic reports them against the grant they came out of, not
   the grant being bought. Leave dp_shares at 0 when the arithmetic does not
   land on whole shares.
7. Use only figures present in the source material. Do not estimate anything.
"""

_IDENTITIES = """\
Your answer must satisfy all of these. Check them before replying:

  A. For each due year, the loans due that year sum to that year's Subtotal on
     the statement.
  B. All loans together sum to the statement's Total.
  C. For each grant, its loans sum to that grant's "Loan Balance" in the CSV.
  D. For each grant, the sum of (loan amount x interest_rate) over its loans
     equals that grant's "Annual Interest Due" in the CSV.
  E. For each grant, shares equals "Shares Granted" in the CSV.
  F. For each grant carrying dp_shares, cost basis minus the purchase loan
     equals dp_shares x price. Across all grants, the shares handed back come
     to no more than the total "Shares Sold" in the CSV; any remainder was
     genuinely sold.

If a check cannot be made to pass with the figures available, say so in a
comment AFTER the JSON object rather than bending a number to fit.
"""


def _schedule_table(sk: Skeleton) -> str:
    lines = ["year | type      | vest_start | periods | exercise_date",
             "-----|-----------|------------|---------|--------------"]
    for t in sorted(sk.templates, key=lambda t: (t.year, t.type)):
        lines.append(f"{t.year} | {t.type:<9} | {t.vest_start} | {t.periods:>7} | "
                     f"{t.exercise_date}")
    return "\n".join(lines)


def _dp_policy(sk: Skeleton) -> str:
    return (f"The down payment is at least {sk.dp_min_percent:.0%} of the purchase, "
            f"capped at {sk.dp_min_cap:,.0f}, rounded up to a whole number of shares "
            f"when it is paid in stock.")


def _rate_table(sk: Skeleton) -> str:
    lines = ["kind             | grant type | year | rate",
             "-----------------|------------|------|--------"]
    for year, rate in sorted(sk.interest_rates.items()):
        lines.append(f"interest         | any        | {year} | {rate}")
    for (gtype, year), rate in sorted(sk.tax_rates.items()):
        lines.append(f"tax              | {gtype:<10} | {year} | {rate}")
    for year, rate in sorted(sk.purchase_rates.items()):
        lines.append(f"purchase (orig.) | any        | {year} | {rate}")
    return "\n".join(lines) if len(lines) > 2 else "(none on record)"


def _problem_list(findings: list[Finding]) -> str:
    rank = {"error": 0, "warning": 1, "info": 2}
    actionable = [f for f in findings if f.severity in ("error", "warning")]
    if not actionable:
        return "(no failures — the draft reconciles; fill in anything still missing)"
    actionable.sort(key=lambda f: rank[f.severity])
    return "\n".join(f"- [{f.code}] {f.subject or 'file'}: {f.message}" for f in actionable)


def build_prompt(draft: Draft, findings: list[Finding], statement: Statement | None,
                 sk: Skeleton, statement_text: str = "", csv_text: str = "") -> str:
    """Assemble the brief. Nothing is truncated — upload size caps bound it."""
    parts = [
        "I am importing my Epic equity paperwork into a tracker. The tracker parsed my "
        "files and produced a draft, but some figures do not reconcile. Please correct "
        "the draft and return it in the exact format below.",
        "",
        "I have attached the two files this came from, both downloaded from Shareworks: "
        "Data for Stock Workbook (CSV) and my Stock Loan Statement (PDF). "
        "The text the tracker extracted from them is included at the bottom — if it "
        "disagrees with the attachments, trust the attachments.",
        "",
        "## Output format", "", _CONTRACT,
        "## Rules", "", _RULES,
        "## Checks your answer must pass", "", _IDENTITIES,
        "## Company grant schedule (fixed — do not change these)", "",
        "```", _schedule_table(sk), "```", "",
        "## Loan rates on record", "",
        "```", _rate_table(sk), "```", "",
        "## Down payment policy (fixed)", "", _dp_policy(sk), "",
        "## What did not reconcile", "", _problem_list(findings), "",
        "## The draft so far", "",
        "```json", json.dumps(to_wizard_payload(draft), indent=2), "```", "",
    ]
    if statement:
        printed = statement.printed_total or statement.total_principal
        parts += ["## Figures the statement asserts about itself", "",
                  f"- Statement date: {statement.statement_date or 'unknown'}",
                  f"- Total principal: {printed if printed is not None else 'unreadable'}",
                  "- Subtotals by due year: " + (
                      ", ".join(f"{y}: {v:,.2f}" for y, v in sorted(statement.subtotals.items()))
                      or "none readable"),
                  ""]
    if csv_text:
        parts += ["## Data for Stock Workbook (as downloaded)", "", "```csv", csv_text.strip(), "```", ""]
    if statement_text:
        parts += ["## Stock Loan Statement (text extracted from the PDF)", "",
                  "```", statement_text.strip(), "```", ""]
    parts += ["Return only the JSON object."]
    return "\n".join(parts)
