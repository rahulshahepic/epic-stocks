"""normalize grant program settings

Moves per-template data out of the singleton grant_program_settings table, and
drops setting columns whose values are derivable from other content:

  Added:
    - grant_templates.default_purchase_due_month_day (MM-DD, Purchase rows only)

  Dropped from grant_program_settings:
    - latest_rate_year           (derived from max(loan_rates.year))
    - dp_shares_start_year       (replaced by per-template grant_templates.show_dp_shares)
    - default_purchase_due_month_day_pre2022  (moved onto grant_templates)
    - default_purchase_due_month_day_post2022 (moved onto grant_templates)
    - price_years_start          (derived from min(grant_templates.year))
    - price_years_end            (derived from max(loan_rates.year) + 1)

The pre/post-2022 due-date values are backfilled onto the Purchase grant templates
using the existing singleton-row values (split at grant_year >= 2022).

Revision ID: s8t9u0v1w2x3
Revises: r7s8t9u0v1w2
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 's8t9u0v1w2x3'
down_revision: Union[str, Sequence[str], None] = 'r7s8t9u0v1w2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grant_templates',
        sa.Column('default_purchase_due_month_day', sa.String(), nullable=True),
    )

    # Backfill: use the old singleton's pre/post-2022 MM-DD values for Purchase rows.
    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            "SELECT default_purchase_due_month_day_pre2022, "
            "default_purchase_due_month_day_post2022 "
            "FROM grant_program_settings WHERE id = 1"
        )
    ).fetchone()
    pre, post = (row[0], row[1]) if row else ('07-15', '06-30')
    conn.execute(
        sa.text(
            "UPDATE grant_templates SET default_purchase_due_month_day = :pre "
            "WHERE type = 'Purchase' AND year < 2022"
        ),
        {"pre": pre},
    )
    conn.execute(
        sa.text(
            "UPDATE grant_templates SET default_purchase_due_month_day = :post "
            "WHERE type = 'Purchase' AND year >= 2022"
        ),
        {"post": post},
    )

    with op.batch_alter_table('grant_program_settings') as batch:
        batch.drop_column('latest_rate_year')
        batch.drop_column('dp_shares_start_year')
        batch.drop_column('default_purchase_due_month_day_pre2022')
        batch.drop_column('default_purchase_due_month_day_post2022')
        batch.drop_column('price_years_start')
        batch.drop_column('price_years_end')


def downgrade() -> None:
    with op.batch_alter_table('grant_program_settings') as batch:
        batch.add_column(sa.Column('latest_rate_year', sa.Integer(), nullable=False, server_default='2025'))
        batch.add_column(sa.Column('dp_shares_start_year', sa.Integer(), nullable=False, server_default='2023'))
        batch.add_column(sa.Column('default_purchase_due_month_day_pre2022', sa.String(), nullable=False, server_default='07-15'))
        batch.add_column(sa.Column('default_purchase_due_month_day_post2022', sa.String(), nullable=False, server_default='06-30'))
        batch.add_column(sa.Column('price_years_start', sa.Integer(), nullable=False, server_default='2018'))
        batch.add_column(sa.Column('price_years_end', sa.Integer(), nullable=False, server_default='2026'))

    op.drop_column('grant_templates', 'default_purchase_due_month_day')
