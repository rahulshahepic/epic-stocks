"""add grant_templates.default_tax_due_date

Tax-loan due dates weren't derivable from anything the admin had control over —
they were either inherited from the purchase loan (code) or left to the user to
fill in at wizard review. Adding a per-template default so a content admin can
set exactly when tax loans generated from each (year, type) template are due.

Backfill uses the same values the wizard would have produced via inheritance
from purchase_original.due_date (preserves behaviour); admins can override.

Revision ID: w2x3y4z5a6b7
Revises: v1w2x3y4z5a6
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'w2x3y4z5a6b7'
down_revision: Union[str, Sequence[str], None] = 'v1w2x3y4z5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grant_templates',
        sa.Column('default_tax_due_date', sa.String(), nullable=True),
    )

    # Backfill Bonus/Free templates with the purchase_original due_date for that
    # grant year — matches the wizard's previous inheritance-from-purchase result.
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE grant_templates
        SET default_tax_due_date = (
            SELECT due_date FROM loan_rates
            WHERE loan_rates.loan_kind = 'purchase_original'
              AND loan_rates.year = grant_templates.year
            LIMIT 1
        )
        WHERE grant_templates.type IN ('Bonus', 'Free')
    """))


def downgrade() -> None:
    with op.batch_alter_table('grant_templates') as batch:
        batch.drop_column('default_tax_due_date')
