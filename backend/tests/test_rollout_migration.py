import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


def migration():
    path = Path(__file__).parents[1] / 'alembic/versions/r9s0t1u2v3w4_rollout_metrics_and_reminders.py'
    spec = importlib.util.spec_from_file_location('rollout_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_preserves_existing_preferences_and_counts_and_downgrades():
    engine = sa.create_engine('sqlite://')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY, opaque TEXT, notify_push_intent INTEGER DEFAULT 0)')
        conn.exec_driver_sql("INSERT INTO users VALUES (1, 'synthetic-encrypted-placeholder', 0)")
        conn.exec_driver_sql('CREATE TABLE email_preferences (id INTEGER PRIMARY KEY, user_id INTEGER, enabled INTEGER NOT NULL DEFAULT 1)')
        conn.exec_driver_sql('INSERT INTO email_preferences VALUES (1, 1, 1)')
        conn.exec_driver_sql('CREATE TABLE trial_daily_stats (day DATE PRIMARY KEY, previews INTEGER DEFAULT 0, save_clicked INTEGER DEFAULT 0, signups_from_trial INTEGER DEFAULT 0)')
        conn.exec_driver_sql("INSERT INTO trial_daily_stats VALUES ('2026-11-24', 7, 4, 2)")
        context = MigrationContext.configure(conn)
        with Operations.context(context):
            migration().upgrade()
        assert conn.exec_driver_sql('SELECT enabled, annual_summary_enabled FROM email_preferences').one() == (1, 0)
        assert conn.exec_driver_sql('SELECT previews, import_starts FROM trial_daily_stats').one() == (7, 0)
        assert conn.exec_driver_sql('SELECT opaque, annual_summary_year FROM users').one() == ('synthetic-encrypted-placeholder', None)
        conn.exec_driver_sql('INSERT INTO email_preferences (id, user_id) VALUES (2, 1)')
        assert conn.exec_driver_sql('SELECT enabled FROM email_preferences WHERE id=2').scalar() == 0
        with Operations.context(context):
            migration().downgrade()
        assert conn.exec_driver_sql('SELECT enabled FROM email_preferences WHERE id=1').scalar() == 1
        assert conn.exec_driver_sql('SELECT previews FROM trial_daily_stats').scalar() == 7


def test_postgresql_ddl_uses_the_existing_head_and_additive_columns():
    module = migration()
    assert module.down_revision == 'q8r9s0t1u2v3'
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': output})
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert 'ADD COLUMN annual_summary_year' in sql
    assert 'ALTER COLUMN enabled SET DEFAULT' in sql
    assert 'UPDATE users SET notification_offer_dismissed = 1' in sql
    assert 'UPDATE email_preferences' not in sql
