"""move purchase-loan due date from loan_rates onto GrantTemplate

Parity with Bonus/Free templates (which carry default_tax_due_date): Purchase
templates now carry default_purchase_due_date. The loan_rates.due_date column
— only ever populated for purchase_original rows — is dropped.

Revision ID: y4z5a6b7c8d9
Revises: x3y4z5a6b7c8
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'y4z5a6b7c8d9'
down_revision: Union[str, Sequence[str], None] = 'x3y4z5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grant_templates',
        sa.Column('default_purchase_due_date', sa.String(), nullable=True),
    )

    # Backfill Purchase templates from the purchase_original due_date for that year.
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE grant_templates
        SET default_purchase_due_date = (
            SELECT due_date FROM loan_rates
            WHERE loan_rates.loan_kind = 'purchase_original'
              AND loan_rates.year = grant_templates.year
            LIMIT 1
        )
        WHERE grant_templates.type = 'Purchase'
    """))

    with op.batch_alter_table('loan_rates') as batch:
        batch.drop_column('due_date')


def downgrade() -> None:
    op.add_column(
        'loan_rates',
        sa.Column('due_date', sa.String(), nullable=True),
    )
    with op.batch_alter_table('grant_templates') as batch:
        batch.drop_column('default_purchase_due_date')
