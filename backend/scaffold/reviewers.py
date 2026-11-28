"""Restricted identities for directory evaluation; never an ordinary-user login provider."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
import secrets
import uuid

from fastapi import HTTPException
from sqlalchemy import delete

from scaffold.models import ReviewerAccount, User
from scaffold.oauth.models import OAuthAuthCode, OAuthGrant

PROVIDER = 'directory-reviewer'
MAX_ACCOUNTS = 40


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def verifier(secret):
    from scaffold.auth import JWT_SECRET
    return hmac.new(JWT_SECRET.encode(), b'directory-reviewer\0' + secret.encode(), hashlib.sha256).hexdigest()


def identity(user):
    return bool(user and user.is_synthetic and user.provider_name == PROVIDER
                and user.email.endswith('@reviewers.example.invalid')
                and not user.is_admin and not user.is_content_admin)


def account(db, user):
    return db.query(ReviewerAccount).filter_by(user_id=user.id).populate_existing().first() if identity(user) else None


def active(db, user):
    row = account(db, user)
    return bool(row and not row.revoked_at and row.credential_hash and aware(row.expires_at) > now())


def allowed_identity(db, user):
    # Other staging synthetic users still cannot authenticate. Internal
    # test users (#827) are the one other synthetic kind with a live
    # account row, and they authenticate on exactly the same terms.
    if not user:
        return False
    if not user.is_synthetic and user.provider_name != PROVIDER:
        return True
    if active(db, user):
        return True
    from scaffold.test_users import active as test_user_active
    return test_user_active(db, user)


def state(row):
    return {'id': row.id, 'login': row.login, 'platform': row.platform, 'scenario': row.scenario,
            'fixture_version': row.fixture_version, 'generation': row.generation,
            'expires_at': aware(row.expires_at).isoformat(),
            'status': 'revoked' if row.revoked_at else 'expired' if aware(row.expires_at) <= now() else 'active',
            'last_login_at': row.last_login_at.isoformat() if row.last_login_at else None,
            'notice': 'FICTIONAL financial data; no administrative access'}


def validate_access(db, args):
    from services.reviewer_fixtures import scenarios
    platform, scenario, days = args.get('platform'), args.get('scenario', 'established'), args.get('days', 30)
    if platform not in ('openai', 'anthropic') or scenario not in (*scenarios, 'empty'):
        raise ValueError('Choose openai or anthropic and early, established, exit or empty.')
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 90:
        raise ValueError('days must be an integer from 1 to 90')
    rid = args.get('reviewer_id')
    if rid is not None:
        if isinstance(rid, bool) or not isinstance(rid, int):
            raise ValueError('reviewer_id must be an integer')
        row = db.get(ReviewerAccount, rid)
        if not row or row.platform != platform or row.scenario != scenario:
            raise ValueError('Reviewer not found or platform/scenario differs. Reset separately.')
    elif db.query(ReviewerAccount).count() >= MAX_ACCOUNTS:
        raise ValueError('Reviewer account limit reached. Delete obsolete reviewers first.')
    digest = args.get('credential_hash')
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('A generated credential verifier is required')
    return {'platform': platform, 'scenario': scenario, 'days': days,
            'reviewer_id': rid, 'credential_hash': digest}


def invalidate(db, user):
    user.session_version += 1
    db.execute(delete(OAuthAuthCode).where(OAuthAuthCode.user_id == user.id))
    db.execute(delete(OAuthGrant).where(OAuthGrant.user_id == user.id))


def grant_access(db, args):
    """Caller supplies approval and commits; no secret ever enters this service."""
    from services.reviewer_fixtures import seed, version
    from scaffold.synthetic_accounts import synthetic_key
    data = validate_access(db, args)
    row = db.get(ReviewerAccount, data['reviewer_id']) if data['reviewer_id'] else None
    if row:
        user = db.get(User, row.user_id)
        if not identity(user):
            raise ValueError('Reviewer identity boundary failed')
        from scaffold.synthetic_accounts import deletion_lock
        with deletion_lock(db, user.id):
            invalidate(db, user)
    else:
        login = f"{data['platform']}-{uuid.uuid4().hex}"
        user = User(email=login + '@reviewers.example.invalid', google_id=uuid.uuid4().hex,
                    provider_name=PROVIDER, name='FICTIONAL — directory reviewer', is_synthetic=True,
                    is_admin=0, is_content_admin=0)
        db.add(user)
        db.flush()
        row = ReviewerAccount(user_id=user.id, login=login, platform=data['platform'],
                              scenario=data['scenario'], fixture_version=version, generation=uuid.uuid4().hex,
                              credential_hash=data['credential_hash'], expires_at=now() + timedelta(days=data['days']))
        db.add(row)
        with synthetic_key(db, user.id):
            if data['scenario'] != 'empty':
                seed(db, user, data['scenario'])
    row.credential_hash = data['credential_hash']
    row.expires_at, row.revoked_at = now() + timedelta(days=data['days']), None
    db.flush()
    return state(row)


def credentials():
    raw = secrets.token_urlsafe(48)
    return raw, verifier(raw)


def authenticate(db, login, password):
    row = db.query(ReviewerAccount).filter_by(login=login).populate_existing().first()
    expected = row.credential_hash if row else verifier('unavailable')
    matches = hmac.compare_digest(verifier(password), expected)
    user = db.get(User, row.user_id) if row else None
    if not matches or not active(db, user):
        raise HTTPException(401, 'Reviewer credentials are invalid or expired')
    row.last_login_at = now()
    db.commit()
    return user


def restrict_request(db, user, path, method):
    if not active(db, user):
        raise HTTPException(401, 'Reviewer access expired or revoked')
    # Deny account sharing, invitations, uploads to diagnostics, notifications,
    # global content writes and account/profile privilege changes.
    if any(path == prefix or path.startswith(prefix + '/') for prefix in (
            '/api/admin', '/admin-mcp', '/admin-oauth', '/api/sharing', '/api/push',
            '/api/notifications', '/api/ai', '/api/onboarding', '/api/trial')):
        raise HTTPException(403, 'Unavailable to fictional reviewer identities')
    if path.startswith('/api/auth/') and path not in ('/api/auth/logout', '/api/auth/refresh', '/api/auth/logout-everywhere'):
        raise HTTPException(403, 'Reviewer identity cannot change authentication provider')
    if path == '/api/me' and method not in ('GET', 'HEAD'):
        raise HTTPException(403, 'Manage reviewer identities through the admin reviewer console')
    if path.startswith('/api/content') and method not in ('GET', 'HEAD'):
        raise HTTPException(403, 'Reviewers cannot modify global content')


def audit_login(db, user_id, outcome):
    """Unknown usernames share one daily bucket: anonymous input cannot grow
    cardinality or evict administrative history. Count updates are atomic.
    """
    from scaffold.models import ReviewerLoginAudit
    if outcome not in ('attempt', 'success', 'failure'):
        raise ValueError('Unknown reviewer authentication outcome')
    at = now()
    bucket = f"{user_id if user_id is not None else 'unknown'}:{at.date().isoformat()}:{outcome}"
    if db.get_bind().dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(ReviewerLoginAudit).values(bucket=bucket, user_id=user_id, outcome=outcome, count=1, last_at=at)
    db.execute(statement.on_conflict_do_update(index_elements=['bucket'],
        set_={'count': ReviewerLoginAudit.count + 1, 'last_at': at}))
    prune_login_audit(db)
    db.commit()


def login_activity(db, user_id):
    from scaffold.models import ReviewerLoginAudit
    from sqlalchemy import func
    rows = db.query(ReviewerLoginAudit.outcome, func.sum(ReviewerLoginAudit.count)).filter(
        ReviewerLoginAudit.user_id == user_id, ReviewerLoginAudit.last_at >= now() - timedelta(days=7)
    ).group_by(ReviewerLoginAudit.outcome).all()
    return {outcome: int(count) for outcome, count in rows}


def prune_login_audit(db):
    from scaffold.models import ReviewerLoginAudit
    return db.query(ReviewerLoginAudit).filter(
        ReviewerLoginAudit.last_at < now() - timedelta(days=90)
    ).delete(synchronize_session=False)
