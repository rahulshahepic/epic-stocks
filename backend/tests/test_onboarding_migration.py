import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_attempt_migration_preserves_existing_data_and_reverses():
    path = Path(__file__).parents[1] / 'alembic/versions/u2v3w4x5y6z7_onboarding_attempts.py'
    spec = importlib.util.spec_from_file_location('onboarding_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == 't1u2v3w4x5y6'
    engine = sa.create_engine('sqlite://')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE legacy (count INTEGER)')
        conn.exec_driver_sql('INSERT INTO legacy VALUES (7)')
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
        assert {'onboarding_attempts', 'onboarding_daily_stats'} <= set(sa.inspect(conn).get_table_names())
        conn.exec_driver_sql("INSERT INTO onboarding_daily_stats (day, entrypoint, metric) VALUES ('2026-01-01', 'trial', 'starts')")
        assert conn.exec_driver_sql('SELECT count FROM onboarding_daily_stats').scalar() == 0
        with Operations.context(MigrationContext.configure(conn)):
            module.downgrade()
        assert sa.inspect(conn).get_table_names() == ['legacy']
        assert conn.exec_driver_sql('SELECT count FROM legacy').scalar() == 7
