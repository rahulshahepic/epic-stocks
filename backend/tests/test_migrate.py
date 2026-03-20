"""Tests for _migrate_schema() lightweight migration."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sqlalchemy
from sqlalchemy import create_engine, text, Integer, String, DateTime
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime

import database
from main import _migrate_schema


def _make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def test_migrate_adds_missing_columns():
    """When users table exists without last_login/is_admin, migration adds them."""
    engine = _make_engine()
    # Create a users table WITHOUT last_login and is_admin
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                google_id TEXT NOT NULL UNIQUE,
                name TEXT,
                picture TEXT,
                encrypted_key TEXT,
                created_at DATETIME
            )
        """))
        conn.execute(text(
            "INSERT INTO users (id, email, google_id, name, created_at) "
            "VALUES (1, 'test@test.com', 'g123', 'Test', '2024-01-01')"
        ))

    original_engine = database.engine
    try:
        database.engine = engine
        _migrate_schema()

        # Verify columns were added
        insp = sqlalchemy.inspect(engine)
        cols = {c["name"] for c in insp.get_columns("users")}
        assert "last_login" in cols
        assert "is_admin" in cols

        # Verify existing data is intact and new columns are null/default
        with engine.connect() as conn:
            row = conn.execute(text("SELECT email, last_login, is_admin FROM users WHERE id = 1")).fetchone()
            assert row[0] == "test@test.com"
            assert row[1] is None  # last_login defaults to NULL
            assert row[2] == 0     # is_admin defaults to 0
    finally:
        database.engine = original_engine


def test_migrate_idempotent():
    """Running migration twice doesn't error (columns already exist)."""
    engine = _make_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                google_id TEXT NOT NULL UNIQUE,
                name TEXT,
                picture TEXT,
                encrypted_key TEXT,
                created_at DATETIME,
                last_login DATETIME,
                is_admin INTEGER DEFAULT 0
            )
        """))

    original_engine = database.engine
    try:
        database.engine = engine
        _migrate_schema()  # first run — no-op
        _migrate_schema()  # second run — still no-op, no error
    finally:
        database.engine = original_engine


def test_migrate_no_users_table():
    """Migration does nothing if users table doesn't exist yet."""
    engine = _make_engine()
    original_engine = database.engine
    try:
        database.engine = engine
        _migrate_schema()  # should not raise
    finally:
        database.engine = original_engine
