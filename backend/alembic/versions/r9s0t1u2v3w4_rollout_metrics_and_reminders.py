"""Aggregate import attempt quality counters, without visitor records."""
from alembic import op
import sqlalchemy as sa

revision = "r9s0t1u2v3w4"
down_revision = "q8r9s0t1u2v3"
branch_labels = None
depends_on = None

FIELDS = ("import_starts", "valid_uploads", "source_checks_passed", "format_rejections",
          "processing_le_5s", "processing_gt_5s")


def upgrade():
    op.add_column("email_preferences", sa.Column("annual_summary_enabled", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("email_preferences") as batch:
        batch.alter_column("enabled", server_default="0")
    op.add_column("users", sa.Column("notification_offer_dismissed", sa.Integer(), nullable=False, server_default="0"))
    # This offer is onboarding for new accounts, not a new prompt for existing users who have not requested device offers.
    op.execute("UPDATE users SET notification_offer_dismissed = 1 WHERE notify_push_intent = 0")
    op.add_column("users", sa.Column("annual_summary_year", sa.Integer(), nullable=True))
    for name in FIELDS:
        op.add_column("trial_daily_stats", sa.Column(name, sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("email_preferences") as batch:
        batch.alter_column("enabled", server_default="1")
    op.drop_column("email_preferences", "annual_summary_enabled")
    op.drop_column("users", "annual_summary_year")
    op.drop_column("users", "notification_offer_dismissed")
    for name in reversed(FIELDS):
        op.drop_column("trial_daily_stats", name)
