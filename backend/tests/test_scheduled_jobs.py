"""The same job entry point is used by the Hetzner timer and future cloud jobs."""
from datetime import datetime, timedelta, timezone
import json

import pytest

import scheduled_jobs as jobs
from scaffold.models import SystemSettings


def _at(hour):
    return datetime(2026, 10, 17, hour, tzinfo=timezone.utc)


def test_job_runs_after_missed_firing_and_only_once(setup_db, db_session, monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, "_JOBS", (("notifications", jobs.time(7), 555555555, calls.append),))

    assert jobs.run_due(_at(6)) == {"notifications": "not_due"}
    assert jobs.run_due(_at(9)) == {"notifications": "completed"}
    assert jobs.run_due(_at(12)) == {"notifications": "already_done_or_running"}
    assert calls == [_at(9).date()]
    assert db_session.get(SystemSettings, "scheduled:notifications:last_completed").value == "2026-10-17"
    completed = db_session.get(SystemSettings, "scheduled:notifications:last_completed_at").value
    assert datetime.fromisoformat(completed).tzinfo == timezone.utc
    assert jobs.run_due(_at(13)) == {"notifications": "already_done_or_running"}
    assert db_session.get(SystemSettings, "scheduled:notifications:last_completed_at").value == completed


def test_failed_job_retries_without_blocking_other_jobs(setup_db, db_session, monkeypatch):
    calls = []

    def fail_once(day):
        calls.append(day)
        if len(calls) == 1:
            raise RuntimeError("transient failure")

    other = []
    monkeypatch.setattr(jobs, "_JOBS", (
        ("maintenance", jobs.time(3), 444444444, fail_once),
        ("notifications", jobs.time(7), 555555555, other.append),
    ))

    assert jobs.run_due(_at(8)) == {"maintenance": "failed", "notifications": "completed"}
    assert db_session.get(SystemSettings, "scheduled:maintenance:last_completed") is None
    assert db_session.get(SystemSettings, "scheduled:maintenance:last_completed_at") is None
    assert jobs.run_due(_at(8) + timedelta(minutes=15)) == {
        "maintenance": "completed", "notifications": "already_done_or_running",
    }
    assert len(calls) == 2
    assert len(other) == 1
    assert json.loads(db_session.get(SystemSettings, "scheduled:runner:last_results").value) == {
        "maintenance": "completed", "notifications": "already_done_or_running",
    }
    assert datetime.fromisoformat(db_session.get(SystemSettings, "scheduled:runner:last_finished_at").value).tzinfo


def test_runner_records_startup_failure(setup_db, db_session, monkeypatch):
    from scaffold import crypto

    def fail(_db):
        raise RuntimeError("key unavailable")

    monkeypatch.setattr(crypto, "initialize_master_key", fail)
    with pytest.raises(RuntimeError, match="key unavailable"):
        jobs.run_due(_at(8))
    assert json.loads(db_session.get(SystemSettings, "scheduled:runner:last_results").value) == {
        "runner": "failed",
    }


def test_jobs_use_utc_day(setup_db, monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, "_JOBS", (("maintenance", jobs.time(3), 444444444, calls.append),))

    local = datetime(2026, 10, 16, 22, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert jobs.run_due(local) == {"maintenance": "completed"}
    assert calls == [datetime(2026, 10, 17, tzinfo=timezone.utc).date()]
    with pytest.raises(ValueError, match="timezone-aware"):
        jobs.run_due(datetime(2026, 10, 17, 4))


def test_one_off_job_loads_encryption_key_before_work(setup_db, monkeypatch):
    from scaffold import crypto

    calls = []
    monkeypatch.setattr(crypto, "initialize_master_key", lambda _db: calls.append("key"))
    monkeypatch.setattr(jobs, "_JOBS", (("notifications", jobs.time(7), 555555555,
                                      lambda _day: calls.append("work")),))

    assert jobs.run_due(_at(8)) == {"notifications": "completed"}
    assert calls == ["key", "work"]


def test_notifications_use_the_due_utc_date(monkeypatch):
    from scaffold import notifications

    calls = []
    monkeypatch.setattr(notifications, "send_daily_notifications", lambda today: calls.append(today))
    monkeypatch.setattr(notifications, "send_admin_daily_digest", lambda today: calls.append(("digest", today)))

    jobs._notifications(_at(8).date())
    jobs._admin_digest(_at(8).date())
    assert calls == [_at(8).date(), ("digest", _at(8).date())]


def test_failed_digest_retries_without_resending_notifications(setup_db, db_session, monkeypatch):
    from scaffold import notifications

    sent = []
    attempts = []
    monkeypatch.setattr(notifications, "send_daily_notifications", lambda today: sent.append(today))

    def digest(today):
        assert today == _at(8).date()
        attempts.append(True)
        if len(attempts) == 1:
            raise RuntimeError("email provider unavailable")

    monkeypatch.setattr(notifications, "send_admin_daily_digest", digest)
    monkeypatch.setattr(jobs, "_JOBS", (
        ("notifications", jobs.time(7), 555555555, jobs._notifications),
        ("admin_digest", jobs.time(7), 666666666, jobs._admin_digest),
    ))

    assert jobs.run_due(_at(8)) == {"notifications": "completed", "admin_digest": "failed"}
    assert jobs.run_due(_at(8) + timedelta(minutes=15)) == {
        "notifications": "already_done_or_running", "admin_digest": "completed",
    }
    assert sent == [_at(8).date()]
    assert len(attempts) == 2
    assert db_session.get(SystemSettings, "scheduled:admin_digest:last_completed").value == "2026-10-17"


def test_maintenance_runs_all_three_steps(setup_db, monkeypatch):
    import main
    from app.routers import prices
    from scaffold.oauth import cleanup

    calls = []
    monkeypatch.setattr(main, "_aggregate_old_metrics", lambda: calls.append("metrics"))
    monkeypatch.setattr(prices, "_cleanup_epic_past_estimates", lambda db: calls.append("prices"))
    monkeypatch.setattr(cleanup, "prune", lambda db: calls.append("oauth"))

    jobs._maintenance(_at(4).date())
    assert calls == ["metrics", "prices", "oauth"]
