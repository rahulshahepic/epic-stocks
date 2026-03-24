import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import our models so autogenerate can detect changes
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import Base
import models  # noqa: F401 — registers all model classes on Base.metadata

target_metadata = Base.metadata

# Override sqlalchemy.url from DATABASE_URL env var if set
db_url = os.getenv("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# Custom TypeDecorators (EncryptedFloat/Int/String) are all stored as String
_ENCRYPTED_TYPES = {"EncryptedFloat", "EncryptedInt", "EncryptedString"}


def _render_item(type_, obj, autogen_context):
    if type_ == "type" and obj.__class__.__name__ in _ENCRYPTED_TYPES:
        autogen_context.imports.add("import sqlalchemy as sa")
        return "sa.String()"
    return False


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=_render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # Fail fast rather than hang if a table lock can't be acquired
        connection.execute(text("SET lock_timeout = '10s'"))
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_item=_render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
