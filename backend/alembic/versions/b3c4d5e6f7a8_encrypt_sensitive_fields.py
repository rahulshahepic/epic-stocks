"""Encrypt previously-plaintext sensitive fields

Converts the following columns from native types to VARCHAR so the
EncryptedDate / EncryptedJSON / EncryptedFloat / EncryptedString
TypeDecorators can store AES-256-GCM ciphertext at rest:

  users.date_of_birth     Date   → VARCHAR  (ISO-8601 plaintext, then encrypted)
  users.retirement_params JSON   → TEXT     (JSON string, then encrypted)
  sales.actual_tax_paid   FLOAT  → VARCHAR  (float string, then encrypted)

The notes / data_json columns (sale, loan_payment, import_backup) are already
VARCHAR so they need no DDL change — the TypeDecorator change is transparent.

Revision ID: b3c4d5e6f7a8
Revises: c8d9e0f1g2h3
Create Date: 2026-05-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'c8d9e0f1g2h3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        # SQLite test environments use create_all and skip migrations entirely.
        return

    op.execute(
        "ALTER TABLE users "
        "ALTER COLUMN date_of_birth TYPE VARCHAR "
        "USING date_of_birth::text"
    )
    op.execute(
        "ALTER TABLE users "
        "ALTER COLUMN retirement_params TYPE TEXT "
        "USING retirement_params::text"
    )
    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN actual_tax_paid TYPE VARCHAR "
        "USING actual_tax_paid::text"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    # NOTE: downgrade is only safe if encryption has not yet been applied.
    # Encrypted values (prefixed $ENC$) cannot be cast back to Date/JSON/Float.
    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN actual_tax_paid TYPE DOUBLE PRECISION "
        "USING actual_tax_paid::double precision"
    )
    op.execute(
        "ALTER TABLE users "
        "ALTER COLUMN retirement_params TYPE JSON "
        "USING retirement_params::json"
    )
    op.execute(
        "ALTER TABLE users "
        "ALTER COLUMN date_of_birth TYPE DATE "
        "USING date_of_birth::date"
    )
