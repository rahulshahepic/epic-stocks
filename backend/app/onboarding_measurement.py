"""Observe existing parser outcomes without storing any file or financial data."""
from fastapi import HTTPException
from scaffold import onboarding as measure


def analyze(db, request, token, sequence, opt_in, execute):
    allowed = opt_in and request.headers.get('dnt') != '1'
    if not allowed:
        measure.safely(db, lambda: measure.forget(db, token))
    accepted = allowed and measure.safely(db, lambda: measure.begin_analysis(db, token, sequence))
    try:
        result = execute()
    except Exception as exc:
        if accepted:
            category = 'format_errors' if isinstance(exc, HTTPException) and exc.status_code in (400, 413, 422) else 'processing_errors'
            measure.safely(db, lambda: measure.finish_analysis(db, token, sequence, error=category))
        raise
    if accepted:
        value = result.model_dump() if hasattr(result, 'model_dump') else result
        findings = value.get('findings', [])
        errors = any(f['severity'] == 'error' for f in findings)
        warnings = any(f['severity'] in ('error', 'warning') for f in findings)
        evidence = value.get('reconciliation', [])
        checked = len(evidence) >= 2 and all(e['status'] == 'matched' for e in evidence[:2])
        eligible = not value['blocked'] and value['summary']['grants'] > 0 and value['summary']['prices'] > 0
        measure.safely(db, lambda: measure.finish_analysis(db, token, sequence,
            valid=value.get('files_parsed', False), reconciled=value['reconciles'], eligible=eligible,
            checked=eligible and checked and not warnings and not value.get('price_is_stale') and not value.get('unanswered_sales'),
            error=('reconciliation_errors' if value.get('files_parsed') else 'format_errors') if errors else None))
    return result
