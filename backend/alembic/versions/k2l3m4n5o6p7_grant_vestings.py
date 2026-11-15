"""Store each grant's vesting schedule as dated rows.

Existing grants keep their computed schedule: the boot backfill in
services/vesting.py writes their rows with the formula they were shown with,
because the share counts are encrypted per user and SQL cannot split them.
"""
from alembic import op
import sqlalchemy as sa

revision = "k2l3m4n5o6p7"
down_revision = "j1k2l3m4n5o6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "grant_vestings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("grant_id", sa.Integer(), sa.ForeignKey("grants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("shares", sa.String(), nullable=False),
        sa.UniqueConstraint("grant_id", "date", name="uq_grant_vesting_date"),
    )
    op.create_index("ix_grant_vestings_user_id", "grant_vestings", ["user_id"])
    op.create_index("ix_grant_vestings_grant_id", "grant_vestings", ["grant_id"])


def downgrade():
    op.drop_index("ix_grant_vestings_grant_id", "grant_vestings")
    op.drop_index("ix_grant_vestings_user_id", "grant_vestings")
    op.drop_table("grant_vestings")
