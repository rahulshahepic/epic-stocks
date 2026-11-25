from datetime import date
from unittest.mock import patch

from app.annual_summary import annual_summary_events
from scaffold.models import User
from scaffold.notifications import build_notification_payload, send_daily_notifications
from tests.conftest import register_user, user_key
from tests.test_liquidation import _seed_data


def test_annual_summary_requires_auth_and_a_completed_year(client):
    assert client.get('/api/annual-stock-summary?year=2025').status_code == 401
    register_user(client)
    assert client.get(f'/api/annual-stock-summary?year={date.today().year}').status_code == 400


def test_annual_changes_reconcile_to_the_dated_dashboard(client):
    register_user(client)
    _seed_data(client)
    summary = client.get('/api/annual-stock-summary?year=2025').json()
    before = client.get('/api/dashboard?as_of=2024-12-31').json()['cards']
    after = client.get('/api/dashboard?as_of=2025-12-31').json()['cards']
    row = next(r for r in summary['rows'] if r['label'] == 'Vested holdings')
    assert row['before'] == before['total_shares']
    assert row['after'] == after['total_shares']
    assert row['change'] == after['total_shares'] - before['total_shares']
    assert 'currently saved records' in summary['note']


def test_default_summary_uses_last_completed_server_year(client):
    class ServerDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 12, 31)

    register_user(client)
    with patch('app.routers.events.date', ServerDate):
        response = client.get('/api/annual-stock-summary')
    assert response.status_code == 200
    assert response.json()['year'] == 2025


def test_annual_reminder_is_opt_in_seasonal_and_records_only_delivery(client, db_session):
    register_user(client)
    _seed_data(client)
    user = db_session.query(User).first()
    with user_key(user):
        assert annual_summary_events(user, db_session, date(2027, 1, 1)) == []
    client.put('/api/notifications/annual-summary?enabled=true', json={})
    client.put('/api/notifications/email?enabled=true', json={})
    with user_key(user):
        events = annual_summary_events(user, db_session, date(2027, 1, 1))
        assert events and annual_summary_events(user, db_session, date(2027, 2, 1)) == []
        payload = build_notification_payload(events)
        assert payload['data']['url'] == '/events#annual-summary'
        assert '$' not in payload['body'] and '1000' not in payload['body']
    with patch('scaffold.email_sender.email_configured', return_value=True), patch('scaffold.email_sender.send_email', return_value=False):
        send_daily_notifications(date(2027, 1, 1), extra_events=annual_summary_events)
        db_session.refresh(user)
        assert user.annual_summary_year is None
        user.last_notified_at = None
        db_session.commit()
    with patch('scaffold.email_sender.email_configured', return_value=True), patch('scaffold.email_sender.send_email', return_value=True) as send:
        send_daily_notifications(date(2027, 1, 2), extra_events=annual_summary_events)
        db_session.refresh(user)
        assert user.annual_summary_year == 2026
        user.last_notified_at = None
        db_session.commit()
        send.reset_mock()
        send_daily_notifications(date(2027, 1, 3), extra_events=annual_summary_events)
        send.assert_not_called()


def test_annual_preference_does_not_enable_a_channel(client):
    register_user(client)
    result = client.put('/api/notifications/annual-summary?enabled=true', json={})
    assert result.json()['annual_summary_enabled'] is True
    assert client.get('/api/notifications/email').json()['enabled'] is False


def test_stop_offering_reminders_is_an_account_preference(client):
    register_user(client)
    assert client.get('/api/notifications/email').json()['offers_dismissed'] is False
    assert client.put('/api/push/intent', json={'enabled': False}).status_code == 200
    assert client.get('/api/notifications/email').json()['offers_dismissed'] is True
    assert client.post('/api/push/status', json={}).json()['offer_dismissed'] is True
    assert client.get('/api/notifications/email').json()['enabled'] is False


def test_passive_push_subscription_repair_preserves_stop_offering(client):
    from tests.test_push import SUB_DATA
    register_user(client)
    assert client.post('/api/push/subscribe', json=SUB_DATA).status_code == 201
    client.put('/api/push/intent', json={'enabled': False})
    assert client.post('/api/push/subscribe', json=SUB_DATA).status_code == 201
    assert client.post('/api/push/status', json={}).json()['offer_dismissed'] is True
    assert client.get('/api/notifications/email').json()['offers_dismissed'] is True
