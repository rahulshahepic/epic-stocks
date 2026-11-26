"""Make successful account confirmations single-use."""

import sqlalchemy as sa
from alembic import op

revision = "z7a8b9c0d1e2"
down_revision = "y6z7a8b9c0d1"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("change_confirmation_version", sa.Integer(),
                                     server_default="0", nullable=False))


def downgrade():
    op.drop_column("users", "change_confirmation_version")
