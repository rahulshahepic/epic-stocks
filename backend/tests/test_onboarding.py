"""Attempt cohorts must be idempotent, bounded and free of financial payloads."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select

from scaffold import onboarding as m
from scaffold.models import OnboardingAttempt, OnboardingDailyStat, EmailPreference, User
from scaffold.user_deletion import delete_user
from tests.conftest import register_user
from tests.test_epic_import import upload_files


def call(db, fn, *args, **kwargs):
    result = fn(db, *args, **kwargs)
    db.commit()
    return result


def ready(db, checked=False):
    token = call(db, m.start, 'trial')
    assert call(db, m.begin_analysis, token, 1)
    assert call(db, m.finish_analysis, token, 1, valid=True, reconciled=True, eligible=True, checked=checked)
    return token


def totals(db):
    return m.report(db)['totals']


def event(client, token, stage='preview_viewed', **values):
    return client.post('/api/onboarding/event', json={'token': token, 'opt_in': True, 'sequence': 1, 'event': stage, **values})


def test_explicit_opt_in_dnt_and_start_retry_idempotency(client, db_session):
    body = {'entrypoint': 'trial', 'nonce': 'a' * 48, 'opt_in': False}
    assert client.post('/api/onboarding/start', json=body).json()['token'] is None
    body['opt_in'] = True
    assert client.post('/api/onboarding/start', json=body, headers={'DNT': '1'}).json()['token'] is None
    first = client.post('/api/onboarding/start', json=body).json()['token']
    again = client.post('/api/onboarding/start', json=body).json()['token']
    assert first == again and len(first) == 48
    assert totals(db_session)['starts'] == 1
    row = db_session.query(OnboardingAttempt).one()
    assert first not in json.dumps({c.name: str(getattr(row, c.name)) for c in row.__table__.columns})
    assert not {'user_id', 'email', 'ip', 'filename', 'price', 'document_hash'} & set(row.__table__.columns.keys())


def test_real_parse_then_visible_preview_is_not_automatically_accurate(client, db_session):
    token = call(db_session, m.start, 'trial')
    r = client.post('/api/trial/analyze', files=upload_files(), data={'attempt_token': token, 'attempt_sequence': '1', 'measure_usage': 'true'})
    assert r.status_code == 200, r.text
    assert totals(db_session)['valid_files'] == 1
    assert totals(db_session)['usable_position'] == 0
    for _ in range(3):
        assert event(client, token).json()['recorded']
    report = m.report(db_session)
    assert report['totals']['usable_position'] == 1
    assert report['totals']['source_checked_5min'] == 0
    assert 'independently proven accuracy' in report['definitions']['source_checked_5min']


def test_parse_success_is_separate_from_reconciliation_error(client, db_session):
    from app.onboarding_measurement import analyze
    from starlette.requests import Request
    token = call(db_session, m.start, 'account')
    result = {'files_parsed': True, 'blocked': True, 'reconciles': False,
              'findings': [{'code': 'C1', 'severity': 'error', 'message': 'private financial text'}],
              'summary': {'grants': 2, 'prices': 1}}
    analyze(db_session, Request({'type': 'http', 'headers': []}), token, 1, True, lambda: result)
    assert totals(db_session)['valid_files'] == 1
    assert totals(db_session)['reconciliation_errors'] == 1
    assert totals(db_session)['usable_position'] == 0
    assert 'private financial' not in json.dumps(m.report(db_session))


def test_retries_and_out_of_order_completions_cannot_replace_new_evidence(db_session):
    token = call(db_session, m.start, 'trial')
    assert call(db_session, m.begin_analysis, token, 1)
    assert not call(db_session, m.begin_analysis, token, 1)
    assert call(db_session, m.begin_analysis, token, 2)
    assert call(db_session, m.finish_analysis, token, 2, valid=True, eligible=True, checked=True)
    assert not call(db_session, m.finish_analysis, token, 1, error='format_errors')
    assert not call(db_session, m.finish_analysis, token, 2, error='processing_errors')
    assert call(db_session, m.client_event, token, 2, 'preview_viewed')
    assert not call(db_session, m.client_event, token, 1, 'preview_viewed')
    t = totals(db_session)
    assert (t['starts'], t['retries'], t['usable_position'], t['source_checked_5min']) == (1, 1, 1, 1)
    assert t['format_errors'] == t['processing_errors'] == 0


def test_timing_uses_server_start_day_not_callback_day(db_session, monkeypatch):
    start = datetime(2026, 11, 24, 23, 59, tzinfo=timezone.utc)
    monkeypatch.setattr(m, 'now', lambda: start)
    token = ready(db_session, checked=True)
    monkeypatch.setattr(m, 'now', lambda: start + timedelta(seconds=301))
    assert call(db_session, m.client_event, token, 1, 'preview_viewed')
    report = m.report(db_session)
    assert report['totals']['source_checked_5min'] == 0
    assert report['totals']['usable_gt_300s'] == 1
    assert report['cohorts'][0]['day'] == '2026-11-24'
    assert report['cohorts'][0]['provisional']


def test_claim_binding_and_deletion_without_reusable_account_identifier(client, db_session):
    token = ready(db_session, checked=True)
    event(client, token, 'save_intent')
    register_user(client, 'first@example.test')
    first = db_session.query(User).filter_by(email='first@example.test').one()
    assert call(db_session, m.claim, token, first)
    assert call(db_session, m.claim, token, first)
    register_user(client, 'second@example.test')
    second = db_session.query(User).filter_by(email='second@example.test').one()
    assert not call(db_session, m.claim, token, second)
    assert not call(db_session, m.saved, token, second)
    assert totals(db_session)['authenticated'] == 1
    assert totals(db_session)['carryover'] == 0
    token2 = ready(db_session)
    event(client, token2)
    call(db_session, m.claim, token2, first)
    hashes = db_session.scalars(select(OnboardingAttempt.claim_digest)).all()
    assert len(set(hashes)) == 2
    delete_user(db_session, first.id)
    db_session.commit()
    assert db_session.query(OnboardingAttempt).count() == 0
    assert totals(db_session)['starts'] == 2


def test_only_confirmed_nonempty_writes_count_as_carryover(client, db_session):
    token = ready(db_session)
    event(client, token, 'save_intent')
    register_user(client)
    assert client.post('/api/onboarding/claim', json={'token': token, 'opt_in': True}).json()['recorded']
    assert not event(client, token, 'carryover_failed').json()['recorded']
    changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-01-01', 'price': 100}}]
    preview = client.post('/api/changes/preview', json={'changes': changes, 'onboarding_token': token}).json()
    assert totals(db_session)['carryover'] == 0
    assert client.post('/api/changes/apply', json={'changes': changes, 'confirm': 'wrong', 'onboarding_token': token}).status_code == 422
    assert totals(db_session)['carryover'] == 0
    result = client.post('/api/changes/apply', json={'changes': changes, 'confirm': preview['confirm'], 'onboarding_token': token})
    assert result.status_code == 200, result.text
    assert totals(db_session)['carryover'] == 1
    assert call(db_session, m.saved, token, db_session.query(User).one())
    assert totals(db_session)['carryover'] == 1


def test_reminder_requires_real_channel_and_successful_save(client, db_session):
    token = ready(db_session)
    event(client, token)
    register_user(client)
    user = db_session.query(User).one()
    call(db_session, m.claim, token, user)
    assert not call(db_session, m.client_event, token, 1, 'reminder_enabled', user)
    call(db_session, m.saved, token, user)
    assert not call(db_session, m.client_event, token, 1, 'reminder_enabled', user)
    db_session.query(EmailPreference).filter_by(user_id=user.id).one().enabled = 1
    db_session.commit()
    with patch('scaffold.email_sender.email_configured', return_value=True):
        for _ in range(3):
            assert call(db_session, m.client_event, token, 1, 'reminder_enabled', user)
    assert totals(db_session)['reminder_enabled'] == 1


def test_optout_expiry_pause_and_capacity(client, db_session, monkeypatch):
    token = ready(db_session)
    assert not event(client, token, opt_in=False).json()['recorded']
    assert db_session.query(OnboardingAttempt).count() == 0
    token = ready(db_session)
    assert not client.post('/api/onboarding/event', json={'token': token, 'opt_in': True}, headers={'DNT': '1'}).json()['recorded']
    assert db_session.query(OnboardingAttempt).count() == 0
    monkeypatch.setattr(m, 'MAX_ACTIVE', 1)
    token = ready(db_session)
    assert call(db_session, m.start, 'account') is None
    row = db_session.query(OnboardingAttempt).one()
    row.expires_at = m.now() - timedelta(seconds=1)
    db_session.add(OnboardingDailyStat(day=(m.now() - timedelta(days=181)).date(), entrypoint='trial', metric='starts', count=10))
    db_session.commit()
    assert not event(client, token).json()['recorded']
    assert m.report(db_session)['expired_attempts'] == 1
    call(db_session, m.cleanup)
    assert db_session.query(OnboardingAttempt).count() == 0
    assert db_session.query(OnboardingDailyStat).filter(OnboardingDailyStat.count == 10).count() == 0
    token = ready(db_session)
    call(db_session, m.set_paused, True)
    assert call(db_session, m.start, 'trial') is None
    assert not event(client, token).json()['recorded']
    assert m.report(db_session)['actions'][0]['tool'] == 'admin_request_resume_onboarding'


def test_measurement_failure_does_not_fail_import_and_is_reported(client, db_session):
    with patch('scaffold.onboarding.begin_analysis', side_effect=RuntimeError('never expose private text')):
        r = client.post('/api/trial/analyze', files=upload_files(), data={'attempt_token': 'a' * 48, 'measure_usage': 'true'})
    assert r.status_code == 200
    report = m.report(db_session)
    assert report['last_measurement_failure_at']
    assert 'never expose' not in json.dumps(report)
    assert any(a['action'] == 'investigate_measurement_write_failure' for a in report['actions'])


@pytest.mark.parametrize('bad', [True, 0, 181, '30'])
def test_report_bounds(db_session, bad):
    with pytest.raises(ValueError):
        m.report(db_session, bad)


def test_stale_deleted_user_cannot_claim_an_unbound_attempt(client, db_session):
    token = ready(db_session)
    event(client, token)
    register_user(client, 'deleted@example.test')
    user = db_session.query(User).filter_by(email='deleted@example.test').one()
    db_session.expunge(user)
    delete_user(db_session, user.id)
    db_session.commit()
    assert not call(db_session, m.claim, token, user)
    assert db_session.get(OnboardingAttempt, m.digest(token)).claim_digest is None


def test_protocol_rejects_unapproved_payloads_and_anonymous_account_start(client):
    assert client.post('/api/onboarding/start', json={'entrypoint': 'account', 'nonce': 'a' * 48, 'opt_in': True}).status_code == 422
    assert client.post('/api/onboarding/start-account', json={'entrypoint': 'account', 'nonce': 'a' * 48, 'opt_in': True}).status_code == 401
    assert client.post('/api/onboarding/event', json={'token': 'a' * 48, 'opt_in': True, 'email': 'private@example.test'}).status_code == 422


def test_dnt_confirmed_write_forgets_linkage_without_counting(client, db_session):
    token = ready(db_session)
    event(client, token)
    register_user(client)
    client.post('/api/onboarding/claim', json={'token': token, 'opt_in': True})
    changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2026-01-01', 'price': 100}}]
    preview = client.post('/api/changes/preview', json={'changes': changes}).json()
    result = client.post('/api/changes/apply', json={'changes': changes, 'confirm': preview['confirm'], 'onboarding_token': token}, headers={'DNT': '1'})
    assert result.status_code == 200, result.text
    assert totals(db_session)['carryover'] == 0
    assert db_session.query(OnboardingAttempt).count() == 0
