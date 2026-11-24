"""Ordinary production lifecycle calls must not consume synthetic lock slots."""
from unittest.mock import patch

import pytest

from scaffold.models import MCPTestAccount, User
from scaffold.oauth.connections import revoke_grant
from scaffold.oauth.models import OAuthGrant
from scaffold.synthetic_accounts import lifecycle_lock
from scaffold.user_deletion import delete_user
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp


@pytest.mark.parametrize('action', ['disconnect', 'delete'])
def test_production_lifecycle_does_not_acquire_synthetic_guard(client, db_session, monkeypatch, action):
    register_user(client)
    Mcp(client)
    user = db_session.query(User).one()
    grant = db_session.query(OAuthGrant).one()
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DOMAIN', 'epic-stocks.com')
    # Even a saturated synthetic pool must not affect ordinary accounts.
    with patch('scaffold.synthetic_accounts.account_lock', side_effect=AssertionError('synthetic pool exhausted')):
        if action == 'disconnect':
            revoke_grant(db_session, grant)
            assert db_session.query(OAuthGrant).count() == 0
        else:
            delete_user(db_session, user.id)
            db_session.commit()
            assert db_session.query(User).count() == 0


def test_historical_fixture_still_requires_lifecycle_guard(client, db_session, monkeypatch):
    register_user(client)
    user = db_session.query(User).one()
    synthetic = User(email='fictional@example.invalid', name='Fictional', google_id='fictional-lifecycle', is_synthetic=True)
    db_session.add(synthetic)
    db_session.flush()
    db_session.add(MCPTestAccount(user_id=user.id, synthetic_id=synthetic.id, grant_id=None,
                                 scenario='early', fixture_version=1, generation='historical'))
    db_session.commit()
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DOMAIN', 'epic-stocks.com')
    with patch('scaffold.synthetic_accounts.account_lock', side_effect=ValueError('guard required')):
        with pytest.raises(ValueError, match='guard required'):
            with lifecycle_lock(db_session, user.id):
                pytest.fail('must hold the guard')
