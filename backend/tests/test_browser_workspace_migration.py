"""Upgrade keeps existing connections and enforces one null-grant binding per owner."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_browser_binding_upgrade_and_downgrade(tmp_path):
    engine = sa.create_engine(f'sqlite:///{tmp_path}/migration.db')
    with engine.begin() as conn:
        conn.execute(sa.text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
        conn.execute(sa.text('CREATE TABLE oauth_grants (id INTEGER PRIMARY KEY)'))
        conn.execute(sa.text('CREATE TABLE mcp_test_accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), grant_id INTEGER NOT NULL UNIQUE REFERENCES oauth_grants(id), synthetic_id INTEGER NOT NULL UNIQUE REFERENCES users(id))'))
        for uid in range(1, 7):
            conn.execute(sa.text('INSERT INTO users VALUES (:uid)'), {'uid': uid})
        conn.execute(sa.text('INSERT INTO oauth_grants VALUES (10)'))
        conn.execute(sa.text('INSERT INTO mcp_test_accounts VALUES (1, 1, 10, 3)'))
        path = Path(__file__).parents[1] / 'alembic/versions/t1u2v3w4x5y6_browser_test_workspace.py'
        spec = importlib.util.spec_from_file_location('browser_migration', path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            assert next(c for c in sa.inspect(conn).get_columns('mcp_test_accounts') if c['name'] == 'grant_id')['nullable']
            conn.execute(sa.text('INSERT INTO mcp_test_accounts VALUES (2, 1, NULL, 4)'))
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(sa.text('INSERT INTO mcp_test_accounts VALUES (3, 1, NULL, 5)'))
            conn.execute(sa.text('INSERT INTO mcp_test_accounts VALUES (3, 2, NULL, 5)'))
            with pytest.raises(RuntimeError, match='deletion service'):
                migration.downgrade()
            conn.execute(sa.text('DELETE FROM mcp_test_accounts WHERE grant_id IS NULL'))
            migration.downgrade()
            assert conn.execute(sa.text('SELECT * FROM mcp_test_accounts')).all() == [(1, 1, 10, 3)]
            assert not next(c for c in sa.inspect(conn).get_columns('mcp_test_accounts') if c['name'] == 'grant_id')['nullable']
    engine.dispose()
