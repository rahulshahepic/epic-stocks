"""Import of Epic's own files: the share-summary CSV and Stock Loan Statement PDF.

The app never calls a language model. It parses what it can, checks the result
against arithmetic the documents assert about themselves, and when that fails it
hands the user a prompt to paste into whichever assistant they already use. What
comes back is validated by the same checks.

    parse_statement_pdf / parse_statement_lines   Stock Loan Statement PDF
    parse_share_csv                               share-summary CSV
    build_skeleton                                content tables -> fixed structure
    derive_draft / draft_from_payload             files or repaired JSON -> draft
    validate_draft / is_blocked                   the checks, whatever produced the draft
    build_prompt                                  the brief the user pastes out
    reconcile                                     draft vs. an exported dataset
"""
from .models import ERROR, INFO, WARNING, Finding, ShareRow, Statement, StatementLoan
from .pdf_statement import (StatementParserBusy, StatementUnreadable, extract_lines,
                            parse_statement_lines, parse_statement_pdf)
from .share_csv import parse_share_csv
from .skeleton import Skeleton, TemplateRow, build_skeleton
from .draft import (BLOCKING_CHECKS, Draft, DraftGrant, DraftLoan, DraftPrice,
                    derive_draft, draft_from_payload, is_blocked, supersede_parse_findings,
                    to_wizard_payload, validate_draft)
from .prompt import build_prompt
from .reconcile import Difference, ReconcileReport, reconcile, render_markdown

__all__ = [
    "ERROR", "INFO", "WARNING", "Finding", "ShareRow", "Statement", "StatementLoan",
    "StatementParserBusy", "StatementUnreadable", "extract_lines", "parse_statement_lines",
    "parse_statement_pdf", "parse_share_csv",
    "Skeleton", "TemplateRow", "build_skeleton",
    "BLOCKING_CHECKS", "Draft", "DraftGrant", "DraftLoan", "DraftPrice",
    "derive_draft", "draft_from_payload", "is_blocked", "supersede_parse_findings",
    "to_wizard_payload", "validate_draft", "build_prompt",
    "Difference", "ReconcileReport", "reconcile", "render_markdown",
]
