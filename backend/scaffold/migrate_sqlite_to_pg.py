"""
One-time migration: copy all data from an existing SQLite database into PostgreSQL.

This runs automatically on first startup when PostgreSQL is empty and
data/vesting.db exists. It is safe to run multiple times — it skips any table
that already has rows in PostgreSQL, and writes data/.migrated_to_pg when done
to prevent re-running.

Can also be run manually:
    DATABASE_URL=postgresql://... python migrate_sqlite_to_pg.py [--sqlite path/to/vesting.db]
"""
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

logger = logging.getLogger(__name__)

# Tables in FK-safe insertion order
_TABLES = [
    "users",
    "blocked_emails",
    "error_logs",
    "grants",
    "loans",
    "prices",
    "push_subscriptions",
    "email_preferences",
    "tax_settings",
    "sales",
    "loan_payments",
    "import_backups",
]

# Sentinel file written after a successful migration so it never runs again
_SENTINEL = Path(__file__).parent / "data" / ".migrated_to_pg"


def _coerce(value):
    """SQLite may return date/datetime values as ISO strings; ensure they are
    proper Python objects so psycopg2 can bind them without ambiguity."""
    if value is None or not isinstance(value, str):
        return value
    # ISO date: "YYYY-MM-DD"
    if len(value) == 10:
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    # ISO datetime: "YYYY-MM-DD HH:MM:SS..." (SQLite stores with space, not T)
    if len(value) >= 19 and (value[10] == " " or value[10] == "T"):
        try:
            return datetime.fromisoformat(value.replace(" ", "T"))
        except ValueError:
            pass
    return value


def migrate(sqlite_url: str, pg_url: str) -> bool:
    """Copy all rows from sqlite_url into pg_url.  Returns True on success."""
    sqlite_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    pg_engine = create_engine(pg_url)
    sqlite_insp = inspect(sqlite_engine)

    migrated_tables = 0
    migrated_rows = 0

    with sqlite_engine.connect() as src, pg_engine.connect() as dst:
        for table in _TABLES:
            if not sqlite_insp.has_table(table):
                logger.info("migrate: skip %s (not in SQLite)", table)
                continue

            # Skip if PG already has rows (idempotent)
            pg_count = dst.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            if pg_count > 0:
                logger.info("migrate: skip %s (%d rows already in PG)", table, pg_count)
                continue

            rows = src.execute(text(f"SELECT * FROM {table}")).fetchall()
            if not rows:
                logger.info("migrate: skip %s (empty in SQLite)", table)
                continue

            cols = list(src.execute(text(f"SELECT * FROM {table} LIMIT 0")).keys())
            col_sql = ", ".join(f'"{c}"' for c in cols)
            placeholders = ", ".join(f":{c}" for c in cols)

            data = [
                {c: _coerce(row[i]) for i, c in enumerate(cols)}
                for row in rows
            ]

            # Disable FK checks for duration of this table's insert so we can
            # insert in bulk without worrying about ordering within a batch.
            dst.execute(text(
                f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders})"
            ), data)
            dst.commit()

            logger.info("migrate: %s — %d rows", table, len(rows))
            migrated_tables += 1
            migrated_rows += len(rows)

        # Reset all PG sequences so new inserts don't collide with migrated IDs.
        # Every table has an `id` serial primary key.
        for table in _TABLES:
            try:
                dst.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table}), 1))"
                ))
            except Exception:
                pass  # table may not exist or may not have a sequence
        dst.commit()

    logger.info("migrate: done — %d tables, %d rows", migrated_tables, migrated_rows)
    return True


def maybe_migrate() -> bool:
    """Called from the app lifespan. Runs the migration if conditions are met.

    Conditions:
    - Sentinel file does NOT exist (migration hasn't run yet)
    - SQLite file exists at data/vesting.db
    - PostgreSQL users table is empty

    Writes sentinel file on success so it never runs again.
    """
    if _SENTINEL.exists():
        return False

    sqlite_path = Path(__file__).parent / "data" / "vesting.db"
    if not sqlite_path.exists():
        return False

    pg_url = os.getenv("DATABASE_URL", "")
    if not pg_url or pg_url.startswith("sqlite"):
        return False

    try:
        pg_engine = create_engine(pg_url)
        with pg_engine.connect() as conn:
            user_count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if user_count > 0:
            logger.info("migrate: PG already has %d users, skipping", user_count)
            _SENTINEL.touch()
            return False
    except Exception as exc:
        logger.warning("migrate: could not check PG state: %s", exc)
        return False

    logger.info("migrate: SQLite found at %s, PG is empty — starting migration", sqlite_path)
    sqlite_url = f"sqlite:///{sqlite_path}"

    try:
        migrate(sqlite_url, pg_url)
        _SENTINEL.touch()
        logger.info("migrate: complete. Sentinel written to %s", _SENTINEL)
        return True
    except Exception:
        logger.exception("migrate: FAILED — data/vesting.db is untouched, will retry on next start")
        return False


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    parser = argparse.ArgumentParser(description="Migrate SQLite → PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=str(Path(__file__).parent / "data" / "vesting.db"),
        help="SQLite file path (default: data/vesting.db)",
    )
    parser.add_argument(
        "--postgres",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL DSN (default: $DATABASE_URL)",
    )
    args = parser.parse_args()

    if not args.postgres:
        print("ERROR: --postgres or $DATABASE_URL required", file=sys.stderr)
        sys.exit(1)

    success = migrate(f"sqlite:///{args.sqlite}", args.postgres)
    sys.exit(0 if success else 1)
