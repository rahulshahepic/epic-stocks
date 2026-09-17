"""deduplicate prices and enforce one price per user/date

Revision ID: i0j1k2l3m4n5
Revises: h9i0j1k2l3m5
Create Date: 2026-09-15 00:00:00.000000

When duplicate rows exist, a real price wins over an estimate; ties retain the
newest row. Prices have no child foreign keys, so removing the losing rows does
not orphan other records.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "i0j1k2l3m4n5"
down_revision: Union[str, Sequence[str], None] = "h9i0j1k2l3m5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM prices
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY user_id, effective_date
                           ORDER BY is_estimate ASC, id DESC
                       ) AS duplicate_rank
                FROM prices
            ) ranked
            WHERE duplicate_rank > 1
        )
    """)
    with op.batch_alter_table("prices") as batch:
        batch.create_unique_constraint(
            "uq_prices_user_effective_date", ["user_id", "effective_date"],
        )


def downgrade() -> None:
    with op.batch_alter_table("prices") as batch:
        batch.drop_constraint("uq_prices_user_effective_date", type_="unique")
