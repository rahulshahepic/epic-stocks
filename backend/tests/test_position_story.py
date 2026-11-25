from datetime import date
import pytest
from app.position_story import position_story
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp, GRANT


@pytest.mark.parametrize('price,loans,estimate', [(None, False, False), (20, False, False), (20, True, False), (20, True, True)])
def test_story_uses_authoritative_results_and_partial_data(price, loans, estimate):
    payload = dict(held_vested_shares=100, stock_valuation_price=price,
                   vested_stock_value=2000 if price else None, outstanding_loan_balance=500,
                   price_is_estimate=estimate)
    active = [dict(dueDate='2030-01-01', grantYear=2020)] if loans else []
    story = position_story(payload, date.today(), active=active,
                           exit_preview={'liquidation_net_cash': 1234} if price else None)
    text = ' '.join(story['summary_sentences'])
    assert ('Add a share price' in text) == (price is None)
    assert ('$1,234' in text) == (price is not None)
    assert ('estimated price' in text) == estimate
    assert ('No outstanding loans are recorded' in text) == (not loans)
    assert all(q.startswith('Use Epic Stocks:') and '$' not in q for q in story['starter_questions'])


def test_story_parity_for_http_and_connector(client):
    register_user(client)
    client.post('/api/grants', json=GRANT)
    client.post('/api/prices', json={'effective_date': '2020-01-01', 'price': 20})
    web = client.get(f'/api/dashboard?as_of={date.today().isoformat()}').json()
    connector = Mcp(client).call('get_dashboard')
    assert web['summary_sentences'] == connector['summary_sentences']
    assert web['starter_questions'] == connector['starter_questions']
    assert not any('$' in q for q in web['starter_questions'])


def test_empty_story_invites_import(client):
    register_user(client)
    web = client.get('/api/dashboard').json()
    assert web['summary_sentences'] == ['Add your stock files to see your position in plain words.']


def test_exit_shortfall_is_money_needed_not_money_available():
    result = position_story({'held_vested_shares': 1, 'stock_valuation_price': 20,
                             'vested_stock_value': 20}, date.today(),
                            exit_preview={'liquidation_net_cash': 0, 'liquidation_shortfall': 500})
    assert 'require about $500 in additional cash' in result['summary_sentences'][-1]


def test_generated_repayment_story_uses_real_enriched_sale_shape(client):
    register_user(client)
    client.post('/api/grants', json={**GRANT, 'year': 2020, 'shares': 1000, 'price': 10,
                'exercise_date': '2020-01-01', 'vest_start': '2021-01-01', 'periods': 1})
    client.post('/api/prices', json={'effective_date': '2020-01-01', 'price': 20})
    response = client.post('/api/loans', json={'grant_year': 2020, 'grant_type': GRANT['type'],
        'loan_type': 'Purchase', 'loan_year': 2020, 'amount': 100, 'interest_rate': 0,
        'due_date': '2035-01-01'})
    assert response.status_code == 201, response.text
    sales = client.get('/api/sales').json()
    generated = next(s for s in sales if s['is_generated'])
    story = client.get(f'/api/dashboard?as_of={date.today().isoformat()}').json()['summary_sentences']
    assert f"sell about {generated['shares']:,} shares" in ' '.join(story)
