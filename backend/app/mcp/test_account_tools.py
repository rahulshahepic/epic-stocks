"""Provision the existing fictional demo profiles as writable staging fixtures."""
from datetime import date, datetime, timezone
import hashlib
import hmac
import uuid

from app.demo import AS_OF, PROFILES, VERSION, profile_inputs
from fastapi import HTTPException
from scaffold.quota import check_row_quota
from scaffold.models import Grant, Loan, LoanInterestCheckpoint, MCPTestAccount, Price, TaxSettings, User
from scaffold.synthetic_accounts import account_context, binding, is_staging, synthetic_key
from scaffold.user_deletion import delete_financial_data
from services.vesting import set_schedule
from .tools import Tool, object_schema, register


class InvalidResetConfirmation(ValueError):
    pass


def _stage(browser=False):
    from scaffold.web_test_accounts import enabled
    if not (enabled() if browser else is_staging()):
        raise ValueError('Synthetic accounts are available exclusively in staging.')


def _seed(db, owner, scenario):
    fixture = profile_inputs(scenario)
    info = PROFILES[scenario]
    owner.date_of_birth = date(AS_OF.year - info['age'], 1, 1)
    owner.comp_entries = [entry for year in range(AS_OF.year - info['tenure'] + 1, AS_OF.year + 1)
                          for entry in [
                              {'id': f'fictional-salary-{year}', 'type': 'salary', 'effective_date': f'{year}-01-01',
                               'amount': 80000 + 5000 * (year - AS_OF.year + info['tenure'])},
                              {'id': f'fictional-bonus-{year}', 'type': 'bonus', 'date': f'{year}-06-01',
                               'amount': 10000, 'note': 'Fictional annual bonus'}]]
    owner.retirement_params = {
        'retirementDate': '2032-01-01', 'epicExitMode': 'auto', 'currentAge': info['age'], 'endAge': 95,
        'taxableAdditional': info['other_assets_m'], 'additionalBasis': info['other_assets_m'] * .8,
        'traditional': info['other_assets_m'] * .5, 'roth': .02, 'advanced': True,
        'defaultSpend': info['spend_k'], 'minSpend': info['spend_k'] * .75,
        'stockPct': .7, 'bondPct': .2, 'paths': 500, 'seed': 1729,
        'plannedEvents': [
            {'id': 'fictional-car', 'title': 'Fictional replacement car', 'kind': 'vehicle',
             'date': '2035-01-01', 'amountM': .04, 'annualCostM': .002, 'funding': 'mixed',
             'lifetimeYears': 8, 'replacementEveryYears': 8, 'depreciationProfile': 'regular',
             'condition': {'requireFullSpending': True, 'minStartingWealthRatio': 1.2}, 'conditionFailure': 'defer'},
            {'id': 'fictional-college', 'title': 'Fictional four-year college', 'kind': 'education',
             'date': '2038-09-01', 'amountM': 0, 'annualCostM': .04, 'durationYears': 4, 'funding': 'mixed'},
        ],
    }
    for row in fixture.prices:
        db.add(Price(user_id=owner.id, effective_date=row.effective_date, price=row.price, is_estimate=row.is_estimate))
    for row in fixture.grants:
        grant = Grant(user_id=owner.id, **{key: getattr(row, key) for key in
                      ('year', 'type', 'shares', 'price', 'vest_start', 'periods', 'exercise_date', 'dp_shares', 'election_83b')})
        db.add(grant)
        db.flush()
        set_schedule(grant, [(v.date, v.shares) for v in row.vesting])
    for row in fixture.loans:
        loan = Loan(user_id=owner.id, **{key: getattr(row, key) for key in
                    ('grant_year', 'grant_type', 'loan_type', 'loan_year', 'amount', 'interest_rate', 'due_date', 'disbursed_on', 'loan_number')})
        db.add(loan)
        db.flush()
        if row.loan_year == AS_OF.year:
            db.add(LoanInterestCheckpoint(user_id=owner.id, loan_id=loan.id, statement_date=AS_OF,
                                         accrued_through=AS_OF, accrued_interest=500, source='Fictional test statement'))
    db.add(TaxSettings(user_id=owner.id))
    db.flush()


def _setup(ctx, args, *, browser=False):
    _stage(browser)
    if set(args) - {'scenario'}:
        raise ValueError('Only scenario may be supplied; accounts are selected by the authenticated connection.')
    scenario = args.get('scenario')
    if not isinstance(scenario, str) or scenario not in PROFILES:
        raise ValueError('Choose a scenario from list_test_scenarios: early, established or exit.')
    row = binding(ctx.db, ctx.connector.user.id, ctx.connector.grant.id)
    if row:
        if row.scenario != scenario:
            raise ValueError('This connection already has a different scenario. Use reset_test_account with explicit confirmation to change it.')
        return account_context(ctx)
    try:
        check_row_quota(ctx.db, MCPTestAccount, ctx.connector.user.id)
    except HTTPException as exc:
        raise ValueError(exc.detail) from None
    uid = uuid.uuid4().hex
    owner = User(email=f'mcp-test-{uid}@example.invalid', google_id=uid, provider_name='synthetic',
                 name=f'FICTIONAL — {PROFILES[scenario]["label"]}', is_synthetic=True)
    ctx.db.add(owner)
    ctx.db.flush()  # generates the independent encryption key before any financial column is touched
    row = MCPTestAccount(user_id=ctx.connector.user.id, grant_id=ctx.connector.grant.id,
                         synthetic_id=owner.id, scenario=scenario, fixture_version=VERSION,
                         generation=str(uuid.uuid4()), last_used_at=datetime.now(timezone.utc))
    ctx.db.add(row)
    with synthetic_key(ctx.db, owner.id):
        try:
            _seed(ctx.db, owner, scenario)
            ctx.db.commit()
        except Exception:
            ctx.db.rollback()
            raise
    return account_context(ctx)


def _reset(ctx, args, *, browser=False):
    _stage(browser)
    if set(args) - {'scenario', 'confirm'}:
        raise ValueError('Only scenario and confirm may be supplied.')
    row = binding(ctx.db, ctx.connector.user.id, ctx.connector.grant.id)
    if row is None:
        raise ValueError('No synthetic account exists. Call setup_test_account first.')
    scenario = args.get('scenario', row.scenario)
    if not isinstance(scenario, str) or scenario not in PROFILES:
        raise ValueError('Unknown scenario; call list_test_scenarios.')
    # Bound to the connection, account, generation, chosen fixture and version.
    from scaffold.auth import JWT_SECRET
    body = f'{row.user_id}:{row.grant_id}:{row.synthetic_id}:{row.generation}:{scenario}:{VERSION}'
    token = hmac.new(JWT_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    if args.get('confirm') is None:
        return {**account_context(ctx), 'reset': False, 'confirm': token, 'scenario_to_restore': scenario,
                'warning': 'Deletes all testing modifications in this connection only. Ask for explicit confirmation, then repeat with this token.'}
    if not isinstance(args['confirm'], str) or not args['confirm'].isascii() or not hmac.compare_digest(args['confirm'], token):
        raise InvalidResetConfirmation('Reset confirmation is invalid or stale. Preview reset again.')
    with synthetic_key(ctx.db, row.synthetic_id):
        try:
            owner = ctx.db.get(User, row.synthetic_id)
            if not owner or not owner.is_synthetic:
                raise ValueError('Synthetic account is unavailable; reset refused.')
            delete_financial_data(ctx.db, owner.id)
            ctx.db.query(TaxSettings).filter_by(user_id=owner.id).delete(synchronize_session=False)
            ctx.db.expire_all()
            owner.session_version += 1
            row.generation = str(uuid.uuid4())
            row.scenario, row.fixture_version = scenario, VERSION
            row.last_used_at = datetime.now(timezone.utc)
            _seed(ctx.db, owner, scenario)
            ctx.db.commit()
        except Exception:
            ctx.db.rollback()
            raise
    return {**account_context(ctx), 'reset': True}


def _list(ctx, args):
    _stage()
    return {'synthetic': True, 'fixture_version': VERSION, 'as_of': AS_OF.isoformat(),
            'scenarios': [{'scenario': key, **info} for key, info in PROFILES.items()],
            'notice': 'Entirely invented data, independent of actual accounts. Prices are fictional round numbers.'}


register(Tool(name='get_account_context', title='Verify active account', description='Check deployment, synthetic status, scenario, fixture version and initialization before financial operations.', input_schema=object_schema({}), scope=None, handler=lambda ctx, args: account_context(ctx)))
register(Tool(name='list_test_scenarios', title='List fictional datasets', description='Staging only: list the existing demo profiles available for an isolated writable test account.', input_schema=object_schema({}), scope=None, handler=_list, staging_only=True))
register(Tool(name='setup_test_account', title='Activate fictional test account', description='Staging only: provision an isolated persistent writable account for this connection. Safe to retry with the same scenario; never copies or changes actual records.', input_schema=object_schema({'scenario': {'type': 'string', 'enum': list(PROFILES)}}, ['scenario']), scope=None, handler=_setup, read_only=False, staging_only=True))
register(Tool(name='reset_test_account', title='Reset fictional test account', description='Staging only: preview a destructive reset. Ask for explicit confirmation before repeating with the returned token; only this connection’s synthetic records are restored.', input_schema=object_schema({'scenario': {'type': 'string', 'enum': list(PROFILES)}, 'confirm': {'type': 'string'}}), scope=None, handler=_reset, read_only=False, destructive=True, idempotent=False, staging_only=True))
