"""move dp_min_percent + dp_min_cap from tax_settings to grant_program_settings

Epic's down-payment policy (≥ 10% of purchase, capped at $20k) is company-wide,
not per-user. Moving those two fields to the singleton grant_program_settings
table so content admins can edit them; keeping prefer_stock_dp on tax_settings
since that's a genuine per-user preference.

Picks the first non-null (dp_min_percent, dp_min_cap) pair found across all
tax_settings rows to seed the singleton. Falls back to (0.10, 20000) if no
rows exist yet.

Revision ID: u0v1w2x3y4z5
Revises: t9u0v1w2x3y4
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u0v1w2x3y4z5'
down_revision: Union[str, Sequence[str], None] = 't9u0v1w2x3y4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grant_program_settings',
        sa.Column('dp_min_percent', sa.Float(), nullable=False, server_default='0.1'),
    )
    op.add_column(
        'grant_program_settings',
        sa.Column('dp_min_cap', sa.Float(), nullable=False, server_default='20000'),
    )

    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            "SELECT dp_min_percent, dp_min_cap FROM tax_settings "
            "WHERE dp_min_percent IS NOT NULL AND dp_min_cap IS NOT NULL "
            "LIMIT 1"
        )
    ).fetchone()
    if row:
        conn.execute(
            sa.text(
                "UPDATE grant_program_settings SET dp_min_percent = :p, dp_min_cap = :c "
                "WHERE id = 1"
            ),
            {"p": row[0], "c": row[1]},
        )

    with op.batch_alter_table('tax_settings') as batch:
        batch.drop_column('dp_min_percent')
        batch.drop_column('dp_min_cap')


def downgrade() -> None:
    op.add_column(
        'tax_settings',
        sa.Column('dp_min_percent', sa.Float(), nullable=False, server_default='0.1'),
    )
    op.add_column(
        'tax_settings',
        sa.Column('dp_min_cap', sa.Float(), nullable=False, server_default='20000'),
    )
    with op.batch_alter_table('grant_program_settings') as batch:
        batch.drop_column('dp_min_percent')
        batch.drop_column('dp_min_cap')
