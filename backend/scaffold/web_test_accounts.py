"""Browser fixture selection. The session always authenticates the real principal."""
import os
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text

from scaffold.models import MCPTestAccount
from scaffold.synthetic_accounts import binding, is_staging, requires_synthetic


def enabled():
    return is_staging() or (os.getenv('APP_ENV') == 'staging' and not os.getenv('DOMAIN') and os.getenv('E2E_TEST') == '1')


def financial_path(path):
    if not path.startswith('/api/') or path in ('/api/me', '/api/health', '/api/config', '/api/status', '/api/sharing/invite-info', '/api/import/template', '/api/import/sample'):
        return False
    return not any(path == prefix or path.startswith(prefix + '/') for prefix in (
        '/api/auth', '/api/admin', '/api/oauth', '/api/demo', '/api/content', '/api/ai', '/api/report',
        '/api/trial', '/api/onboarding', '/api/unsubscribe', '/api/internal',
    ))


def workspace_id(db, principal_id):
    if not enabled():
        raise HTTPException(409, 'Staging configuration is inconsistent; financial access refused.')
    row = binding(db, principal_id, None)
    if row is None:
        raise HTTPException(409, 'Choose a fictional staging profile before using financial pages.')
    valid = db.execute(text('SELECT id FROM users WHERE id=:uid AND is_synthetic=:flag'),
                       {'uid': row.synthetic_id, 'flag': True}).scalar()
    if not valid:
        raise HTTPException(409, 'The fictional workspace is unavailable. Reload staging setup.')
    return row.synthetic_id


def financial_user(request, db, principal):
    """Only the guarded ASGI request may select another financial identity."""
    from scaffold.reviewers import identity
    if identity(principal):
        return None
    if requires_synthetic() and any(request.url.path == prefix or request.url.path.startswith(prefix + '/')
                                    for prefix in ('/api/push', '/api/notifications', '/api/sharing')):
        raise HTTPException(403, 'Sharing and notifications are disabled in fictional staging workspaces.')
    if not requires_synthetic() or not financial_path(request.url.path):
        return None
    from scaffold.models import User
    target = workspace_id(db, principal.id)
    if getattr(request.state, 'staging_workspace_id', None) != target:
        raise HTTPException(409, 'The fictional workspace changed. Reload and retry.')
    return db.get(User, target)


def browser_binding(db, principal_id):
    return db.query(MCPTestAccount).filter_by(user_id=principal_id, grant_id=None).first()



@contextmanager
def request_workspace(db, token, path, method):
    from scaffold.auth import decode_jwt, token_type, TOKEN_TYPE_SESSION
    from scaffold.models import User
    from scaffold.synthetic_accounts import account_lock
    from scaffold.reviewers import identity, restrict_request
    protected = (path.startswith('/api/') and path not in ('/api/auth/logout', '/api/auth/providers', '/api/config', '/api/health', '/api/status')) or path.startswith('/admin-oauth/')
    if not protected and not path.startswith('/oauth/authorize'):
        yield None
        return
    try:
        reviewer = db.get(User, int(decode_jwt(token or '')['sub']))
    except (ValueError, KeyError, TypeError):
        reviewer = None
    if identity(reviewer) and (protected or path.startswith('/oauth/authorize')):
        if protected:
            restrict_request(db, reviewer, path, method)
        if financial_path(path) or path.startswith('/oauth/authorize') or path.startswith('/api/report') or path in ('/api/auth/refresh', '/api/auth/logout-everywhere'):
            with account_lock(db, reviewer.id, shared=method in ('GET', 'HEAD', 'OPTIONS')):
                yield None
        else:
            yield None
        return
    if not requires_synthetic() or not financial_path(path):
        yield None
        return
    try:
        payload = decode_jwt(token or '')
        if token_type(payload) != TOKEN_TYPE_SESSION:
            raise ValueError('Wrong token purpose')
        principal = db.get(User, int(payload['sub']))
        if not principal or principal.is_synthetic or principal.session_version != int(payload.get('sv', 0)):
            raise ValueError('Invalid session')
    except (ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(401, 'Not authenticated') from None
    with account_lock(db, principal.id, shared=method in ('GET', 'HEAD', 'OPTIONS')):
        target = workspace_id(db, principal.id)
        row = browser_binding(db, principal.id)
        row.last_used_at = datetime.now(timezone.utc)
        db.commit()
        yield target
