from datetime import date, datetime, timezone
from unittest.mock import patch

from app.statement_reminders import statement_reminder_events, STATEMENT_MESSAGE
from scaffold.models import User, Loan, Sale, EmailPreference
from scaffold.oauth.models import OAuthGrant
from scaffold.notifications import send_daily_notifications, build_notification_payload
from tests.conftest import user_key
from tests.test_interest_checkpoints import setup_account


def connect(user, db, **kwargs):
    row = OAuthGrant(user_id=user.id, client_id='test-ai', client_name='Test AI', scope='equity:read',
                     session_version=user.session_version, refresh_token='test-verifier',
                     refresh_expires_at=datetime(2030, 1, 1, tzinfo=timezone.utc))
    for key, value in kwargs.items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    return row


def test_reminder_requires_live_equity_connection_and_is_seasonal(client, db_session):
    setup_account(client)
    client.put("/api/notifications/email?enabled=true", json={})
    user = db_session.query(User).first()
    with user_key(user):
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []
        grant = connect(user, db_session)
        assert statement_reminder_events(user, db_session, date(2026, 12, 30)) == []
        events = statement_reminder_events(user, db_session, date(2026, 12, 31))
        assert len(events) == 1
        assert statement_reminder_events(user, db_session, date(2027, 1, 15))
        assert statement_reminder_events(user, db_session, date(2027, 2, 1)) == []
        assert 'optional' in build_notification_payload(events)['body']
        grant.session_version = user.session_version + 1
        db_session.flush()
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []
        grant.session_version = user.session_version
        grant.scope = 'admin:read'
        db_session.flush()
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []
        grant.scope = 'equity:read'
        grant.refresh_expires_at = datetime(2026, 12, 30)
        db_session.flush()
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []


def test_reminder_skips_future_paid_and_reconciled_loans(client, db_session):
    loan = setup_account(client)
    user = db_session.query(User).first()
    connect(user, db_session)
    from scaffold.models import LoanInterestCheckpoint
    with user_key(user):
        row = db_session.get(Loan, loan['id'])
        row.disbursed_on = date(2027, 1, 1)
        db_session.commit()
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []
        row.disbursed_on = date(2025, 1, 1)
        row.interest_checkpoints.append(LoanInterestCheckpoint(user_id=user.id, statement_date=date(2027, 1, 1),
            accrued_through=date(2026, 12, 31), accrued_interest=400))
        db_session.commit()
        assert statement_reminder_events(user, db_session, date(2027, 1, 1)) == []
        row.interest_checkpoints.clear()
        db_session.add(Sale(user_id=user.id, loan_id=row.id, date=date(2026, 12, 31), shares=10, price_per_share=10))
        db_session.commit()
        assert statement_reminder_events(user, db_session, date(2026, 12, 31)) == []


def test_delivery_records_year_only_after_success_and_honors_opt_out(client, db_session):
    setup_account(client)
    client.put("/api/notifications/email?enabled=true", json={})
    user = db_session.query(User).first()
    connect(user, db_session)
    with patch.object(db_session, 'close'), \
         patch('scaffold.notifications.SessionLocal', return_value=db_session), \
         patch('scaffold.email_sender.email_configured', return_value=True), \
         patch('scaffold.email_sender.send_email', return_value=False) as send:
        send_daily_notifications(date(2026, 12, 31), extra_events=statement_reminder_events)
        assert user.statement_reminder_year is None
        assert STATEMENT_MESSAGE in send.call_args.args[2]
        user.last_notified_at = None
        db_session.commit()
        send.return_value = True
        send_daily_notifications(date(2027, 1, 1), extra_events=statement_reminder_events)
        assert user.statement_reminder_year == 2026
        user.last_notified_at = None
        db_session.commit()
        send.reset_mock()
        send_daily_notifications(date(2027, 1, 2), extra_events=statement_reminder_events)
        send.assert_not_called()
        user.statement_reminder_year = None
        db_session.query(EmailPreference).filter_by(user_id=user.id).update({'enabled': 0})
        db_session.commit()
        send_daily_notifications(date(2027, 1, 3), extra_events=statement_reminder_events)
        send.assert_not_called()
