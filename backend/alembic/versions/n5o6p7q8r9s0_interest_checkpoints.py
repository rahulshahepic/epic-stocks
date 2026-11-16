"""Optional statement interest checkpoints and annual reminder delivery."""
from alembic import op
import sqlalchemy as sa

revision = "n5o6p7q8r9s0"
down_revision = "m4n5o6p7q8r9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("loan_interest_checkpoints",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("loan_id", sa.Integer(), sa.ForeignKey("loans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("accrued_through", sa.Date(), nullable=False),
        sa.Column("accrued_interest", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("loan_id", "accrued_through", name="uq_loan_interest_cutoff"))
    op.create_index("ix_loan_interest_checkpoints_user_id", "loan_interest_checkpoints", ["user_id"])
    op.create_index("ix_loan_interest_checkpoints_loan_id", "loan_interest_checkpoints", ["loan_id"])
    op.add_column("users", sa.Column("statement_reminder_year", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("users", "statement_reminder_year")
    op.drop_table("loan_interest_checkpoints")
