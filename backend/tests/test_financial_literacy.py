import pytest

from app.financial_literacy import TERMS, MAX_PORTFOLIO_MILLIONS, MAX_SPENDING_THOUSANDS
from app.retirement_simulation import MILLIONS, THOUSANDS, validate_changes
from app.mcp.read_tools import _TOPICS
from tests.conftest import register_user
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
