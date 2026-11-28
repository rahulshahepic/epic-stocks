"""Internal test identities for production validation (#827).

A separate kind from directory reviewers (scaffold/reviewers.py): reviewers
exist so external directory reviewers can evaluate the connector, while a
test user is the operator's own actor for prod-shaped validation workflows
— export, import, OAuth authorize/revoke, account deletion — run against
fictional data only. The two kinds share the credential, expiry and
revocation patterns but never a table, a login page or an admin list, so
neither lifecycle can be mistaken for the other.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
import secrets
import uuid

from fastapi import HTTPException
from sqlalchemy import delete

from scaffold.models import InternalTestAccount, User
from scaffold.oauth.models import OAuthAuthCode, OAuthGrant

PROVIDER = 'internal-test'
EMAIL_DOMAIN = '@test-users.example.invalid'
MAX_ACCOUNTS = 40
MAX_LABEL_LEN = 80


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def verifier(secret):
    from scaffold.auth import JWT_SECRET
    return hmac.new(JWT_SECRET.encode(), b'internal-test\0' + secret.encode(), hashlib.sha256).hexdigest()


def identity(user):
    return bool(user and user.is_synthetic and user.provider_name == PROVIDER
                and user.email.endswith(EMAIL_DOMAIN)
                and not user.is_admin and not user.is_content_admin)


def account(db, user):
    return db.query(InternalTestAccount).filter_by(user_id=user.id).populate_existing().first() if identity(user) else None


def active(db, user):
    row = account(db, user)
    return bool(row and not row.revoked_at and row.credential_hash and aware(row.expires_at) > now())


def state(row):
    return {'id': row.id, 'login': row.login, 'label': row.label, 'scenario': row.scenario,
            'fixture_version': row.fixture_version, 'generation': row.generation,
            'expires_at': aware(row.expires_at).isoformat(),
            'status': 'revoked' if row.revoked_at else 'expired' if aware(row.expires_at) <= now() else 'active',
            'last_login_at': row.last_login_at.isoformat() if row.last_login_at else None,
            'notice': 'INTERNAL TEST — fictional financial data; no administrative access'}


def validate_access(db, args):
    from services.reviewer_fixtures import scenarios
    label, scenario, days = args.get('label'), args.get('scenario', 'established'), args.get('days', 30)
    if not isinstance(label, str) or not label.strip() or len(label) > MAX_LABEL_LEN \
            or any(not c.isprintable() for c in label):
        raise ValueError('A short purpose label is required')
    if scenario not in (*scenarios, 'empty'):
        raise ValueError('Choose an early, established, exit or empty scenario.')
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 90:
        raise ValueError('days must be an integer from 1 to 90')
    tid = args.get('test_user_id')
    if tid is not None:
        if isinstance(tid, bool) or not isinstance(tid, int):
            raise ValueError('test_user_id must be an integer')
        row = db.get(InternalTestAccount, tid)
        if not row or row.scenario != scenario:
            raise ValueError('Test user not found or scenario differs. Reset separately.')
    elif db.query(InternalTestAccount).count() >= MAX_ACCOUNTS:
        raise ValueError('Internal test user limit reached. Delete obsolete test users first.')
    digest = args.get('credential_hash')
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('A generated credential verifier is required')
    return {'label': label.strip(), 'scenario': scenario, 'days': days,
            'test_user_id': tid, 'credential_hash': digest}


def invalidate(db, user):
    user.session_version += 1
    db.execute(delete(OAuthAuthCode).where(OAuthAuthCode.user_id == user.id))
    db.execute(delete(OAuthGrant).where(OAuthGrant.user_id == user.id))


def grant_access(db, args):
    """Caller supplies approval and commits; no secret ever enters this service."""
    from services.reviewer_fixtures import seed, version
    from scaffold.synthetic_accounts import synthetic_key
    data = validate_access(db, args)
    row = db.get(InternalTestAccount, data['test_user_id']) if data['test_user_id'] else None
    if row:
        user = db.get(User, row.user_id)
        if not identity(user):
            raise ValueError('Test user identity boundary failed')
        from scaffold.synthetic_accounts import deletion_lock
        with deletion_lock(db, user.id):
            invalidate(db, user)
        row.label = data['label']
    else:
        login = f"test-{uuid.uuid4().hex}"
        user = User(email=login + EMAIL_DOMAIN, google_id=uuid.uuid4().hex,
                    provider_name=PROVIDER, name='INTERNAL TEST — fictional data only', is_synthetic=True,
                    is_admin=0, is_content_admin=0)
        db.add(user)
        db.flush()
        row = InternalTestAccount(user_id=user.id, login=login, label=data['label'],
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
    row = db.query(InternalTestAccount).filter_by(login=login).populate_existing().first()
    expected = row.credential_hash if row else verifier('unavailable')
    matches = hmac.compare_digest(verifier(password), expected)
    user = db.get(User, row.user_id) if row else None
    if not matches or not active(db, user):
        raise HTTPException(401, 'Test user credentials are invalid or expired')
    row.last_login_at = now()
    db.commit()
    return user


def restrict_request(db, user, path, method):
    if not active(db, user):
        raise HTTPException(401, 'Test user access expired or revoked')
    # Deny administration, anything that reaches other people (sharing,
    # invitations), notifications, onboarding and global content writes.
    # Ordinary account workflows stay open — export, import, OAuth and
    # self-deletion are the workflows this identity exists to validate,
    # which is why /api/me is not restricted the way it is for reviewers.
    if any(path == prefix or path.startswith(prefix + '/') for prefix in (
            '/api/admin', '/admin-mcp', '/admin-oauth', '/api/sharing', '/api/push',
            '/api/notifications', '/api/ai', '/api/onboarding', '/api/trial')):
        raise HTTPException(403, 'Unavailable to internal test identities')
    if path.startswith('/api/auth/') and path not in ('/api/auth/logout', '/api/auth/refresh', '/api/auth/logout-everywhere'):
        raise HTTPException(403, 'Test user identity cannot change authentication provider')
    if path.startswith('/api/content') and method not in ('GET', 'HEAD'):
        raise HTTPException(403, 'Test users cannot modify global content')


def audit_login(db, user_id, outcome):
    """Unknown usernames share one daily bucket: anonymous input cannot grow
    cardinality or evict administrative history. Count updates are atomic.
    """
    from scaffold.models import InternalTestLoginAudit
    if outcome not in ('attempt', 'success', 'failure'):
        raise ValueError('Unknown test user authentication outcome')
    at = now()
    bucket = f"{user_id if user_id is not None else 'unknown'}:{at.date().isoformat()}:{outcome}"
    if db.get_bind().dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(InternalTestLoginAudit).values(bucket=bucket, user_id=user_id, outcome=outcome, count=1, last_at=at)
    db.execute(statement.on_conflict_do_update(index_elements=['bucket'],
        set_={'count': InternalTestLoginAudit.count + 1, 'last_at': at}))
    prune_login_audit(db)
    db.commit()


def login_activity(db, user_id):
    from scaffold.models import InternalTestLoginAudit
    from sqlalchemy import func
    rows = db.query(InternalTestLoginAudit.outcome, func.sum(InternalTestLoginAudit.count)).filter(
        InternalTestLoginAudit.user_id == user_id, InternalTestLoginAudit.last_at >= now() - timedelta(days=7)
    ).group_by(InternalTestLoginAudit.outcome).all()
    return {outcome: int(count) for outcome, count in rows}


def prune_login_audit(db):
    from scaffold.models import InternalTestLoginAudit
    return db.query(InternalTestLoginAudit).filter(
        InternalTestLoginAudit.last_at < now() - timedelta(days=90)
    ).delete(synchronize_session=False)
