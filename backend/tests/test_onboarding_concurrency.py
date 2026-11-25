"""Real multi-connection races on CI's PostgreSQL service, isolated schema."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from database import Base
from scaffold import onboarding as m
from scaffold.models import OnboardingAttempt, User


@pytest.fixture()
def pg():
    url = os.getenv('TEST_POSTGRES_URL')
    if not url:
        pytest.skip('CI supplies TEST_POSTGRES_URL')
    raw = create_engine(url)
    schema = 'onboarding_' + uuid.uuid4().hex
    with raw.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    def run(fn, *args, **kwargs):
        with factory() as db:
            out = fn(db, *args, **kwargs)
            db.commit()
            return out
    try:
        yield factory, run
    finally:
        engine.dispose()
        with raw.begin() as conn:
            conn.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        raw.dispose()


def test_start_nonce_is_idempotent_and_capacity_is_atomic(pg, monkeypatch):
    _, run = pg
    with ThreadPoolExecutor(6) as pool:
        same = list(pool.map(lambda _: run(m.start, 'trial', 'a' * 48), range(6)))
    assert len(set(same)) == 1
    assert run(m.report)['totals']['starts'] == 1
    monkeypatch.setattr(m, 'MAX_ACTIVE', 2)
    with ThreadPoolExecutor(6) as pool:
        different = list(pool.map(lambda _: run(m.start, 'trial'), range(6)))
    assert sum(v is not None for v in different) == 1
    assert run(m.report)['totals']['starts'] == 2


def test_parallel_phases_and_late_results_count_once(pg):
    _, run = pg
    token = run(m.start, 'trial')
    with ThreadPoolExecutor(6) as pool:
        starts = list(pool.map(lambda _: run(m.begin_analysis, token, 1), range(6)))
    assert sum(starts) == 1
    assert run(m.begin_analysis, token, 2)
    assert run(m.finish_analysis, token, 2, valid=True, eligible=True, checked=True)
    assert not run(m.finish_analysis, token, 1, eligible=False, error='format_errors')
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda _: run(m.client_event, token, 2, 'preview_viewed'), range(6)))
    out = run(m.report)['totals']
    assert out['retries'] == out['valid_files'] == out['usable_position'] == out['source_checked_5min'] == 1
    assert out['format_errors'] == 0


def test_two_accounts_cannot_claim_same_attempt(pg):
    factory, run = pg
    token = run(m.start, 'trial')
    run(m.begin_analysis, token, 1)
    run(m.finish_analysis, token, 1, eligible=True)
    run(m.client_event, token, 1, 'preview_viewed')
    with factory() as db:
        users = [User(id=i, email=f'fictional-{i}@example.test', google_id=f'test-{i}', created_at=datetime.now(timezone.utc)) for i in (1, 2)]
        db.add_all(users)
        db.commit()
        for user in users:
            db.refresh(user)
            db.expunge(user)
    with ThreadPoolExecutor(2) as pool:
        claims = list(pool.map(lambda u: run(m.claim, token, u), users))
    assert sum(claims) == 1
    winner, loser = users[claims.index(True)], users[claims.index(False)]
    assert run(m.saved, token, winner)
    assert not run(m.saved, token, loser)
    assert not run(m.client_event, token, 1, 'reminder_enabled', loser)
    assert run(m.report)['totals']['carryover'] == 1
    with factory() as db:
        assert db.query(OnboardingAttempt).count() == 1


def test_pause_serializes_with_starts_and_invalidates_every_token(pg):
    factory, run = pg
    with ThreadPoolExecutor(5) as pool:
        work = [pool.submit(run, m.start, 'trial') for _ in range(4)]
        pause = pool.submit(run, m.set_paused, True)
        tokens = [f.result() for f in work]
        pause.result()
    with factory() as db:
        assert m.paused(db)
        assert db.query(OnboardingAttempt).count() == 0
    assert run(m.start, 'trial') is None
    for token in filter(None, tokens):
        assert not run(m.begin_analysis, token, 1)


def test_account_deletion_and_claim_cannot_leave_live_linkage(pg):
    from scaffold.user_deletion import delete_user
    factory, run = pg
    with factory() as db:
        user = User(email='fictional-delete@example.test', google_id='delete-test')
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
    token = run(m.start, 'trial')
    run(m.begin_analysis, token, 1)
    run(m.finish_analysis, token, 1, eligible=True)
    run(m.client_event, token, 1, 'preview_viewed')
    with ThreadPoolExecutor(2) as pool:
        claim = pool.submit(run, m.claim, token, user)
        deletion = pool.submit(run, delete_user, user.id)
        claim.result()
        deletion.result()
    assert not run(m.claim, token, user)
    with factory() as db:
        assert not db.query(OnboardingAttempt).filter(OnboardingAttempt.claim_digest.isnot(None)).count()
