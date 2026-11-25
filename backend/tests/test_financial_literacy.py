import pytest

from app.financial_literacy import TERMS, MAX_PORTFOLIO_MILLIONS, MAX_SPENDING_THOUSANDS
from app.retirement_simulation import MILLIONS, THOUSANDS, validate_changes
from app.mcp.read_tools import _TOPICS
from scaffold.models import User
from tests.conftest import register_user, user_key
from tests.test_mcp_tools import Mcp


def test_plain_dictionary_is_available_through_explain(client):
    register_user(client)
    mcp = Mcp(client)
    for key, entry in TERMS.items():
        assert entry['definition'] and entry['meaning'] and entry['title']
        assert key in _TOPICS
        assert mcp.call('explain', topic=key)['plain_language'] == entry


@pytest.mark.parametrize('field', sorted(MILLIONS | THOUSANDS))
def test_http_and_mcp_share_money_bounds_without_overwriting_plan(client, field):
    register_user(client)
    limit = MAX_PORTFOLIO_MILLIONS if field in MILLIONS else MAX_SPENDING_THOUSANDS
    params = {field: limit, 'retirementDate': '2032-01-01'}
    assert client.put('/api/retirement/params', json={'params': params}).status_code == 200
    validate_changes({field: limit})
    for invalid in [limit + 1, -1, '400000', True]:
        assert client.put('/api/retirement/params', json={'params': {field: invalid}}).status_code == 422
        with pytest.raises(ValueError):
            validate_changes({field: invalid})
        assert client.get('/api/retirement/params').json()['params'] == params


def test_http_saves_other_fields_while_legacy_amounts_wait_for_correction(client, db_session):
    register_user(client)
    user = db_session.query(User).one()
    with user_key(user):
        user.retirement_params = {'defaultSpend': None, 'traditional': -1.0}
        db_session.commit()
    params = {'defaultSpend': None, 'traditional': -1, 'minSpend': 80}
    assert client.put('/api/retirement/params', json={'params': params}).status_code == 200
    assert client.get('/api/retirement/params').json()['params'] == params
    assert client.put('/api/retirement/params', json={'params': {**params, 'traditional': -2}}).status_code == 422
    assert client.put('/api/retirement/params', json={'params': {**params, 'traditional': 0, 'defaultSpend': 100}}).status_code == 200
