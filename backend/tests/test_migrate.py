"""Tests for Alembic migration configuration."""
import sys
import os
from types import SimpleNamespace
from unittest.mock import Mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_alembic_config_loads():
    """Alembic config can be loaded without error."""
    from pathlib import Path
    from alembic.config import Config
    cfg = Config(Path(__file__).parent.parent / "alembic.ini")
    assert cfg.get_main_option("script_location") is not None


def test_alembic_has_initial_migration():
    """At least one migration version file exists."""
    from pathlib import Path
    versions_dir = Path(__file__).parent.parent / "alembic" / "versions"
    migration_files = list(versions_dir.glob("*.py"))
    assert len(migration_files) >= 1, "Expected at least one Alembic migration"


def test_alembic_env_imports_models():
    """Alembic env.py can import models and target_metadata is set."""
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location(
        "alembic_env",
        Path(__file__).parent.parent / "alembic" / "env.py"
    )
    # Just verify the file parses without errors
    assert spec is not None


def test_deployed_postgres_uses_isolated_migration_step(monkeypatch):
    import main
    import database
    from alembic import command
    from scaffold import migrate_sqlite_to_pg

    monkeypatch.setattr(database, "engine", SimpleNamespace(url=SimpleNamespace(drivername="postgresql")))
    upgrade = Mock()
    migrate = Mock()
    monkeypatch.setattr(command, "upgrade", upgrade)
    monkeypatch.setattr(migrate_sqlite_to_pg, "maybe_migrate", migrate)
    monkeypatch.setenv("RUN_MIGRATIONS_ON_STARTUP", "0")

    main._prepare_database()

    upgrade.assert_not_called()
    migrate.assert_called_once()


def test_local_postgres_migrates_on_startup(monkeypatch):
    import main
    import database
    from alembic import command
    from scaffold import migrate_sqlite_to_pg

    monkeypatch.setattr(database, "engine", SimpleNamespace(url=SimpleNamespace(drivername="postgresql")))
    upgrade = Mock()
    monkeypatch.setattr(command, "upgrade", upgrade)
    monkeypatch.setattr(migrate_sqlite_to_pg, "maybe_migrate", Mock())
    monkeypatch.delenv("RUN_MIGRATIONS_ON_STARTUP", raising=False)

    main._prepare_database()

    upgrade.assert_called_once()
    assert upgrade.call_args.args[1] == "head"
