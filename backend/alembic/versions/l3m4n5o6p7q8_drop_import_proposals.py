"""Drop staged import proposals: an assistant now previews and applies edits
through the change set itself, so nothing waits in a review queue."""
from alembic import op
import sqlalchemy as sa

revision = "l3m4n5o6p7q8"
down_revision = "k2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table("import_proposals")


def downgrade():
    op.create_table(
        "import_proposals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False, unique=True, index=True),
        sa.Column("client_name", sa.String(), nullable=False, server_default=""),
        sa.Column("payload_json", sa.String(), nullable=False),
        sa.Column("findings_json", sa.String(), nullable=False, server_default="[]"),
        sa.Column("blocked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False, index=True),
    )
