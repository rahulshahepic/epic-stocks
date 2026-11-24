"""Persistent browser fixtures; authenticated financial records are never seeded."""
import logging
import secrets
from types import SimpleNamespace

from fastapi import HTTPException

from app.mcp.test_account_tools import InvalidResetConfirmation, _setup, _reset
from app.mcp.tools import ToolContext
from scaffold.models import ErrorLog
from scaffold.synthetic_accounts import account_lock, binding

STAGING_ORIGIN = 'https://staging.epic-stocks.com'
logger = logging.getLogger(__name__)


def staging_demo_enabled():
    from scaffold.web_test_accounts import enabled
    return enabled()


def _refuse(user, db, reason, message):
    row = db.query(ErrorLog).filter_by(user_id=user.id, error_type='StagingSetupRefused',
                                      error_message=reason, resolved_at=None).first()
    if row is None:
        row = ErrorLog(user_id=user.id, method='POST', path='/api/demo/seed',
                       error_type='StagingSetupRefused', error_message=reason,
                       error_ref=secrets.token_hex(4))
        db.add(row)
        db.commit()
    logger.warning('Staging setup refused: %s [ref %s]', reason, row.error_ref)
    raise HTTPException(409, message, headers={'X-Error-Ref': row.error_ref})


def seed_profile(user, db, profile, *, confirm=None, reset=False):
    if not staging_demo_enabled():
        raise HTTPException(404, 'Not found')
    # A null grant reserves the browser workspace, independently of every OAuth
    # connection's fixture. Only the server can choose this binding.
    connector = SimpleNamespace(user=user, grant=SimpleNamespace(id=None))
    ctx = ToolContext(connector=connector, db=db)
    with account_lock(db, user.id):
        try:
            row = binding(db, user.id, None)
            if row and (reset or row.scenario != profile):
                args = {'scenario': profile}
                if confirm is not None:
                    args['confirm'] = confirm
                status = _reset(ctx, args, browser=True)
                if not status['reset']:
                    raise HTTPException(409, {'code': 'reset_required', 'confirm': status['confirm'],
                                             'message': 'Reset this fictional workspace? This discards its testing edits and restores the selected profile. Your signed-in account is unchanged.'})
            elif confirm is not None or reset:
                _refuse(user, db, 'invalid_confirmation', 'The workspace changed. Choose a profile and preview the reset again.')
            else:
                status = _setup(ctx, {'scenario': profile}, browser=True)
            return {'fictional': True, 'profile': profile, 'mcp_url': STAGING_ORIGIN + '/mcp',
                    'account_context': status}
        except InvalidResetConfirmation:
            db.rollback()
            _refuse(user, db, 'invalid_confirmation', 'Reset confirmation is invalid or stale. Choose a profile and preview again.')
        except ValueError:
            db.rollback()
            _refuse(user, db, 'workspace_unavailable', 'The fictional workspace could not be loaded. Try again or report this problem using the error reference.')
        finally:
            db.rollback()
