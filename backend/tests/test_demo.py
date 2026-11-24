"""Anonymous fixtures must use canonical calculations without account I/O."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from unittest.mock import patch

import pytest

from app.demo import AS_OF, PROFILES, profile_inputs
from app.routers.events import _get_dashboard_data, _get_events_data, _preview_exit_data


@pytest.mark.parametrize('profile', PROFILES)
def test_demo_uses_canonical_services(client, profile, db_session):
    from scaffold.models import User, Grant, Price, Loan
    before = [db_session.query(model).count() for model in (User, Grant, Price, Loan)]
    with patch('app.event_cache.get', side_effect=AssertionError('account cache')):
        response = client.post('/api/demo/preview', json={'profile': profile})
    assert response.status_code == 200, response.text
    result = response.json()
    inputs = profile_inputs(profile)
    assert result['fictional'] is True
    assert result['dashboard'] == _get_dashboard_data(None, None, AS_OF, include_details=True, inputs=inputs)
    assert result['events'] == _get_events_data(None, None, inputs=inputs)
    assert result['exit'] == _preview_exit_data(None, None, AS_OF.isoformat(), inputs=inputs)
    assert result['dashboard']['held_vested_shares'] > 0
    assert before == [db_session.query(model).count() for model in (User, Grant, Price, Loan)]


@pytest.mark.parametrize('body', [
    {'profile': 'me'}, {'account_id': 1}, {'as_of': '9999-12-31'},
    {'as_of': '2020-01-01'}, {'sale_shares': 10001}, {'sale_shares': -1},
    {'sale_shares': 9999}, {'as_of': 'bad'},
])
def test_bad_demo_requests(client, body):
    assert client.post('/api/demo/preview', json=body).status_code == 422


def test_demo_sale_matches_shared_estimator(client):
    from app.routers.sales import estimate_sale_from_timeline
    from app.routers.events import _ts_dict
    response = client.post('/api/demo/preview', json={'profile': 'established', 'sale_shares': 100})
    assert response.status_code == 200, response.text
    data = response.json()
    inputs = profile_inputs('established')
    expected = estimate_sale_from_timeline(
        inputs.timeline(), AS_OF, {**_ts_dict(inputs.tax), 'lot_selection_method': inputs.tax.lot_selection_method},
        price_per_share=data['dashboard']['stock_valuation_price'], shares=100,
    )
    assert data['sale'] == expected
    assert expected['net_proceeds'] < expected['gross_proceeds']
    assert client.post('/api/demo/preview', json={'profile': 'established'}).json()['sale'] is None


def test_profiles_are_request_local_and_concurrent():
    def compute(profile):
        inputs = profile_inputs(profile)
        return _get_dashboard_data(None, None, date(2030, 1, 1), include_details=True, inputs=inputs)
    with ThreadPoolExecutor(3) as pool:
        results = list(pool.map(compute, PROFILES))
    assert len({r['held_vested_shares'] for r in results}) == 3
    first = profile_inputs('early')
    first.grants[0].shares = 0
    assert profile_inputs('early').grants[0].shares == 200


def test_demo_sheds_concurrent_load(client):
    from app.routers.demo import SLOTS
    with SLOTS, SLOTS:
        response = client.post('/api/demo/preview', json={})
    assert response.status_code == 503
    assert response.headers['retry-after'] == '2'


@pytest.mark.parametrize('profile', PROFILES)
def test_equivalent_account_rows_have_identical_accounting(client, db_session, profile):
    """Prove parity with persisted, encrypted rows, rather than a second formula."""
    from scaffold.models import User, Grant, Price, Loan, TaxSettings
    from tests.conftest import register_user, user_key
    from services.vesting import set_schedule, schedule_of
    from app.calculation_inputs import load_calculation_inputs
    inputs = profile_inputs(profile)
    register_user(client)
    user = db_session.query(User).filter_by(email='test@example.com').one()
    with user_key(user):
        for g in inputs.grants:
            row = Grant(user_id=user.id, **{k: getattr(g, k) for k in
                        ('year', 'type', 'shares', 'price', 'vest_start', 'periods', 'exercise_date', 'dp_shares', 'election_83b')})
            set_schedule(row, schedule_of(g))
            db_session.add(row)
        for p in inputs.prices:
            db_session.add(Price(user_id=user.id, **vars(p)))
        for ln in inputs.loans:
            db_session.add(Loan(user_id=user.id, **{k: v for k, v in vars(ln).items() if k != 'interest_checkpoints'}))
        db_session.add(TaxSettings(user_id=user.id, **vars(inputs.tax)))
        db_session.commit()
        account = load_calculation_inputs(user, db_session)
        # The deployed program's templates are deliberately not fictional inputs.
        # Supply this profile's due-date assumptions to both row sources.
        account.tax_due = inputs.tax_due
        assert account.today is None
        account.today = inputs.today
        for when in (AS_OF, date(2032, 1, 1)):
            expected = _get_dashboard_data(None, None, when, include_details=True, inputs=inputs)
            actual = _get_dashboard_data(user, db_session, when, include_details=True, inputs=account)
            assert actual == expected
            assert _preview_exit_data(user, db_session, when.isoformat(), inputs=account) == _preview_exit_data(None, None, when.isoformat(), inputs=inputs)
        assert _get_events_data(user, db_session, inputs=account) == _get_events_data(None, None, inputs=inputs)
        # A signed-in visitor gets the same fictional response and keeps their rows.
        before = client.get('/api/grants').json()
        assert client.post('/api/demo/preview', json={'profile': profile}).status_code == 200
        assert client.get('/api/grants').json() == before
        demo_sale = client.post('/api/demo/preview', json={'profile': profile, 'sale_shares': 100}).json()
        account_sale = client.get('/api/sales/estimate', params={
            'sale_date': AS_OF.isoformat(), 'shares': 100,
            'price_per_share': demo_sale['dashboard']['stock_valuation_price'],
        })
        assert account_sale.status_code == 200, account_sale.text
        assert account_sale.json() == demo_sale['sale']



def test_demo_is_repeatable_when_the_server_clock_changes():
    class LaterDate(date):
        @classmethod
        def today(cls):
            return date(2030, 1, 1)

    when = date(2032, 1, 1)
    inputs = profile_inputs('established')
    expected = (_get_dashboard_data(None, None, when, include_details=True, inputs=inputs),
                _get_events_data(None, None, inputs=inputs),
                _preview_exit_data(None, None, when.isoformat(), inputs=inputs))
    with patch('app.routers.events.date', LaterDate):
        actual = (_get_dashboard_data(None, None, when, include_details=True, inputs=inputs),
                  _get_events_data(None, None, inputs=inputs),
                  _preview_exit_data(None, None, when.isoformat(), inputs=inputs))
    assert actual == expected
