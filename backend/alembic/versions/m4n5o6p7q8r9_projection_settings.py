"""Loan disbursement date and projection assumptions."""
from alembic import op
import sqlalchemy as sa

revision = "m4n5o6p7q8r9"
down_revision = "l3m4n5o6p7q8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("loans", sa.Column("disbursed_on", sa.Date(), nullable=True))
    op.add_column("tax_settings", sa.Column("tax_withholding_rate", sa.String(), nullable=True))
    op.add_column("tax_settings", sa.Column("projected_loan_rate", sa.String(), nullable=True))
    op.add_column("tax_settings", sa.Column("exit_payoff_lag_days", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("tax_settings", "exit_payoff_lag_days")
    op.drop_column("tax_settings", "projected_loan_rate")
    op.drop_column("tax_settings", "tax_withholding_rate")
    op.drop_column("loans", "disbursed_on")
