import os
import sys
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# Make the backend package importable when running `alembic` from the backend directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.settings import settings
from app.database import Base
import app.models  # noqa: F401 — registers all ORM models with Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# Multi-region target selection
# ---------------------------------------------------------------------------
# Pass -x db=router to run migrations against the Global Router DB only.
# Default (db=regional) targets the main DATABASE_URL (regional or single-instance).
#
# Usage:
#   alembic upgrade head                   # regional / single-instance DB
#   alembic -x db=router upgrade head      # dedicated router DB (ROUTER_DB_URL)
# ---------------------------------------------------------------------------
_db_target = context.get_x_argument(as_dictionary=True).get("db", "regional")


def _get_url() -> str:
    """Return the DB URL for the current migration target."""
    if _db_target == "router" and settings.router_db_url:
        return settings.router_db_url
    return settings.database_url


def run_migrations_offline() -> None:
    # Use _get_url() directly to avoid configparser percent-interpolation
    # errors when the password contains percent-encoded special characters.
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_get_url(), poolclass=pool.NullPool)
    try:
        with connectable.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
