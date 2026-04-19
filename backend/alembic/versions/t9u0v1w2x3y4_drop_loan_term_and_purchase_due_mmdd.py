"""drop loan_term_years + grant_templates.default_purchase_due_month_day + latest_rate_year

Tax-loan and interest-loan due dates are now propagated in code (interest inherits
from its parent loan; tax inherits from the corresponding purchase loan / rate for
the grant year). Purchase-loan due dates continue to live on loan_rates (original)
and loan_refinances (post-refi). So:

  - grant_templates.default_purchase_due_month_day: no consumer — drop.
  - grant_program_settings.loan_term_years: only a seldom-hit init fallback in the
    wizard that's now just an empty string — drop.
  - grant_program_settings.latest_rate_year was already dropped in s8t9u0v1w2x3.
    (The wizard previously read it as an upper bound; it now iterates the known
    rate years directly.)

Revision ID: t9u0v1w2x3y4
Revises: s8t9u0v1w2x3
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't9u0v1w2x3y4'
down_revision: Union[str, Sequence[str], None] = 's8t9u0v1w2x3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('grant_program_settings') as batch:
        batch.drop_column('loan_term_years')

    with op.batch_alter_table('grant_templates') as batch:
        batch.drop_column('default_purchase_due_month_day')


def downgrade() -> None:
    with op.batch_alter_table('grant_templates') as batch:
        batch.add_column(sa.Column('default_purchase_due_month_day', sa.String(), nullable=True))

    with op.batch_alter_table('grant_program_settings') as batch:
        batch.add_column(sa.Column('loan_term_years', sa.Integer(), nullable=False, server_default='10'))
