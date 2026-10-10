"""Separate expected and actual price announcements from effective dates."""
from alembic import op
import sqlalchemy as sa

revision = "j1k2l3m4n5o6"
down_revision = "i0j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("prices", sa.Column("expected_announcement_date", sa.Date(), nullable=True))
    op.add_column("prices", sa.Column("announced_date", sa.Date(), nullable=True))
    op.add_column("prices", sa.Column("announcement_notified_at", sa.DateTime(timezone=True), nullable=True))
    # Never invent an actual announcement for old confirmed prices.
    if op.get_bind().dialect.name == "sqlite":
        op.execute("UPDATE prices SET expected_announcement_date = strftime('%Y-03-01', effective_date) WHERE is_estimate = 1")
        return
    op.execute("UPDATE prices SET expected_announcement_date = "
               "make_date(EXTRACT(YEAR FROM effective_date)::integer, 3, 1) WHERE is_estimate = true")


def downgrade():
    op.drop_column("prices", "announcement_notified_at")
    op.drop_column("prices", "announced_date")
    op.drop_column("prices", "expected_announcement_date")
