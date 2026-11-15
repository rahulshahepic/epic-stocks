"""A dated dashboard is one server snapshot, shared with connector accounting."""
from datetime import date

import pytest

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp


def post(client, path, data):
    response = client.post('/api/' + path, json=data)
    assert response.status_code == 201, response.text
    return response.json()


def seed(client):
    register_user(client)
    assert client.put('/api/tax-settings', json={
        'federal_lt_cg_rate': 0.20, 'state_lt_cg_rate': 0, 'niit_rate': 0,
    }).status_code == 200
    post(client, 'grants', dict(year=2020, type='Purchase', shares=1000, price=10,
        exercise_date='2020-01-01', vest_start='2021-01-01', periods=4, election_83b=True))
    post(client, 'grants', dict(year=2026, type='Purchase', shares=2000, price=10,
        exercise_date='2026-11-30', vest_start='2027-01-01', periods=4, election_83b=True))
    post(client, 'prices', dict(effective_date='2020-01-01', price=10))
    original = post(client, 'loans?generate_payoff_sale=false', dict(
        grant_year=2020, grant_type='Purchase', loan_type='Purchase', loan_year=2020,
        amount=10000, interest_rate=0.05, due_date='2035-06-30'))
    post(client, 'loans?generate_payoff_sale=false', dict(
        grant_year=2020, grant_type='Purchase', loan_type='Purchase', loan_year=2026,
        amount=12000, interest_rate=0.06, due_date='2035-06-30',
        disbursed_on='2026-11-30', refinances_loan_id=original['id']))
    post(client, 'loans?generate_payoff_sale=false', dict(
        grant_year=2026, grant_type='Purchase', loan_type='Purchase', loan_year=2026,
        amount=20000, interest_rate=0.06, due_date='2035-06-30', disbursed_on='2026-11-30'))
    post(client, 'loan-payments', dict(loan_id=original['id'], date='2026-01-01', amount=1000))


@pytest.mark.parametrize('when,balance,value', [
    ('2026-11-15', 9000, 10000), ('2026-11-30', 32000, 30000), ('2026-12-01', 32000, 30000),
])
def test_snapshot_counts_only_drawn_loans_and_purchased_shares(client, when, balance, value):
    seed(client)
    response = client.get(f'/api/dashboard?as_of={when}')
    assert response.status_code == 200, response.text
    snapshot = response.json()
    cards = snapshot['cards']
    assert snapshot['as_of'] == when
    assert cards['total_loan_principal'] == snapshot['outstanding_loan_balance'] == balance
    assert sum(l['balance'] for l in snapshot['active_loans']) == balance
    assert sum(g['totalLoan'] for g in snapshot['grant_holdings']) == balance
    assert cards['total_stock_value'] == value
    assert sum(g['totalValue'] for g in snapshot['grant_holdings']) == value
    assert cards['net_equity'] == snapshot['net_equity']
    assert cards['net_equity'] == round(value-balance-cards['accrued_unbooked_interest'], 2)
    assert cards['total_interest'] == snapshot['breakdowns']['interest']['total']
    assert cards['total_tax_paid'] == snapshot['breakdowns']['tax']['total']
    assert cards['total_income'] == snapshot['breakdowns']['income']['total']
    assert cards['total_cap_gains'] == snapshot['breakdowns']['capGains']['total']
    assert cards['cash_received'] == snapshot['breakdowns']['cash']['totals']['net']


def test_today_snapshot_matches_connector_position(client):
    seed(client)
    web = client.get(f'/api/dashboard?as_of={date.today().isoformat()}').json()
    connector = Mcp(client).call('get_dashboard')
    for key in ('total_stock_value', 'outstanding_loan_balance', 'accrued_unbooked_interest', 'net_equity'):
        assert web[key] == connector[key]
    assert web['cards']['total_shares'] == connector['held_vested_shares']


def test_snapshot_after_sale_uses_remaining_lots_and_sale_tax(client):
    seed(client)
    post(client, 'sales', dict(date='2026-11-10', shares=100, price_per_share=20))
    web = client.get('/api/dashboard?as_of=2026-11-15').json()
    assert web['cards']['total_shares'] == 900
    assert web['cards']['total_stock_value'] == 9000
    assert web['cards']['total_cost_basis'] == 9000
    assert web['breakdowns']['cash']['sales'][0]['proceeds'] == 2000
    assert web['breakdowns']['cash']['totals']['net'] == web['cards']['cash_received']


def test_empty_and_unpriced_snapshots_do_not_invent_valuation(client):
    register_user(client)
    empty = client.get('/api/dashboard?as_of=2026-01-01').json()
    assert empty['cards']['net_equity'] is None
    assert empty['active_loans'] == empty['grant_holdings'] == []
    post(client, 'grants', dict(year=2020, type='Purchase', shares=1000, price=10,
        exercise_date='2020-01-01', vest_start='2021-01-01', periods=1))
    web = client.get('/api/dashboard?as_of=2026-01-01').json()
    assert web['cards']['total_stock_value'] is None
    assert web['cards']['net_equity'] is None
    assert web['cards']['current_price'] is None


def test_snapshot_rejects_invalid_date(client):
    register_user(client)
    assert client.get('/api/dashboard?as_of=not-a-date').status_code == 422


def test_financial_charts_include_sales_and_do_not_depend_on_card_date(client):
    seed(client)
    post(client, 'sales', dict(date='2026-11-10', shares=100, price_per_share=20))
    before = client.get('/api/dashboard?as_of=2026-11-01').json()
    after = client.get('/api/dashboard?as_of=2026-11-15').json()
    assert before['charts'] == after['charts']
    sale_row = next(r for r in before['charts']['tax'] if r['date'] == '2026-11-10')
    assert sale_row['paid'] > 0
    assert after['cards']['total_tax_paid'] == sale_row['paid']


def test_next_event_uses_enriched_timeline_without_superseded_payoffs(client):
    register_user(client)
    post(client, 'grants', dict(year=2020, type='Purchase', shares=1000, price=10,
        exercise_date='2020-01-01', vest_start='2021-01-01', periods=1))
    post(client, 'prices', dict(effective_date='2020-01-01', price=10))
    old = post(client, 'loans?generate_payoff_sale=false', dict(
        grant_year=2020, grant_type='Purchase', loan_type='Purchase', loan_year=2020,
        amount=10000, interest_rate=0.05, due_date='2028-06-30'))
    post(client, 'loans?generate_payoff_sale=false', dict(
        grant_year=2020, grant_type='Purchase', loan_type='Purchase', loan_year=2025,
        amount=10000, interest_rate=0.05, due_date='2035-06-30', refinances_loan_id=old['id']))
    post(client, 'sales', dict(date='2030-05-01', shares=100, price_per_share=20))
    snapshot = client.get('/api/dashboard?as_of=2026-11-15').json()
    assert snapshot['cards']['next_event'] == {'date': '2030-05-01', 'event_type': 'Sale'}
    assert snapshot['cards']['next_event_detail']['sale_id'] is not None


def test_unsaved_tax_settings_use_existing_server_defaults(client, db_session):
    register_user(client)
    post(client, 'grants', dict(year=2020, type='Purchase', shares=1000, price=10,
        exercise_date='2020-01-01', vest_start='2021-01-01', periods=1))
    post(client, 'prices', dict(effective_date='2020-01-01', price=20))
    post(client, 'sales', dict(date='2026-11-10', shares=100, price_per_share=20))
    from scaffold.models import TaxSettings
    db_session.query(TaxSettings).delete()
    db_session.commit()
    web = client.get('/api/dashboard?as_of=2026-11-15').json()
    assert db_session.query(TaxSettings).count() == 0
    assert web['cards']['total_tax_paid'] > 0
    assert web['breakdowns']['cash']['sales'][0]['tax'] == web['cards']['total_tax_paid']
    sale_row = next(r for r in web['charts']['tax'] if r['date'] == '2026-11-10')
    assert sale_row['paid'] == web['cards']['total_tax_paid']
    events = client.get('/api/events').json()
    event_sale = next(e for e in events if e['event_type'] == 'Sale')
    assert event_sale['estimated_tax'] == web['cards']['total_tax_paid']
    tool_events = Mcp(client).call('list_events', event_types=['Sale'])['events']
    assert tool_events[0]['estimated_tax'] == web['cards']['total_tax_paid']
    assert client.get('/api/tips').status_code == 200
    assert db_session.query(TaxSettings).count() == 0


def test_dated_cards_can_skip_date_independent_chart_computation(client, monkeypatch):
    seed(client)
    from app import dashboard_view

    def forbidden(*args, **kwargs):
        raise AssertionError('Dated cards must not recompute chart series')

    monkeypatch.setattr(dashboard_view, 'dashboard_chart_data', forbidden)
    result = client.get('/api/dashboard?as_of=2026-11-15&include_charts=false')
    assert result.status_code == 200
    assert 'charts' not in result.json()
    assert result.json()['cards']['total_loan_principal'] == 9000


def test_chart_endpoint_matches_full_snapshot(client):
    seed(client)
    charts = client.get('/api/dashboard/charts')
    snapshot = client.get(f'/api/dashboard?as_of={date.today().isoformat()}').json()
    assert charts.status_code == 200
    assert charts.json() == {key: snapshot[key] for key in ('charts', 'loan_payment_by_year')}


def test_next_share_price_event_says_it_is_an_estimate(client):
    register_user(client)
    post(client, 'grants', dict(year=2020, type='Purchase', shares=1000, price=10,
        exercise_date='2020-01-01', vest_start='2021-01-01', periods=1))
    post(client, 'prices', dict(effective_date='2020-01-01', price=10))
    post(client, 'prices', dict(effective_date='2090-01-01', price=12, is_estimate=True))
    detail = client.get('/api/dashboard?as_of=2026-11-15').json()['cards']['next_event_detail']
    assert detail['event_type'] == 'Share Price' and detail['date'] == '2090-01-01'
    assert detail['price_is_estimate'] is True
    assert detail['expected_announcement_date'] == '2090-03-01'


def test_next_price_certainty_is_judged_at_the_viewed_date(client):
    register_user(client)
    post(client, 'grants', dict(year=2018, type='Purchase', shares=1000, price=10,
        exercise_date='2018-01-01', vest_start='2019-01-01', periods=1))
    post(client, 'prices', dict(effective_date='2018-01-01', price=10))
    post(client, 'prices', dict(effective_date='2020-01-01', price=12, announced_date='2020-02-27'))
    before = client.get('/api/dashboard?as_of=2019-12-31').json()['cards']['next_event_detail']
    assert before['date'] == '2020-01-01' and before['price_is_estimate'] is True
    after = client.get('/api/dashboard?as_of=2020-02-27').json()['cards']['next_event_detail']
    assert after is None or after['date'] != '2020-01-01'
