"""Opted-in, bounded onboarding attempts. Never return attempt rows to admins."""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from scaffold.models import OnboardingAttempt as Attempt, OnboardingDailyStat as Stat, SystemSettings, User

logger = logging.getLogger(__name__)
TTL = timedelta(hours=24)
RETENTION_DAYS = 180
MAX_ACTIVE = 10000
PAUSED_KEY = 'onboarding_collection_paused'
STAGES = ('starts', 'valid_files', 'reconciled', 'usable_position', 'source_checked_5min',
          'save_intent', 'authenticated', 'new_account', 'carryover', 'reminder_enabled',
          'usable_le_60s', 'usable_le_300s', 'usable_gt_300s')
ERRORS = ('format_errors', 'reconciliation_errors', 'processing_errors', 'carryover_errors')
METRICS = (*STAGES, *ERRORS, 'retries')
BITS = {name: 1 << i for i, name in enumerate(STAGES)}


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def paused(db):
    return db.execute(select(SystemSettings.value).where(SystemSettings.key == PAUSED_KEY)).scalar() == 'true'


def digest(token):
    if not isinstance(token, str) or len(token) != 48 or not all(c in '0123456789abcdef' for c in token):
        return None
    return hashlib.sha256(token.encode()).hexdigest()


def owner_digest(row, user_id):
    from scaffold.auth import JWT_SECRET
    return hmac.new(JWT_SECRET.encode(), f'onboarding:{row.token_hash}:{user_id}'.encode(), hashlib.sha256).hexdigest()


def _row(db, token):
    key = digest(token)
    if key is None or paused(db):
        return None
    return db.execute(select(Attempt).where(Attempt.token_hash == key, Attempt.expires_at > now())
                      .with_for_update().execution_options(populate_existing=True)).scalar_one_or_none()


def _bump(db, row, metric):
    if metric not in METRICS:
        raise ValueError('Unknown onboarding metric')
    insert = pg_insert if db.get_bind().dialect.name == 'postgresql' else sqlite_insert
    statement = insert(Stat).values(day=aware(row.started_at).date(), entrypoint=row.entrypoint, metric=metric, count=1)
    db.execute(statement.on_conflict_do_update(index_elements=['day', 'entrypoint', 'metric'], set_={'count': Stat.count + 1}))


def _stage(db, row, name):
    bit = BITS[name]
    changed = db.execute(update(Attempt).where(Attempt.token_hash == row.token_hash,
                        Attempt.flags.op('&')(bit) == 0).values(flags=Attempt.flags.op('|')(bit)),
                        execution_options={'synchronize_session': False}).rowcount
    if changed:
        set_committed_value(row, 'flags', row.flags | bit)
        _bump(db, row, name)
    return bool(changed)


def _has(row, name):
    return bool(row.flags & BITS[name])


def cleanup(db):
    attempts = db.execute(delete(Attempt).where(Attempt.expires_at <= now())).rowcount
    aggregates = db.execute(delete(Stat).where(Stat.day < now().date() - timedelta(days=RETENTION_DAYS))).rowcount
    from scaffold.models import TrialDailyStat
    legacy = db.query(TrialDailyStat).filter(TrialDailyStat.day < now().date() - timedelta(days=RETENTION_DAYS)).delete(synchronize_session=False)
    return {'expired_attempts_removed': attempts, 'expired_aggregates_removed': aggregates, 'expired_legacy_aggregates_removed': legacy}


def _capacity_lock(db):
    if db.get_bind().dialect.name == 'postgresql':
        db.execute(text('SELECT pg_advisory_xact_lock(6712026)'))
    else:
        db.execute(update(Attempt).where(Attempt.token_hash == 'capacity').values(flags=0))


def start(db, entrypoint, nonce=None):
    if entrypoint not in ('trial', 'account'):
        raise ValueError('Unknown entrypoint')
    if paused(db):
        return None
    # Serialize capacity checks across deployed workers, without holding a lock
    # while parsing files or waiting for a browser. SQLite also takes a write lock.
    _capacity_lock(db)
    if paused(db):
        return None
    cleanup(db)
    from scaffold.auth import JWT_SECRET
    nonce = nonce or secrets.token_hex(24)
    token = hmac.new(JWT_SECRET.encode(), ('onboarding-start:' + nonce).encode(), hashlib.sha256).hexdigest()[:48]
    existing = db.get(Attempt, digest(token))
    if existing:
        return token if existing.entrypoint == entrypoint else None
    if db.scalar(select(func.count()).select_from(Attempt)) >= MAX_ACTIVE:
        return None
    row = Attempt(token_hash=digest(token), started_at=now(), expires_at=now() + TTL,
                  entrypoint=entrypoint, flags=0, sequence=0, completed_sequence=0, eligible=False, checked=False)
    db.add(row)
    db.flush()
    _stage(db, row, 'starts')
    return token


def begin_analysis(db, token, sequence):
    row = _row(db, token)
    if not row or type(sequence) is not int or not 1 <= sequence <= 500 or sequence <= row.sequence:
        return False
    changed = db.execute(update(Attempt).where(Attempt.token_hash == row.token_hash, Attempt.sequence < sequence)
                         .values(sequence=sequence, eligible=False, checked=False),
                         execution_options={'synchronize_session': False}).rowcount
    if not changed:
        return False
    if row.sequence:
        _bump(db, row, 'retries')
    return True


def finish_analysis(db, token, sequence, *, valid=False, reconciled=False, eligible=False, checked=False, error=None):
    row = _row(db, token)
    if not row or row.sequence != sequence or row.completed_sequence >= sequence:
        return False
    changed = db.execute(update(Attempt).where(Attempt.token_hash == row.token_hash,
                         Attempt.sequence == sequence, Attempt.completed_sequence < sequence)
                         .values(completed_sequence=sequence, eligible=eligible, checked=checked),
                         execution_options={'synchronize_session': False}).rowcount
    if not changed:
        return False
    if valid:
        _stage(db, row, 'valid_files')
    if reconciled:
        _stage(db, row, 'reconciled')
    if error in ERRORS:
        _bump(db, row, error)
    return True


def visible(db, row):
    if not row.eligible or row.sequence != row.completed_sequence:
        return False
    if _stage(db, row, 'usable_position'):
        elapsed = max(0, (now() - aware(row.started_at)).total_seconds())
        _stage(db, row, 'usable_le_60s' if elapsed <= 60 else 'usable_le_300s' if elapsed <= 300 else 'usable_gt_300s')
    if row.checked and (now() - aware(row.started_at)).total_seconds() <= 300:
        _stage(db, row, 'source_checked_5min')
    return True


def client_event(db, token, sequence, event, user=None):
    row = _row(db, token)
    if not row or row.sequence != sequence or row.completed_sequence != sequence:
        return False
    if event in ('preview_viewed', 'save_intent'):
        if not visible(db, row):
            return False
        if event == 'save_intent':
            _stage(db, row, 'save_intent')
        return True
    if not user or not row.claim_digest or not hmac.compare_digest(row.claim_digest, owner_digest(row, user.id)):
        return False
    if event == 'reminder_enabled' and _has(row, 'carryover'):
        import os
        from scaffold.email_sender import email_configured
        from scaffold.models import EmailPreference, PushSubscription
        email = db.query(EmailPreference).filter_by(user_id=user.id, enabled=1).first()
        push = db.query(PushSubscription.id).filter_by(user_id=user.id).first()
        if (email and email_configured()) or (push and os.getenv('VAPID_PUBLIC_KEY') and os.getenv('VAPID_PRIVATE_KEY')):
            _stage(db, row, event)
            return True
    if event == 'carryover_failed' and not _has(row, 'carryover'):
        # One failure category per attempt rather than a record of exception text.
        # Its own flag makes repeated error callbacks idempotent.
        bit = 1 << 20
        changed = db.execute(update(Attempt).where(Attempt.token_hash == row.token_hash,
                             Attempt.flags.op('&')(bit) == 0).values(flags=Attempt.flags.op('|')(bit)),
                             execution_options={'synchronize_session': False}).rowcount
        if changed:
            _bump(db, row, 'carryover_errors')
        return True
    return False


def claim(db, token, user):
    # Match deletion's lock order: live account first, attempt second. A stale
    # authentication object cannot recreate linkage after account deletion.
    live_user = db.execute(select(User.id, User.is_synthetic, User.created_at)
                           .where(User.id == user.id).with_for_update()).first()
    if not live_user or live_user.is_synthetic:
        return False
    user = live_user
    row = _row(db, token)
    if not row or user.is_synthetic or not _has(row, 'usable_position'):
        return False
    binding = owner_digest(row, user.id)
    if row.claim_digest and not hmac.compare_digest(row.claim_digest, binding):
        return False
    changed = db.execute(update(Attempt).where(Attempt.token_hash == row.token_hash,
                         or_(Attempt.claim_digest.is_(None), Attempt.claim_digest == binding))
                         .values(claim_digest=binding), execution_options={'synchronize_session': False}).rowcount
    if not changed:
        return False
    _stage(db, row, 'authenticated')
    if row.entrypoint == 'trial' and user.created_at and aware(user.created_at) >= aware(row.started_at):
        _stage(db, row, 'new_account')
    return True


def saved(db, token, user):
    if user.is_synthetic:
        from scaffold.models import MCPTestAccount
        principal_id = db.execute(select(MCPTestAccount.user_id).where(MCPTestAccount.synthetic_id == user.id)).scalar()
        if principal_id is None:
            return False
    else:
        principal_id = user.id
    row = _row(db, token)
    if not row or not row.eligible or not _has(row, 'authenticated') or not row.claim_digest:
        return False
    if not hmac.compare_digest(row.claim_digest, owner_digest(row, principal_id)):
        return False
    _stage(db, row, 'carryover')
    return True


def forget(db, token):
    key = digest(token)
    if key:
        db.execute(delete(Attempt).where(Attempt.token_hash == key))


def delete_account_linkage(db, user_id):
    # Bounded at MAX_ACTIVE. Digests are unique per attempt, so no reusable
    # account identifier is stored. Deletion can still erase its live linkage.
    for row in db.query(Attempt).filter(Attempt.claim_digest.isnot(None)).all():
        if hmac.compare_digest(row.claim_digest, owner_digest(row, user_id)):
            db.delete(row)


def safely(db, operation):
    try:
        result = operation()
        db.commit()
        return result
    except Exception:
        db.rollback()
        try:
            insert = pg_insert if db.get_bind().dialect.name == 'postgresql' else sqlite_insert
            db.execute(insert(SystemSettings).values(key='onboarding_last_failure_at', value=now().isoformat())
                       .on_conflict_do_update(index_elements=['key'], set_={'value': now().isoformat()}))
            db.commit()
        except Exception:
            db.rollback()
        logger.warning('onboarding_measurement_unavailable')
        return None


def set_paused(db, value, *, commit=True):
    _capacity_lock(db)
    row = db.get(SystemSettings, PAUSED_KEY)
    if row is None:
        row = SystemSettings(key=PAUSED_KEY, value='false')
        db.add(row)
    row.value = 'true' if value else 'false'
    if value:
        db.execute(delete(Attempt))
    if commit:
        db.commit()


def report(db, days=30):
    if type(days) is not int or not 1 <= days <= RETENTION_DAYS:
        raise ValueError('days must be an integer from 1 to 180')
    cutoff = now().date() - timedelta(days=days - 1)
    totals = {key: 0 for key in METRICS}
    cohorts = {}
    for row in db.query(Stat).filter(Stat.day >= cutoff).order_by(Stat.day.desc(), Stat.entrypoint).all():
        if row.metric not in METRICS:
            continue
        cohort = cohorts.setdefault((row.day, row.entrypoint), {key: 0 for key in METRICS})
        cohort[row.metric] += row.count
        totals[row.metric] += row.count
    active = db.scalar(select(func.count()).select_from(Attempt).where(Attempt.expires_at > now()))
    expired = db.scalar(select(func.count()).select_from(Attempt).where(Attempt.expires_at <= now()))
    is_paused = paused(db)
    actions = []
    if is_paused:
        actions.append({'action': 'resume_collection', 'tool': 'admin_request_resume_onboarding', 'requires_approval': True})
    if db.get(SystemSettings, 'onboarding_last_failure_at'):
        actions.append({'action': 'investigate_measurement_write_failure', 'tool': None, 'requires_approval': False})
    if expired:
        actions.append({'action': 'remove_expired_linkage', 'tool': 'admin_cleanup_onboarding', 'requires_approval': False})
    if active >= MAX_ACTIVE * .9:
        actions.append({'action': 'capacity_nearly_full', 'tool': 'admin_pause_onboarding', 'requires_approval': False})
    return {'schema_version': 1, 'window_days': days, 'cohort_timezone': 'UTC', 'collection_paused': is_paused,
            'attempt_ttl_hours': 24, 'aggregate_retention_days': RETENTION_DAYS,
            'last_measurement_failure_at': (db.get(SystemSettings, 'onboarding_last_failure_at').value if db.get(SystemSettings, 'onboarding_last_failure_at') else None),
            'cleanup_last_at': (db.get(SystemSettings, 'onboarding_cleanup_last_at').value if db.get(SystemSettings, 'onboarding_cleanup_last_at') else None),
            'active_attempts': active, 'expired_attempts': expired, 'attempt_capacity': MAX_ACTIVE,
            'totals': totals, 'rates_per_attempt': {key: totals[key] / totals['starts'] if totals['starts'] else None
                                                for key in STAGES if key != 'starts'},
            'cohorts': [{'day': day.isoformat(), 'entrypoint': entrypoint,
                         'provisional': day >= (now() - TTL).date(), 'counts': counts}
                        for (day, entrypoint), counts in cohorts.items()],
            'actions': actions,
            'definitions': {'denominator': 'Opted-in import attempts by server UTC start day, including failed and abandoned attempts; not unique people.',
                            'retries': 'Accepted increasing analysis sequence numbers after the first; duplicate or obsolete sequence numbers do not add counts.',
                            'carryover': 'Confirmed nonempty equity changes saved for the account bound to this attempt; sign-in alone is not carryover.',
                            'source_checked_5min': 'Usable preview acknowledged within 300 server-timed seconds with matching supplied source totals and no warnings/stale prices. This is evidence, not independently proven accuracy.',
                            'privacy': 'Explicit opt-in sample only; DNT/opt-out/paused collection excluded. No account IDs, IPs, file text, document hashes or financial values. Temporary per-attempt HMAC binding prevents cross-account claims; no cross-visit person tracking.',
                            'errors': 'Fixed categories of analysis failures, including retries; carryover errors counted at most once per attempt. Never exception messages or finding text.',
                            'maturity': 'Recent cohorts remain provisional for up to 24 hours; no cross-attempt or retention measurement.'}}
