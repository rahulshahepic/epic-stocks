"""Seed the signed-in staging account through the normal change-set service."""
import os
from datetime import date

from fastapi import HTTPException

from app.demo import AS_OF, PROFILES, profile_inputs
from app.changes import ChangeError, _Uncommitted, apply_changes
from scaffold.models import Grant, Loan, LoanPayment, Price, Sale, LoanInterestCheckpoint, User

STAGING_ORIGIN = 'https://staging.epic-stocks.com'


def staging_demo_enabled():
    domain = os.getenv('DOMAIN', '').strip().lower()
    return os.getenv('APP_ENV') == 'staging' and (
        domain == 'staging.epic-stocks.com' or (not domain and os.getenv('E2E_TEST') == '1'))


def _require_empty(user, db):
    db.query(User).filter(User.id == user.id).with_for_update().one()
    if any(db.query(model.id).filter(model.user_id == user.id).first() is not None
           for model in (Grant, Loan, LoanPayment, Price, Sale, LoanInterestCheckpoint)) or user.retirement_params or user.comp_entries or user.date_of_birth is not None:
        raise HTTPException(409, 'Load fictional data into an empty staging account. Existing records, birthday and saved plans will not be replaced.')


def seed_profile(user, db, profile):
    if not staging_demo_enabled():
        raise HTTPException(404, 'Not found')
    _require_empty(user, db)
    source = profile_inputs(profile)
    changes = []
    for row in source.prices:
        changes.append({'kind': 'price', 'action': 'create', 'values': {
            'effective_date': row.effective_date.isoformat(), 'price': row.price, 'is_estimate': row.is_estimate}})
    for row in source.grants:
        values = {key: getattr(row, key) for key in ('year', 'type', 'shares', 'price', 'periods', 'dp_shares', 'election_83b')}
        values.update(vest_start=row.vest_start.isoformat(), exercise_date=row.exercise_date.isoformat(),
                      vesting=[{'date': v.date.isoformat(), 'shares': v.shares} for v in row.vesting])
        changes.append({'kind': 'grant', 'action': 'create', 'values': values})
    for row in source.loans:
        values = {key: getattr(row, key) for key in ('grant_year', 'grant_type', 'loan_type', 'loan_year', 'amount', 'interest_rate', 'loan_number')}
        values.update(due_date=row.due_date.isoformat(), disbursed_on=row.disbursed_on.isoformat())
        changes.append({'kind': 'loan', 'action': 'create', 'values': values})
    try:
        preview = apply_changes(user, db, changes)
        _require_empty(user, db)
        apply_changes(user, _Uncommitted(db), changes, confirm=preview['confirm'])
        info = PROFILES[profile]
        user.date_of_birth = date(AS_OF.year - info['age'], AS_OF.month, AS_OF.day)
        user.retirement_params = {
            'retirementDate': AS_OF.isoformat(), 'epicExitMode': 'automatic',
            'taxableAdditional': info['other_assets_m'], 'additionalBasis': info['other_assets_m'],
            'traditional': 0, 'roth': 0, 'defaultSpend': info['spend_k'], 'minSpend': info['spend_k'] * 0.7,
            'plannedEvents': [],
        }
        # Save exit cash using the same service the planner/MCP use, within this transaction.
        from app.routers.events import _preview_exit_data
        exit_data = _preview_exit_data(user, _Uncommitted(db), AS_OF.isoformat())
        user.retirement_params = {**user.retirement_params, 'epicExit': (exit_data or {}).get('net_cash', 0) / 1_000_000}
        db.commit()
    except Exception as exc:
        db.rollback()
        if isinstance(exc, ChangeError):
            raise HTTPException(422, str(exc)) from None
        raise
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return {'fictional': True, 'profile': profile, 'mcp_url': STAGING_ORIGIN + '/mcp'}
